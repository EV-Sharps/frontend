"""Offline football team points columns, saved settings, and filter integration."""
import argparse
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, default=ROOT, help='Fallback assets for a staged frontend')
args = parser.parse_args()


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass

    def translate_path(self, path):
        staged = Path(super().translate_path(path))
        return str(staged if staged.is_file() else args.assets / staged.relative_to(ROOT))


game_date = (date.today() + timedelta(days=1)).isoformat()


def fixture(name, prop, points, sport, handicap=0.5):
    return {
        'player': name, 'prop': prop, 'dt': game_date, 'team': 'phi', 'opp': 'dal',
        'game': 'phi @ dal', 'sport': sport, 'pos': 'WR', 'handicap': handicap, 'under': False,
        'book': 'fd', 'line': 150, 'bookOdds': {'fd': '150/-175', 'pn': '130/-155', 'circa': '135/-160'},
        'liquidity': {}, 'logs': [0, 1, 0], 'hitRate': 33, 'hitRateLYR': 20,
        'snaps': ['60%', '65%', '70%'], 'teamTotal': points,
        'oppRank': {'opp-rz-scoring-pct': {'rank': 8}}, 'carries': [2, 3],
        'dvpRank': 6, 'dvpAllowed': 0.7, 'dvpGames': 3, 'dvpContext': True,
    }


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        cases = [(name, 1440, 'compact') for name in ('nfl', 'tds', 'tds2', 'ftd', 'ncaaf', 'ncaafprops')]
        cases.extend((name, 390, 'mobile') for name in ('nfl', 'ncaaf'))
        for name, width, view in cases:
            sport = 'ncaaf' if name.startswith('ncaaf') else 'nfl'
            prop = {'tds': 'attd', 'tds2': 'attd', 'ftd': 'ftd'}.get(name, 'rec_yd')
            handicap = 1.5 if name == 'tds2' else 0.5
            rows = [fixture(player, prop, points, sport, handicap) for player, points in
                    [('high team', 27.25), ('boundary team', 24), ('low team', 23.75), ('unknown team', None)]]
            payload = {'data': rows, 'props': [prop], 'games': ['phi @ dal'], 'updated': {},
                       'times': {'phi @ dal': game_date + 'T20:20:00-04:00'}}
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.set_default_timeout(5000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript'))
            page.route('**/record_*.js', lambda route: route.fulfill(
                body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type='application/javascript'))
            page.route('**/api/**', lambda route: route.fulfill(json=payload))
            page.goto(f'http://localhost:{server.server_port}/{name}.html?view={view}&devig=pn-circa&weight=1-1')
            count = "document.querySelectorAll('#card-container .data-card').length" if view == 'mobile' else "TABLE?.getData().length"
            page.wait_for_function(f"document.getElementById('data-status')?.hidden === true && {count} === 4")
            if view == 'mobile':
                page.evaluate("changeView('compact')")
                page.wait_for_function("TABLE.getData().length === 4")
            assert page.evaluate("TABLE.getColumn('teamTotal').isVisible()")
            assert page.evaluate("TABLE.getColumn('teamTotal').getDefinition().title") == 'Est. Team<br>Pts'
            assert page.locator('#custom_teamTotal').count() == 1
            assert page.evaluate("TABLE.getColumn('teamTotal').getDefinition().headerTooltip").startswith('Estimated full-game points')
            if view == 'compact':
                assert page.locator('.tabulator-cell[tabulator-field="teamTotal"]').all_text_contents() == ['27.25', '24.00', '23.75', '-']
                page.evaluate("TABLE.setSort('teamTotal', 'desc')")
                assert page.evaluate("TABLE.getData('active').map(row => row.player)") == ['high team', 'boundary team', 'low team', 'unknown team']
                page.evaluate("TABLE.setSort('teamTotal', 'asc')")
                assert page.evaluate("TABLE.getData('active').map(row => row.player)") == ['low team', 'boundary team', 'high team', 'unknown team']

            if name != 'ncaafprops':  # Legacy table has no filter-builder panel.
                if view == 'mobile':
                    page.evaluate("changeView('mobile')")
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length === 4")
                assert page.locator('#fb-teamtotal-enabled').count() == 1
                assert page.locator('#fb-teamtotal-min').input_value() == '24'
                page.locator('#filterbuilder-dd-button').click()
                assert page.locator('#fb-teamtotal-enabled').locator('..').inner_text() == 'Est. Team Pts'
                assert page.locator('#fb-teamtotal-min').get_attribute('aria-label') == 'Minimum estimated team points'
                page.locator('#fb-teamtotal-enabled').check()
                assert page.evaluate("TABLE.getData('active').length") == 4, 'Rule edits should wait for Apply'
                page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()

                def names():
                    return "(CURRENT_VIEW === 'mobile' ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player) : TABLE.getData('active').map(row => row.player)).sort()"

                page.wait_for_function(f"JSON.stringify({names()}) === JSON.stringify(['boundary team','high team'])")
                page.locator('#fb-teamtotal-min').fill('27')
                page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()
                page.wait_for_function(f"JSON.stringify({names()}) === JSON.stringify(['high team'])")
                page.locator('#filterbuilder-options button[onclick="clearFilterBuilder()"]').click()
                page.wait_for_function(f"{names()}.length === 4")
                page.evaluate('closeFilterBuilderWindow()')

            page.evaluate("""() => {
                ENABLE_AUTH = true;
                CURR_USER = {id:'fixture', metadata:{[PAGE]:['player','book']}};
                CURR_SESSION = {user:{id:'fixture'}};
                SB = {from:() => ({update:payload => ({eq:async () => {
                    window.savedMetadata = payload.metadata;
                    return {error:null};
                }})})};
                showHideUserTable(true);
            }""")
            assert page.evaluate("TABLE.getColumn('teamTotal').isVisible()"), 'Existing profiles should see the new column'
            page.evaluate('openOverlay()')
            assert page.locator('#custom_teamTotal').is_checked()
            page.locator('#custom_teamTotal').uncheck()
            page.evaluate('saveTableSettings()')
            page.wait_for_function("window.savedMetadata?.[`${PAGE}-team-total-version`] === 1")
            assert page.evaluate("!savedMetadata[PAGE].includes('teamTotal')")
            page.evaluate('CURR_USER.metadata = savedMetadata; showHideUserTable(true); closeOverlay();')
            assert not page.evaluate("TABLE.getColumn('teamTotal').isVisible()"), 'Saved hiding must survive the migration'
            assert not errors, errors
            print(f'{name} {width}px: team points display, sort, filter (when available), settings migration passed')
            page.close()
        browser.close()
finally:
    server.shutdown()
