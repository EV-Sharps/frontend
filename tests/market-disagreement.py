"""Offline browser regression checks for the default market-disagreement filter."""
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
NBA = runpy.run_path(str(ROOT / 'tests/nba-filters.py'))
ALL_NAMES = ['extreme points', 'extreme threes', 'normal points']
CONTROL = '#fb-market-disagreements-enabled'
STATUS = '#fb-market-disagreements-status'


def payload_for():
    payload = NBA['payload_for']('nba')
    base = payload['data'][0]
    rows = []
    for player, prop, extreme in [('normal points', 'pts', False),
                                  ('extreme points', 'pts', True),
                                  ('extreme threes', '3ptm', True)]:
        row = deepcopy(base)
        row.update(player=player, prop=prop, handicap='29.5' if prop == 'pts' else '4.5')
        row['bookOdds'] = ({'fd': '2000/-10000', 'dk': '1500/-6000',
                            'hr': '1200/-5000', 'nv': '-153/130'} if extreme else
                           {'fd': '180/-220', 'dk': '170/-210',
                            'hr': '160/-200', 'nv': '155/-195'})
        rows.append(row)
    payload.update(data=rows, props=['pts', '3ptm'])
    return payload


class MarketDisagreementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(HARNESS['QuietHandler'], directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "market-disagreement-browser.log"}'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

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
        self.payload = payload_for()
        self.requests = 0

        def respond(route):
            self.requests += 1
            route.fulfill(json=deepcopy(self.payload))

        self.page.route(f'**/api/{name}*', respond)
        self.page.goto(f'http://localhost:{self.server.server_port}/{name}.html?view={view}&sport=nba&devig=nv&weight=1')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.expect_names(['normal points'])
        self.assertEqual(self.page.locator(CONTROL).count(), 1)
        expect(self.page.locator(CONTROL)).not_to_be_checked()
        expect(self.page.locator('#filterbuilder-dd-button')).to_have_text('2 hidden')

    def names(self):
        return self.page.evaluate("""() => (CURRENT_VIEW === 'mobile'
            ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
            : TABLE.getData('active').map(row => row.player)).sort()""")

    def expect_names(self, names):
        self.page.wait_for_function("""expected => JSON.stringify((CURRENT_VIEW === 'mobile'
            ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
            : TABLE.getData('active').map(row => row.player)).sort()) === JSON.stringify(expected)""", arg=sorted(names))

    def menu(self):
        HARNESS['open_window'](self.page)

    def apply(self):
        HARNESS['action'](self.page, 'applyFilterBuilder')

    def clear(self):
        HARNESS['action'](self.page, 'clearFilterBuilder')

    def scope(self):
        return self.page.evaluate("""() => Object.fromEntries(['prop', 'game'].map(kind => [kind, {
            label: document.getElementById(`${kind}-dd-button`).textContent,
            selected: [...document.querySelectorAll(`#${kind}-options input:checked`)].map(el => el.value)
        }]))""")

    def test_default_draft_apply_clear_and_layout_on_table_and_mobile_cards(self):
        for width, view in [(1440, 'compact'), (320, 'mobile')]:
            with self.subTest(width=width, view=view):
                self.open(width=width, view=view)
                original_scope = self.scope()
                # Tabulator may add null entries for absent displayed book columns.
                quote_values = 'RES.data.map(row => Object.fromEntries(Object.entries(row.bookOdds).filter(([, value]) => value != null)))'
                original_odds = self.page.evaluate(quote_values)
                self.menu()
                expect(self.page.locator(STATUS)).to_have_text('2 matching rows hidden in the current selection.')
                expect(self.page.locator('#fb-active-summary')).to_have_text('2 hidden')
                expect(self.page.locator('#fb-draft-status')).to_have_text('Filters applied')
                HARNESS['check_layout'](self.page, width, 900)
                self.page.locator(CONTROL).check()
                self.assertEqual(self.names(), ['normal points'], 'Draft must not apply immediately')
                expect(self.page.locator('#fb-draft-status')).to_have_text('Changes not applied')
                expect(self.page.locator(STATUS)).to_contain_text('hidden')
                self.apply()
                self.expect_names(ALL_NAMES)
                expect(self.page.locator(STATUS)).to_have_text('2 matching rows shown in the current selection.')
                self.assertEqual(self.page.evaluate(quote_values), original_odds)
                self.assertEqual(self.scope(), original_scope)
                self.clear()
                self.expect_names(['normal points'])
                expect(self.page.locator(CONTROL)).not_to_be_checked()
                expect(self.page.locator(STATUS)).to_contain_text('2 matching rows hidden')
                expect(self.page.locator('#fb-active-summary')).to_have_text('2 hidden')
                expect(self.page.locator('#fb-draft-status')).to_have_text('Filters applied')
                self.assertEqual(self.scope(), original_scope)
                if width == 320:
                    self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'market-disagreement-mobile.png'))

    def test_reference_changes_refresh_and_current_selection_counts(self):
        self.open()
        self.page.evaluate("() => { DEVIG='fd+dk+hr'; WEIGHT='1+1+1'; REQUIRED=[]; updateRequiredDropdown(); return changeFilter(); }")
        self.expect_names(ALL_NAMES)
        self.assertEqual(self.page.evaluate('FB_MARKET_DISAGREEMENT_COUNT'), 0)
        self.page.evaluate("() => { DEVIG='nv+dk+hr'; WEIGHT='1+1+1'; DEVIG_EXCLUDED=['nv']; updateRequiredDropdown(); return changeFilter(); }")
        self.expect_names(ALL_NAMES)
        self.page.evaluate("() => { DEVIG_EXCLUDED=[]; updateRequiredDropdown(); return changeFilter(); }")
        self.expect_names(['normal points'])

        self.page.evaluate("() => { setOptions('prop-options', ['pts']); updatePropLabel(['pts']); return changeFilter(); }")
        self.expect_names(['normal points'])
        self.assertEqual(self.page.evaluate('FB_MARKET_DISAGREEMENT_COUNT'), 1)
        self.menu()
        expect(self.page.locator(STATUS)).to_have_text('1 matching row hidden in the current selection.')
        original_scope = self.scope()
        self.page.locator(CONTROL).check()
        self.apply()
        self.expect_names(['normal points', 'extreme points'])
        self.assertEqual(self.scope(), original_scope)
        self.clear()
        self.page.evaluate('closeFilterBuilderWindow()')

        extreme = next(row for row in self.payload['data'] if row['player'] == 'extreme points')
        extreme['bookOdds']['nv'] = '1400/-6000'
        before = self.requests
        self.page.locator('button.table-refresh-now').click()
        self.expect_names(['normal points', 'extreme points'])
        self.assertGreater(self.requests, before)
        self.assertEqual(self.page.evaluate('FB_MARKET_DISAGREEMENT_COUNT'), 0)
        extreme['bookOdds']['nv'] = '-153/130'
        self.page.locator('button.table-refresh-now').click()
        self.expect_names(['normal points'])
        self.assertEqual(self.page.evaluate('FB_MARKET_DISAGREEMENT_COUNT'), 1)

    def test_save_load_legacy_config_and_reload_default(self):
        self.open()
        HARNESS['setup_profile'](self.page)
        self.page.evaluate("""() => {
            CURR_USER.metadata['nba-savedFilters'] = [{name:'Old default', config:{}}];
            populateSavedFilterBuilderSelect();
        }""")
        self.menu()
        self.page.locator(CONTROL).check()
        self.page.locator('#fb-name-input').fill('Include disagreements')
        HARNESS['action'](self.page, 'saveFilterBuilder')
        self.page.wait_for_function('filterWrites.length === 1')
        self.assertEqual(self.names(), ['normal points'], 'Save As should only save draft')
        self.assertEqual(self.page.evaluate("filterWrites[0].value.metadata['nba-savedFilters'][1].config.marketDisagreements"), {'enabled': True})
        self.clear()
        self.page.locator('#fb-saved-select').select_option('1')
        self.expect_names(ALL_NAMES)
        expect(self.page.locator(CONTROL)).to_be_checked()
        self.page.locator('#fb-saved-select').select_option('0')
        self.expect_names(['normal points'])
        expect(self.page.locator(CONTROL)).not_to_be_checked()
        self.page.locator('#fb-saved-select').select_option('1')
        self.expect_names(ALL_NAMES)
        self.page.reload()
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.expect_names(['normal points'])
        expect(self.page.locator(CONTROL)).not_to_be_checked()

    def test_raw_devig_outliers(self):
        for width, view in [(1440, 'compact'), (320, 'mobile')]:
            with self.subTest(width=width, view=view):
                self.open(name='outliers', width=width, view=view)
                self.assertEqual(self.page.evaluate('VIG'), '0')
                self.menu()
                HARNESS['check_layout'](self.page, width, 900)
                self.page.locator(CONTROL).check()
                self.apply()
                self.expect_names(ALL_NAMES)
                self.clear()
                self.expect_names(['normal points'])
                # Keep FD as a betting candidate: cards independently omit rows
                # that have no positive raw comparison outside reference books.
                self.page.evaluate("() => { DEVIG='dk+hr'; WEIGHT='1+1'; REQUIRED=[]; updateRequiredDropdown(); return changeFilter(); }")
                self.expect_names(ALL_NAMES)
                self.assertEqual(self.page.evaluate('FB_MARKET_DISAGREEMENT_COUNT'), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
