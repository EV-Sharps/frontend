"""Offline FAQ refresh-interval browser checks; no external requests escape."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse
import json
import os
import tempfile

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
WORKSPACE = next((p for p in STAGED.parents if (p / 'oddsapi.py').is_file()), STAGED.parent / 'odds')
SITE = WORKSPACE.parent / 'frontend'


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = urlparse(path).path.strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *_args):
        pass


def fixture():
    return dict(version=1, configured_at='2024-01-02T12:00:00Z', sports=[
        dict(sport='mlb', label='MLB', interval_seconds=60),
        dict(sport='nhl', label='NHL', interval_seconds=120),
        dict(sport='nfl', label='NFL', interval_seconds=90),
    ])


def install_routes(page, origin, state):
    def intercept(route):
        url = route.request.url
        if urlparse(url).path == '/api/refresh-intervals':
            state['requests'].append(dict(url=url, headers=route.request.headers))
            if state.get('hold'):
                state['held'].append(route)
            else:
                route.fulfill(status=state.get('status', 200), json=state['payload'])
        elif url.startswith(origin + '/'):
            route.continue_()
        elif urlparse(url).hostname == 'public-faq.test':
            name = urlparse(url).path.strip('/')
            path = STAGED / name if (STAGED / name).is_file() else SITE / name
            if '..' not in name and path.is_file():
                route.fulfill(path=str(path))
            else:
                route.fulfill(status=404, body='')
        else:
            route.abort()
    page.route('**/*', intercept)


def check_live_refresh(browser, origin, output):
    page = browser.new_page(viewport=dict(width=1280, height=1000))
    page.clock.install()
    state = dict(payload=fixture(), requests=[], held=[])
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    install_routes(page, origin, state)
    page.goto(origin + '/faq.html?faq=q-refresh-intervals')
    question = page.locator('#q-refresh-intervals')
    expect(question).to_have_attribute('open', '')
    expect(page.locator('#faq-refresh-rows tr')).to_have_count(3)
    expect(page.locator('#faq-refresh-rows td')).to_have_text(['1 min', '2 min', '1 min 30 sec'])
    expect(page.locator('#faq-refresh-config-time')).to_have_attribute('datetime', '2024-01-02T12:00:00Z')
    expect(page.locator('#faq-refresh-status')).to_contain_text('Last checked')
    assert 'stale' not in question.inner_text().lower(), 'Old unchanged configuration is not stale'
    assert state['requests'][0]['url'] == 'http://localhost:5001/api/refresh-intervals'
    assert 'authorization' not in state['requests'][0]['headers']
    assert 'sleep.json' not in question.inner_text()

    # Fractional seconds and minutes are rendered from the new response.
    state['payload']['sports'][1]['interval_seconds'] = 18.5
    with page.expect_request('**/api/refresh-intervals'):
        page.clock.run_for(60001)
    expect(page.locator('#faq-refresh-rows td').nth(1)).to_have_text('18.5 sec')
    state['payload']['sports'][1]['interval_seconds'] = 150
    with page.expect_request('**/api/refresh-intervals'):
        page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.locator('#faq-refresh-rows td').nth(1)).to_have_text('2 min 30 sec')

    # In-flight calls from focus/manual checks coalesce into one request.
    before = len(state['requests'])
    state['hold'] = True
    with page.expect_request('**/api/refresh-intervals'):
        page.evaluate("() => { void loadRefreshIntervals(); window.dispatchEvent(new Event('focus')); void loadRefreshIntervals(); }")
    page.wait_for_timeout(25)
    assert len(state['requests']) == before + 1 and len(state['held']) == 1
    state['hold'] = False
    state['held'].pop().fulfill(json=state['payload'])
    page.wait_for_function('refreshIntervalsInFlight === false')

    # Hidden tabs do not poll; returning to the page immediately refreshes.
    before = len(state['requests'])
    page.evaluate("() => { window.testHidden=true; Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testHidden?'hidden':'visible'}); document.dispatchEvent(new Event('visibilitychange')); }")
    page.clock.run_for(60001)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    assert len(state['requests']) == before
    state['payload']['sports'][1]['interval_seconds'] = .5
    with page.expect_request('**/api/refresh-intervals'):
        page.evaluate("() => { window.testHidden=false; document.dispatchEvent(new Event('visibilitychange')); }")
    expect(page.locator('#faq-refresh-rows td').nth(1)).to_have_text('0.5 sec')

    # A failed recheck preserves only clearly labeled last-known values.
    state['status'] = 503
    page.evaluate('void loadRefreshIntervals()')
    expect(page.locator('#faq-refresh-status')).to_contain_text('Current settings could not be confirmed')
    expect(page.locator('#faq-refresh-status')).to_contain_text('Showing intervals last checked')
    expect(page.locator('#faq-refresh-retry')).to_be_visible()
    expect(page.locator('#faq-refresh-rows tr')).to_have_count(3)
    state.update(status=200, payload=fixture())
    page.locator('#faq-refresh-retry').click()
    expect(page.locator('#faq-refresh-retry')).to_be_hidden()
    expect(page.locator('#faq-refresh-rows td').nth(1)).to_have_text('2 min')

    # Dynamic sport labels are safe text and participate in FAQ search.
    state['payload']['sports'][1]['label'] = '<img src=x onerror=alert(1)> NHL'
    page.evaluate('void loadRefreshIntervals()')
    expect(page.locator('#faq-refresh-rows th').nth(1)).to_have_text('<img src=x onerror=alert(1)> NHL')
    assert page.locator('#faq-refresh-panel img, #faq-refresh-table img').count() == 0
    page.locator('#faq-search').fill('configured NHL')
    expect(page.locator('#faq-result-count')).to_have_text('1 question found')
    expect(question).to_be_visible()
    page.locator('#faq-clear').click()
    page.locator('#collapse-all').click()
    expect(question).not_to_have_attribute('open', '')
    page.locator('#expand-all').click()
    expect(question).to_have_attribute('open', '')
    page.locator('#faq-search').fill('How often do odds refresh')
    expect(page.locator('#faq-result-count')).to_have_text('1 question found')
    page.evaluate("history.replaceState({},'',location.pathname+'#q-devig-basics');openFaqLink()")
    expect(page.locator('#q-devig-basics')).to_have_attribute('open', '')
    page.evaluate("history.replaceState({},'',location.pathname+'#q-refresh-intervals');openFaqLink()")

    state['payload'] = fixture()
    page.evaluate('void loadRefreshIntervals()')
    expect(page.locator('#faq-refresh-rows th').nth(1)).to_have_text('NHL')
    page.locator('#faq-search').fill('How often do odds refresh')
    for width in (1280, 390, 320):
        page.set_viewport_size(dict(width=width, height=1000))
        question.scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        box = page.locator('#faq-refresh-table').bounding_box()
        assert box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1, box
        question.screenshot(path=str(output / f'faq-refresh-{width}.png'))
    assert not errors, errors
    page.close()


def check_unavailable_and_routes(browser, origin):
    for config, expected_base, public in [(None, 'http://localhost:5001', False),
                                         ({'packaged': True, 'apiBase': 'https://packaged-api.test/'}, 'https://packaged-api.test', False),
                                         (None, 'https://api-production-3a3b.up.railway.app', True)]:
        page = browser.new_page(viewport=dict(width=390, height=900))
        if config:
            page.add_init_script('window.EV_APP_CONFIG=' + json.dumps(config))
        state = dict(payload=fixture(), status=503, requests=[], held=[])
        install_routes(page, origin, state)
        page.goto(('https://public-faq.test' if public else origin) + '/faq.html#q-refresh-intervals')
        expect(page.locator('#faq-refresh-status')).to_contain_text('unavailable right now')
        expect(page.locator('#faq-refresh-table')).to_be_hidden()
        expect(page.locator('#faq-refresh-rows tr')).to_have_count(0)
        assert state['requests'][0]['url'] == expected_base + '/api/refresh-intervals'
        # Malformed payloads cannot replace missing data with guessed intervals.
        state.update(status=200, payload=dict(fixture(), sports=[dict(sport='nhl', label='NHL', interval_seconds='120')]))
        page.locator('#faq-refresh-retry').click()
        expect(page.locator('#faq-refresh-table')).to_be_hidden()
        page.wait_for_function('refreshIntervalsInFlight === false')
        state['payload'] = dict(fixture(), sports=[])
        page.locator('#faq-refresh-retry').click()
        expect(page.locator('#faq-refresh-status')).to_have_text('No configured refresh intervals are currently available.')
        expect(page.locator('#faq-refresh-table')).to_be_hidden()
        page.close()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='faq-refresh-') as output, sync_playwright() as playwright:
            output = Path(os.environ.get('FAQ_REFRESH_ARTIFACTS') or output)
            output.mkdir(parents=True, exist_ok=True)
            browser = playwright.chromium.launch(headless=True)
            origin = f'http://localhost:{server.server_port}'
            check_live_refresh(browser, origin, output)
            check_unavailable_and_routes(browser, origin)
            browser.close()
    finally:
        server.shutdown()
    print('PASS: live/configured interval display, fractions, polling/focus/visibility, in-flight deduplication, failure/retry/invalid/empty data, safe searchable labels, existing FAQ links/filter controls, local/packaged/public API routing, 1280/390/320px, no page errors.')


if __name__ == '__main__':
    main()
