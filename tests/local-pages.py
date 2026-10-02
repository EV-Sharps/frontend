"""Offline browser checks for local Movement/Longshots boot and hosted auth."""
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 2, 16, 0, tzinfo=timezone.utc)
LOCAL_API = 'http://localhost:5001'
HOSTED_API = 'https://api-production-3a3b.up.railway.app'
CATALOG = dict(sport='mlb', day='2026-10-02', updated=NOW.isoformat(),
               interval_minutes=30, max_age_minutes=60, props=[], books=[],
               total=0, offset=0, limit=100, rows=[], status='ok')
REPORT = dict(schema_version=1, sport='nhl', market='atgs', date='2026-10-02',
              generated_at=NOW.isoformat(), refresh_minutes=5, picks=[], books_checked=[],
              criteria=dict(min_odds=1000, max_odds=3000, min_ev=0, method='probit',
                            max_age_minutes=15, min_minutes_to_start=5, limit_per_book=10))


def check(browser, name, origin, auth, local):
    context = browser.new_context()
    page = context.new_page()
    page.clock.install(time=NOW)
    requests, errors = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('window.authCalls = {session: 0, subscribe: 0};')
    endpoint = '/api/line-movement' if name == 'movement' else '/api/longshots'
    payload = CATALOG if name == 'movement' else REPORT
    content = '#movement-content' if name == 'movement' else '#report-content'
    session = "{access_token: 'fixture-token'}" if auth == 'signed-in' else 'null'
    auth_script = '' if auth == 'unavailable' else '''
        window.supabase = {createClient: () => ({auth: {
            getSession: () => { window.authCalls.session++;
                return SESSION_RESULT;
            },
            onAuthStateChange: fn => {
                window.authCalls.subscribe++; window.authChanged = fn; return {};
            }
        }})};
    '''.replace('SESSION_RESULT', 'new Promise(() => {})' if auth == 'pending'
                else f'Promise.resolve({{data: {{session: {session}}}}})')

    def intercept(route):
        url = route.request.url
        if urlsplit(url).path == endpoint:
            requests.append(dict(url=url, headers=route.request.headers))
            allowed = local or auth == 'signed-in'
            route.fulfill(status=200 if allowed else 401,
                          json=payload if allowed else {'error': 'Sign in required'})
        elif url.startswith('https://cdn.jsdelivr.net/'):
            route.fulfill(content_type='application/javascript', body=auth_script)
        elif url.startswith(origin + '/'):
            target = (ROOT / urlsplit(url).path.lstrip('/')).resolve()
            if target.is_relative_to(ROOT) and target.is_file():
                route.fulfill(path=target)
            else:
                route.fulfill(status=404, body='')
        else:
            route.fulfill(status=404, body='')

    page.route('**/*', intercept)
    try:
        page.goto(f'{origin}/{name}.html')
        assert page.evaluate('IS_LOCALHOST') is local
        assert page.evaluate('API_BASE') == (LOCAL_API if local else HOSTED_API)
        expect(page.locator('#account-link')).to_have_attribute('href', 'profile.html' if local else 'profile')
        expect(page.locator('#access-pricing')).to_have_attribute('href', 'pricing.html' if local else 'pricing')

        if local or auth == 'signed-in':
            expect(page.locator(content)).to_be_visible()
            if name == 'movement':
                expect(page.locator('#catalog-count')).to_have_text('0 selections')
            else:
                expect(page.locator('#pick-count')).to_have_text('0')
                expect(page.locator('#empty-state')).to_be_visible()
            expect(page.locator('#access-panel')).to_be_hidden()
            assert len(requests) == 1, requests
            assert requests[0]['url'].startswith((LOCAL_API if local else HOSTED_API) + endpoint)
            assert requests[0]['headers'].get('authorization') == (None if local else 'Bearer fixture-token')
            assert page.evaluate('ACCESS_TOKEN') == ('' if local else 'fixture-token')
            if local:
                assert page.evaluate('authCalls') == {'session': 0, 'subscribe': 0}
            else:
                assert page.evaluate('authCalls') == {'session': 1, 'subscribe': 1}
            # Manual refresh remains usable without signing in on local pages.
            page.locator('#refresh').click()
            expect(page.locator('#refresh')).to_be_enabled()
            assert len(requests) == 2
            assert requests[-1]['headers'].get('authorization') == (None if local else 'Bearer fixture-token')
        elif auth == 'unavailable':
            expect(page.locator('#request-status')).to_contain_text('Sign-in service unavailable')
            assert not requests
        else:
            expect(page.locator('#access-panel')).to_be_visible()
            expect(page.locator(content)).to_be_hidden()
            assert page.evaluate('authCalls') == {'session': 1, 'subscribe': 1}
            # Hosted Longshots asks the API to enforce membership; Movement gates first.
            assert len(requests) == (1 if name == 'longshots' else 0)
            for request in requests:
                assert request['url'].startswith(HOSTED_API + endpoint)
                assert 'authorization' not in request['headers']
        assert not errors, errors
        print(f'PASS {name}: {origin} / {auth}', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for name in ('movement', 'longshots'):
                for origin, auth, local in (
                    ('http://localhost:8000', 'signed-out', True),
                    ('http://127.0.0.1:8000', 'signed-out', True),
                    ('http://[::1]:8000', 'signed-out', True),
                    ('http://localhost:8000', 'unavailable', True),
                    ('http://127.0.0.1:8000', 'pending', True),
                    ('http://[::1]:8000', 'signed-in', True),
                    ('https://ev-sharps.test', 'signed-in', False),
                    ('https://ev-sharps.test', 'signed-out', False),
                    ('https://ev-sharps.test', 'unavailable', False),
                    ('https://localhost.example', 'signed-out', False),
                    ('https://notlocalhost.test', 'signed-out', False),
                ):
                    check(browser, name, origin, auth, local)
        finally:
            browser.close()
    print('PASS: 22 local/hosted boot, endpoint, header, auth and refresh scenarios.')
