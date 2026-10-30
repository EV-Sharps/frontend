"""Offline NBA parlay coverage: selected sides, filters, fair value and mobile layout."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from math import prod
from pathlib import Path
import re
import tempfile
from threading import Thread
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
BOOKS = {'circa': 'Circa', 'pn': 'Pinnacle', 'fd': 'FanDuel', 'dk': 'DraftKings'}
PROP_NAMES = {'pts': 'points', 'reb': 'rebounds', 'ast': 'assists', '3ptm': 'threes'}


def decimal(price):
    return 1 + price / 100 if price > 0 else 1 + 100 / -price


def american(value):
    return (value - 1) * 100 if value >= 2 else -100 / (value - 1)


def probabilities(power, mult=None):
    return {'power': power, 'mult': power if mult is None else mult,
            'probit': power, 'conservative': min(power, power if mult is None else mult)}


def nba_catalog():
    now = datetime.now(timezone.utc)

    def quote(over, under, status='available', age=0):
        return {'over': over, 'under': under, 'status': status,
                'updated_at': (now - timedelta(minutes=age)).isoformat()}

    def leg(index, player, game, prop, line, side):
        return {'id': f'{index:024x}', 'player': player, 'team': game.split(' @ ')[0],
                'game': game, 'start': (now + timedelta(hours=4)).isoformat(),
                'prop': prop, 'handicap': line, 'side': side,
                'market': f'{side.title()} {line:g} {PROP_NAMES[prop]}',
                'quotes': {'circa': quote(115, -135), 'pn': quote(110, -130),
                           'fd': quote(130, -155), 'dk': quote(125, -150)},
                'fair_probabilities': {'circa': probabilities(.48, .45),
                                       'pn': probabilities(.47, .44),
                                       'fd': probabilities(.46, .43),
                                       'dk': probabilities(.45, .42)}}

    legs = [
        leg(1, 'alpha guard', 'bos @ ny', 'pts', 24.5, 'over'),
        leg(2, 'alpha guard', 'bos @ ny', 'pts', 24.5, 'under'),
        leg(3, 'alpha guard', 'bos @ ny', 'pts', 29.5, 'over'),
        leg(4, 'alpha guard', 'bos @ ny', 'reb', 7.5, 'over'),
        leg(5, 'alpha guard', 'bos @ phi', 'pts', 24.5, 'under'),
        leg(6, 'bravo forward', 'mia @ orl', 'pts', 24.5, 'under'),
        leg(7, 'charlie center', 'den @ uta', 'ast', 6.5, 'over'),
        leg(8, 'delta wing', 'lac @ phx', 'reb', 7.5, 'under'),
        leg(9, 'echo shooter', 'chi @ det', '3ptm', 2.5, 'under'),
        leg(10, 'foxtrot shooter', 'sac @ por', '3ptm', 2.5, 'under'),
        leg(11, 'same game teammate', 'bos @ ny', 'pts', 18.5, 'over'),
    ]
    legs[2]['quotes'].update(fd=quote(210, -250), dk=quote(200, -240))
    legs[5]['quotes'].update(fd=quote(-110, -110), dk=quote(-125, 105))
    legs[5]['fair_probabilities'] = {'circa': probabilities(.60, .55),
                                     'pn': probabilities(.58, .54),
                                     'fd': probabilities(.65, .62),
                                     'dk': probabilities(.62, .60)}
    legs[6]['quotes'].update(fd=quote(150, -180), dk=quote(145, -175))
    legs[6]['fair_probabilities'] = {'circa': probabilities(.44, .40),
                                     'pn': probabilities(.43, .39),
                                     'fd': probabilities(.50, .46),
                                     'dk': probabilities(.48, .44)}
    # An under offer remains bettable without an over; devig references still need both.
    legs[7]['quotes'].update(fd=quote(None, 140, 'Missing over price'),
                             dk=quote(None, None, 'Missing over price'))
    # A valid opposite-side quote cannot make the selected under side bettable.
    legs[8]['quotes'].update(fd=quote(200, None, 'Missing under price'),
                             dk=quote(None, None, 'Missing under price'))
    legs[9]['quotes'].update(fd=quote(200, 250, age=20), dk=quote(210, 125))
    return {'market': 'nba', 'sport': 'nba', 'date': now.date().isoformat(),
            'generated_at': now.isoformat(), 'max_age_minutes': 10,
            'books': dict(BOOKS), 'legs': legs}


def hockey_catalog():
    payload = nba_catalog()
    payload.update(market='atgs', sport='nhl')
    payload['legs'] = payload['legs'][5:7]
    for index, leg in enumerate(payload['legs'], 101):
        leg.update(id=f'{index:024x}', prop='atgs', handicap=.5, side='over',
                   market='Over 0.5 goals', player=f'hockey scorer {index}')
    return payload


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


class NbaParlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "parlays-nba.log"}',
        ])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1080})
        self.page.set_default_timeout(6000)
        self.catalogs = {'nba': nba_catalog(), 'atgs': hockey_catalog()}
        self.posts, self.gets, self.errors = [], [], []
        self.denied = False
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('https://**/*', lambda route: route.fulfill(
            body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'sharp-fixture'}}}),onAuthStateChange:()=>{}}})};"
            if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
        self.page.route('**/api/parlays*', self.respond)

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def respond(self, route):
        self.assertEqual(route.request.headers.get('authorization'), 'Bearer sharp-fixture')
        if self.denied:
            return route.fulfill(status=403, json={'error': 'Sharp membership required'})
        if route.request.method == 'GET':
            market = parse_qs(urlsplit(route.request.url).query)['market'][0]
            self.gets.append(market)
            return route.fulfill(json=deepcopy(self.catalogs[market]))
        payload = route.request.post_data_json
        self.posts.append(payload)
        selected = [deepcopy(next(leg for leg in self.catalogs[payload['market']]['legs']
                                  if leg['id'] == key)) for key in payload['legs']]
        prices, references = [], []
        now = datetime.now(timezone.utc)

        def current(quote, side):
            value = quote.get(side)
            return (value is not None and abs(value) >= 100
                    and quote['status'] in ('available', f'Missing {"over" if side == "under" else "under"} price')
                    and -60 <= (now - datetime.fromisoformat(quote['updated_at'])).total_seconds() <= 600)

        for book, name in BOOKS.items():
            quotes = [leg['quotes'][book] for leg in selected]
            selected_quotes = [dict(quote, id=leg['id'], player=leg['player'], side=leg['side'],
                                    price=quote[leg['side']]) for leg, quote in zip(selected, quotes)]
            if book not in ('circa', 'pn') and all(current(q, leg['side']) for q, leg in zip(quotes, selected)):
                combined = prod(decimal(q['price']) for q in selected_quotes)
                prices.append({'book': book, 'name': name, 'decimal': combined,
                               'odds': american(combined), 'legs': selected_quotes})
            pairs = all(current(q, 'over') and current(q, 'under') for q in quotes)
            probabilities_ = [leg['fair_probabilities'][book][payload['method']] for leg in selected]
            probability = prod(probabilities_) if pairs else None
            offered = payload['offered_odds']
            references.append({'book': book, 'name': name, 'complete': pairs,
                               'same_as_betting_book': book == payload['betting_book'],
                               'probability': probability,
                               'fair_odds': american(1 / probability) if probability else None,
                               'raw_product_odds': american(prod(decimal(q['price']) for q in selected_quotes)) if pairs else None,
                               'ev': 100 * (probability * decimal(offered) - 1) if probability and offered is not None else None,
                               'legs': [dict(q, probability=p if pairs else None,
                                             fair_odds=american(1 / p) if pairs else None)
                                        for q, p in zip(selected_quotes, probabilities_)]})
        route.fulfill(json={'market': payload['market'], 'sport': self.catalogs[payload['market']]['sport'],
                           'method': payload['method'], 'legs': selected, 'prices': prices,
                           'references': references, 'best_price': max(prices, key=lambda p: p['decimal'], default=None),
                           'max_age_minutes': 10, 'offered_odds': payload['offered_odds']})

    def open(self):
        self.page.goto(f'http://localhost:{self.server.server_port}/parlays.html?market=nba')
        expect(self.page.locator('#calculator')).to_be_visible()
        expect(self.page.locator('#refresh')).to_be_enabled()
        expect(self.page.locator('#parlay-market')).to_have_value('nba')

    def row(self, index):
        return self.page.locator(f'[data-leg-row="{index:024x}"]')

    def pick(self, index):
        self.row(index).locator('button[data-leg]').click()

    def ids(self):
        return set(self.page.locator('#catalog-rows [data-leg-row]').evaluate_all(
            'rows => rows.map(row => parseInt(row.dataset.legRow, 16))'))

    def calculated(self, *ids):
        expect(self.page.locator('#results')).to_be_visible()
        expect(self.page.locator('#calculation-status')).to_have_text(f'{len(ids)}-leg parlay updated automatically.')
        self.assertEqual(self.posts[-1]['legs'], [f'{index:024x}' for index in ids])
        self.assertEqual(self.posts[-1]['market'], 'nba')

    def references(self, *books):
        self.page.locator('#fair-books-summary').click()
        for book in BOOKS:
            self.page.locator(f'[data-reference-book="{book}"]').set_checked(book in books)
        self.page.locator('#fair-books-summary').click()

    def test_mixed_sides_keep_exact_labels_and_prices_through_results(self):
        self.open()
        self.page.locator('#picker-book').select_option('dk')
        expect(self.row(6).locator('.ev-offer')).to_contain_text('+105')
        expect(self.row(6).locator('.catalog-ev strong')).to_have_text('+18.9%')
        expect(self.row(6).locator('.catalog-price').nth(3).locator('strong')).to_have_text('+105')
        expect(self.row(6).locator('.catalog-price').nth(3).locator('small')).to_have_text('-125')
        expect(self.row(1).locator('.catalog-price').nth(3).locator('small')).to_have_text('-150')
        self.pick(1)
        self.pick(6)
        self.calculated(1, 6)
        slots = self.page.locator('#leg-inputs .leg-card.is-filled')
        expect(slots.nth(0)).to_contain_text('Over 24.5 points')
        expect(slots.nth(0).locator('.leg-price')).to_contain_text('+125')
        expect(slots.nth(1)).to_contain_text('Under 24.5 points')
        expect(slots.nth(1).locator('.leg-price')).to_contain_text('+105')
        expect(self.page.locator('#result-selections')).to_have_text(
            'Alpha Guard Over 24.5 points + Bravo Forward Under 24.5 points')
        expect(self.page.locator('[data-price-tile="dk"] .parlay-book-odds')).to_have_text('+361')
        expect(self.page.locator('[data-price-tile="circa"] .parlay-book-odds')).to_have_text('+274')
        expect(self.page.locator('[data-price-tile="pn"] .parlay-book-odds')).to_have_text('+272')
        self.page.locator('#parlay-breakdown > summary').click()
        cells = self.page.locator('[data-price-book="dk"] td')
        expect(cells.nth(cells.count() - 2)).to_have_text('+125')
        expect(cells.last).to_have_text('+105')
        # References retain both actual sides even when the selected price is an under.
        expect(self.page.locator('[data-book="circa"] .reference-leg').nth(1)).to_contain_text('+115')
        expect(self.page.locator('[data-book="circa"] .reference-leg').nth(1)).to_contain_text('-135')

    def test_prop_side_search_game_filters_intersect_and_reset_between_sports(self):
        self.open()
        self.assertEqual(set(self.page.locator('#prop-filter option').evaluate_all(
            'options => options.map(option => option.value)')), {'', 'pts', 'reb', 'ast', '3ptm'})
        self.page.locator('#player-search').fill('alpha')
        self.page.locator('#game-filter').select_option('bos @ ny')
        self.page.locator('#prop-filter').select_option('pts')
        self.page.locator('#side-filter').select_option('under')
        self.assertEqual(self.ids(), {2})
        self.page.locator('#side-filter').select_option('over')
        self.assertEqual(self.ids(), {1, 3})
        self.page.locator('#prop-filter').select_option('reb')
        self.assertEqual(self.ids(), {4})
        self.page.locator('#parlay-market').select_option('atgs')
        expect(self.page.locator('#calculator')).to_be_visible()
        expect(self.page.locator('#prop-filter')).to_be_hidden()
        expect(self.page.locator('#side-filter')).to_be_hidden()
        expect(self.page.locator('#player-search')).to_have_value('')
        expect(self.page.locator('#game-filter')).to_have_value('')
        self.assertEqual(self.ids(), {101, 102})
        self.page.locator('#parlay-market').select_option('nba')
        expect(self.page.locator('#prop-filter')).to_be_visible()
        expect(self.page.locator('#prop-filter')).to_have_value('')
        expect(self.page.locator('#side-filter')).to_have_value('')
        expect(self.page.locator('#selection-count')).to_have_text('0 / 8 selected')
        self.assertEqual(self.ids(), set(range(1, 12)) - {9})
        self.assertEqual(self.gets, ['nba', 'atgs', 'nba'])

    def test_duplicate_player_alternate_line_and_same_game_are_blocked(self):
        self.open()
        self.pick(1)
        for index in (2, 3, 4, 5):
            button = self.row(index).locator('button[data-leg]')
            expect(button).to_be_disabled()
            expect(button).to_have_attribute('title', 'Player already selected')
        button = self.row(11).locator('button[data-leg]')
        expect(button).to_be_disabled()
        expect(button).to_have_attribute('title', 'Matchup already selected')
        self.assertEqual(self.posts, [])
        expect(self.row(6).locator('button[data-leg]')).to_be_enabled()
        self.page.locator('[data-remove="0"]').click()
        for index in (2, 3, 4, 5, 11):
            expect(self.row(index).locator('button[data-leg]')).to_be_enabled()

    def test_under_requires_only_its_own_current_offer_but_reference_requires_pair(self):
        self.open()
        self.assertIn(8, self.ids())
        self.assertNotIn(9, self.ids())
        expect(self.row(8).locator('.ev-offer')).to_contain_text('FD +140')
        expect(self.row(10).locator('.ev-offer')).to_contain_text('DK +125')
        self.page.locator('#picker-book').select_option('fd')
        self.assertNotIn(10, self.ids())  # Stale +250 cannot masquerade as a current under.
        self.pick(8)
        self.pick(7)
        self.calculated(8, 7)
        expect(self.page.locator('[data-price-tile="fd"] .parlay-book-odds')).to_have_text('+500')
        expect(self.page.locator('[data-price-tile="dk"]')).to_have_count(0)
        self.references('fd')
        self.calculated(8, 7)
        expect(self.page.locator('[data-price-tile="fd"] .parlay-book-ev')).to_have_text(re.compile(r'^EV\s+[—-]$'))
        expect(self.page.locator('#result-status')).to_contain_text('0 selected reference books')
        expect(self.row(8).locator('.catalog-ev strong')).to_have_text(re.compile(r'^[—-]$'))

    def test_method_and_reference_changes_recalculate_selected_side_ev(self):
        self.open()
        self.pick(6)
        self.pick(7)
        self.calculated(6, 7)
        expect(self.page.locator('[data-price-tile="dk"] .parlay-book-ev')).to_have_text('+25.3% EV')
        self.page.locator('#method').select_option('mult')
        expect(self.page.locator('[data-price-tile="dk"] .parlay-book-ev')).to_have_text('+5.8% EV')
        self.calculated(6, 7)
        self.assertEqual(self.posts[-1]['method'], 'mult')
        self.references('fd')
        expect(self.page.locator('[data-price-tile="dk"] .parlay-book-ev')).to_have_text('+43.2% EV')
        self.calculated(6, 7)
        expect(self.page.locator('#selection-count')).to_have_text('2 / 8 selected')
        self.assertEqual(self.page.locator('#price-head [data-ev-reference]').evaluate_all(
            'heads => heads.map(head => head.dataset.evReference)'), ['fd'])
        expect(self.page.locator('#leg-inputs .leg-card.is-filled').first).to_contain_text('Under 24.5 points')
        self.assertEqual(self.gets, ['nba'])

    def test_sharp_access_denial_hides_and_clears_loaded_nba_results(self):
        self.open()
        self.pick(1)
        self.pick(6)
        self.calculated(1, 6)
        self.denied = True
        self.page.locator('#refresh').click()
        expect(self.page.locator('#access-panel')).to_be_visible()
        expect(self.page.locator('#calculator')).to_be_hidden()
        expect(self.page.locator('#results')).to_be_hidden()
        expect(self.page.locator('#access-panel')).to_contain_text('Sharp')
        expect(self.page.locator('#parlay-book-prices > *')).to_have_count(0)

    def test_large_nba_slate_pages_all_matches_and_filters_reset_to_first_page(self):
        template = self.catalogs['nba']['legs'][6]
        for index in range(105):
            extra = deepcopy(template)
            extra.update(id=f'{1000 + index:024x}', player=f'extra player {index:03d}',
                         game=f'away{index} @ home{index}')
            self.catalogs['nba']['legs'].append(extra)
        self.open()
        expect(self.page.locator('#catalog-pagination')).to_be_visible()
        self.assertEqual(len(self.ids()), 100)
        first = self.ids()
        expect(self.page.locator('#catalog-prev')).to_be_disabled()
        self.page.locator('#catalog-next').click()
        self.assertEqual(len(self.ids()), 15)
        self.assertTrue(first.isdisjoint(self.ids()))
        expect(self.page.locator('#catalog-next')).to_be_disabled()
        self.page.locator('#catalog-prev').click()
        self.assertEqual(self.ids(), first)
        self.page.locator('#catalog-next').click()
        self.page.locator('#player-search').fill('alpha')
        self.assertEqual(self.ids(), {1, 2, 3, 4, 5})
        expect(self.page.locator('#catalog-prev')).to_be_disabled()
        expect(self.page.locator('#catalog-next')).to_be_disabled()
        self.page.locator('#player-search').fill('')
        self.page.locator('#catalog-next').click()
        self.page.locator('#game-filter').select_option('den @ uta')
        self.assertEqual(self.ids(), {7})
        expect(self.page.locator('#catalog-prev')).to_be_disabled()
        expect(self.page.locator('#catalog-next')).to_be_disabled()

    def test_desktop_and_small_mobile_keep_filters_and_results_inside_viewport(self):
        for width in (1440, 390, 320):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 1000})
                self.open()
                self.pick(1)
                self.pick(6)
                self.calculated(1, 6)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                for selector in ('#prop-filter', '#side-filter', '#method', '#picker-book',
                                 '#fair-books-picker', '#leg-inputs', '#parlay-book-prices'):
                    box = self.page.locator(selector).bounding_box()
                    self.assertIsNotNone(box, selector)
                    self.assertGreaterEqual(box['x'], -1, selector)
                    self.assertLessEqual(box['x'] + box['width'], width + 1, selector)
                self.page.locator('#fair-books-summary').click()
                box = self.page.locator('#fair-books-menu').bounding_box()
                self.assertGreaterEqual(box['x'], -1)
                self.assertLessEqual(box['x'] + box['width'], width + 1)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.page.locator('#fair-books-summary').click()
                if width == 320:
                    self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-nba-320.png'), full_page=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
