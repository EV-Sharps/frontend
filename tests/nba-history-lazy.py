"""Offline real-page checks for deferred NBA histories and shared modal regressions."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from time import monotonic
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--overlay', type=Path, default=Path(__file__).resolve().parents[1])
args = parser.parse_args()


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def translate_path(self, path):
        relative = unquote(urlparse(path).path).lstrip('/')
        for directory in (args.overlay, args.root):
            target = (directory / relative).resolve()
            if target.is_relative_to(directory.resolve()) and target.is_file():
                return str(target)
        return str(args.root / '_missing')


def key(number):
    return f'{number:064x}'


def history(number, prop, **overrides):
    return dict(key=key(number), playerId='42', prop=prop, before='2099-10-23', opp='bos',
                careerLogs=[0, 10, 20], bvtLogs=[0, 10], awayLogs=[20], homeLogs=[], **overrides)


def fixture(name):
    prop = '3ptm' if name == 'threes' else 'pts'
    base = dict(prop=prop, dt='2099-10-23', sport='nba', playerId='42', team='ny', opp='bos', game='ny @ bos',
                pos='PG', avgMin=30, handicap='15.5', under=False, ouIdx=0, book='fd', line=150,
                bookOdds={'fd':'150/-175', 'pn':'130/-155', 'circa':'135/-160'}, liquidity={},
                logs=[0, 5, 10], hitRate=50, hitRateLYR=45,
                hitRates={'career':{'w':2,'t':3,'p':67}, 'bvt':{'w':1,'t':2,'p':50}})
    rows = [dict(base, player='history alpha', historyKey=key(1)),
            dict(base, player='history beta', historyKey=key(2)),
            dict(base, player='legacy player', careerLogs=[3, 4, 5], bvtLogs=[7], awayLogs=[8], homeLogs=[9]),
            dict(base, player='blurred player', historyKey=key(3), blurred=True)]
    return {'data':rows, 'props':[prop], 'games':['ny @ bos'], 'updated':{}, 'times':{'ny @ bos':'2099-10-23T23:00:00Z'}}


server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name in ('nba', 'pts', 'threes'):
            for width in (1440, 390):
                page = browser.new_page(viewport={'width':width, 'height':900})
                page.set_default_timeout(7000)
                errors, calls, held = [], [], {}
                feed = fixture(name)
                prop = feed['props'][0]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script("""window.EventSource=undefined;
                  window.Plotly={newPlot:async(el,data,layout)=>{el.data=data;el.layout=layout;},
                    purge:el=>{el.data=[];},Plots:{resize:()=>{}}};""")
                page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
                page.route('**/auth.js', lambda route: route.fulfill(
                    body=(args.root/'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                    content_type='application/javascript'))
                page.route('**/record_*.js', lambda route: route.fulfill(
                    body="let RECORD_UPD=''; let RECORD={worst:{best:{}}};", content_type='application/javascript'))

                def api(route):
                    url = urlparse(route.request.url)
                    if url.path == '/api/nba-history':
                        value = parse_qs(url.query)['key'][0]
                        assert route.request.headers['authorization'] == 'Bearer history-fixture'
                        calls.append(value)
                        held.setdefault(value, []).append(route)
                    else:
                        route.fulfill(json=feed)
                page.route('**/api/**', api)
                page.goto(f'http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou')
                page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData().length === 4")
                assert calls == [], 'Initial odds render must not fetch any player history'
                page.evaluate("ACCESS_TOKEN='history-fixture'")

                def wait_request(number):
                    deadline = monotonic() + 5
                    while not held.get(key(number)) and monotonic() < deadline:
                        page.wait_for_timeout(20)
                    assert held.get(key(number)), (name, width, number, calls)
                    return held[key(number)].pop(0)

                def open_row(player='history alpha', **changes):
                    page.evaluate("""({player,changes})=>NbaHistory.open({...TABLE.getData().find(row=>row.player===player),...changes})""",
                                  {'player':player, 'changes':changes})

                def chart(values, prefix='nba'):
                    page.wait_for_function("""({values,prefix})=>JSON.stringify(document.getElementById(prefix+'-history-chart')?.data?.[0]?.y)===JSON.stringify(values)""",
                                           arg={'values':values,'prefix':prefix})

                popup = page.locator('#nba-history-dialog')
                # Actual table click retains the existing entry point at both widths.
                page.evaluate("TABLE.getRows().find(row=>row.getData().player==='history alpha').getCell('ev').getElement().setAttribute('data-history-click','target')")
                page.locator('[data-history-click="target"]').click()
                alpha = wait_request(1)
                chart([0, 5, 10])
                popup.locator('[data-history-view="career"]').click()
                assert 'Loading player history' in popup.locator('.nhl-history-empty').inner_text()
                assert popup.locator('.nhl-history-stats > div').count() == 0
                assert 'No ' not in popup.locator('.nhl-history-empty').inner_text()
                assert popup.get_by_role('button', name='Compare prices').is_enabled()
                assert popup.get_by_role('button', name='Play card').is_enabled()

                # A late response for alpha must not replace beta's selected history.
                open_row('history beta')
                beta = wait_request(2)
                popup.locator('[data-history-view="career"]').click()
                beta_data = history(2, prop)
                beta_data['careerLogs'] = [2, 2, 2]
                beta.fulfill(json=beta_data)
                chart([2, 2, 2])
                alpha.fulfill(json=history(1, prop))
                page.wait_for_timeout(40)
                chart([2, 2, 2])
                assert popup.locator('h2').inner_text() == 'History Beta'

                # Alternative lines/sides reuse immutable history without mutating the feed.
                open_row(handicap='35.5', under=True)
                popup.locator('[data-history-view="career"]').click()
                chart([0, 10, 20])
                assert calls.count(key(1)) == 1
                assert '100% (3/3)' in popup.locator('.nhl-history-stats').inner_text()
                assert page.evaluate("['careerLogs','bvtLogs','awayLogs','homeLogs'].every(field=>!(field in TABLE.getData().find(row=>row.player==='history alpha')) && !(field in RES.data.find(row=>row.player==='history alpha')))")

                # A changed content key fetches; prices are usable while it is pending.
                open_row(historyKey=key(4))
                changed = wait_request(4)
                popup.get_by_role('button', name='Compare prices').click()
                page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
                assert not popup.evaluate('el=>el.open')
                changed.fulfill(json=history(4, prop))
                page.wait_for_timeout(40)
                assert not popup.evaluate('el=>el.open'), 'A late response must not reopen a closed dialog'
                page.evaluate("document.getElementById('player-lines-dialog').close()")
                open_row(historyKey=key(4))
                popup.locator('[data-history-view="bvt"]').click()
                chart([0, 10])
                assert calls.count(key(4)) == 1

                # Failure is retryable, and pending/error long tabs never report zero games.
                open_row(historyKey=key(5))
                failed = wait_request(5)
                popup.locator('[data-history-view="home"]').click()
                failed.fulfill(status=503, json={'error':'unavailable'})
                popup.get_by_role('button', name='Retry', exact=True).wait_for()
                assert 'Unable to load player history' in popup.locator('.nhl-history-empty').inner_text()
                assert popup.locator('.nhl-history-stats > div').count() == 0
                popup.locator('[data-history-view="logs"]').click()
                chart([0, 5, 10])
                popup.locator('[data-history-view="home"]').click()
                popup.get_by_role('button', name='Retry', exact=True).click()
                retry = wait_request(5)
                assert 'Loading player history' in popup.locator('.nhl-history-empty').inner_text()
                retry.fulfill(json=history(5, prop))
                page.wait_for_function("document.querySelector('#nba-history-dialog .nhl-history-empty')?.textContent.startsWith('No home game logs')")
                assert calls.count(key(5)) == 2

                # A retired content key explains that this table must be refreshed.
                open_row(historyKey=key(8))
                stale = wait_request(8)
                popup.locator('[data-history-view="career"]').click()
                stale.fulfill(status=404, json={'error':'not_found'})
                popup.get_by_role('button', name='Retry', exact=True).wait_for()
                assert 'History for this table is no longer available. Refresh the page and try again.' in popup.locator('.nhl-history-empty').inner_text()
                assert popup.locator('.nhl-history-stats > div').count() == 0

                # Play cards remain immediate and keep using the short inline logs.
                open_row(historyKey=key(7))
                pending_card = wait_request(7)
                popup.get_by_role('button', name='Play card').click()
                page.wait_for_function("document.getElementById('card-modal-overlay')?.classList.contains('open') || document.querySelector('.card-modal-overlay.open')")
                pending_card.fulfill(json=history(7, prop))
                page.wait_for_timeout(40)
                assert not popup.evaluate('el=>el.open')
                page.evaluate("document.querySelectorAll('[id*=card-modal],.card-modal-overlay').forEach(el=>el.classList.remove('open'))")

                # Existing inline rows and other sports retain their previous behavior.
                count = len(calls)
                open_row('legacy player')
                popup.locator('[data-history-view="career"]').click()
                chart([3, 4, 5])
                page.evaluate('NbaHistory.close()')
                for sport, module, market in [('nhl','NhlHistory','sog'), ('nfl','NflHistory','rec_yd')]:
                    page.evaluate("""({module,market,key})=>window[module].open({...TABLE.getData().find(row=>row.player==='legacy player'),prop:market,historyKey:key})""",
                                  {'module':module,'market':market,'key':key(6)})
                    dialog = page.locator(f'#{sport}-history-dialog')
                    dialog.locator('[data-history-view="bvt"]').click()
                    chart([7], sport)
                    page.evaluate(f'{module}.close()')
                open_row('blurred player')
                assert not popup.evaluate('el=>el.open')
                assert len(calls) == count
                assert errors == [], errors
                page.close()
                print(f'{name} {width}px passed: no eager requests, cache, changed key, races, retry, cards/prices, legacy and NHL/NFL', flush=True)
        browser.close()
finally:
    server.shutdown()
    server.server_close()
