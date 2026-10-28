"""Offline browser checks for daily line movement and lazy selected-series loading."""
from copy import deepcopy
import os
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit
import tempfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

# Optional read-only fallback lets a staged test run against unchanged assets.
ASSETS = Path(os.environ.get('MOVEMENT_TEST_ASSETS', str(ROOT)))


def asset_path(relative):
    staged = ROOT / relative
    return staged if staged.is_file() else ASSETS / relative


def window_metadata(data, query):
    updated = datetime.fromisoformat(data['updated'].replace('Z', '+00:00'))
    window = query.get('window', '6h')
    start = updated - timedelta(hours=24 if window == 'today' else int(window[:-1]))
    start += timedelta(minutes=state.get('window_shift', 0))
    data.update(window=window, window_start=start.isoformat(), window_end=updated.isoformat())
    if state.get('window_shift'):
        for row in data.get('rows', [data.get('selection')]):
            if row:
                row.update(first_at=start.isoformat(), first_fair_at=start.isoformat(),
                           first_fair=430, first_probability=100/530)
        if data.get('points'):
            data['points'][0].update(ts=start.isoformat(), fair=430, probability=100/530)
    return data


def select_card(page, index=0):
    back = page.locator('#back-to-plays')
    if page.viewport_size['width'] <= 850 and back.is_visible():
        back.click()
    page.locator('#catalog-rows .movement-play').nth(index).click()

NOW = datetime(2026, 9, 30, 19, 0, tzinfo=timezone.utc)


def selection(index, player, prop='hr', handicap='0.5', change=3.5):
    return dict(id=f'{index:024x}', game='nyy @ bos', start=(NOW + timedelta(hours=3)).isoformat(),
                player=player, prop=prop, handicap=handicap, side=0, side_labels=['Over', 'Under'],
                first_at=(NOW-timedelta(hours=6)).isoformat(), last_at=NOW.isoformat(),
                point_count=2, reference_books=['circa', 'pn'], first_fair=400, current_fair=326,
                first_probability=.2, current_probability=.235, change_pp=change, status='ok')


ROWS = [selection(1, 'aaron judge'), selection(2, 'shohei ohtani', change=-2),
        selection(3, 'aaron judge', 'tb', '1.5', 1.2), selection(4, 'aaron judge', 'tb', '2.5', .6),
        selection(5, '<img src=x onerror=alert(1)>', 'rbi', '0.5', None)]
ROWS[-1].update(status='insufficient_fair_data', first_fair=None, current_fair=None,
                first_probability=None, current_probability=None, reference_books=[])
