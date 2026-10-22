"""Offline shared column reorder checks: python -B tests/shared-reorder.py."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import runpy
import tempfile
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
NHL = runpy.run_path(str(ROOT / 'tests/nhl-reorder.py'))
CUSTOMIZE = runpy.run_path(str(ROOT / 'tests/customize-window.py'))


class SharedReorderTests(unittest.TestCase):
    generic_cases = [
        ('outliers', 1280, True, 'bookOdds.dk'), ('threes', 320, True, 'kelly'),
        ('tracker', 1280, False, 'bookOdds.fd'), ('backfields', 320, False, 'snap'),
    ]

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(NHL['QuietHandler'], directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "shared-reorder-browser.log"}'])
        cls.origin = f'http://localhost:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.context = None
        self.errors = []

    def tearDown(self):
        if self.context:
            self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, path, width=1280):
        if self.context:
            self.context.close()
        self.context = self.browser.new_context(
            viewport={'width': width, 'height': 568 if width == 320 else 844}, has_touch=width == 320)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(f'{path}: {error}'))
        NHL['mock_page'](self.page)
        # Local tracker demo data overwrites cached profiles; exercise the normal
        # production path while keeping its real table and Customize handlers.
        self.page.route('**/tracker.html*', lambda route: route.fulfill(
            body=(ROOT / 'tracker.html').read_text(encoding='utf-8').replace('if (IS_LOCALHOST) {', 'if (false) {', 1),
            content_type='text/html'))
        self.navigate(path)

    def navigate(self, path):
        self.page.goto(f'{self.origin}/{path}')
        self.page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && TABLE.getColumns().length > 2")
        self.page.wait_for_function("!document.getElementById('data-status') || document.getElementById('data-status').hidden")

    def profile(self):
        self.page.evaluate("""() => {
            ENABLE_AUTH = true;
            CURR_USER = {id:'fixture', tier:'sharp', metadata:CURR_USER?.metadata || {}};
            CURR_SESSION = {user:{id:'fixture'}};
            window.reorderWrites = [];
            SB = {from: table => ({update: value => ({eq: async (key,id) => {
                reorderWrites.push({table,key,id,value:structuredClone(value)});
                return {error:null};
            }})})};
            document.querySelectorAll('#overlay .loggedOut').forEach(node => node.style.display='none');
        }""")

    def customize(self):
        if not self.page.locator('#overlay').is_visible():
            CUSTOMIZE['open_window'](self.page)

    def reorder(self, standard=True):
        if standard:
            self.customize()
        button = self.page.locator('.cx-reorder' if standard else '#shared-column-reorder')
        expect(button).to_be_visible()
        button.click()
        modal = self.page.locator('#col-reorder-modal')
        expect(modal).to_be_visible()
        panel = modal.locator('.modal-content.devig-panel')
        expect(panel).to_be_visible()
        bounds, viewport = panel.bounding_box(), self.page.viewport_size
        self.assertGreaterEqual(bounds['x'], -1)
        self.assertGreaterEqual(bounds['y'], -1)
        self.assertLessEqual(bounds['x'] + bounds['width'], viewport['width'] + 1)
        self.assertLessEqual(bounds['y'] + bounds['height'], viewport['height'] + 1)
        self.assertTrue(panel.evaluate('el => el.scrollWidth <= el.clientWidth + 1'))
        self.assertTrue(modal.locator('#col-reorder-list [data-key]').first.evaluate("""el => {
            const rect=el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
        }"""), 'Reorder must receive pointer events above Customize')
        if standard:
            self.page.wait_for_function("document.querySelector('.cx-panel').inert")
        return modal

    def save(self, modal):
        modal.get_by_role('button', name='Save', exact=True).click()
        expect(modal).not_to_be_visible()

    def fields(self):
        return NHL['fields'](self.page)

    def keys(self):
        return NHL['keys'](self.page)

    def state(self):
        return NHL['state'](self.page)

    def expect_fb_order(self, order):
        self.page.wait_for_function("""order => JSON.stringify(TABLE.getColumns()
            .map(col=>col.getField()).filter(field=>field && !['_watchlist','game'].includes(field))
            .map(field=>field.replaceAll('.','_'))) === JSON.stringify(order)""", arg=order)

    def test_first_basket_direct_and_redirect_desktop_and_touch(self):
        for path in ('nba.html?market=fb&view=compact', 'fb.html?view=compact'):
            for width in (1280, 320):
                with self.subTest(path=path, width=width):
                    self.open(path, width)
                    self.assertEqual(self.page.evaluate('PAGE'), 'fb')
                    self.profile()
                    self.customize()
                    self.page.locator('#custom_kelly').uncheck()
                    self.page.evaluate("""() => {
                        TABLE.moveColumn('bookOdds.dk','ev',false);
                        TABLE.setHeaderFilterValue('player','fixture');
                        TABLE.setSort([{column:'ev',dir:'asc'}]);
                        TABLE.setFilter([{field:'prop',type:'=',value:'fb'}]);
                    }""")
                    before, fields = self.state(), self.fields()
                    modal = self.reorder()
                    original = self.keys()
                    full = self.page.evaluate("document.getElementById('col-reorder-list')._fullColumnOrder")
                    visible = [field.replace('.', '_') for field in fields
                               if before['visibility'][field] and field not in ('_watchlist', 'game')]
                    self.assertEqual(original, visible)
                    self.assertEqual(original[0], 'bookOdds_dk')
                    self.assertNotIn('kelly', original)
                    self.assertIn('kelly', full)
                    self.assertNotIn('bookOdds_poly', original)
                    self.assertEqual(len(full), len(set(full)))
                    self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'shared-reorder-fb-{width}.png'))
                    NHL['move_second_first'](self.page, touch=width == 320)
                    modal.get_by_role('button', name='Cancel', exact=True).click()
                    expect(modal).not_to_be_visible()
                    self.page.wait_for_function("!document.querySelector('.cx-panel').inert")
                    self.assertEqual(self.fields(), fields)
                    self.assertEqual(self.state(), before)
                    self.assertEqual(self.page.evaluate('reorderWrites.length'), 0)
                    expect(self.page.locator('.cx-reorder')).to_be_focused()

                    modal = self.reorder()
                    self.assertEqual(self.keys(), original)
                    NHL['move_second_first'](self.page, touch=width == 320)
                    self.save(modal)
                    self.page.wait_for_function("!document.querySelector('.cx-panel').inert")
                    saved = self.page.evaluate("CURR_USER.metadata['fb-order']")
                    self.assertEqual(len(saved), len(full))
                    self.assertEqual(set(saved), set(full))
                    self.assertEqual([key for key in saved if key in original], [original[1], original[0], *original[2:]])
                    self.assertTrue(all(saved.index(key) == full.index(key) for key in full if key not in original))
                    self.assertEqual(self.state(), before)
                    self.assertEqual(self.page.evaluate('reorderWrites.length'), 1)
                    self.assertIsNone(self.page.evaluate("CURR_USER.metadata['nba-order'] || null"))
                    self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('cached_profile')).metadata['fb-order']"), saved)
                    self.expect_fb_order(saved)
                    self.page.reload()
                    self.expect_fb_order(saved)

    def test_first_basket_late_profile_and_other_nba_page_remain_separate(self):
        self.open('nba.html?market=fb&view=compact')
        self.profile()
        self.customize()
        modal = self.reorder()
        NHL['move_second_first'](self.page)
        self.save(modal)
        saved = self.page.evaluate("CURR_USER.metadata['fb-order']")
        self.navigate('nba.html?view=compact')
        self.assertEqual(self.page.evaluate('PAGE'), 'nba')
        fields = self.fields()
        self.assertLess(fields.index('ev'), fields.index('player'))
        self.assertEqual(self.page.evaluate("CURR_USER.metadata['fb-order']"), saved)
        self.assertIsNone(self.page.evaluate("CURR_USER.metadata['nba-order'] || null"))
        self.navigate('fb.html?view=compact')
        self.expect_fb_order(saved)
        self.profile()
        late = [saved[-1], *saved[:-1]]
        self.page.evaluate("""order => {
            TABLE.setHeaderFilterValue('player','fixture');
            TABLE.setSort([{column:'ev',dir:'asc'}]);
            CURR_USER.metadata['fb-order']=order;
            hydrateAfterProfileLoad();
        }""", late)
        self.expect_fb_order(late)
        self.assertEqual(self.page.evaluate('reorderWrites.length'), 0)
        self.assertEqual(self.page.evaluate("TABLE.getHeaderFilters().map(f=>[f.field,f.value])"), [['player', 'fixture']])
        self.assertEqual(self.page.evaluate("TABLE.getSorters().map(s=>[s.field,s.dir])"), [['ev', 'asc']])

    def test_generic_customize_bespoke_tracker_and_direct_entry(self):
        for name, width, standard, hidden in self.generic_cases:
            with self.subTest(page=name, width=width):
                self.open(f'{name}.html?view=compact', width)
                signed_in = name != 'backfields'
                if signed_in:
                    self.profile()
                if standard:
                    self.customize()
                    self.page.locator('#custom_' + hidden.replace('.', '_')).uncheck()
                else:
                    self.page.evaluate('field => { TABLE.hideColumn(field); }', hidden)
                self.page.evaluate("""() => {
                    const player=TABLE.getColumn('player');
                    if (player?.getDefinition().headerFilter) TABLE.setHeaderFilterValue('player','fixture');
                    const field=TABLE.getColumn('ev') ? 'ev' : 'player';
                    TABLE.setSort([{column:field,dir:'asc'}]);
                }""")
                before, fields = self.state(), self.fields()
                modal = self.reorder(standard)
                original = self.keys()
                full = self.page.evaluate("document.getElementById('col-reorder-list')._fullColumnOrder")
                self.assertGreaterEqual(len(original), 2)
                self.assertNotIn(f'column:{hidden}', original)
                self.assertIn(f'column:{hidden}', full)
                self.assertTrue(all(key.startswith(('column:', 'group:')) for key in full))
                self.assertEqual(len(full), len(set(full)))
                NHL['move_second_first'](self.page, touch=width == 320)
                modal.get_by_role('button', name='Cancel', exact=True).click()
                expect(modal).not_to_be_visible()
                self.assertEqual(self.fields(), fields)
                self.assertEqual(self.state(), before)
                modal = self.reorder(standard)
                self.assertEqual(self.keys(), original)
                NHL['move_second_first'](self.page, touch=width == 320)
                self.save(modal)
                self.assertEqual(self.state(), before)
                expected = [original[1], original[0], *original[2:]]
                modal = self.reorder(standard)
                self.assertEqual(self.keys(), expected)
                modal.get_by_role('button', name='Cancel', exact=True).click()
                if signed_in:
                    saved = self.page.evaluate('key => CURR_USER.metadata[key]', f'{name}-order')
                    self.assertEqual([key for key in saved if key in original], expected)
                    self.assertTrue(all(saved.index(key) == full.index(key) for key in full if key not in original))
                    self.assertEqual(self.page.evaluate('reorderWrites.length'), 1)
                    self.assertEqual(self.page.evaluate('key => JSON.parse(localStorage.getItem("cached_profile")).metadata[key]', f'{name}-order'), saved)
                    reordered_fields = self.fields()
                    self.page.reload()
                    self.page.wait_for_function("""fields => typeof TABLE !== 'undefined' && TABLE &&
                        JSON.stringify(TABLE.getColumns().map(c=>c.getField()).filter(Boolean)) === JSON.stringify(fields)""", arg=reordered_fields)
                else:
                    # Guest direct-entry pages keep the order when their table is rebuilt.
                    reordered_fields = self.fields()
                    self.page.evaluate('() => { renderTable([]); }')
                    self.page.wait_for_function("""fields => JSON.stringify(TABLE.getColumns()
                        .map(c=>c.getField()).filter(Boolean)) === JSON.stringify(fields)""", arg=reordered_fields)


if __name__ == '__main__':
    unittest.main(verbosity=2)
