"""Verify independent prop/page stars in tables, mobile cards and the tracker."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
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
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "watchlist-pages.log"}',
        ])
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('window.EventSource = undefined;')
        page.route('https://**/*', lambda route: route.fulfill(
            body='window.supabase={createClient:()=>({rpc:async()=>({data:[]})})};' if 'supabase-js' in route.request.url else '',
            content_type='application/javascript',
        ))
        page.route('**/auth.js', lambda route: route.fulfill(
            body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
            content_type='application/javascript',
        ))
        page.route('**/api/**', lambda route: route.fulfill(json={
            'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {},
        }))

        def setup_profile(profile):
            page.evaluate('''profile => {
                CURR_USER = profile;
                CURR_SESSION = {user:{id:'fixture'}};
                SB = {from:()=>({update:()=>({eq:async()=>({error:null})})}),rpc:async()=>({data:[]})};
            }''', profile)

        def visit(name, profile, props=('hr',)):
            page.goto(f'http://localhost:{server.server_port}/{name}.html')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            setup_profile(profile)
            page.evaluate('''async props => {
                RES = null;
                TABLE.clearFilter(true); TABLE.clearSort();
                TABLE.setColumns([watchlistColumn(),{title:'Player',field:'player',width:200}]);
                const row = {player:'test player',team:'bal',sport:'mlb',game:'bal @ kc',
                    prop:'hr',handicap:0.5,under:false,book:'fd',line:500,ev:10,fairVal:450,
                    bookOdds:{fd:'+500/-700',pn:'+450/-650'},logs:[0,1,0],hitRates:{}};
                const rows = props.map(prop => ({...row, prop}));
                await TABLE.setData(rows);
                initializeCards(rows);
                CURRENT_VIEW = 'table'; applyOddsTableView();
            }''', list(props))

        def toggle(selector, watched):
            star = page.locator(selector)
            star.click()
            page.wait_for_function('''({selector, watched}) => {
                const star = document.querySelector(selector);
                return !star.disabled && star.getAttribute('aria-pressed') === String(watched);
            }''', arg={'selector': selector, 'watched': watched})

        table_star = '#table .watchlist-star'
        card_star = '#card-container .watchlist-star'
        visit('dingers', {'metadata': {}})
        toggle(table_star, True)
        assert page.locator(card_star).get_attribute('aria-pressed') == 'true'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, False)
        page.evaluate("CURRENT_VIEW='table'; applyOddsTableView()")
        assert page.locator(table_star).get_attribute('aria-pressed') == 'false'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, True)
        profile = page.evaluate('CURR_USER')
        assert profile['metadata']['watchlist'][0]['page'] == 'dingers'

        visit('mlb', profile)
        assert page.locator(table_star).get_attribute('aria-pressed') == 'false'
        assert page.locator(card_star).get_attribute('aria-pressed') == 'false'
        toggle(table_star, True)
        profile = page.evaluate('CURR_USER')
        assert {entry['page'] for entry in profile['metadata']['watchlist']} == {'dingers', 'mlb'}
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, False)
        assert page.evaluate("CURR_USER.metadata.watchlist.map(entry => entry.page)") == ['dingers']
        toggle(card_star, True)
        profile = page.evaluate('CURR_USER')
        visit('dingers', profile)
        assert page.locator(table_star).get_attribute('aria-pressed') == 'true'

        # Doubles can be starred without starring singles or total bases.
        visit('mlb', profile, ('double', 'single', 'tb', 'hr'))
        double_table = table_star + '[data-prop="double"]'
        single_table = table_star + '[data-prop="single"]'
        double_card = card_star + '[data-prop="double"]'
        single_card = card_star + '[data-prop="single"]'
        toggle(double_table, True)
        assert page.locator(single_table).get_attribute('aria-pressed') == 'false'
        assert page.locator(table_star + '[data-prop="tb"]').get_attribute('aria-pressed') == 'false'
        assert page.locator(double_card).get_attribute('aria-pressed') == 'true'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(single_card, True)
        toggle(double_card, False)
        assert page.locator(single_card).get_attribute('aria-pressed') == 'true'
        toggle(double_card, True)
        profile = page.evaluate('CURR_USER')
        assert len(profile['metadata']['watchlist']) == 4
        visit('mlb', profile, ('double', 'single', 'tb', 'hr'))
        assert page.locator(double_table).get_attribute('aria-pressed') == 'true'
        assert page.locator(single_table).get_attribute('aria-pressed') == 'true'
        assert page.locator(table_star + '[data-prop="tb"]').get_attribute('aria-pressed') == 'false'

        # Tracker matches odds by prop and removes only the selected favorite.
        page.goto(f'http://localhost:{server.server_port}/tracker.html')
        page.wait_for_function("typeof WATCHLIST_TABLE !== 'undefined' && WATCHLIST_TABLE !== null")
        setup_profile(profile)
        page.evaluate('''() => {
            ALL_ROWS = [{player:'test player',sport:'mlb',team:'bal',prop:'hr',
                game:'bal @ kc',handicap:0.5,bookOdds:{fd:'+500/-700'}}];
            refreshWatchlist();
        }''')
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 4")
        assert page.evaluate("WATCHLIST_TABLE.getData().map(row => row.prop).sort()") == ['double', 'hr', 'hr', 'single']
        assert page.evaluate("WATCHLIST_TABLE.getData().filter(row => row.bookOdds).every(row => row.prop === 'hr')")
        assert page.locator('#watchlist-table [tabulator-field="watchlistPage"]').count() >= 5
        double_row = page.locator('#watchlist-table .tabulator-row').filter(
            has=page.locator('[tabulator-field="prop"]', has_text='2B'))
        double_row.locator('.wl-remove').click()
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 3")
        assert page.evaluate("isWatchlisted('test player','mlb','mlb','single')")
        assert not page.evaluate("isWatchlisted('test player','mlb','mlb','double')")
        page.evaluate("removeFromWatchlist('test player','mlb','mlb','hr')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 2")
        assert page.evaluate("isWatchlisted('test player','mlb','dingers','hr')")
        page.evaluate("toggleWatchlistTracker('test player')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 1")
        assert page.evaluate("isWatchlisted('test player','mlb','mlb','single')")
        page.evaluate("removeFromWatchlist('test player','mlb','mlb','single')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 0")
        assert not errors, errors
        print('Prop/page isolation, table and mobile stars, navigation persistence, tracker prop matching and removal passed.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