CATALOG = dict(sport='mlb', day='2026-09-30', updated=NOW.isoformat(), interval_minutes=30,
               max_age_minutes=60, props=['hr', 'tb', 'rbi'], books=['circa', 'pn', 'fd'],
               total=len(ROWS), offset=0, limit=100, rows=ROWS, status='ok')


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
state = dict(status=200, requests=[], payload=deepcopy(CATALOG), delayed=[], null_side=False)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1050})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=NOW)

        def intercept(route):
            request_url = route.request.url
            if '/api/line-movement?' in request_url:
                query = {key: values[0] for key, values in parse_qs(urlsplit(request_url).query).items()}
                state['requests'].append(query)
                assert route.request.headers.get('authorization') == 'Bearer fixture-token'
                if query.get('query') == 'slow':
                    state['delayed'].append(route)
                    return
                if state['status'] != 200:
                    route.fulfill(status=state['status'], json={'error': 'fixture'})
                    return
                data = deepcopy(state['payload'])
                data['sport'] = query.get('sport', 'mlb')
                if 'id' in query:
                    row = next((item for item in data['rows'] if item['id'] == query['id']), None)
                    data.pop('rows')
                    data['selection'] = row
                    data['points'] = []
                    if row:
                        row['side'] = int(query.get('side', 0))
                        if state['null_side']:
                            row.update(first_fair=None, current_fair=None, first_probability=None,
                                       current_probability=None, change_pp=None, status='insufficient_fair_data')
                        raw_only = row['status'] == 'insufficient_fair_data'
                        if query.get('reference') == 'circa':
                            row['reference_books'] = ['circa']
                        for index, ts in enumerate([row['first_at'], row['last_at']]):
                            prices = {'circa': None, 'pn': None, 'fd': None} if state['null_side'] else {'circa': 380-index*70, 'pn': 390-index*70, 'fd': 410-index*70}
                            data['points'].append(dict(ts=ts, prices=prices,
                                                      fair=None if raw_only else [400, 326][index],
                                                      probability=None if raw_only else [.2, .235][index]))
                else:
                    rows = data['rows']
                    if query.get('query'):
                        rows = [row for row in rows if query['query'].lower() in row['player'].lower()]
                    if query.get('props'):
                        rows = [row for row in rows if row['prop'] in query['props'].split(',')]
                    if query.get('direction') == 'shortening':
                        rows = [row for row in rows if row['change_pp'] is not None and row['change_pp'] > 0]
                    if query.get('direction') == 'drifting':
                        rows = [row for row in rows if row['change_pp'] is not None and row['change_pp'] < 0]
                    for row in rows:
                        row['side'] = int(query.get('side', 0))
                    data['rows'] = rows
                    data['total'] = state.get('force_total', len(rows))
                route.fulfill(json=window_metadata(data, query))
            elif 'cdn.jsdelivr.net' in request_url:
                route.fulfill(content_type='application/javascript', body='''window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                    onAuthStateChange: fn => {window.authChanged = fn; return {};}
                }})};''')
            elif request_url.startswith('https://ev-sharps.test/'):
                asset = asset_path(request_url.split('/', 3)[3].split('?', 1)[0])
                if asset.is_file():
                    route.fulfill(path=asset)
                else:
                    route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        page.goto('https://ev-sharps.test/movement.html?sport=mlb')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(5)
        expect(page.locator('#chart-title')).to_have_text('Aaron Judge')
        page.wait_for_function("document.getElementById('movement-chart').data?.length === 4")
        assert len([request for request in state['requests'] if 'id' in request]) == 1
        assert '30 minutes' in page.locator('#day-note').inner_text()
        assert '+3.50 pp' in page.locator('#selection-metrics').inner_text()
        assert page.locator('#catalog-rows img[src="x"]').count() == 0
        assert page.locator('#movement-chart').bounding_box()['height'] >= 330
        assert page.evaluate("document.getElementById('movement-chart').data.at(-1).name.includes('fair')")
        assert page.evaluate("document.getElementById('movement-chart').data.at(-1).y[0]") == 20

        # One window controls both requests and survives URL restoration. A change
        # resets pagination and refreshes the selected exact market's chart.
        assert all(request.get('window') == '6h' for request in state['requests'])
        expect(page.locator('[data-window="6h"][aria-pressed="true"]')).to_have_count(2)
        state['force_total'] = 200
        page.locator('#refresh').click()
        page.locator('#next-page').click()
        expect(page.locator('#previous-page')).to_be_enabled()
        assert next(request for request in reversed(state['requests']) if 'id' not in request)['offset'] == '100'
        page.locator('.window-toolbar [data-window="1h"]').click()
        page.clock.run_for(20)
        expect(page.locator('#previous-page')).to_be_disabled()
        summary = next(request for request in reversed(state['requests']) if 'id' not in request)
        assert summary['window'] == '1h' and summary['offset'] == '0', summary
        expect(page.locator('#chart-title')).to_have_text('Aaron Judge')
        assert state['requests'][-1]['window'] == '1h' and state['requests'][-1]['id'] == ROWS[0]['id']
        assert 'window=1h' in page.url
        expect(page.locator('[data-window="1h"][aria-pressed="true"]')).to_have_count(2)
        state.pop('force_total')
        page.locator('.chart-toolbar [data-window="6h"]').click()
        page.clock.run_for(20)
        expect(page.locator('#chart-title')).to_have_text('Aaron Judge')

        # A rolling cutoff can change while the snapshot update time stays fixed.
        # Identical bounds reuse detail; changed bounds require a new baseline.
        count = len([request for request in state['requests'] if 'id' in request])
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#refresh')).to_be_enabled()
        assert len([request for request in state['requests'] if 'id' in request]) == count
        state['window_shift'] = 60
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#selection-metrics > div').nth(3).locator('strong')).to_have_text('+430')
        assert len([request for request in state['requests'] if 'id' in request]) == count + 1
        expect(page.locator('#window-range')).to_contain_text('10:00 AM')
        assert page.evaluate("document.getElementById('movement-chart').data.at(-1).y[0]") == 10000 / 530
        state['window_shift'] = 0
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#selection-metrics > div').nth(3).locator('strong')).to_have_text('+400')
        output = Path(tempfile.mkdtemp(prefix='line-movement-'))
        page.screenshot(path=str(output/'desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        select_card(page)
        page.clock.run_for(400)
        page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width <= 390")
        page.screenshot(path=str(output/'mobile.png'), full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1050})
        page.clock.run_for(400)
        page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width > 700")

        # Raw-book visibility and chart units never trigger history downloads.
        count = len(state['requests'])
        page.locator('#book-options input[value="fd"]').uncheck()
        assert page.evaluate("document.getElementById('movement-chart').data.length") == 3
        page.select_option('#chart-scale', 'probability')
        assert page.evaluate("document.getElementById('movement-chart').layout.yaxis.title.text") == 'Probability (%)'
        assert len(state['requests']) == count

        # Search + multi-prop filters preserve distinct handicaps; selection is exact.
        page.fill('#player-search', 'judge')
        page.clock.run_for(300)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(3)
        page.locator('#prop-summary').click()
        page.locator('#prop-options input[value="hr"]').check()
        page.clock.run_for(20)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(1)
        page.locator('#prop-options input[value="tb"]').check()
        page.clock.run_for(20)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(3)
        assert state['requests'][-2].get('props') == 'hr,tb'
        page.locator('#prop-summary').click()
        select_card(page, 2)
        expect(page.locator('#chart-subtitle')).to_contain_text('2.5')
        page.select_option('#reference-select', 'circa')
        page.clock.run_for(20)
        expect(page.locator('#chart-subtitle')).to_contain_text('Circa')
        expect(page.locator('#chart-subtitle')).to_contain_text('2.5')
        assert state['requests'][-1]['id'] == f'{4:024x}'
        page.select_option('#side-select', '1')
        page.clock.run_for(20)
        expect(page.locator('#chart-subtitle')).to_contain_text('Under')

        # One-sided markets can return no quotes at all for the opposite side.
        state['null_side'] = True
        page.locator('#refresh').click()
        expect(page.locator('#chart-status')).to_contain_text('No captured prices for this side')
        expect(page.locator('#movement-chart')).to_be_hidden()
        expect(page.locator('#book-picker')).to_be_visible()
        expect(page.locator('#side-select')).to_be_visible()
        state['null_side'] = False
        page.locator('#refresh').click()
        expect(page.locator('#movement-chart')).to_be_visible()

        # Delayed prior search cannot replace the latest sport/filter results.
        page.fill('#player-search', 'slow')
        page.clock.run_for(300)
        page.fill('#player-search', 'ohtani')
        page.select_option('#sport-select', 'nhl')
        page.clock.run_for(300)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(1)
        expect(page.locator('#chart-title')).to_have_text('Shohei Ohtani')
        for route in state['delayed']:
            try:
                route.fulfill(json=CATALOG)
            except Exception:
                pass
        expect(page.locator('#chart-title')).to_have_text('Shohei Ohtani')
        assert 'sport=nhl' in page.url
        page.select_option('#direction-select', 'shortening')
        page.clock.run_for(20)
        expect(page.locator('#empty-slate')).to_contain_text('No captured selections match')
        page.select_option('#direction-select', 'drifting')
        page.clock.run_for(20)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(1)

        # Missing pairs keep raw histories and clearly omit fair values.
        page.fill('#player-search', '<img')
        page.select_option('#direction-select', 'all')
        page.clock.run_for(300)
        expect(page.locator('#chart-status')).to_contain_text('paired prices are missing')
        assert page.locator('#chart-title img').count() == 0
        assert page.evaluate("document.getElementById('movement-chart').data.every(t => !t.name.includes('fair'))")

        # Responsive layout uses a scrollable slate, with the full large chart in view.
        page.set_viewport_size({'width': 390, 'height': 844})
        select_card(page)
        page.clock.run_for(400)
        page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width <= 390")
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        assert page.locator('#movement-chart').bounding_box()['height'] >= 300
        page.screenshot(path=str(output/'mobile-raw-only.png'), full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1050})
        page.clock.run_for(400)
        page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width > 700")
        page.screenshot(path=str(output/'desktop-raw-only.png'), full_page=True)

        # Same-capture polling does not fetch the selected history again.
        count = len([request for request in state['requests'] if 'id' in request])
        page.evaluate('window.refreshMovement()')
        assert len([request for request in state['requests'] if 'id' in request]) == count
        state['status'] = 503
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#request-status')).to_contain_text('Unable to load')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(1)
        for status in [401, 403]:
            state['status'] = status
            page.evaluate('window.refreshMovement()')
            expect(page.locator('#access-panel')).to_be_visible()
            expect(page.locator('#movement-content')).to_be_hidden()
            expect(page.locator('#catalog-rows .movement-play')).to_have_count(0)
            expect(page.locator('#movement-chart')).to_be_hidden()
            assert page.evaluate("!document.getElementById('movement-chart').data")
        state['status'] = 200
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#movement-content')).to_be_visible()
        page.fill('#player-search', '')
        page.clock.run_for(300)
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(5)

        # Exact home spread signs and future game dates stay visible in the chart.
        state['payload']['rows'][0].update(prop='spread', handicap='-1.5', side_labels=['NYY', 'BOS'],
                                           start=(NOW+timedelta(days=1)).isoformat())
        page.select_option('#side-select', '1')
        page.clock.run_for(20)
        select_card(page)
        expect(page.locator('#chart-subtitle')).to_contain_text('BOS 1.5')
        expect(page.locator('#chart-subtitle')).to_contain_text('Oct 1')
        page.select_option('#reference-select', 'circa')
        page.clock.run_for(20)
        expect(page.locator('#chart-subtitle')).to_contain_text('Circa')

        # Hidden tabs do not poll; returning refreshes the selected sport only.
        page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'})")
        count = len(state['requests'])
        page.clock.run_for(61000)
        assert len(state['requests']) == count
        page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator('#refresh')).to_be_enabled()
        assert len(state['requests']) > count

        # A failed poll cannot keep an already-started selection ranked as current.
        state['payload']['rows'][0]['start'] = (NOW+timedelta(minutes=2)).isoformat()
        page.locator('#refresh').click()
        expect(page.locator('#refresh')).to_be_enabled()
        state['status'] = 503
        page.clock.run_for(120000)
        expect(page.locator('#catalog-rows .movement-play').first).to_contain_text('Game started')
        assert page.locator('#catalog-rows .movement-play').first.locator('.play-metrics > span').nth(2).locator('strong').inner_text() == '-'
        expect(page.locator('#selection-metrics')).to_contain_text('Game started')
        state['status'] = 200
        state['payload']['rows'][0].update(start=(NOW+timedelta(days=1)).isoformat(), last_at=(NOW-timedelta(hours=2)).isoformat())
        page.locator('#refresh').click()
        expect(page.locator('#refresh')).to_be_enabled()
        expect(page.locator('#catalog-rows .movement-play').first).to_contain_text('Capture out of date')
        state['status'] = 503
        page.evaluate('window.refreshMovement()')
        assert page.locator('#catalog-rows .movement-play').first.locator('.play-metrics > span').nth(2).locator('strong').inner_text() == '-'

        # Eastern midnight clears private history before any successful refresh.
        state['status'] = 503
        page.clock.fast_forward(9*60*60*1000 + 100)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(0)
        expect(page.locator('#movement-chart')).to_be_hidden()
        expect(page.locator('#slate-date')).to_contain_text('October 1')
        assert page.locator('#reference-select').input_value() == 'consensus'
        state['status'] = 200  # A stale server response must still be rejected.
        page.evaluate('window.refreshMovement()')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(0)
        expect(page.locator('#movement-chart')).to_be_hidden()

        assert not errors, errors
        browser.close()
        print(f'Line movement browser checks passed. Screenshots: {output}')
finally:
    server.shutdown()
