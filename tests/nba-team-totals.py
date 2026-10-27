"""Offline NBA team points columns/cards, saved settings, and filter integration."""
import argparse
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import tempfile

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, default=ROOT, help='Fallback assets for a staged frontend')
args = parser.parse_args()
artifacts = Path(tempfile.gettempdir())


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
        'game': 'phi @ dal', 'sport': sport, 'pos': 'PG', 'handicap': handicap, 'under': False,
        'book': 'fd', 'line': 150, 'bookOdds': {'fd': '150/-175', 'pn': '130/-155', 'circa': '135/-160'},
        'liquidity': {}, 'logs': [0, 1, 0], 'hitRate': 33, 'hitRateLYR': 20,
        'teamTotal': points, 'oppRank': 8, 'oppPosRank': 6, 'avgMin': 30,
    }


def check_team_pill_layout(page):
    card = page.locator('#card-container .data-card').first
    if 'expanded' not in (card.get_attribute('class') or ''):
        card.locator('.card-arrow-container').click()
    pill, game = card.locator('.nba-team-total'), card.locator('.card-game-pill')
    assert pill.is_visible() and game.is_visible()
    assert pill.locator('span').inner_text() == 'Est. Team Pts'
    assert pill.evaluate('el => el.previousElementSibling.classList.contains("card-game-pill")')
    points_bounds, game_bounds = pill.bounding_box(), game.bounding_box()
    assert abs(points_bounds['y'] - game_bounds['y']) <= 1, 'Team points must sit on the Game pill row'
    assert points_bounds['x'] >= game_bounds['x'] + game_bounds['width'] - 1
    assert pill.locator('strong').bounding_box()['y'] < pill.locator('span').bounding_box()['y']
    assert card.evaluate('el => el.scrollWidth <= el.clientWidth + 1')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={artifacts / "nba-team-totals-browser.log"}'])
        cases = [(name, 1440, 'compact') for name in ('nba', 'pts', 'threes', 'fb')]
        cases.extend((name, 390, 'mobile') for name in ('nba', 'pts', 'threes', 'fb'))
        for name, width, view in cases:
            sport = 'nba'
            prop = {'threes': '3ptm', 'fb': 'fb'}.get(name, 'pts')
            handicap = 0.5
            rows = [fixture(player, prop, points, sport, handicap) for player, points in
                    [('high team', 120.25), ('boundary team', 110), ('low team', 99.75), ('unknown team', None)]]
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
            assert page.evaluate('PAGE') == name, 'First Basket must preserve its own page settings through redirect'
            if view == 'mobile':
                assert page.locator('#card-container .nba-team-total strong').all_text_contents() == ['120.25', '110.00', '99.75', '-']
                assert page.locator('#card-container .card-row.nba-team-total').count() == 0
                assert page.locator('#card-container .expanded-ranks > .card-game-pill + .nba-team-total').count() == 4
                check_team_pill_layout(page)
                missing = page.locator('#card-container .data-card').last
                missing.locator('.card-arrow-container').click()
                expect(missing.locator('.nba-team-total strong')).to_have_text('-')
                expect(missing.locator('.nba-team-total')).to_be_visible()
                if name in ('nba', 'fb'):
                    for card_width in (320, 1440):
                        page.set_viewport_size({'width': card_width, 'height': 900})
                        check_team_pill_layout(page)
                        page.screenshot(path=str(artifacts / f'{name}-team-total-card-{card_width}.png'))
                    page.set_viewport_size({'width': width, 'height': 900})
                if name == 'nba':
                    payload['data'][0]['teamTotal'] = 121.5
                    page.locator('.table-refresh-now').click()
                    expect(page.locator('#card-container .nba-team-total strong').first).to_have_text('121.50')
                    check_team_pill_layout(page)
                page.evaluate("changeView('compact')")
                page.wait_for_function("TABLE.getData().length === 4")
            assert page.evaluate("TABLE.getColumn('teamTotal').isVisible()")
            assert page.evaluate("TABLE.getColumn('teamTotal').getDefinition().title") == 'Est. Team<br>Pts'
            assert page.locator('#custom_teamTotal').count() == 1
            assert page.evaluate("TABLE.getColumn('teamTotal').getDefinition().headerTooltip").startswith('Estimated full-game points')
            assert page.evaluate("DEFAULT_FIELDS[PAGE].includes('teamTotal')")
            if name in ('nba', 'fb'):
                assert page.evaluate("buildNbaColumns(['player', 'book']).some(col => col.field === 'teamTotal')"), 'Legacy saved column order must include the added column'
                assert page.evaluate("getNbaColumnItems().some(item => item.key === 'teamTotal')")
            if view == 'compact':
                assert page.locator('.tabulator-cell[tabulator-field="teamTotal"]').all_text_contents() == ['120.25', '110.00', '99.75', '-']
                page.evaluate("TABLE.setSort('teamTotal', 'desc')")
                assert page.evaluate("TABLE.getData('active').map(row => row.player)") == ['high team', 'boundary team', 'low team', 'unknown team']
                page.evaluate("TABLE.setSort('teamTotal', 'asc')")
                assert page.evaluate("TABLE.getData('active').map(row => row.player)") == ['low team', 'boundary team', 'high team', 'unknown team']

            if name in ('nba', 'pts', 'threes', 'fb'):
                if view == 'mobile':
                    page.evaluate("changeView('mobile')")
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length === 4")
                assert page.locator('#fb-teamtotal-enabled').count() == 1
                assert page.locator('#fb-teamtotal-min').input_value() == '110'
                page.locator('#filterbuilder-dd-button').click()
                assert page.locator('#fb-teamtotal-enabled').locator('..').inner_text() == 'Est. Team Pts'
                assert page.locator('#fb-teamtotal-min').get_attribute('aria-label') == 'Minimum estimated team points'
                page.locator('#fb-teamtotal-enabled').check()
                assert page.evaluate("TABLE.getData('active').length") == 4, 'Rule edits should wait for Apply'
                page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()

                def names():
                    return "(CURRENT_VIEW === 'mobile' ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player) : TABLE.getData('active').map(row => row.player)).sort()"

                page.wait_for_function(f"JSON.stringify({names()}) === JSON.stringify(['boundary team','high team'])")
                page.locator('#fb-teamtotal-min').fill('120')
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
            print(f'{name} {width}px: team points display/cards, sort, filter, settings migration passed')
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
