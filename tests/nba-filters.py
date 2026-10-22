"""Offline NBA position and lineup filters in the existing table/card Filter modal."""
from copy import deepcopy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import runpy
import tempfile
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
HARNESS = runpy.run_path(str(ROOT / 'tests/filter-window.py'))
SPECS = [
    ('confirmed point guard', 'PG', 'PG', 'confirmed', True, True),
    ('expected shooting guard', 'PG', 'SG', 'expected', False, True),
    ('unknown combo guard', 'PG', 'PG/SG', 'unknown', None, None),
    ('confirmed small forward', 'SF', 'SF', 'confirmed', True, True),
    ('expected power forward', 'SF', 'PF', 'expected', False, True),
    ('confirmed center', 'C', None, 'confirmed', True, True),
    ('confirmed forward center', 'C', 'PF/C', 'confirmed', True, True),
    ('expected hybrid forward', 'SF', 'SF-PF', 'expected', False, True),
    ('confirmed bench guard', 'PG', 'SG', 'confirmed', True, False),
    ('legacy confirmed forward', 'PF', None, None, True, False),
    ('explicit expected center', 'C', None, 'expected', True, True),
    ('explicit unknown forward', 'SF', 'PF', 'unknown', True, None),
    ('empty lineup fallback', 'C', '', None, None, None),
    ('missing position', None, None, None, None, None),
]
ALL_NAMES = sorted(row[0] for row in SPECS)
CONFIRMED = sorted(['confirmed point guard', 'confirmed small forward', 'confirmed center',
                    'confirmed forward center', 'confirmed bench guard', 'legacy confirmed forward'])
GUARDS = sorted(['confirmed point guard', 'expected shooting guard', 'unknown combo guard', 'confirmed bench guard'])
FORWARDS = sorted(['confirmed small forward', 'expected power forward', 'confirmed forward center',
                   'expected hybrid forward', 'legacy confirmed forward', 'explicit unknown forward'])
CONFIRMED_GUARDS = ['confirmed bench guard', 'confirmed point guard']


def payload_for(name):
    prop = {'threes': '3ptm', 'fb': 'fb'}.get(name, 'pts')
    rows = []
    for player, pos, lineup_pos, status, confirmed, starting in SPECS:
        row = {'player': player, 'sport': 'nba', 'prop': prop, 'handicap': '0.5',
               'team': 'bos', 'opp': 'lal', 'game': 'bos @ lal', 'dt': '2099-10-21',
               'under': False, 'ouIdx': 0, 'pos': pos, 'avgMin': 30, 'teamTotal': 115,
               'book': 'fd', 'line': 150, 'liquidity': {}, 'links': {},
               'logs': [0, 1, 2], 'hitRate': 66, 'hitRateLYR': 50,
               'hitRates': {}, 'oppRank': 15, 'oppPosRank': 20,
               'confirmed': confirmed, 'starting': starting,
               'bookOdds': {'fd': '150/-175', 'dk': '145/-170', 'pn': '130/-155', 'circa': '135/-160'}}
        if lineup_pos is not None:
            row['lineupPosition'] = lineup_pos
        if status is not None:
            row['lineupStatus'] = status
        if name == 'fb':
            row['bookOdds'] = {book: odds.split('/')[0] for book, odds in row['bookOdds'].items()}
        rows.append(row)
    return {'data': rows, 'games': ['bos @ lal'], 'props': [prop], 'updated': {},
            'times': {'bos @ lal': '2099-10-21T23:00:00Z'}}


class NbaFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(HARNESS['QuietHandler'], directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "nba-filters-browser.log"}'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.page = None
        self.errors = []

    def tearDown(self):
        if self.page:
            self.page.close()
        self.assertEqual(self.errors, [])

    def open(self, name='nba', width=1440, view='compact'):
        if self.page:
            self.page.close()
        self.page = self.browser.new_page(viewport={'width': width, 'height': 900})
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        HARNESS['mock_page'](self.page)
        self.payload = payload_for(name)
        self.requests = 0

        def respond(route):
            self.requests += 1
            route.fulfill(json=deepcopy(self.payload))

        self.page.route(f'**/api/{name}*', respond)
        self.page.goto(f'http://localhost:{self.server.server_port}/{name}.html?view={view}&devig=pn-circa&weight=1-1')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.assertEqual(self.page.evaluate('PAGE'), name)
        self.expect_names(ALL_NAMES)
        self.assertEqual(self.page.locator('#fb-position-enabled').count(), 1)
        self.assertEqual(self.page.locator('#fb-lineup-enabled').count(), 1)
        expect(self.page.locator('#fb-position-enabled')).not_to_be_checked()
        expect(self.page.locator('#fb-lineup-enabled')).not_to_be_checked()
        expect(self.page.locator('#fb-position-value')).to_have_value('PG')
        expect(self.page.locator('#fb-lineup-value')).to_have_value('confirmed')

    def names(self):
        return self.page.evaluate("""() => (CURRENT_VIEW === 'mobile'
            ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
            : TABLE.getData('active').map(row => row.player)).sort()""")

    def expect_names(self, names):
        self.page.wait_for_function("""expected => JSON.stringify((CURRENT_VIEW === 'mobile'
            ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
            : TABLE.getData('active').map(row => row.player)).sort()) === JSON.stringify(expected)""", arg=sorted(names))

    def menu(self):
        if not self.page.locator('#filterbuilder-options').is_visible():
            self.page.locator('#filterbuilder-dd-button').click()

    def set_rule(self, name, value):
        self.menu()
        self.page.locator(f'#fb-{name}-enabled').check()
        self.page.locator(f'#fb-{name}-value').select_option(value)

    def apply(self):
        self.menu()
        self.page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()

    def clear(self):
        self.menu()
        self.page.locator('#filterbuilder-options button[onclick="clearFilterBuilder()"]').click()

    def test_position_and_lineup_apply_clear_and_combination_on_table_and_cards(self):
        for width, view in [(1440, 'compact'), (320, 'mobile')]:
            with self.subTest(width=width, view=view):
                self.open(width=width, view=view)
                self.assertEqual(self.page.locator('#fb-position-value option').evaluate_all(
                    'options => options.map(option => option.value)'), ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'])
                self.assertEqual(self.page.locator('#fb-lineup-value option').evaluate_all(
                    'options => options.map(option => option.value)'), ['confirmed', 'unconfirmed'])
                self.set_rule('lineup', 'confirmed')
                self.assertEqual(self.names(), ALL_NAMES, 'Draft edits must wait for Apply')
                self.apply()
                self.expect_names(CONFIRMED)  # Includes confirmed bench players and legacy confirmation.
                self.set_rule('lineup', 'unconfirmed')
                self.assertEqual(self.names(), CONFIRMED)
                self.apply()
                self.expect_names(set(ALL_NAMES) - set(CONFIRMED))
                self.clear()
                self.expect_names(ALL_NAMES)
                expect(self.page.locator('#fb-lineup-enabled')).not_to_be_checked()

                for position, wanted in [
                    ('PG', ['confirmed point guard', 'unknown combo guard']),
                    ('SG', ['expected shooting guard', 'unknown combo guard', 'confirmed bench guard']),
                    ('C', ['confirmed center', 'confirmed forward center', 'explicit expected center', 'empty lineup fallback']),
                    ('G', GUARDS), ('F', FORWARDS),
                ]:
                    self.set_rule('position', position)
                    self.apply()
                    self.expect_names(wanted)
                self.set_rule('position', 'G')
                self.set_rule('lineup', 'confirmed')
                self.apply()
                self.expect_names(CONFIRMED_GUARDS)
                expect(self.page.locator('#filterbuilder-dd-button')).to_have_text('2 Filters')
                self.menu()
                bounds = self.page.locator('#filterbuilder-options').bounding_box()
                self.assertGreaterEqual(bounds['x'], -1)
                self.assertLessEqual(bounds['x'] + bounds['width'], width + 1)
                self.assertLessEqual(bounds['y'] + bounds['height'], 901)
                for selector in ('#fb-position-value', '#fb-lineup-value'):
                    control = self.page.locator(selector).bounding_box()
                    self.assertGreaterEqual(control['x'], bounds['x'] - 1)
                    self.assertLessEqual(control['x'] + control['width'], bounds['x'] + bounds['width'] + 1)
                self.clear()
                self.expect_names(ALL_NAMES)
                expect(self.page.locator('#fb-position-enabled')).not_to_be_checked()
                expect(self.page.locator('#fb-lineup-enabled')).not_to_be_checked()

    def test_saved_filters_refresh_and_view_switching_keep_applied_rules(self):
        self.open()
        self.page.evaluate("""() => {
            CURR_USER = {id:'fixture', tier:'sharp', metadata:{'nba-savedFilters':[
                {name:'Old guards', config:{position:{enabled:true,value:'G'}}}
            ]}};
            CURR_SESSION = {user:{id:'fixture'}};
            SB = {from:() => ({update:payload => ({eq:async () => {
                window.savedFilterMetadata = structuredClone(payload.metadata);
                return {error:null};
            }})})};
            populateSavedFilterBuilderSelect();
        }""")
        self.set_rule('position', 'G')
        self.set_rule('lineup', 'confirmed')
        self.apply()
        self.expect_names(CONFIRMED_GUARDS)
        self.menu()
        self.page.locator('#fb-name-input').fill('Confirmed guards')
        self.page.locator('#filterbuilder-options button[onclick="saveFilterBuilder()"]').click()
        self.page.wait_for_function("window.savedFilterMetadata?.['nba-savedFilters']?.length === 2")
        saved = self.page.evaluate("savedFilterMetadata['nba-savedFilters'][1].config")
        self.assertEqual(saved['position'], {'enabled': True, 'value': 'G'})
        self.assertEqual(saved['lineup'], {'enabled': True, 'value': 'confirmed'})
        self.clear()
        self.expect_names(ALL_NAMES)
        self.menu()
        self.page.locator('#fb-saved-select').select_option('1')
        self.expect_names(CONFIRMED_GUARDS)

        changed = next(row for row in self.payload['data'] if row['player'] == 'expected shooting guard')
        changed.update(lineupStatus='confirmed', confirmed=True)
        self.page.evaluate('closeFilterBuilderWindow()')
        before = self.requests
        self.page.locator('button.table-refresh-now').click()
        refreshed = CONFIRMED_GUARDS + ['expected shooting guard']
        self.expect_names(refreshed)
        self.assertGreater(self.requests, before)
        for view in ('mobile', 'table', 'compact'):
            self.page.evaluate('view => changeView(view)', view)
            self.expect_names(refreshed)
        self.menu()
        self.page.locator('#fb-saved-select').select_option('0')
        self.expect_names(GUARDS)
        expect(self.page.locator('#fb-lineup-enabled')).not_to_be_checked()
        self.page.reload()
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.expect_names(ALL_NAMES)
        expect(self.page.locator('#filterbuilder-dd-button')).to_have_text('None')
        expect(self.page.locator('#fb-saved-select option[value="1"]')).to_have_text('Confirmed guards')
        self.menu()
        self.page.locator('#fb-saved-select').select_option('1')
        self.expect_names(refreshed)

    def test_existing_points_threes_and_first_basket_modals_expose_and_apply_filters(self):
        for name in ('pts', 'threes', 'fb'):
            with self.subTest(page=name):
                self.open(name=name)
                self.set_rule('lineup', 'confirmed')
                self.apply()
                self.expect_names(CONFIRMED)
                self.set_rule('position', 'SG')
                self.apply()
                self.expect_names(['confirmed bench guard'])
                self.clear()
                self.expect_names(ALL_NAMES)


if __name__ == '__main__':
    unittest.main(verbosity=2)
