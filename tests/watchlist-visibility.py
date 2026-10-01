"""Watchlist pauses requests while hidden and catches up once on return."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(error.stack))
        page.route('https://**/*', lambda route: route.fulfill(
            body='window.supabase={createClient:()=>({rpc:async()=>({data:[]})})};' if 'supabase-js' in route.request.url else '',
            content_type='application/javascript',
        ))
        page.route('**/auth.js', lambda route: route.fulfill(
            body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
            content_type='application/javascript',
        ))
        page.route('**/api/**', lambda route: route.fulfill(json={'data': [], 'updated': {}}))
        page.goto(f'http://localhost:{server.server_port}/tracker.html')
        page.wait_for_function("WATCHLIST_TABLE !== null && trackerFetchPending === null")
        page.evaluate('''() => {
            window.testVisibility = 'visible';
            Object.defineProperty(document, 'visibilityState', {get:()=>testVisibility, configurable:true});
            window.setTestVisibility = value => {
                testVisibility = value;
                document.dispatchEvent(new Event('visibilitychange'));
            };
            const dt = new Date().toISOString().slice(0,10);
            window.remoteProfile = {id:'fixture', metadata:{bets:[], watchlist:[{
                player:'new favorite', sport:'mlb', page:'dingers', prop:'hr', dt,
                quote:{book:'fd', odds:300, handicap:0.5, under:false, game:'bal @ kc'}
            }]}};
            CURR_USER = {id:'fixture', metadata:{bets:[], watchlist:[]}};
            CURR_SESSION = {user:{id:'fixture'}};
            window.profileReads = 0;
            window.popularReads = 0;
            SB = {
                from:()=>({select:()=>({eq:()=>({maybeSingle:()=>{
                    profileReads++;
                    return Promise.resolve({data:structuredClone(remoteProfile), error:null});
                }})})}),
                rpc:async()=>{popularReads++; return {data:[{player:'new favorite',count:2}]};}
            };
            window.requests = [];
            window.refreshErrors = [];
            console.error = (...args) => refreshErrors.push(args.map(String));
            window.fetch = (_url, options) => new Promise((resolve, reject) => {
                requests.push({signal:options.signal, resolve:data=>resolve({ok:true,json:async()=>data}), reject});
            });
        }''')

        # Hidden initial requests are skipped. Return events and explicit refresh coalesce.
        page.evaluate("setTestVisibility('hidden'); fetchTrackerData(); window.dispatchEvent(new Event('pageshow'))")
        assert page.evaluate('requests.length') == 0
        assert page.evaluate('profileReads + popularReads') == 0
        page.evaluate("setTestVisibility('visible'); window.dispatchEvent(new Event('pageshow')); window.sameRequest = fetchTrackerData() === fetchTrackerData()")
        page.wait_for_function('requests.length === 1')
        assert page.evaluate('sameRequest')
        assert page.evaluate('profileReads') == 1
        assert page.evaluate('popularReads') == 2
        page.evaluate("requests[0].resolve({data:[],updated:{}})")
        page.wait_for_function("trackerFetchPending === null && WATCHLIST_TABLE.getData().length === 1")
        assert page.evaluate('WATCHLIST_TABLE.getData()[0].line') == 300
        assert 'New Favorite' in page.locator('#popular-watchlist-list').inner_text()

        # Refresh the backing profile without replacing edits currently typed in the modal.
        page.evaluate("openWatchlistEdit(WATCHLIST_TABLE.getData()[0])")
        page.locator('#abt-manual-odds').fill('999')
        page.locator('#abt-line').fill('4.5')
        page.evaluate("remoteProfile.metadata.watchlist[0].quote.odds=350; setTestVisibility('hidden'); setTestVisibility('visible')")
        page.wait_for_function('requests.length === 2')
        page.evaluate("requests[1].resolve({data:[],updated:{}})")
        page.wait_for_function('trackerFetchPending === null')
        assert page.evaluate('WATCHLIST_TABLE.getData()[0].line') == 350
        assert page.locator('#abt-manual-odds').input_value() == '999'
        assert page.locator('#abt-line').input_value() == '4.5'
        page.evaluate('closeAddBet()')

        # Late results from an aborted request cannot repaint or replace the fresh profile.
        page.evaluate("setTestVisibility('hidden'); setTestVisibility('visible')")
        page.wait_for_function('requests.length === 3')
        page.evaluate("window.oldRun=trackerFetchPending; setTestVisibility('hidden')")
        assert page.evaluate('requests[2].signal.aborted')
        page.evaluate('oldRun')  # Settles before the mock transport/body cooperates with abort.
        page.evaluate("remoteProfile.metadata.watchlist[0].quote.odds=400; setTestVisibility('visible'); window.dispatchEvent(new Event('pageshow'))")
        page.wait_for_function('requests.length === 4')
        page.evaluate("requests[3].resolve({data:[],updated:{fresh:1}})")
        page.wait_for_function('trackerFetchPending === null')
        page.evaluate("requests[2].resolve({data:[{player:'stale'}],updated:{stale:1}})")
        page.evaluate('oldRun')
        assert page.evaluate('ALL_ROWS') == []
        assert page.evaluate('WATCHLIST_TABLE.getData()[0].line') == 400
        assert page.evaluate('RES.updated') == {'fresh': 1}

        # Back/forward lifecycle pauses too, even when visibilityState has not changed.
        page.evaluate("window.dispatchEvent(new Event('pagehide')); fetchTrackerData()")
        assert page.evaluate('requests.length') == 4
        page.evaluate("window.dispatchEvent(new Event('pageshow'))")
        page.wait_for_function('requests.length === 5')
        page.evaluate("window.hiddenRun=trackerFetchPending; window.dispatchEvent(new Event('pagehide')); requests[4].reject(new Error('Late network failure'))")
        page.evaluate('hiddenRun')
        assert page.evaluate('refreshErrors') == []

        # Slow popular lists cannot delay the returned tab's prices and favorites.
        page.evaluate('''() => {
            window.heldPopular = [];
            SB.rpc = () => new Promise(resolve => heldPopular.push(resolve));
            remoteProfile.metadata.watchlist[0].quote.odds = 475;
            window.dispatchEvent(new Event('pageshow'));
        }''')
        page.wait_for_function('requests.length === 6 && heldPopular.length === 2')
        page.evaluate("requests[5].resolve({data:[],updated:{fresh:2}})")
        page.wait_for_function('WATCHLIST_TABLE.getData()[0].line === 475')
        assert page.evaluate('RES.updated') == {'fresh': 2}
        assert page.evaluate('trackerFetchPending !== null')
        page.evaluate('heldPopular.forEach(resolve => resolve({data:[]}))')
        page.wait_for_function('trackerFetchPending === null')
        assert not errors, errors
        print('Hidden requests, coalescing, cross-tab favorites, modal preservation, late responses, page lifecycle and slow popular lists passed.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
