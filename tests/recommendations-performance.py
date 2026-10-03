"""Authenticated performance view checks; fixture-only, no external requests."""
import copy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import os
import tempfile
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(os.environ.get('RECOMMENDATIONS_SITE', str(ROOT)))
SCREENSHOTS = Path(tempfile.gettempdir()) / 'recommendations-performance-browser'
SCREENSHOTS.mkdir(exist_ok=True)
NOW = datetime.now(timezone.utc)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = path.split('?')[0].strip('/')
        if '/' not in name and (ROOT / name).is_file():
            return str(ROOT / name)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def stats(**kwargs):
    return dict(tracked=1000, settled=800, wins=320, losses=470, pushes=10, pending=150,
                ungraded=40, void=10, profit_units=24.5, roi_pct=3.0625,
                hit_rate_pct=40.5063, **kwargs)


def fixture():
    started = (NOW-timedelta(days=30)).isoformat()
    base = dict(id='one', date=(NOW-timedelta(days=1)).date().isoformat(),
                first_seen=(NOW-timedelta(days=1)).isoformat(), sport='nhl', book='fd',
                game='nyr @ bos', player='test player', prop='atgs', handicap='0.5',
                selection='Test Player over 0.5 atgs', odds=1200, ev=8.7, probability=.09,
                under=False, net_decimal=13, status='win', reason=None, profit_units=12)
    return dict(version=1, updated=NOW.isoformat(), tracking_started_at=started,
                policy='First published recommendation per event/player/market/book; frozen first price/line; one-unit flat returns after saved fees.',
                summary=stats(), unique_summary=stats(),
                by_book=[stats(book='fd'), dict(stats(book='dk'), profit_units=-8, roi_pct=-1)],
                by_sport=[stats(sport='nhl')], by_market=[stats(market='props')],
                rows=[base, dict(base, id='two', book='dk', status='ungraded', profit_units=None,
                                 reason='<img src=x onerror=alert(1)>'),
                      dict(base, id='three', player='pending player', selection='pending player under 2.5 sog', status='pending', reason='completion_buffer', profit_units=None)])


def shortlist():
    return dict(date=NOW.astimezone(ZoneInfo('America/New_York')).date().isoformat(),
                generated_at=(NOW-timedelta(days=1)).isoformat(), picks=[], qualifying_offers=0,
                criteria=dict(timezone='America/New_York', min_ev=3, min_floor_ev=1, min_references=3,
                              require_anchor=False, max_age_minutes=10, min_minutes_to_start=5,
                              min_odds=-250, max_odds=3000, max_probability_spread=.06, max_per_game=2),
                feeds={}, errors={})


state = {'status': 200, 'payload': fixture(), 'live_status': 200, 'live': shortlist()}
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        errors = []
        requests = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('window.EventSource = undefined;')

        def intercept(route):
            if '/api/recommendations/performance' in route.request.url:
                requests.append(route.request.headers)
                route.fulfill(status=state['status'], json=state['payload'])
            elif '/api/recommendations' in route.request.url:
                route.fulfill(status=state['live_status'], json=state['live'])
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
        page.wait_for_selector('#performance-results tr', state='attached')
        assert not page.locator('#performance-view').is_visible()
        assert page.locator('#freshness-status').is_visible()
        page.locator('#performance-tab').click()
        assert page.locator('#performance-view').is_visible()
        assert not page.locator('#current-view').is_visible()
        assert page.locator('#performance-results tr').count() == 3
        assert requests[-1]['authorization'] == 'Bearer fixture-token'
        assert '1,000' in page.locator('#performance-summary').inner_text()  # Full ledger, not three bounded rows.
        assert '+24.50u' in page.locator('#performance-summary').inner_text()
        assert 'separate offers, not independent plays' in page.locator('#performance-period').inner_text()
        assert 'highest-ranked offer' in page.locator('#performance-unique').inner_text()
        assert '<img src=x' in page.locator('#performance-results').inner_text()
        assert page.locator('#performance-results img, #performance-results [onerror]').count() == 0
        assert page.locator('#performance-results tr').nth(2).locator('td').last.inner_text() == '-'
        assert 'Waiting until 8 hours after scheduled start' in page.locator('#performance-results').inner_text()
        assert 'completion_buffer' not in page.locator('#performance-results').inner_text()
        assert 'requires a verified final result' in page.locator('#performance-policy').inner_text()
        state['payload']['grading_errors'] = [{'sport': 'nhl', 'date': '2026-10-01', 'error': 'FixtureTimeout'}]
        page.evaluate('window.RecommendationPerformance.refresh()')
        assert 'Some result sources could not refresh' in page.locator('#performance-status').inner_text()
        assert page.locator('#performance-data').is_visible()
        assert '+24.50u' in page.locator('#performance-summary').inner_text()
        assert 'FixtureTimeout' not in page.locator('#performance-status').inner_text()
        state['payload']['grading_errors'] = []
        page.evaluate('window.RecommendationPerformance.refresh()')
        assert not page.locator('#performance-status').is_visible()
        page.locator('#performance-book').select_option('dk')
        assert page.locator('#performance-results tr').count() == 1
        assert '-8.00u' in page.locator('#performance-summary').inner_text()
        assert not page.locator('#performance-unique').is_visible()
        assert 'breakdowns below cover all books' in page.locator('#performance-period').inner_text()
        page.locator('#performance-book').select_option('')
        page.screenshot(path=str(SCREENSHOTS / 'desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(SCREENSHOTS / 'mobile.png'), full_page=True)
        state['status'] = 503
        page.evaluate('window.RecommendationPerformance.refresh()')
        assert page.locator('#performance-data').is_visible()
        assert 'last loaded report' in page.locator('#performance-status').inner_text()
        state['status'] = 403
        page.evaluate('window.RecommendationPerformance.refresh()')
        assert not page.locator('#performance-data').is_visible()
        assert page.locator('#performance-results tr').count() == 0
        assert 'Sharp subscription' in page.locator('#performance-status').inner_text()
        state['status'] = 200
        state['payload'] = dict(fixture(), summary={key: (None if key.endswith('_pct') else 0) for key in stats()},
                                by_book=[], by_sport=[], by_market=[], rows=[], unique_summary=None)
        page.evaluate('window.RecommendationPerformance.refresh()')
        assert 'Tracking is ready' in page.locator('#performance-status').inner_text()
        assert 'No tracked offers' in page.locator('#performance-results').inner_text()
        state['payload'] = fixture()
        state['live_status'] = 503
        page.evaluate('window.RecommendationPerformance.refresh()')
        page.locator('#current-tab').click()
        page.evaluate('window.refreshRecommendations()')
        page.locator('#performance-tab').click()
        assert '+24.50u' in page.locator('#performance-summary').inner_text()
        state['status'] = state['live_status'] = 401
        page.evaluate("window.authChanged('SIGNED_OUT', null)")
        page.wait_for_function("document.querySelector('#performance-results').children.length === 0")
        assert not page.locator('#performance-data').is_visible()
        page.wait_for_function("document.querySelector('#performance-status').textContent.includes('Sign in')")
        assert 'Sign in' in page.locator('#performance-status').inner_text()
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
print('Recommendations performance browser checks passed.')
