"""Offline Record header sorting with real ROI bins: python -B tests/record-roi-sort.py."""
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
HARNESS = runpy.run_path(str(ROOT / 'tests/nhl-reorder.py'))
GRID = {'evMin': 0, 'evStep': 1, 'evBins': 31, 'oddsMin': 100, 'oddsStep': 100, 'oddsBins': 30}
PROP_HEATMAP = {'grid': GRID, 'xy': {'fd': {'pn+circa': {'8': {
    '0': [90, 10, 125], '1': [4, 6, 4], '2': [2, 7, 0],
    '3': [1, 9, -4.5], '4': [2, 10, 1], '6': [0, 0, 0],
}}}}}
ROW_SPECS = [('negative', 450), ('missing bucket', 650), ('small profit', 550),
             ('large profit', 150), ('zero profit', 350), ('medium profit', 250), ('zero bets', 750)]
DESCENDING = ['large profit', 'medium profit', 'small profit', 'zero profit', 'negative']
MISSING = {'missing bucket', 'zero bets'}


def rows():
    return [{'player': name, 'sport': 'nhl', 'prop': 'sog', 'team': 'tor', 'opp': 'bos',
             'game': 'tor @ bos', 'pos': 'C', 'handicap': 2.5, 'under': False,
             'book': 'fd', 'line': line, 'ev': 8.2, 'fairVal': line - 20, 'kelly': 0.2,
             'bookOdds': {'fd': f'{line}/-900'}, 'liquidity': {}, 'links': {}, 'logs': []}
            for name, line in ROW_SPECS]


class RecordRoiSortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(HARNESS['QuietHandler'], directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "record-roi-sort-browser.log"}'])

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

    def open(self, width=1280, history=True):
        if self.page:
            self.page.close()
        self.page = self.browser.new_page(viewport={'width': width, 'height': 844})
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        HARNESS['mock_page'](self.page)
        self.page.goto(f'http://localhost:{self.server.server_port}/nhl.html?view=table&devig=pn-circa&weight=1-1')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.page.evaluate("""async ({rows,history}) => {
            RES = null;
            DEVIG = 'pn+circa'; DEVIG_EXCLUDED = [];
            HEATMAP = history || {};
            TABLE.clearFilter(true); TABLE.clearSort();
            await TABLE.replaceData(rows);
            TABLE.getRows().forEach(row => row.reformat());
        }""", {'rows': rows(), 'history': {'grid': GRID, 'xy': {'sog': PROP_HEATMAP['xy']}} if history else None})
        expect(self.page.locator('.tabulator-header [tabulator-field="roiRecord"]')).to_be_visible()

    def names(self):
        return self.page.evaluate("TABLE.getData('active').map(row => row.player)")

    def sorters(self):
        return self.page.evaluate('TABLE.getSorters().map(sort => ({field:sort.field,dir:sort.dir}))')

    def click_header(self):
        # Click the label itself, not the adjacent information button.
        self.page.locator('.record-column-heading').click(position={'x': 4, 'y': 6})

    def expect_order(self, known):
        self.page.wait_for_function("""known => JSON.stringify(TABLE.getData('active')
            .slice(0,known.length).map(row=>row.player)) === JSON.stringify(known)""", arg=known)
        self.assertEqual(set(self.names()[len(known):]), MISSING)

    def test_header_sorts_numeric_roi_both_directions_and_info_does_not_sort(self):
        for width in (1280, 320):
            with self.subTest(width=width):
                self.open(width)
                records = self.page.evaluate("Object.fromEntries(TABLE.getData().map(row=>[row.player,getRowROI(row)]))")
                self.assertEqual(records['large profit']['roi'], 1.25)
                self.assertEqual(records['zero profit']['roi'], 0)
                self.assertEqual(records['negative']['roi'], -0.45)
                self.assertIsNone(records['zero bets'])
                self.assertIsNone(records['missing bucket'])
                # Equal wins still have different ROI; W/L text cannot supply this order.
                self.assertEqual(records['small profit']['wins'], records['zero profit']['wins'])
                self.click_header()
                self.expect_order(DESCENDING)
                self.assertEqual(self.sorters(), [{'field': 'roiRecord', 'dir': 'desc'}])
                expect(self.page.locator('[tabulator-field="roiRecord"] .record-roi').first).to_have_text('+125.0% ROI')
                self.click_header()
                self.expect_order(list(reversed(DESCENDING)))
                self.assertEqual(self.sorters(), [{'field': 'roiRecord', 'dir': 'asc'}])
                before = self.names()
                self.page.locator('.record-info-button').click()
                expect(self.page.locator('#record-info')).to_be_visible()
                self.assertEqual(self.names(), before)
                self.assertEqual(self.sorters(), [{'field': 'roiRecord', 'dir': 'asc'}])
                self.page.locator('.record-info-close').click()
                expect(self.page.locator('#record-info')).not_to_be_visible()
                column = self.page.locator('.tabulator-header [tabulator-field="roiRecord"]')
                self.assertEqual(round(column.bounding_box()['width']), 80)
                label_bounds = column.evaluate("""col => {
                    const heading=col.querySelector('.record-column-heading');
                    const range=document.createRange(); range.selectNodeContents(heading.firstChild);
                    return [col.getBoundingClientRect().toJSON(),range.getBoundingClientRect().toJSON(),
                        heading.querySelector('button').getBoundingClientRect().toJSON()];
                }""")
                for rect in label_bounds[1:]:
                    self.assertGreaterEqual(rect['left'], label_bounds[0]['left'])
                    self.assertLessEqual(rect['right'], label_bounds[0]['right'])
                sorted_height = self.page.locator('.tabulator-header').bounding_box()['height']
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'record-roi-sort-{width}.png'))
                self.page.evaluate("async () => { await TABLE.getColumn('roiRecord').updateDefinition({headerSort:false}); TABLE.redraw(true); }")
                baseline_height = self.page.locator('.tabulator-header').bounding_box()['height']
                self.assertLessEqual(sorted_height, baseline_height + 1, 'Sort arrow should not make the table header taller')

    def test_delayed_heatmap_reapplies_record_sort_and_preserves_other_sorts(self):
        self.open(history=False)
        self.assertTrue(self.page.evaluate("TABLE.getData().every(row=>getRowROI(row) === null)"))
        pending = []
        self.page.route('**/heatmaps/*.json.gz', lambda route: pending.append(route))
        # Compression is a transport detail; use JSON bytes with the actual fetch,
        # heatmap loader, getRowROI, formatter and column sorter unchanged.
        self.page.evaluate("""() => {
            window.pako = {ungzip: bytes => new TextDecoder().decode(bytes)};
            window.heatmapLoadDone = false;
            loadHeatmapData().then(() => { window.heatmapLoadDone = true; });
        }""")
        self.page.wait_for_timeout(50)
        self.assertEqual(len(pending), 1)
        self.click_header()
        self.assertEqual(self.sorters(), [{'field': 'roiRecord', 'dir': 'desc'}])
        pending.pop().fulfill(json=PROP_HEATMAP)
        self.page.wait_for_function('window.heatmapLoadDone')
        self.expect_order(DESCENDING)

        # Tabulator applies its final sorter as the primary key.
        self.page.evaluate("TABLE.setSort([{column:'player',dir:'desc'},{column:'roiRecord',dir:'asc'}])")
        saved_sorters = self.sorters()
        changed = deepcopy(PROP_HEATMAP)
        changed['xy']['fd']['pn+circa']['8']['0'][2] = -90
        self.page.evaluate("() => { window.heatmapLoadDone=false; loadHeatmapData().then(()=>window.heatmapLoadDone=true); }")
        self.page.wait_for_timeout(50)
        self.assertEqual(len(pending), 1)
        pending.pop().fulfill(json=changed)
        self.page.wait_for_function('window.heatmapLoadDone')
        self.assertEqual(self.sorters(), saved_sorters)
        self.expect_order(['large profit', 'negative', 'zero profit', 'small profit', 'medium profit'])

        self.page.evaluate("TABLE.setSort([{column:'player',dir:'asc'}])")
        expected = sorted(name for name, _line in ROW_SPECS)
        self.assertEqual(self.names(), expected)
        self.page.evaluate("() => { window.heatmapLoadDone=false; loadHeatmapData().then(()=>window.heatmapLoadDone=true); }")
        self.page.wait_for_timeout(50)
        self.assertEqual(len(pending), 1)
        pending.pop().fulfill(json=PROP_HEATMAP)
        self.page.wait_for_function('window.heatmapLoadDone')
        self.assertEqual(self.names(), expected)
        self.assertEqual(self.sorters(), [{'field': 'player', 'dir': 'asc'}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
