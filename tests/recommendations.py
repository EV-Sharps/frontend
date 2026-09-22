"""Browser integration checks with fixture data and mocked auth; no external requests."""
import copy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import tempfile
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STAGED = ROOT
SITE = ROOT
SCREENSHOTS = Path(tempfile.gettempdir()) / 'recommendations-browser'
SCREENSHOTS.mkdir(exist_ok=True)
NOW = datetime.now(timezone.utc)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = path.split('?')[0].strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def sample():
    base = dict(game='away @ home', player='test player', selection='test player Over 49.5 rec_yd',
                sport='ncaaf', main=False, book='nv', odds=125, ev=7.2, floor_ev=3.1,
                minimum_odds=118, liquidity=100.6, prop='rec_yd', handicap='49.5', under=False,
                reference_groups=3, reference_probabilities={'pn': .48, 'circa': .47, 'fd': .48},
                reference_age_minutes={'pn': 1, 'circa': 1, 'fd': 1},
                quote_updated=(NOW-timedelta(minutes=1)).isoformat(), quote_age_minutes=1,
                start=(NOW+timedelta(hours=2)).isoformat(), fair_odds=112,
                reasons=['Three references agree', '<img src=x onerror=alert(1)>'],
                link='https://example.com/selection', history={'hits': 6, 'games': 10})
    second = dict(base, sport='mlb', game='nyy @ bos', player='', main=True, selection='NYY moneyline',
                  book='dk', prop='ml', link='javascript:alert(1)', liquidity=None)
    return dict(date=NOW.astimezone(__import__('zoneinfo').ZoneInfo('America/New_York')).date().isoformat(),
                generated_at=NOW.isoformat(), picks=[base, second], qualifying_offers=4,
                criteria=dict(timezone='America/New_York', min_ev=3, min_floor_ev=1,
                              min_references=3, require_anchor=True, max_age_minutes=10,
                              min_minutes_to_start=5, min_liquidity=50, min_odds=-250,
                              max_odds=600, max_probability_spread=.06, max_per_game=2),
                feeds={'ncaaf': {'rows': 100, 'fresh_books': ['dk', 'pn', 'nv']}}, errors={})


