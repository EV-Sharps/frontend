"""Offline NCAAB prediction markets, filters, Customize and line comparisons."""
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
BOOKS = ['circa', 'pn', 'fd', 'dk', 'b365', 'kal', 'nv', 'px', 'poly']


def payload():
    base = dict(sport='ncaab', game='duke @ unc', gameId='duke @ unc',
                dt='2099-11-02', team='duke', opp='unc', teamId='duke', oppId='unc',
                book='px', line=200, under=False, handicap=20.5, prop='pts',
                logs=[15, 22, 28], hitRate=67, hitRateLYR=50, links={},
                bookOdds={book: '200/-250' for book in BOOKS},
                liquidity={book: [300, 25] for book in ['kal', 'nv', 'px', 'poly']})
    guard = dict(base, player='test guard')
    forward = dict(base, player='test forward', under=True,
                   liquidity={book: [25, 300] for book in ['kal', 'nv', 'px', 'poly']})
    away = dict(base, player='', prop='spread', handicap=3.5, logs=[], main=True)
    home = dict(away, team='unc', opp='duke', under=True, handicap=-3.5)
    alternate = dict(away, handicap=4.5)
    moneyline = dict(away, prop='ml', handicap=0.5)
    rows = [guard, dict(guard, handicap=21.5), dict(guard, prop='reb', handicap=6.5),
            forward, away, home, alternate, moneyline]
    return dict(data=rows, games=['duke @ unc'], props=['pts', 'reb', 'spread', 'ml'],
                updated={book: '2099-11-02T12:00:00Z' for book in BOOKS},
                times={'duke @ unc': '2099-11-02T23:00:00Z'})


class NcaabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(HARNESS['QuietHandler'], directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "ncaab-browser.log"}'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 900})
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        HARNESS['mock_page'](self.page)
        self.page.route('**/api/ncaab*', lambda route: route.fulfill(json=deepcopy(payload())))

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def open(self, view='table'):
        self.page.goto(f'http://localhost:{self.server.server_port}/ncaab.html?view={view}&devig=pn&weight=1')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true && (CURRENT_VIEW === 'mobile' ? document.querySelector('#card-container .data-card') : TABLE.getData('active').length > 0)")
        auto = self.page.locator('.table-refresh-auto input')
        if auto.count():
            auto.uncheck()

    def test_prediction_columns_filters_and_exclusions(self):
        self.open()
        for book in ['b365', 'kal', 'nv', 'px', 'poly']:
            self.assertTrue(self.page.evaluate('(book) => !!TABLE.getColumn(`bookOdds.${book}`)', book))
            expect(self.page.locator(f'#exclude-options input[value="{book}"]')).to_have_count(1)
            expect(self.page.locator(f'#book-options input[value="{book}"]')).to_have_count(1)
        cell = self.page.locator('.tabulator-row .tabulator-cell[tabulator-field="bookOdds.px"]').first
        expect(cell).to_contain_text('$300')
        expect(cell).to_contain_text('$25')
        HARNESS['open_window'](self.page)
        expect(self.page.locator('.fb-liquidity-rule')).to_have_count(3)
        self.page.locator('#fb-liquidity-ev-enabled').check()
        self.page.locator('#fb-liquidity-ev-book').select_option('px')
        self.page.locator('#fb-liquidity-ev-amount').fill('50')
        self.page.locator('button[onclick="applyFilterBuilder()"]').click()
        self.assertTrue(self.page.evaluate("TABLE.getData('active').every(row => row.liquidity.px[row.under ? 1 : 0] >= 50)"))
        HARNESS['open_window'](self.page)
        self.page.locator('#fb-liquidity-ev-book').select_option('poly')
        self.page.locator('button[onclick="applyFilterBuilder()"]').click()
        self.assertEqual(self.page.evaluate('FB_CONFIG.liquidityEV.book'), 'poly')
        self.page.keyboard.press('Escape')
        self.page.locator('#exclude-dd .chkdd-btn').click()
        self.page.locator('[data-exclude-prediction]').click()
        self.assertTrue(self.page.evaluate("['kal','nv','px','poly'].every(book => getExcludedBooks().includes(book))"))

    def test_customize_and_compact_keep_prediction_columns(self):
        self.open('compact')
        self.page.locator('#customize').click()
        for field in ['handicap', 'prop', 'opp', 'bookOdds_b365', 'bookOdds_kal', 'bookOdds_nv', 'bookOdds_px', 'bookOdds_poly']:
            expect(self.page.locator(f'#custom_{field}')).to_have_count(1)
        self.page.locator('#cx-column-search').fill('ProphetX')
        self.page.locator('#custom_bookOdds_px').uncheck()
        self.assertFalse(self.page.evaluate("TABLE.getColumn('bookOdds.px').isVisible()"))
        self.page.locator('#custom_bookOdds_px').check()
        self.assertTrue(self.page.evaluate("TABLE.getColumn('bookOdds.px').isVisible()"))
        self.page.locator('.cx-reorder').click()
        expect(self.page.locator('#col-reorder-modal')).to_be_visible()
        self.assertTrue(self.page.evaluate("createSharedColumnReorderModel(TABLE).items.some(item => item.fields.includes('bookOdds.px'))"))

    def test_player_and_game_comparisons_and_mobile_cards(self):
        self.open()
        self.page.locator('#table .player-lines-trigger').filter(has_text='Test Guard').first.click()
        expect(self.page.locator('#player-lines-prop option')).to_have_count(2)
        self.page.locator('#player-lines-prop').select_option('reb')
        expect(self.page.locator('#player-lines-dialog')).to_contain_text('$300')
        self.page.locator('.player-lines-close').click()
        self.page.evaluate("openPlayerLines(TABLE.getData().find(row => row.prop === 'spread' && row.under))")
        expect(self.page.locator('#player-lines-prop')).to_have_attribute('aria-label', 'Market for DUKE @ UNC')
        expect(self.page.locator('#player-lines-dialog tbody tr')).to_have_count(2)
        self.assertIn('duke', self.page.locator('#player-lines-legend').inner_text().lower())
        self.assertIn('unc', self.page.locator('#player-lines-legend').inner_text().lower())
        self.page.locator('.player-lines-close').click()
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.open('mobile')
        expect(self.page.locator('#card-container')).to_be_visible()
        self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'ncaab-cards.png'))
        self.page.locator('#card-container .player-lines-trigger').filter(has_text='Spread').first.click()
        expect(self.page.locator('#player-lines-dialog')).to_be_visible()
        self.assertTrue(self.page.evaluate("document.getElementById('player-lines-dialog').getBoundingClientRect().right <= innerWidth"))
        self.page.locator('.player-lines-close').click()
        self.page.locator('#filterbuilder-dd-button').click()
        HARNESS['check_layout'](self.page, 390)
        self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'ncaab-filters.png'))

    def test_old_profiles_receive_columns_and_new_hidden_choices_are_saved(self):
        self.open('compact')
        HARNESS['setup_profile'](self.page)
        self.page.evaluate("""() => {
            ENABLE_AUTH = true;
            CURR_USER.metadata = {ncaab:['ev','book','player','bookOdds_pn'], nba:['ev']};
            showHideUserTable(true);
        }""")
        for field in ['handicap', 'prop', 'opp', 'bookOdds.b365', 'bookOdds.kal', 'bookOdds.nv', 'bookOdds.px', 'bookOdds.poly']:
            self.assertTrue(self.page.evaluate('(field) => TABLE.getColumn(field).isVisible()', field), field)
        self.page.evaluate("CURR_USER.metadata['ncaab-line-column-version'] = 1; showHideUserTable(true)")
        self.assertFalse(self.page.evaluate("TABLE.getColumn('handicap').isVisible()"))
        self.page.locator('#customize').click()
        self.page.locator('#cx-column-search').fill('ProphetX')
        self.page.locator('#custom_bookOdds_px').uncheck()
        self.page.locator('#cx-column-search').fill('Opponent')
        self.page.locator('#custom_opp').uncheck()
        self.page.evaluate('saveTableSettings()')
        self.assertEqual(self.page.evaluate("CURR_USER.metadata['ncaab-columns-version']"), 1)
        self.assertEqual(self.page.evaluate('CURR_USER.metadata.nba'), ['ev'])
        self.page.evaluate('showHideUserTable(true)')
        self.assertFalse(self.page.evaluate("TABLE.getColumn('bookOdds.px').isVisible()"))
        self.assertFalse(self.page.evaluate("TABLE.getColumn('opp').isVisible()"))


if __name__ == '__main__':
    unittest.main(verbosity=2)
