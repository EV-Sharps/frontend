"""Exercise the real parlay API transformation with offline browser fixtures."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
NODE = Path(sys.executable).parent / 'Lib/site-packages/playwright/driver/node.exe'
API = ROOT.parent / 'api/parlays.mjs'
spec = importlib.util.spec_from_file_location('nba_fixture', Path(__file__).with_name('parlays-nba.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def api(source, body=None):
    script = f'''import {{ buildCatalog, calculateParlay }} from {json.dumps(API.as_uri())};
      let input=''; for await (const chunk of process.stdin) input+=chunk;
      const {{source, body}}=JSON.parse(input);
      const catalog=buildCatalog(source, {{market:'nba'}});
      process.stdout.write(JSON.stringify(body ? calculateParlay(catalog, body) : catalog));'''
    result = subprocess.run([str(NODE), '--input-type=module', '-e', script],
                            input=json.dumps({'source': source, 'body': body}), text=True,
                            capture_output=True, check=True, timeout=10)
    return json.loads(result.stdout)


class PredictionTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.NbaParlayTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.NbaParlayTests.tearDownClass.__func__)
    tearDown = fixtures.NbaParlayTests.tearDown
    open = fixtures.NbaParlayTests.open

    def setUp(self):
        fixtures.NbaParlayTests.setUp(self)
        now = datetime.now(timezone.utc)
        self.source = {'updated': {book: now.isoformat() for book in ['circa', 'pn', 'fd', 'dk', 'kal', 'nv', 'px', 'poly']},
                       'times': {}, 'data': []}
        for i, (player, game) in enumerate([('alpha guard', 'bos @ ny'), ('bravo forward', 'mia @ orl'), ('charlie center', 'den @ uta')]):
            self.source['times'][game] = (now + timedelta(hours=3)).isoformat()
            self.source['data'].append({'player': player, 'game': game, 'team': game.split(' @ ')[0],
                'prop': 'ast', 'handicap': 6.5,
                'bookOdds': {'circa': '170/-200', 'pn': '175/-205', 'fd': '185/-230', 'dk': '190/-235',
                             'kal': '200/-250', 'nv': '210/-260', 'px': '200/-250', 'poly': '225/-275'},
                'liquidity': {'kal': [['$1,200.50', 35], [50, 250], [60, 70]][i],
                              'nv': [100, 200], 'px': [75, 125], 'poly': [300, None]}})

    def respond(self, route):
        if route.request.method == 'GET':
            self.assertEqual(parse_qs(urlsplit(route.request.url).query)['market'], ['nba'])
            self.catalog = api(self.source)
            route.fulfill(json=self.catalog)
        else:
            self.posts.append(route.request.post_data_json)
            self.quote = api(self.source, self.posts[-1])
            route.fulfill(json=self.quote)

    def leg(self, player, side='over'):
        return next(leg for leg in self.catalog['legs'] if leg['player'] == player and leg['side'] == side)

    def row(self, player, side='over'):
        return self.page.locator(f'[data-leg-row="{self.leg(player, side)["id"]}"]')

    def pick(self, player, side='over'):
        self.row(player, side).locator('[data-leg]').click()

    def test_quotes_liquidity_and_fees_reach_picker_slip_and_generator(self):
        self.open()
        for book in ('kal', 'nv', 'px', 'poly'):
            expect(self.page.locator(f'[data-key="book:{book}"]')).to_have_count(1)
            expect(self.page.locator(f'#picker-book option[value="{book}"]')).to_have_count(1)
            expect(self.page.locator(f'[data-generate-book="{book}"]')).to_have_count(1)
            expect(self.page.locator(f'[data-reference-book="{book}"]')).to_have_count(1)
        cell = self.row('alpha guard').locator('[data-price-column="kal"]')
        expect(cell.locator('strong')).to_have_text('+200 ($1,200.5)')
        expect(cell.locator('small')).to_have_text('-250 ($35)')
        self.page.locator('#picker-book').select_option('kal')
        expect(self.row('alpha guard').locator('.ev-offer')).to_contain_text('+186')
        expect(self.row('alpha guard').locator('[data-price-column="kal"]')).to_have_class('catalog-price prediction-price')
        expect(self.row('alpha guard').locator('[data-price-column="poly"]')).to_have_class('catalog-price prediction-price best-price')
        self.pick('alpha guard')
        self.pick('bravo forward', 'under')
        expect(self.page.locator('#calculation-status')).to_have_text('2-leg parlay updated automatically.')
        for book in ('kal', 'nv', 'px', 'poly'):
            expect(self.page.locator(f'[data-price-tile="{book}"]')).to_be_visible()
        expect(self.page.locator('[data-price-tile="kal"] .parlay-book-liquidity')).to_have_text('Leg liquidity: $1,200.5 / $250')
        expect(self.page.locator('[data-price-tile="poly"] .parlay-book-liquidity')).to_have_text('Leg liquidity: $300 / ?')
        expect(self.page.locator('#leg-inputs .leg-card.is-filled').first).to_contain_text('+186 ($1,200.5)')
        kal = next(price for price in self.quote['prices'] if price['book'] == 'kal')
        expected_odds = f'+{round(kal["odds"]):,}' if kal['odds'] > 0 else f'{round(kal["odds"]):,}'
        expect(self.page.locator('[data-price-tile="kal"] .parlay-book-odds')).to_have_text(expected_odds)
        self.assertLess(kal['decimal'], 3 * 1.4)
        # An all-prediction comparison participates in the same complete-coverage search.
        self.page.locator('#generate-books-summary').click()
        self.page.locator('[data-generate-book="kal"]').check()
        self.page.locator('[data-generate-book="px"]').check()
        self.page.locator('#generate-books-summary').click()
        self.page.locator('#generate-count').select_option('3')
        self.page.locator('#generate-rank').select_option('ev')
        self.page.locator('#generate').click()
        expect(self.page.locator('#calculation-status')).to_have_text('3-leg parlay updated automatically.')
        expect(self.page.locator('.generated-parlay').first).to_contain_text('2 books')
        book = self.posts[-1]['betting_book']
        self.assertIn(book, ('kal', 'px'))
        expect(self.page.locator('.generated-metrics > span').first).to_have_text(
            self.page.locator(f'[data-price-tile="{book}"] .parlay-book-ev').inner_text())

    def test_stale_missing_and_zero_liquidity_do_not_create_complete_prices(self):
        self.source['updated']['kal'] = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        self.source['data'][1]['liquidity']['nv'][1] = 0
        self.source['data'][1]['bookOdds']['px'] = '200'
        self.open()
        expect(self.row('alpha guard').locator('[data-price-column="kal"]')).to_have_text('Stale')
        expect(self.row('bravo forward', 'under').locator('[data-price-column="nv"] strong')).to_have_text('-260 ($0)')
        self.pick('alpha guard')
        self.pick('bravo forward', 'under')
        expect(self.page.locator('#calculation-status')).to_have_text('2-leg parlay updated automatically.')
        for book in ('kal', 'nv', 'px'):
            expect(self.page.locator(f'[data-price-tile="{book}"]')).to_have_count(0)
        expect(self.page.locator('[data-price-tile="poly"]')).to_be_visible()
        self.page.locator('#picker-book').select_option('nv')
        expect(self.row('bravo forward', 'under')).to_have_count(0)

    def test_prediction_columns_and_site_colors_fit_desktop_and_mobile(self):
        for width in (1440, 390, 320):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 1000})
                self.open()
                self.pick('alpha guard')
                self.pick('bravo forward', 'under')
                expect(self.page.locator('#calculation-status')).to_have_text('2-leg parlay updated automatically.')
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.page.locator('#catalog-wrap').evaluate('(node) => {node.scrollLeft=230}')
                self.page.locator('#parlay-slip').evaluate('(node) => {node.scrollTop=0}')
                expect(self.page.locator('[data-leg-row].is-selected').first).to_have_css('background-color', 'rgb(21, 56, 103)')
                expect(self.page.locator('#generate')).to_have_css('background-color', 'rgb(119, 195, 255)')
                self.page.evaluate('window.scrollTo(0, 0)')
                self.page.wait_for_function("Array.from(document.querySelectorAll('#parlay-book-prices img')).every(img => img.complete && img.naturalWidth > 0)")
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'parlay-predictions-{width}.png'), full_page=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