state = {'status': 200, 'payload': sample()}
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--disable-logging', f'--log-file={SCREENSHOTS / "chromium.log"}'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('window.EventSource = undefined;')
        def intercept(route):
            if '/api/recommendations' in route.request.url:
                route.fulfill(status=state['status'], json=state['payload'])
            elif 'cdn.jsdelivr.net' in route.request.url:
                route.fulfill(content_type='application/javascript', body='''
                  window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                    onAuthStateChange: fn => {window.authChanged = fn; return {};}
                  }})};''')
            elif route.request.url.startswith(f'http://localhost:{server.server_port}/'):
                route.continue_()
            else:
                route.fulfill(status=404, body='')
        page.route('**/*', intercept)
        page.goto(f'http://localhost:{server.server_port}/recommendations.html')
        page.wait_for_selector('.rec-pick')
        assert page.locator('.rec-pick').count() == 2
        assert '$101' in page.locator('.rec-pick').first.inner_text()
        assert page.locator('.rec-pick a[href^="javascript"]').count() == 0
        assert page.locator('.rec-book-cell img[src="logos/nv.png"]').count() == 1
        assert page.locator('.rec-book-cell img[src="logos/dk.png"]').count() == 1
        assert page.locator('.rec-reference-cell img').count() == 6
        assert page.locator('#picks img[src="x"], #picks [onerror]').count() == 0
        assert page.locator('.rec-pick').first.locator('.rec-line-cell').inner_text() == 'O49.5'
        assert '+7.2%' in page.locator('.rec-pick').first.locator('.rec-ev-cell').inner_text()
        assert page.locator('.rec-pick a[href="https://example.com/selection"]').count() == 1
        page.locator('.rec-toggle').first.focus()
        page.keyboard.press('Enter')
        assert page.locator('.rec-toggle').first.get_attribute('aria-expanded') == 'true'
        assert '<img src=x' in page.locator('.rec-details').first.inner_text()
        assert page.locator('.rec-ref-table').first.is_visible()
        page.evaluate('window.refreshRecommendations()')
        assert page.locator('.rec-toggle').first.get_attribute('aria-expanded') == 'true'
        assert page.locator('.rec-ref-table').first.is_visible()
        page.wait_for_function('Array.from(document.querySelectorAll("#picks img")).every(img => img.complete && img.naturalWidth > 0)')
        page.screenshot(path=str(SCREENSHOTS/'desktop.png'), full_page=True)
        page.select_option('#sport-filter', 'mlb')
        assert page.locator('.rec-pick').count() == 1
        page.select_option('#market-filter', 'props')
        assert page.locator('#empty-state').is_visible()
        assert not page.locator('#picks-table-wrap').is_visible()
        assert 'No plays match' in page.locator('#empty-state').inner_text()
        page.select_option('#sport-filter', '')
        page.select_option('#market-filter', '')
        page.select_option('#book-filter', 'nv')
        assert page.locator('.rec-pick').count() == 1
        page.select_option('#book-filter', '')
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.wait_for_function('Array.from(document.querySelectorAll("#picks img")).every(img => img.complete && img.naturalWidth > 0)')
        assert page.locator('.rec-book-cell img').first.is_visible()
        assert page.locator('.rec-reference-cell img').first.is_visible()
        page.screenshot(path=str(SCREENSHOTS/'mobile.png'), full_page=True)
        for width in (320, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width

        def refresh():
            page.evaluate('window.refreshRecommendations()')

        # Odds format, unknown books and pagination continue to work in the table.
        page.evaluate('localStorage.setItem("odds_format", "decimal")')
        refresh()
        assert page.locator('.rec-offer strong').first.inner_text() == '2.25'
        page.evaluate('localStorage.removeItem("odds_format")')
        state['payload'] = sample()
        state['payload']['picks'][0]['book'] = 'newbook'
        state['payload']['picks'][0]['under'] = True
        refresh()
        assert page.locator('.rec-book-cell .rec-book-fallback').count() == 1
        assert page.locator('.rec-pick').first.locator('.rec-line-cell').inner_text() == 'U49.5'
        state['payload'] = sample()
        base = state['payload']['picks'][0]
        state['payload']['picks'] = [dict(base, player=f'player {i}') for i in range(55)]
        refresh()
        assert page.locator('.rec-pick').count() == 50
        page.locator('#show-more').click()
        assert page.locator('.rec-pick').count() == 55
        assert not page.locator('#show-more').is_visible()
        page.select_option('#market-filter', 'props')
        assert page.locator('.rec-pick').count() == 50
        page.select_option('#market-filter', '')

        # Expire by individual quote/reference timestamps, not just publication time.
        state['payload'] = sample()
        state['payload']['picks'][0]['quote_updated'] = (NOW-timedelta(minutes=11)).isoformat()
        state['payload']['picks'][1]['reference_age_minutes']['pn'] = 11
        refresh()
        assert page.locator('.rec-pick').count() == 0
        assert 'hidden' in page.locator('#freshness-status').inner_text()
        state['payload'] = sample()
        state['payload']['picks'][0]['start'] = (NOW-timedelta(minutes=1)).isoformat()
        state['payload']['picks'][1]['start'] = (NOW+timedelta(minutes=2)).isoformat()
        refresh()
        assert page.locator('.rec-pick').count() == 0
        state['payload'] = sample()
        state['payload']['generated_at'] = (NOW-timedelta(minutes=11)).isoformat()
        refresh()
        assert 'out of date' in page.locator('#freshness-status').inner_text()
        assert page.locator('.rec-pick').count() == 0
        state['payload'] = sample()
        state['payload']['date'] = '2020-01-01'
        refresh()
        assert page.locator('.rec-pick').count() == 0
        state['payload'] = sample()
        state['payload']['picks'] = []
        refresh()
        assert 'No plays meet' in page.locator('#empty-state').inner_text()
        state['payload'] = sample()
        state['payload']['errors'] = {'mlb': 'DownloadError'}
        refresh()
        assert 'Some feeds' in page.locator('#request-status').inner_text()
        state['status'] = 503
        refresh()
        assert 'Unable to load' in page.locator('#request-status').inner_text()
        assert page.locator('.rec-pick').count() == 2
        for status in (401, 403):
            state['status'] = status
            refresh()
            assert page.locator('#access-panel').is_visible()
            assert page.locator('.rec-pick').count() == 0
            assert not page.locator('#report-content').is_visible()
        state['status'] = 200
        state['payload'] = sample()
        refresh()
        assert page.locator('.rec-pick').count() == 2
        assert not page.locator('#access-panel').is_visible()
        assert not errors, errors
        browser.close()
        print('Browser checks passed: table, logos, details, links, escaping, odds format, pagination, filters, responsive layout, freshness, errors, access, recovery.')
finally:
    server.shutdown()
