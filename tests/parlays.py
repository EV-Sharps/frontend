"""Check the parlay price table, selection constraints and quote request flow."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from math import prod
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)
BOOKS = {'circa': 'Circa', 'pn': 'Pinnacle', 'fd': 'FanDuel', 'dk': 'DraftKings', 'br': 'BetRivers'}


def quote(over, under=-700, status='available'):
    return {'over': over, 'under': under, 'status': status, 'updated_at': NOW.isoformat()}


def leg(index, player, game, price):
    return {'id': f'{index:024x}', 'player': player, 'game': game, 'team': game.split(' @ ')[0],
            'start': (NOW + timedelta(hours=3)).isoformat(), 'market': 'Over 0.5 home runs',
            'quotes': {'circa': quote(price - 30), 'pn': quote(price - 20),
                       'fd': quote(price), 'dk': quote(price + 50), 'br': quote(None, None, 'Missing over price')}}


CATALOG = {'date': NOW.date().isoformat(), 'generated_at': NOW.isoformat(), 'books': BOOKS,
           'max_age_minutes': 10, 'legs': [
               leg(1, 'aaron judge', 'nyy @ bos', 400),
               leg(2, 'rafael devers', 'nyy @ bos', 420),
               leg(3, 'shohei ohtani', 'lad @ sd', 300),
               leg(4, 'pete alonso', 'nym @ phi', 550),
               leg(5, 'bobby witt', 'kc @ det', 700),
               leg(6, 'another hitter', 'nyy-gm2 @ bos-gm2', 200),
               leg(7, 'aaron judge', 'nyy @ tor', 250),
           ]}
CATALOG['legs'][3]['quotes']['dk'] = quote(600, None, 'Missing under price')
CATALOG['legs'][4]['quotes']['dk'] = quote(900, -1200, 'Stale prices')
CATALOG['legs'][4]['quotes']['dk']['updated_at'] = (NOW - timedelta(minutes=20)).isoformat()


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "parlay-table.log"}',
        ])
        page = browser.new_page(viewport={'width': 1440, 'height': 1080})
        errors, posts = [], []
        state = {'catalog': deepcopy(CATALOG), 'denied': False, 'hold_next': False, 'held': None, 'fail_next': False, 'legacy': False}
        state['probabilities'] = {'circa': 0.02, 'pn': 0.005}
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.fulfill(
            body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange:()=>{}}})};"
            if 'supabase-js' in route.request.url else '', content_type='application/javascript'))

        def respond(route):
            if state['denied']:
                return route.fulfill(status=403, json={'error': 'Sign in'})
            if route.request.method == 'GET':
                return route.fulfill(json=state['catalog'])
            payload = route.request.post_data_json
            posts.append(payload)
            assert len(payload['legs']) in (2, 3, 4)
            assert all(payload['legs'])
            if state['fail_next']:
                state['fail_next'] = False
                return route.fulfill(status=503, json={'error': 'Prices temporarily unavailable'})
            selected = [next(leg for leg in state['catalog']['legs'] if leg['id'] == id) for id in payload['legs']]
            references = [{'book': book, 'name': name, 'complete': True, 'same_as_betting_book': book == payload['betting_book'],
                           'probability': 0.02, 'fair_odds': 4900, 'raw_product_odds': 4800, 'ev': 2,
                           'legs': [dict(leg['quotes'][book], probability=0.2, fair_odds=400) for leg in selected]}
                          for book, name in BOOKS.items() if book in ('circa', 'pn')]
            for ref in references:
                probability = state['probabilities'][ref['book']]
                if probability is not None and payload['method'] == 'mult':
                    probability *= 0.5
                ref.update(probability=probability, complete=probability is not None,
                           fair_odds=(1 / probability - 1) * 100 if probability else None)
            prices = []
            for book, name in BOOKS.items():
                if book in ('circa', 'pn'):
                    continue
                quotes = [leg['quotes'].get(book) for leg in selected]
                if not all(q and q['over'] is not None and abs(q['over']) >= 100
                           and q['status'] in ('available', 'Missing under price')
                           and -60 <= (NOW - datetime.fromisoformat(q['updated_at'])).total_seconds() <= 600 for q in quotes):
                    continue
                decimal = prod(1 + q['over'] / 100 if q['over'] > 0 else 1 + 100 / -q['over'] for q in quotes)
                prices.append({'book': book, 'name': name, 'decimal': decimal, 'odds': (decimal - 1) * 100,
                               'legs': [dict(q, player=leg['player'], id=leg['id']) for leg, q in zip(selected, quotes)]})
            prices.sort(key=lambda price: -price['decimal'])
            response = {'legs': selected, 'references': references, 'prices': prices,
                        'best_price': prices[0] if prices else None,
                        'offered_odds': payload['offered_odds'], 'max_age_minutes': 10}
            if state['legacy']:
                # Running older servers omit prices and only provide quotes within references.
                del response['prices']
                del response['best_price']
                for book, name in BOOKS.items():
                    if book in ('circa', 'pn'):
                        continue
                    references.append({'book': book, 'name': name, 'complete': False, 'same_as_betting_book': False,
                                       'probability': None, 'fair_odds': None, 'raw_product_odds': None, 'ev': None,
                                       'legs': [dict(leg['quotes'][book], id=leg['id'], player=leg['player'],
                                                     probability=None, fair_odds=None) for leg in selected]})
            if state['hold_next']:
                state['hold_next'] = False
                state['held'] = (route, response)
            else:
                route.fulfill(json=response)

        page.route('**/api/parlays', respond)
        page.goto(f'http://localhost:{server.server_port}/parlays.html')
        page.wait_for_function("!document.getElementById('calculator').hidden")

        def row(index):
            return page.locator(f'[data-leg-row="{index:024x}"]')

        def pick(index):
            return row(index).locator('button[data-leg]')

        def count(expected):
            assert page.locator('#selection-count').inner_text() == f'{expected} / 4 selected'

        def calculated(ids):
            expect(page.locator('#results')).to_be_visible()
            expect(page.locator('#calculation-status')).to_have_text(f'{len(ids)}-leg parlay updated automatically.')
            assert posts[-1]['legs'] == [f'{index:024x}' for index in ids]
            assert page.locator('#reference-head th').count() == len(ids) + 4
            assert page.locator('#price-head th').count() == len(ids) + 4

        def order(expected):
            ids = page.locator('#catalog-rows tr[data-leg-row]').evaluate_all("rows => rows.map(row => row.dataset.legRow)")
            assert ids == [f'{index:024x}' for index in expected], ids

        count(0)
        assert page.locator('#catalog-rows tr').count() == 7
        order([6, 7, 3, 1, 2, 4, 5])
        assert page.locator('[data-key="average"]').get_attribute('aria-sort') == 'ascending'
        assert row(4).locator('.catalog-average').inner_text() == '+550'  # Includes a fresh over with no under.
        assert row(5).locator('.catalog-average').inner_text() == '+683'  # Excludes the stale +900 price.
        assert page.locator('#leg-inputs input, #leg-inputs select').count() == 0
        assert page.locator('#leg-inputs .leg-card').count() == 4
        assert 'Leg 3 (optional)' in page.locator('#leg-inputs').inner_text()
        assert 'Leg 4 (optional)' in page.locator('#leg-inputs').inner_text()
        assert page.locator('#calculate').is_disabled()
        assert page.locator('#catalog-head img').count() == 4
        assert page.locator('[data-sort="book:br"]').count() == 0
        assert row(4).locator('.catalog-price').last.inner_text() == '+600\n-'
        assert row(5).locator('.catalog-price').last.inner_text() == 'Stale'
        assert row(5).locator('.best-price').inner_text() == '+700\n-700'
        page.locator('[data-sort="book:fd"]').click()
        assert page.locator('#catalog-rows tr').first.get_attribute('data-leg-row') == f'{5:024x}'
        pick(1).click()
        assert pick(1).get_attribute('aria-pressed') == 'true'
        assert all(pick(index).is_disabled() for index in (2, 6, 7))
        assert not posts
        assert page.locator('#calculate').is_disabled()
        assert page.locator('#calculation-status').inner_text() == 'Choose 1 more player to calculate automatically.'
        pick(3).click()
        count(2)
        calculated([1, 3])
        assert page.locator('[data-price-book="dk"] .parlay-total').inner_text() == '+2,375'
        assert page.locator('[data-price-book="fd"] .parlay-total').inner_text() == '+1,900'
        assert page.locator('[data-price-book="dk"] [data-ev-book="circa"]').inner_text() == '-50.5%'
        assert page.locator('[data-price-book="dk"] [data-ev-book="pn"]').inner_text() == '-87.6%'
        post_count = len(posts)
        pick(3).click()
        count(1)
        assert page.locator('#results').is_hidden()
        assert page.locator('#calculate').is_disabled()
        assert len(posts) == post_count
        pick(3).click()
        calculated([1, 3])
        pick(4).click()
        count(3)
        calculated([1, 3, 4])
        assert page.locator('#calculate').is_enabled()
        assert pick(5).is_enabled()
        assert page.locator('#price-rows tr').first.get_attribute('data-price-book') == 'dk'
        assert page.locator('#price-rows tr').first.locator('.parlay-total').inner_text() == '+17,225'
        assert page.locator('[data-price-book="fd"] .parlay-total').inner_text() == '+12,900'
        assert 'DraftKings' in page.locator('#best-parlay-price').inner_text()

        # Compare each book's full-precision estimated product with each distinct reference probability.
        assert page.locator('[data-ev-reference="circa"] small').inner_text() == 'Fair +4,900'
        assert page.locator('[data-ev-reference="pn"] small').inner_text() == 'Fair +19,900'
        assert page.locator('[data-price-book="dk"] [data-ev-book="circa"]').inner_text() == '+246.5%'
        assert page.locator('[data-price-book="dk"] [data-ev-book="pn"]').inner_text() == '-13.4%'
        assert page.locator('[data-price-book="fd"] [data-ev-book="circa"]').inner_text() == '+160.0%'
        assert 'positive' in page.locator('[data-price-book="dk"] [data-ev-book="circa"]').get_attribute('class')
        assert 'negative' in page.locator('[data-price-book="dk"] [data-ev-book="pn"]').get_attribute('class')
        page.locator('#offered-odds').fill('+9999')
        calculated([1, 3, 4])
        assert page.locator('[data-price-book="dk"] [data-ev-book="circa"]').inner_text() == '+246.5%'
        page.locator('#offered-odds').fill('')
        calculated([1, 3, 4])
        page.locator('#method').select_option('mult')
        calculated([1, 3, 4])
        assert page.locator('[data-price-book="dk"] [data-ev-book="circa"]').inner_text() == '+73.3%'
        assert page.locator('[data-ev-reference="circa"] small').inner_text() == 'Fair +9,900'
        page.locator('#method').select_option('power')
        calculated([1, 3, 4])
        state['probabilities'] = {'circa': 1 / 130, 'pn': None}
        page.evaluate('window.refreshParlays()')
        assert page.locator('[data-price-book="fd"] [data-ev-book="circa"]').inner_text() == '0.0%'
        assert page.locator('[data-price-book="fd"] [data-ev-book="circa"]').get_attribute('class') == 'parlay-ev'
        assert page.locator('[data-price-book="dk"] [data-ev-book="pn"]').inner_text() == '-'
        assert page.locator('[data-ev-reference="pn"] small').inner_text() == 'Fair -'
        assert page.locator('#price-rows tr').count() == 2
        state['probabilities'] = {'circa': 0.02, 'pn': 0.005}

        # A missing totals field is not missing coverage, including books without complete unders.
        state['legacy'] = True
        page.evaluate('window.refreshParlays()')
        calculated([1, 3, 4])
        assert page.locator('[data-price-book="dk"] .parlay-total').inner_text() == '+17,225'
        assert page.locator('[data-price-book="fd"] .parlay-total').inner_text() == '+12,900'
        assert page.locator('[data-price-book="br"]').count() == 0

        # Automatic refresh must retain visible results, expanded books, and page/table scroll positions.
        page.locator('#show-unavailable').click()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate("""() => {
            const table = document.getElementById('catalog-wrap');
            table.style.maxHeight = '160px'; table.scrollTop = 80; table.scrollLeft = 120;
            document.querySelector('.parlay-prices').scrollLeft = 90;
            window.scrollTo(0, document.documentElement.scrollHeight);
        }""")
        page.wait_for_timeout(50)
        def scroll_position():
            return page.evaluate("""() => ({page: window.scrollY,
                top: document.getElementById('catalog-wrap').scrollTop,
                left: document.getElementById('catalog-wrap').scrollLeft,
                prices: document.querySelector('.parlay-prices').scrollLeft})""")
        before_refresh = scroll_position()
        assert all(value > 0 for value in before_refresh.values()), before_refresh
        state['hold_next'] = True
        state['held'] = None
        page.evaluate('void window.refreshParlays()')
        expect(page.locator('#results')).to_have_attribute('aria-busy', 'true')
        expect(page.locator('#calculate')).to_have_text('Calculating...')
        assert state['held'] is not None
        assert page.locator('#results').is_visible()
        during_refresh = scroll_position()
        assert all(abs(before_refresh[key] - during_refresh[key]) <= 1 for key in before_refresh), (before_refresh, during_refresh)
        held_route, held_response = state['held']
        held_route.fulfill(json=held_response)
        calculated([1, 3, 4])
        after_refresh = scroll_position()
        assert all(abs(before_refresh[key] - after_refresh[key]) <= 1 for key in before_refresh), (before_refresh, after_refresh)
        assert page.locator('#show-unavailable').get_attribute('aria-expanded') == 'true'
        assert page.locator('[data-book="dk"]').is_visible()
        page.locator('#show-unavailable').click()
        page.evaluate("document.getElementById('catalog-wrap').style.maxHeight=''")
        page.set_viewport_size({'width': 1440, 'height': 1080})

        # The older-response calculation still rejects stale fourth-leg prices.
        pick(5).click()
        count(4)
        calculated([1, 3, 4, 5])
        assert page.locator('#price-rows tr').count() == 1  # DK has a stale fourth-leg price.
        assert page.locator('[data-price-book="fd"] .parlay-total').inner_text() == '+103,900'
        state['legacy'] = False
        page.evaluate('window.refreshParlays()')
        assert page.locator('#reference-rows .reference-leg').count() == 8
        assert all(pick(index).is_disabled() for index in (2, 6, 7))
        pick(5).click()
        calculated([1, 3, 4])

        # Filtering the catalog never drops already selected legs.
        page.locator('#player-search').fill('bobby')
        assert page.locator('#catalog-rows tr').count() == 1
        count(3)
        page.locator('#leg-inputs').get_by_role('button', name='Remove Shohei Ohtani', exact=True).click()
        count(2)
        calculated([1, 4])
        pick(5).click()
        count(3)
        calculated([1, 5, 4])
        page.locator('#player-search').fill('')
        page.locator('#game-filter').select_option('kc @ det')
        assert page.locator('#catalog-rows tr').count() == 1
        page.locator('#game-filter').select_option('')
        page.locator('#method').select_option('mult')
        page.locator('#betting-book').select_option('fd')
        assert '+700' in page.locator('#leg-inputs').inner_text()
        page.locator('#offered-odds').fill('+5000')
        calculated([1, 5, 4])
        assert posts[-1] == {'legs': [f'{index:024x}' for index in (1, 5, 4)],
                            'method': 'mult', 'betting_book': 'fd', 'offered_odds': 5000}

        # Refresh prices without losing selections, then remove a departed player.
        post_count = len(posts)
        state['catalog']['legs'][4]['quotes']['fd']['over'] = 800
        page.evaluate('window.refreshParlays()')
        assert len(posts) == post_count + 1
        count(3)
        assert '+800' in page.locator('#leg-inputs').inner_text()
        state['catalog']['legs'] = [leg for leg in state['catalog']['legs'] if leg['id'] != f'{1:024x}']
        page.evaluate('window.refreshParlays()')
        count(2)
        calculated([5, 4])
        assert 'no longer available' in page.locator('#request-status').inner_text()
        assert pick(2).is_enabled()
        page.locator('#clear').click()
        count(0)
        assert all(pick(index).is_enabled() for index in (2, 3, 4, 5, 6, 7))

        state['catalog']['legs'] = []
        page.evaluate('window.refreshParlays()')
        assert page.locator('#empty-slate').is_visible()
        assert page.locator('#calculate').is_disabled()

        # Average decimal prices across mixed American odds; absent current prices always sort last.
        state['catalog'] = deepcopy(CATALOG)
        state['catalog']['legs'] = state['catalog']['legs'][:3]
        state['catalog']['legs'][0]['quotes'] = {'circa': quote(-200), 'fd': quote(200)}
        state['catalog']['legs'][1]['quotes'] = {'fd': quote(110)}
        state['catalog']['legs'][2]['quotes'] = {'fd': quote(100, status='Stale prices'), 'pn': quote(0)}
        page.evaluate('window.refreshParlays()')
        page.locator('[data-sort="book:fd"]').click()
        page.locator('[data-sort="average"]').click()
        order([2, 1, 3])
        assert row(1).locator('.catalog-average').inner_text() == '+125'
        assert row(3).locator('.catalog-average').inner_text() == '-'
        page.locator('[data-sort="average"]').click()
        order([1, 2, 3])
        page.locator('[data-sort="average"]').click()
        state['catalog']['legs'][1]['quotes']['fd'] = quote(300)
        page.evaluate('window.refreshParlays()')
        order([1, 2, 3])

        state['catalog'] = deepcopy(CATALOG)
        page.evaluate('window.refreshParlays()')
        order([6, 7, 3, 1, 2, 4, 5])

        # A delayed three-leg result must not overwrite a newer four-leg selection.
        pick(1).click()
        pick(3).click()
        calculated([1, 3])
        state['hold_next'] = True
        pick(4).click()
        expect(page.locator('#calculate')).to_have_text('Calculating...')
        page.wait_for_timeout(50)
        assert state['held'] is not None
        pick(5).click()
        calculated([1, 3, 4, 5])
        held_route, held_response = state['held']
        held_route.fulfill(json=held_response)
        page.wait_for_timeout(50)
        calculated([1, 3, 4, 5])

        # Four slots really cap selection, even when another independent game is available.
        state['catalog']['legs'].append(leg(8, 'extra player', 'sea @ hou', 500))
        page.evaluate('window.refreshParlays()')
        assert pick(8).is_disabled()
        assert pick(8).inner_text() == 'Full'

        # A book must carry every leg; an unavailable best book never becomes a partial parlay.
        state['catalog']['legs'][4]['quotes']['fd'] = quote(None, None, 'Missing over price')
        page.evaluate('window.refreshParlays()')
        expect(page.locator('#best-parlay-price')).to_have_text('No complete book prices')
        assert 'No book has current homer prices' in page.locator('#price-rows').inner_text()
        state['catalog']['legs'][4]['quotes']['fd'] = quote(700)
        page.evaluate('window.refreshParlays()')
        calculated([1, 3, 4, 5])

        # Removing a non-last slot still prices all remaining legs.
        pick(3).click()
        calculated([1, 4, 5])
        assert pick(8).is_enabled()
        state['fail_next'] = True
        pick(3).click()
        expect(page.locator('#request-status')).to_contain_text('temporarily unavailable')
        assert page.locator('#results').is_hidden()
        page.locator('#calculate').click()
        calculated([1, 3, 4, 5])
        page.locator('#clear').click()
        assert page.locator('#results').is_hidden()
        count(0)

        page.locator('#player-search').fill('missing player')
        assert 'No players match' in page.locator('#catalog-rows').inner_text()
        page.locator('#player-search').fill('')
        page.locator('[data-sort="player"]').click()
        pick(1).click()
        pick(3).click()
        pick(4).click()
        calculated([1, 3, 4])
        page.wait_for_function("Array.from(document.querySelectorAll('.parlay-book-logo')).every(img => img.complete && img.naturalWidth > 0)")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-table-desktop.png'), full_page=True)

        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        before = row(1).locator('.catalog-player').bounding_box()['x']
        page.evaluate("document.getElementById('catalog-wrap').scrollLeft=200")
        after = row(1).locator('.catalog-player').bounding_box()['x']
        assert abs(after - before) < 1, (before, after)
        pick(5).click()
        count(4)
        calculated([1, 3, 4, 5])
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.wait_for_function("Array.from(document.querySelectorAll('.parlay-book-logo')).every(img => img.complete && img.naturalWidth > 0)")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-four-legs-mobile.png'), full_page=True)
        page.locator('#leg-inputs').get_by_role('button', name='Remove Pete Alonso', exact=True).click()
        count(3)
        calculated([1, 3, 5])
        page.evaluate("document.getElementById('catalog-wrap').scrollLeft=0")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-table-mobile.png'), full_page=True)
        pick(5).click()
        count(2)
        calculated([1, 3])
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        first_leg, second_leg = [cell.bounding_box() for cell in page.locator('[data-book="circa"] .reference-leg').all()]
        assert abs(first_leg['y'] - second_leg['y']) < 1
        assert second_leg['x'] > first_leg['x']
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'parlays-two-legs-mobile.png'), full_page=True)
        state['denied'] = True
        page.evaluate('window.refreshParlays()')
        assert page.locator('#calculator').is_hidden()
        assert page.locator('#access-panel').is_visible()
        assert not errors, errors
        print('Legacy/current API totals, scroll stability during refresh, automatic 2-4 legs, prices, races/retry, limits, mobile and access checks passed.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
