"""Offline browser regression coverage for the ATGS book and EV player picker."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import tempfile
from threading import Thread
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
BOOKS = {'circa': 'Circa', 'pn': 'Pinnacle', 'fd': 'FanDuel', 'dk': 'DraftKings',
         'b365': 'Bet365', 'br': 'BetRivers'}


def probabilities(power, mult=None, probit=None, conservative=None):
    return {'power': power, 'mult': power if mult is None else mult,
            'probit': power if probit is None else probit,
            'conservative': power if conservative is None else conservative}


def catalog_fixture():
    now = datetime.now(timezone.utc)

    def quote(over, under=-500, status='available', age=0):
        return {'over': over, 'under': under, 'status': status,
                'updated_at': (now - timedelta(minutes=age)).isoformat()}

    def leg(index, player, game, fd=None, dk=None, p=0.2):
        quotes = {'circa': quote(300), 'pn': quote(300)}
        if fd is not None:
            quotes['fd'] = quote(fd)
        if dk is not None:
            quotes['dk'] = quote(dk)
        return {'id': f'{index:024x}', 'player': player, 'game': game,
                'team': game.split(' @ ')[0], 'start': (now + timedelta(hours=3)).isoformat(),
                'market': 'Over 0.5 goals', 'quotes': quotes,
                'fair_probabilities': {'circa': probabilities(p), 'pn': probabilities(p)}}

    legs = [
        leg(1, 'alpha scorer', 'bos @ nyr', fd=400, dk=200, p=.25),
        leg(2, 'beta scorer', 'tor @ mtl', fd=300, dk=600, p=.2),
        leg(3, 'gamma scorer', 'edm @ van', fd=400, p=.2),
        leg(4, 'delta scorer', 'pit @ phi', fd=200, dk=300, p=.3),
        leg(5, 'epsilon scorer', 'col @ la', fd=400, p=.3),
        leg(6, 'zeta scorer', 'sj @ ana', fd=1000, dk=500, p=.8),
        leg(7, 'eta scorer', 'min @ chi', fd=1200, p=.8),
        leg(8, 'theta scorer', 'nyi @ njd', fd=2000, dk=300, p=.25),
        leg(9, 'iota reference only', 'wpg @ ott', p=.8),
        leg(10, 'kappa scorer', 'det @ buf', fd=400, p=.2),
        leg(11, 'lambda scorer', 'fla @ tb', fd=400, p=.8),
        leg(12, 'mu no current offer', 'car @ nsh', p=.2),
    ]
    legs[0]['fair_probabilities'] = {'circa': probabilities(.3, .1, .35, .1),
                                     'pn': probabilities(.25, .12, .3, .12)}
    legs[1]['fair_probabilities'] = {'circa': probabilities(.2, .35, .18, .18),
                                     'pn': probabilities(.22, .4, .2, .2)}
    legs[3]['quotes']['dk'] = quote(300, None, 'Missing under price')
    legs[4]['quotes']['circa'] = quote(300, age=20)  # Ignore stale .05; current PN gives .30.
    legs[4]['fair_probabilities']['circa'] = probabilities(.05)
    for book in ('circa', 'pn'):
        legs[5]['quotes'][book] = quote(300, age=20)
    legs[6]['quotes']['circa'] = quote(300, None, 'Missing under price')
    legs[6]['quotes'].pop('pn')  # Cached probabilities alone cannot replace a current reference pair.
    legs[7]['quotes']['fd'] = quote(2000, age=20)
    legs[10]['fair_probabilities'] = {'circa': probabilities(1), 'pn': probabilities(-.1)}
    legs[11]['quotes'].update(fd=quote(None, -500, 'Missing over price'), b365=quote(999, age=20))
    return {'market': 'atgs', 'sport': 'nhl', 'date': now.date().isoformat(),
            'generated_at': now.isoformat(), 'max_age_minutes': 10, 'books': dict(BOOKS), 'legs': legs}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class AtgsPickerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1080})
        self.page.set_default_timeout(5000)
        self.catalog = catalog_fixture()
        self.posts, self.gets, self.errors = [], [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('https://**/*', lambda route: route.fulfill(
            body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange:()=>{}}})};"
            if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
        self.page.route('**/api/parlays*', self.respond)

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def respond(self, route):
        if route.request.method == 'GET':
            market = parse_qs(urlsplit(route.request.url).query).get('market', ['hr'])[0]
            self.gets.append(market)
            payload = deepcopy(self.catalog)
            if market != 'atgs':
                payload.update(market=market, sport={'hr': 'mlb', 'attd': 'nfl'}[market])
                payload['legs'] = payload['legs'][:3]
            route.fulfill(json=payload)
            return
        payload = route.request.post_data_json
        self.posts.append(payload)
        legs = [next(leg for leg in self.catalog['legs'] if leg['id'] == key) for key in payload['legs']]
        route.fulfill(json={'market': payload['market'], 'sport': {'hr': 'mlb', 'attd': 'nfl', 'atgs': 'nhl'}[payload['market']],
                           'legs': legs, 'references': [], 'prices': [], 'best_price': None,
                           'offered_odds': payload['offered_odds'], 'max_age_minutes': 10})

    def open(self, market='atgs'):
        self.page.goto(f'http://localhost:{self.server.server_port}/parlays.html?market={market}')
        expect(self.page.locator('#calculator')).to_be_visible()
        expect(self.page.locator('#refresh')).to_be_enabled()

    def row(self, index):
        return self.page.locator(f'[data-leg-row="{index:024x}"]')

    def order(self):
        return [int(key, 16) for key in self.page.locator('#catalog-rows [data-leg-row]').evaluate_all(
            'rows => rows.map(row => row.dataset.legRow)')]

    def ev(self, index):
        value = self.row(index).locator('.catalog-ev').inner_text().strip()
        match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*%', value)
        return float(match.group(1)) if match else None

    def book_columns(self):
        return self.page.locator('#catalog-head [data-key^="book:"]').evaluate_all(
            'columns => columns.map(column => column.dataset.key.slice(5))')

    def pick(self, index):
        self.row(index).locator('button[data-leg]').click()

    def test_default_all_books_rank_best_betting_offer_against_lowest_current_reference(self):
        self.open()
        expect(self.page.locator('#method')).to_have_value('power')
        expect(self.page.locator('#picker-book')).to_have_value('')
        expect(self.page.locator('#catalog-head [data-key="ev"]')).to_have_attribute('aria-sort', 'descending')
        self.assertEqual(self.order(), [5, 2, 1, 4, 3, 10, 8, 7, 11, 6])
        self.assertEqual(self.ev(1), 25.0)  # min(.30, .25) times FD's 5.0 decimal odds.
        self.assertEqual(self.ev(2), 40.0)  # Best betting quote is DK +600.
        self.assertEqual(self.ev(5), 50.0)  # Stale low Circa probability is ineligible.
        self.assertEqual(self.ev(8), 0.0)  # Stale FD +2000 cannot outrank current DK +300.
        self.assertEqual(self.page.locator('#picker-book option').evaluate_all(
            'options => options.map(option => option.value)'), ['', 'fd', 'dk'])
        for index in (6, 7, 11):
            self.assertIsNone(self.ev(index))
        self.assertEqual(self.row(9).count(), 0)
        self.assertEqual(self.row(12).count(), 0)
        self.assertEqual(self.posts, [])

    def test_specific_book_filters_current_overs_including_over_only_and_keeps_references(self):
        self.open()
        self.page.locator('#picker-book').select_option('dk')
        expect(self.page.locator('#betting-book')).to_have_value('dk')
        self.assertEqual(self.order(), [2, 4, 8, 1, 6])
        self.assertEqual(set(self.book_columns()), {'circa', 'pn', 'dk'})
        self.assertEqual(self.ev(1), -25.0)
        self.assertEqual(self.ev(4), 20.0)  # Betting unders are optional; reference unders are required.
        self.page.locator('#betting-book').select_option('fd')
        expect(self.page.locator('#picker-book')).to_have_value('fd')
        self.assertEqual(self.order(), [5, 1, 3, 10, 4, 2, 7, 11, 6])
        self.assertEqual(set(self.book_columns()), {'circa', 'pn', 'fd'})
        self.assertEqual(self.row(8).count(), 0)
        self.assertEqual(self.gets, ['atgs'])
        self.assertEqual(self.posts, [])

    def test_method_changes_rerank_without_requesting_parlay_quotes(self):
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        self.page.locator('#method').select_option('mult')
        self.assertEqual(self.order(), [5, 2, 3, 10, 4, 1, 7, 11, 6])
        self.assertEqual(self.ev(1), -50.0)
        self.assertEqual(self.ev(2), 40.0)
        self.page.locator('#method').select_option('probit')
        self.assertEqual(self.order()[:2], [1, 5])
        self.assertEqual(self.ev(1), 50.0)
        self.page.locator('#method').select_option('conservative')
        self.assertEqual(self.order(), [5, 3, 10, 4, 2, 1, 7, 11, 6])
        self.assertEqual(self.gets, ['atgs'])
        self.assertEqual(self.posts, [])

    def test_unknown_ev_is_last_in_both_sort_directions_and_ties_are_stable(self):
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        self.assertEqual(self.order()[2:4], [3, 10])
        self.page.locator('#catalog-head [data-sort="ev"]').click()
        expect(self.page.locator('#catalog-head [data-key="ev"]')).to_have_attribute('aria-sort', 'ascending')
        self.assertEqual(self.order(), [2, 4, 3, 10, 1, 5, 7, 11, 6])
        self.page.locator('#catalog-head [data-sort="ev"]').click()
        self.assertEqual(self.order(), [5, 1, 3, 10, 4, 2, 7, 11, 6])

    def test_full_precision_ev_breaks_displayed_ties(self):
        self.catalog['legs'][9]['fair_probabilities'] = {
            'circa': probabilities(.20001), 'pn': probabilities(.20001)}
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        self.assertEqual(self.order()[2:4], [10, 3])

    def test_search_game_and_book_filters_compose_without_clearing_selected_legs(self):
        self.open()
        self.pick(1)
        self.pick(3)
        expect(self.page.locator('#calculation-status')).to_have_text('2-leg parlay updated automatically.')
        self.page.locator('#picker-book').select_option('dk')
        expect(self.page.locator('#selection-count')).to_have_text('2 / 4 selected')
        expect(self.page.locator('#leg-inputs .is-filled')).to_have_count(2)
        self.assertIn('Gamma Scorer', self.page.locator('#leg-inputs').inner_text())
        self.assertEqual(self.row(3).count(), 0)
        self.page.locator('#player-search').fill('beta')
        self.page.locator('#game-filter').select_option('tor @ mtl')
        self.assertEqual(self.order(), [2])
        self.page.locator('#game-filter').select_option('bos @ nyr')
        self.assertEqual(self.order(), [])
        expect(self.page.locator('#selection-count')).to_have_text('2 / 4 selected')
        self.page.locator('#player-search').fill('')
        self.page.locator('#game-filter').select_option('')
        self.page.locator('#picker-book').select_option('')
        expect(self.row(1).locator('button')).to_have_attribute('aria-pressed', 'true')
        expect(self.row(3).locator('button')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(self.gets, ['atgs'])

    def test_one_selected_leg_book_and_method_changes_do_not_make_extra_requests(self):
        self.open()
        self.pick(1)
        self.page.locator('#picker-book').select_option('fd')
        self.page.locator('#betting-book').select_option('dk')
        self.page.locator('#method').select_option('mult')
        self.page.locator('#player-search').fill('beta')
        self.page.wait_for_timeout(100)
        self.assertEqual(self.gets, ['atgs'])
        self.assertEqual(self.posts, [])
        expect(self.page.locator('#selection-count')).to_have_text('1 / 4 selected')

    def test_refresh_retains_filters_and_recomputes_ev_from_updated_prices(self):
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        self.page.locator('#method').select_option('mult')
        self.page.locator('#player-search').fill('scorer')
        self.page.locator('#game-filter').select_option('bos @ nyr')
        self.assertEqual(self.ev(1), -50.0)
        self.catalog['legs'][0]['quotes']['fd']['over'] = 900
        self.page.evaluate('window.refreshParlays()')
        expect(self.page.locator('#picker-book')).to_have_value('fd')
        expect(self.page.locator('#betting-book')).to_have_value('fd')
        expect(self.page.locator('#method')).to_have_value('mult')
        expect(self.page.locator('#player-search')).to_have_value('scorer')
        expect(self.page.locator('#game-filter')).to_have_value('bos @ nyr')
        self.assertEqual(self.order(), [1])
        self.assertEqual(self.ev(1), 0.0)
        self.assertEqual(self.gets, ['atgs', 'atgs'])
        self.assertEqual(self.posts, [])

    def test_refresh_preserves_focused_sort_and_leg_buttons_after_reranking(self):
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        sort_button = self.page.locator('#catalog-head [data-sort="ev"]')
        sort_button.focus()
        self.page.evaluate('window.refreshParlays()')
        expect(sort_button).to_be_focused()
        self.pick(1)
        selected_button = self.row(1).locator('button[data-leg]')
        expect(selected_button).to_be_focused()
        self.catalog['legs'][0]['quotes']['fd']['over'] = 900
        self.page.evaluate('window.refreshParlays()')
        self.assertEqual(self.order()[0], 1)
        expect(selected_button).to_be_focused()
        expect(selected_button).to_have_attribute('aria-pressed', 'true')
        expect(self.page.locator('#selection-count')).to_have_text('1 / 4 selected')
        self.assertEqual(self.posts, [])

    def test_refresh_keeps_unavailable_selected_book_until_it_leaves_catalog(self):
        self.open()
        self.page.locator('#picker-book').select_option('fd')
        self.pick(1)
        stale = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        for leg in self.catalog['legs']:
            if 'fd' in leg['quotes']:
                leg['quotes']['fd']['updated_at'] = stale
        self.page.evaluate('window.refreshParlays()')
        expect(self.page.locator('#picker-book')).to_have_value('fd')
        expect(self.page.locator('#betting-book')).to_have_value('fd')
        self.assertEqual(self.order(), [])
        self.assertRegex(self.page.locator('#picker-book option:checked').inner_text().lower(),
                         r'unavailable|no current prices')
        expect(self.page.locator('#selection-count')).to_have_text('1 / 4 selected')
        del self.catalog['books']['fd']
        for leg in self.catalog['legs']:
            leg['quotes'].pop('fd', None)
        self.page.evaluate('window.refreshParlays()')
        expect(self.page.locator('#picker-book')).to_have_value('')
        expect(self.page.locator('#betting-book')).to_have_value('')
        self.assertTrue(self.order())
        expect(self.page.locator('#selection-count')).to_have_text('1 / 4 selected')

    def test_other_markets_keep_average_sort_and_have_no_picker_or_ev_column(self):
        self.open()
        self.page.locator('#picker-book').select_option('dk')
        for market in ('hr', 'attd'):
            self.page.locator('#parlay-market').select_option(market)
            expect(self.page.locator('#calculator')).to_be_visible()
            expect(self.page.locator('#picker-book')).to_be_hidden()
            self.assertEqual(self.page.locator('#catalog-head [data-key="ev"], .catalog-ev').count(), 0)
            expect(self.page.locator('#catalog-head [data-key="average"]')).to_have_attribute('aria-sort', 'ascending')
            before = self.book_columns()
            self.page.locator('#betting-book').select_option('fd')
            self.assertEqual(self.book_columns(), before)
            self.assertEqual(len(self.order()), 3)
        self.page.locator('#parlay-market').select_option('atgs')
        expect(self.page.locator('#picker-book')).to_be_visible()
        expect(self.page.locator('#catalog-head [data-key="ev"]')).to_have_attribute('aria-sort', 'descending')

    def test_picker_toolbar_fits_mobile_without_document_overflow(self):
        self.open()
        self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-picker-desktop.png'), full_page=True)
        for width in (390, 320):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                boxes = self.page.locator('.catalog-toolbar input, .catalog-toolbar select').evaluate_all(
                    'inputs => inputs.map(input => { const r = input.getBoundingClientRect(); '
                    'return {left: r.left, right: r.right, width: r.width}; })')
                for box in boxes:
                    self.assertGreater(box['width'], 0)
                    self.assertGreaterEqual(box['left'], 0)
                    self.assertLessEqual(box['right'], width)
                self.page.locator('#picker-book').select_option('dk')
                expect(self.page.locator('#betting-book')).to_have_value('dk')
                self.assertEqual(self.order(), [2, 4, 8, 1, 6])
                if width == 320:
                    self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-picker-mobile-320.png'), full_page=True)
                    bounds = self.page.locator('#catalog-wrap').evaluate('''container => {
                        const row = container.querySelector('[data-leg-row]');
                        const ev = row.querySelector('.catalog-ev').getBoundingClientRect();
                        const player = row.querySelector('.catalog-player').getBoundingClientRect();
                        return {scrollLeft: container.scrollLeft,
                            viewportRight: container.getBoundingClientRect().right,
                            playerRight: player.right, evLeft: ev.left, evRight: ev.right};
                    }''')
                    self.assertEqual(bounds['scrollLeft'], 0)
                    self.assertGreaterEqual(bounds['evLeft'], bounds['playerRight'])
                    self.assertLessEqual(bounds['evRight'], bounds['viewportRight'])


if __name__ == '__main__':
    unittest.main()
