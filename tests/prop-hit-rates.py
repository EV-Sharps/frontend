"""Check MLB/NFL hit-rate data, sorting and Customize persistence with local fixtures."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = ['szn', 'L10', 'L20', 'lyr']


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "prop-hit-rates.log"}',
        ])
        for sport in ['mlb', 'nfl']:
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
            page.goto(f'http://localhost:{server.server_port}/{sport}.html')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate('''async () => {
                RES = null;
                TABLE.clearFilter(true);
                TABLE.clearSort();
                const rates = [
                    {szn:{p:25},L10:{p:30},L20:{p:35},lyr:{p:40}},
                    {szn:{p:0},L10:{p:0},L20:{p:0},lyr:{p:0}},
                    {szn:{p:'100'},L10:{p:'100'},L20:{p:'100'},lyr:{p:'100'}},
                    {szn:{p:null},L10:{},lyr:{p:''}},
                ];
                await TABLE.setData(rates.map((hitRates, id) => ({
                    id, hitRates, player:'test player ' + id, sport:PAGE, team:'bal', opp:'kc',
                    game:'bal @ kc', prop:PAGE === 'mlb' ? 'hr' : 'rec', handicap:0.5,
                    under:false, book:'px', ev:10, line:120, fairVal:100, logs:[0,1,0],
                    percs:{}, batter_percs:{}, savant:{}, pitcherData:{},
                    bookOdds:{pn:'-110/-110',px:'+120/+120'},
                })));
            }''')
            assert page.evaluate("TABLE.getColumns().filter(c => c.getField()?.startsWith('hitRates.')).map(c => c.getField())") == [f'hitRates.{key}' for key in WINDOWS]
            for index, key in enumerate(WINDOWS):
                field = f'hitRates.{key}'
                assert page.evaluate('field => TABLE.getRow(0).getCell(field).getElement().textContent', field) == f'{25 + index * 5}%'
                assert page.evaluate('field => TABLE.getRow(1).getCell(field).getElement().textContent', field) == '0%'
                assert page.evaluate('field => TABLE.getRow(3).getCell(field).getElement().textContent', field) == ''
                for direction, expected in [('asc', [1, 0, 2, 3]), ('desc', [2, 0, 1, 3])]:
                    page.evaluate('([field, dir]) => TABLE.setSort(field, dir)', [field, direction])
                    assert page.evaluate("TABLE.getData('active').map(row => row.id)") == expected
            assert page.evaluate("hitRateFormatter({getValue:()=>({p:0}),getRow:()=>({getData:()=>({blurred:true})})})") == '<div class="blurred">0%</div>'

            page.locator('#customize').click()
            for key in WINDOWS:
                checkbox = page.locator(f'#custom_hitRates_{key}')
                assert checkbox.is_checked()
                checkbox.uncheck()
                assert not page.evaluate('field => TABLE.getColumn(field).isVisible()', f'hitRates.{key}')
                page.evaluate('closeOverlay(); openOverlay()')
                assert not checkbox.is_checked()
                checkbox.check()
                assert page.evaluate('field => TABLE.getColumn(field).isVisible()', f'hitRates.{key}')

            # Existing profiles see the restored columns. Save goes to an in-memory stub.
            page.evaluate('''() => {
                ENABLE_AUTH = true;
                CURR_USER = {metadata:{[PAGE]:['ev','player','logs','hitRate','hitRateLYR']}};
                CURR_SESSION = {user:{id:'fixture'}};
                SB = {from:()=>({update:payload=>({eq:async()=>{
                    window.savedProfile = payload.metadata;
                    return {error:null};
                }})})};
                showHideUserTable(true);
                openOverlay();
            }''')
            for key in WINDOWS:
                assert page.locator(f'#custom_hitRates_{key}').is_checked()
                assert page.evaluate('field => TABLE.getColumn(field).isVisible()', f'hitRates.{key}')
            page.locator('#custom_hitRates_L10').uncheck()
            page.evaluate('saveTableSettings()')
            assert page.evaluate('savedProfile[`${PAGE}-hit-rates-version`]') == 1
            assert not page.evaluate("savedProfile[PAGE].includes('hitRates_L10')")
            for key in ['szn', 'L20', 'lyr']:
                assert page.evaluate('key => savedProfile[PAGE].includes(key)', f'hitRates_{key}')
            page.evaluate('''() => {
                CURR_USER = {metadata:JSON.parse(JSON.stringify(savedProfile))};
                if (PAGE === 'nfl') TABLE.setColumns(buildNflColumns(['ev','player','logs','hitRate','hitRateLYR']));
                showHideUserTable(true);
                openOverlay();
            }''')
            assert not page.locator('#custom_hitRates_L10').is_checked()
            assert not page.evaluate("TABLE.getColumn('hitRates.L10').isVisible()")
            for key in ['szn', 'L20', 'lyr']:
                assert page.locator(f'#custom_hitRates_{key}').is_checked()
            if sport == 'nfl':
                page.evaluate('openColReorder()')
                labels = page.locator('#col-reorder-list').inner_text()
                assert all(f'{label} Hit Rate' in labels for label in ['Season', 'L20', 'LYR'])
                assert 'L10 Hit Rate' not in labels
                page.evaluate('closeColReorder()')
            page.evaluate('closeOverlay()')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate("changeView('compact')")
            assert page.evaluate("TABLE.getColumn('hitRates.szn').isVisible()")
            assert not errors, errors
            print(f'{sport}: all four rates, zero/missing values, numeric sorting, Customize, saved visibility and compact passed.', flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
