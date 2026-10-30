"""Offline integration coverage for the generator and vertical book comparison."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('nba_fixtures', Path(__file__).with_name('parlays-nba.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
fixtures.BOOKS['b365'] = 'bet365'


class GeneratorTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.NbaParlayTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.NbaParlayTests.tearDownClass.__func__)
    tearDown = fixtures.NbaParlayTests.tearDown
    respond = fixtures.NbaParlayTests.respond
    open = fixtures.NbaParlayTests.open
    references = fixtures.NbaParlayTests.references

    def setUp(self):
        fixtures.NbaParlayTests.setUp(self)
        catalog = self.catalogs['nba']
        template = deepcopy(catalog['legs'][6])
        catalog['books'] = dict(fixtures.BOOKS)
        catalog['max_leg_count'] = 8
        catalog['legs'] = []
        for index in range(12):
            leg = deepcopy(template)
            leg.update(id=f'{index+1:024x}', player=f'player {index+1}',
                       game=f'away{index} @ home{index}', side='under' if index == 1 else 'over')
            leg['market'] = f'{leg["side"].title()} 6.5 assists'
            leg['quotes']['fd'].update(over=200 + index * 15, under=190 + index * 15)
            leg['quotes']['dk'].update(over=150 + index * 5, under=140 + index * 5)
            leg['quotes']['b365'] = dict(leg['quotes']['fd'], over=180 if index < 2 else None,
                                         under=-200 if index < 2 else None,
                                         status='available' if index < 2 else 'Missing over price')
            leg['fair_probabilities']['b365'] = fixtures.probabilities(.3)
            catalog['legs'].append(leg)
        # A stale enticing offer and a missing reference pair cannot enter a suggestion.
        catalog['legs'][2]['quotes']['fd'].update(over=9900,
            updated_at=(datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat())
        for book in ('circa', 'pn'):
            catalog['legs'][3]['quotes'][book].update(under=None, status='Missing under price')
        catalog['legs'][4]['game'] = catalog['legs'][0]['game']

    def books(self, *books):
        self.page.locator('#generate-books-summary').click()
        self.page.locator('#generate-books-clear').click()
        for book in books:
            self.page.locator(f'[data-generate-book="{book}"]').check()
        self.page.locator('#generate-books-summary').click()

    def generate(self, count=3):
        self.page.locator('#generate-count').select_option(str(count))
        self.page.locator('#generate').click()
        expect(self.page.locator('#generate')).to_have_text('Generate parlays', timeout=10000)

    def calculated(self, count):
        expect(self.page.locator('#results')).to_be_visible()
        expect(self.page.locator('#calculation-status')).to_have_text(f'{count}-leg parlay updated automatically.')
        self.assertEqual(len(self.posts[-1]['legs']), count)

    def test_all_books_loads_a_complete_parlay_and_matches_the_fresh_quote(self):
        self.open()
        self.generate()
        self.calculated(3)
        selected = [leg for leg in self.catalogs['nba']['legs'] if leg['id'] in self.posts[-1]['legs']]
        self.assertEqual(len({leg['game'] for leg in selected}), 3)
        self.assertNotIn(f'{3:024x}', self.posts[-1]['legs'])
        self.assertNotIn(f'{4:024x}', self.posts[-1]['legs'])
        expect(self.page.locator('#generated-parlays article')).to_have_count(5)
        expect(self.page.locator('[data-price-tile="fd"]')).to_be_visible()
        expect(self.page.locator('[data-price-tile="dk"]')).to_be_visible()
        expect(self.page.locator('[data-price-tile="b365"]')).to_have_count(0)
        # The default references and method are identical in search and POST calculation.
        first = self.page.locator('.generated-parlay').first
        quote_ev = self.page.locator('[data-price-tile="fd"] .parlay-book-ev').inner_text()
        expect(first.locator('.generated-metrics > span')).to_have_text(quote_ev)
        expect(self.page.locator('#parlay-price-summary')).to_contain_text('Book price gap')
        self.page.locator('[data-use-generated="1"]').click()
        self.calculated(3)
        expect(self.page.locator('[data-use-generated="1"]')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(len(self.posts), 2)  # No quote request per candidate.

    def test_selected_books_are_required_and_empty_results_preserve_the_ticket(self):
        self.open()
        self.generate(2)
        self.calculated(2)
        ticket = self.posts[-1]['legs']
        self.books('fd', 'dk', 'b365')
        self.generate(3)
        expect(self.page.locator('#generator-status')).to_contain_text('No complete combinations')
        expect(self.page.locator('#generated-parlays')).to_be_hidden()
        self.assertEqual(self.posts[-1]['legs'], ticket)
        self.generate(2)
        self.calculated(2)
        self.assertEqual(set(self.posts[-1]['legs']), {f'{1:024x}', f'{2:024x}'})
        expect(self.page.locator('[data-price-tile="b365"]')).to_be_visible()
        self.books('fd')
        self.generate(2)
        expect(self.page.locator('#generator-status')).to_contain_text('at least two books')
        self.page.locator('#generate-rank').select_option('ev')
        self.generate(2)
        self.calculated(2)
        expect(self.page.locator('.generated-parlay').first).to_contain_text('Gap unavailable')

    def test_eight_legs_filters_reference_changes_and_manual_removal(self):
        self.open()
        self.generate(8)
        self.calculated(8)
        expect(self.page.locator('#selection-count')).to_have_text('8 / 8 selected')
        self.assertEqual(len(set(self.posts[-1]['legs'])), 8)
        self.page.locator('#leg-inputs [data-remove]').first.click()
        self.calculated(7)
        expect(self.page.locator('#generated-parlays button[aria-pressed="true"]')).to_have_count(0)
        self.page.locator('#side-filter').select_option('under')
        expect(self.page.locator('#generated-parlays')).to_be_hidden()
        self.generate(2)
        expect(self.page.locator('#generator-status')).to_contain_text('Need 2 different matchups')
        self.page.locator('#side-filter').select_option('')
        self.references()
        self.generate(2)
        expect(self.page.locator('#generator-status')).to_contain_text('Choose fair value books')

    def test_vertical_desktop_and_mobile_layout_and_outside_close(self):
        for width in (1440, 390, 320):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 1000})
                self.open()
                self.generate(2)
                self.calculated(2)
                expect(self.page.locator('#generate')).to_be_enabled()
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.page.locator('#generate-books-summary').click()
                box = self.page.locator('#generate-books-menu').bounding_box()
                self.assertGreaterEqual(box['x'], 0)
                self.assertLessEqual(box['x'] + box['width'], width)
                self.page.locator('#generator-title').click()
                expect(self.page.locator('#generate-books-menu')).to_be_hidden()
                rows = self.page.locator('#parlay-book-prices > li')
                bounds = [rows.nth(i).bounding_box() for i in range(rows.count())]
                for first, second in zip(bounds, bounds[1:]):
                    self.assertAlmostEqual(first['x'], second['x'], delta=1)
                    self.assertLessEqual(first['y'] + first['height'], second['y'])
                if width == 1440:
                    chooser = self.page.locator('.builder').bounding_box()
                    slip = self.page.locator('#parlay-slip').bounding_box()
                    self.assertGreater(slip['x'], chooser['x'] + chooser['width'])
                self.page.evaluate('window.scrollTo(0,0); document.querySelector("#parlay-slip").scrollTop=0')
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'parlay-generator-{width}.png'), full_page=True)

    def test_filter_changes_cannot_apply_a_late_generation(self):
        self.open()
        self.generate(2)
        self.calculated(2)
        original_ticket = self.posts[-1]['legs']
        self.page.evaluate('''() => {
            const generate = ParlayGenerator.generate;
            ParlayGenerator.generate = options => new Promise(resolve => {
                window.releaseParlaySearch = async () => resolve(await generate({...options, signal: undefined}));
            });
        }''')
        self.page.locator('#generate-count').select_option('3')
        self.page.locator('#generate').click()
        expect(self.page.locator('#generate')).to_have_text('Finding parlays...')
        self.page.locator('#side-filter').select_option('under')
        self.page.evaluate('window.releaseParlaySearch()')
        expect(self.page.locator('#generated-parlays')).to_be_hidden()
        expect(self.page.locator('#generate')).to_be_enabled()
        self.assertEqual(self.posts[-1]['legs'], original_ticket)

    def test_large_eight_leg_prices_fit_mobile_and_older_api_limits_are_respected(self):
        for leg in self.catalogs['nba']['legs']:
            for book in ('fd', 'dk'):
                leg['quotes'][book].update(over=2500 if book == 'fd' else 2200,
                                           under=2500 if book == 'fd' else 2200)
        self.page.set_viewport_size({'width': 320, 'height': 844})
        self.open()
        self.generate(8)
        self.calculated(8)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.locator('#clear').click()
        self.catalogs['nba']['max_leg_count'] = 4
        self.page.evaluate('window.refreshParlays()')
        expect(self.page.locator('#generate-count option[value="8"]')).to_have_attribute('disabled', '')
        expect(self.page.locator('#generate-count')).to_have_value('4')
        self.generate(4)
        self.calculated(4)
        expect(self.page.locator('#selection-count')).to_have_text('4 / 4 selected')


if __name__ == '__main__':
    unittest.main(defaultTest='GeneratorTests', verbosity=2)
