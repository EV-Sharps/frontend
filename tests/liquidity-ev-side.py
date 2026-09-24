"""Exercise EV-side liquidity through the shared filter UI with local fixtures."""
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


def assert_rows(page, expected):
    page.wait_for_function(
        "ids => JSON.stringify(TABLE.getData().map(row => row.id).sort()) === JSON.stringify(ids)",
        arg=expected,
    )


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "liquidity-ev-side.log"}',
        ])
        for name in ('tds', 'dingers', 'main'):
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript',
            ))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {},
            }))
            page.goto(f'http://localhost:{server.server_port}/{name}.html?devig=pn&weight=100&book=px')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate('''async () => {
                DEVIG = 'pn'; WEIGHT = '100';
                document.getElementById('book-select').value = 'px';
                document.getElementById('ou-select').value = 'ou';
                RES.data = Array.from({length:6}, (_, i) => ({
                    id:i, player:'test player ' + Math.floor(i / 2),
                    sport:PAGE === 'dingers' ? 'mlb' : 'nfl', team:'bal', opp:'kc', away:true,
                    game:'bal @ kc', prop:PAGE === 'dingers' ? 'hr' : PAGE === 'main' ? 'total' : 'attd',
                    handicap:0.5, under:!!(i % 2), pos:'WR', hitRates:{}, logs:[0,1,0],
                    bookOdds:{pn:'-110/-110',px:'+120/+120'},
                    liquidity:{px:i < 2 ? [50,5] : i < 4 ? [5,50] : [5,5]},
                }));
                await changeView('table');
            }''')
            assert_rows(page, [0, 1, 2, 3, 4, 5])
            assert page.evaluate("RES.data.every(row => row.book === 'px' && Number(row.ev) > 0)")

            page.locator('#filterbuilder-dd-button').click()
            assert page.locator('.fb-liquidity-group input[type="checkbox"]').count() == 1
            assert page.locator('#fb-liquidity-enabled, #fb-liquidity-over-enabled, #fb-liquidity-match').count() == 0
            page.locator('#fb-liquidity-ev-enabled').check()
            page.locator('#fb-liquidity-ev-book').select_option('px')
            page.locator('#fb-liquidity-ev-amount').fill('50')
            page.locator('#filterbuilder-options').get_by_role('button', name='Apply', exact=True).click()
            assert_rows(page, [0, 3])
            assert page.locator('#filterbuilder-dd-button').inner_text() == '1 Filter'
            config = page.evaluate('readFilterBuilderFromDOM()')
            assert config['liquidityEV'] == {'enabled': True, 'book': 'px', 'amount': '50'}
            assert not {'liquidity', 'liquidityOver', 'liquidityMatch'}.intersection(config)

            page.locator('#filterbuilder-options').get_by_role('button', name='Clear', exact=True).click()
            assert_rows(page, [0, 1, 2, 3, 4, 5])
            assert not page.locator('#fb-liquidity-ev-enabled').is_checked()
            assert page.locator('#filterbuilder-dd-button').inner_text() == 'None'

            # Older side presets load into the same visible EV-row control.
            page.evaluate('''config => {
                CURR_USER = {metadata:{[`${PAGE}-savedFilters`]:[
                    {name:'EV side PX',config},
                    {name:'Legacy over PX',config:{liquidityOver:{enabled:true,book:'px',amount:'49'},
                        liquidityEV:{enabled:false}}},
                    {name:'Empty',config:{}},
                ]}};
                populateSavedFilterBuilderSelect();
            }''', config)
            page.locator('#fb-saved-select').select_option('0')
            assert_rows(page, [0, 3])
            assert page.locator('#fb-liquidity-ev-enabled').is_checked()
            page.locator('#fb-saved-select').select_option('1')
            assert_rows(page, [0, 3])
            assert page.locator('#fb-liquidity-ev-enabled').is_checked()
            assert page.locator('#fb-liquidity-ev-amount').input_value() == '49'
            assert page.locator('#filterbuilder-dd-button').inner_text() == '1 Filter'
            page.locator('#fb-saved-select').select_option('2')
            assert_rows(page, [0, 1, 2, 3, 4, 5])
            assert not page.locator('#fb-liquidity-ev-enabled').is_checked()
            page.locator('#fb-saved-select').select_option('0')
            assert_rows(page, [0, 3])

            # Restoring an active legacy filter also normalizes the state used by the table.
            page.evaluate('''async () => {
                CURR_USER.metadata[`${PAGE}-activeFilter`] = {liquidity:{enabled:true,book:'px',amount:'50'}};
                restoreFilterBuilder();
                await changeFilter();
            }''')
            assert_rows(page, [0, 3])
            assert page.locator('#fb-liquidity-ev-enabled').is_checked()
            assert page.locator('#filterbuilder-dd-button').inner_text() == '1 Filter'
            for side, expected in [('o', [0]), ('u', [3]), ('ou', [0, 3])]:
                page.evaluate('''async side => {
                    document.getElementById('ou-select').value = side;
                    await changeFilter();
                }''', side)
                assert_rows(page, expected)

            page.locator('#filterbuilder-dd-button').click()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate("async () => { await changeView('mobile'); }")
            assert page.locator('#card-container .data-card').count() == 2
            assert not errors, errors
            print(f'{name}: single liquidity control, both EV sides, $50 boundary, clear, legacy presets and mobile passed.', flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
