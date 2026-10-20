"""Offline real-page refresh controls, polling, live events and mobile layout checks."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import re
import runpy
import tempfile
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
OUTLIERS = runpy.run_path(str(ROOT / 'tests/outliers.py'))

INIT = r"""(() => {
    window.fixtureVisible = true;
    Object.defineProperty(document, 'visibilityState', {get: () => fixtureVisible ? 'visible' : 'hidden'});
    Object.defineProperty(document, 'hidden', {get: () => !fixtureVisible});
    document.hasFocus = () => fixtureVisible;
    window.fixtureVisibility = visible => {
        fixtureVisible = visible;
        document.dispatchEvent(new Event('visibilitychange'));
    };
    window.fixtureSources = [];
    window.EventSource = class {
        constructor(url) { this.url = url; this.closed = false; this.handlers = {}; fixtureSources.push(this); }
        addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
        close() { this.closed = true; }
        emit(name, data) { for (const callback of this.handlers[name] || []) callback({data: JSON.stringify(data)}); }
    };
    const originalFetch = window.fetch.bind(window);
    window.fixtureTransport = {requests: [], mode: 'auto', payload: PAYLOAD};
    window.fetch = (url, options = {}) => {
        if (new URL(String(url), location.href).pathname !== ENDPOINT) return originalFetch(url, options);
        const captured = structuredClone(fixtureTransport.payload);
        const entry = {url: String(url), aborted: false};
        fixtureTransport.requests.push(entry);
        options.signal?.addEventListener('abort', () => { entry.aborted = true; });
        const response = () => new Response(JSON.stringify(captured), {status: 200,
            headers: {'Content-Type': 'application/json', 'X-Odds-Dataset': 'fixture-table'}});
        if (fixtureTransport.mode === 'error') return Promise.reject(new Error('Fixture network failure'));
        if (fixtureTransport.mode === 'hold') return new Promise(resolve => { entry.release = () => resolve(response()); });
        return Promise.resolve(response());
    };
    if (PAUSED && !sessionStorage.getItem('fixture_pause_seeded')) {
        localStorage.setItem('ev_table_auto_refresh', 'false');
        sessionStorage.setItem('fixture_pause_seeded', 'true');
    }
})();"""


def outliers_payload():
    payload = OUTLIERS['payload_for']('nhl')
    rows = []
    for index in range(60):
        row = deepcopy(payload['data'][1])
        row.update(fixture=f'refresh-{index}', player=f'refresh player {index:02d}')
        if index >= 55:
            row.update(prop='ast', handicap='1.5')
        rows.append(row)
    payload.update(data=rows, props=['sog', 'ast'], games=['tor @ bos'])
    return payload


class TableRefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(OUTLIERS['Quiet'], directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "table-refresh-tests.log"}',
        ])
        cls.auth = (ROOT / 'auth.js').read_text(encoding='utf-8').replace(
            'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;')

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.context = None
        self.errors = []

    def tearDown(self):
        if self.context:
            self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, name='outliers', width=1440, *, paused=False, cards=False):
        if self.context:
            self.context.close()
        self.context = self.browser.new_context(viewport={'width': width, 'height': 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(6000)
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.clock.install(time=NOW)
        payload = outliers_payload() if name == 'outliers' else {
            'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}
        endpoint = {'outliers': '/api/outliers', 'main': '/api/main', 'dingers': '/api/ev'}[name]
        self.page.add_init_script(INIT.replace('PAYLOAD', json.dumps(payload))
                                  .replace('ENDPOINT', json.dumps(endpoint)).replace('PAUSED', json.dumps(paused)))
        self.page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
        self.page.route('**/auth.js', lambda route: route.fulfill(body=self.auth, content_type='application/javascript'))
        self.page.route(re.compile(r'/record(?:_[a-z]+)*\.js(?:\?.*)?$'), lambda route: route.fulfill(
            body="var RECORD_UPD = ''; var RECORD = {worst: {best: {}}, mult: {best: {}}};",
            content_type='application/javascript'))
        self.page.route('**/api/**', lambda route: route.fulfill(json={
            'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
        view = 'mobile' if cards else 'compact'
        self.page.goto(f'http://localhost:{self.server.server_port}/{name}.html?view={view}&ou=ou&devig=pn'
                       + ('&sport=nhl' if name == 'outliers' else ''))
        expect(self.page.locator('#table-refresh-controls')).to_be_visible()
        expect(self.page.locator('#data-status')).to_be_hidden()
        expect(self.status).to_have_text('Auto off' if paused else re.compile(r'Next in \d+s'))
        current = datetime.fromisoformat(self.page.evaluate('new Date().toISOString()').replace('Z', '+00:00'))
        self.page.clock.pause_at(current + timedelta(milliseconds=20))
        self.assertEqual(self.requests(), 1, 'The initial load must run exactly once, even when auto is off')

    @property
    def status(self):
        return self.page.locator('.table-refresh-status')

    @property
    def auto(self):
        return self.page.locator('label.table-refresh-auto input[type=checkbox]')

    def requests(self):
        return self.page.evaluate('fixtureTransport.requests.length')

    def settle(self, milliseconds=100):
        self.page.clock.run_for(milliseconds)

    def manual(self):
        self.page.locator('button.table-refresh-now').click()
        self.settle()

    def assert_layout(self, width):
        controls = self.page.locator('#table-refresh-controls')
        expect(controls).to_have_attribute('role', 'group')
        bounds = controls.bounding_box()
        table = self.page.locator('#table-container').bounding_box()
        footer_element = self.page.locator('footer').first
        footer = footer_element.bounding_box()
        disclaimer = footer_element.locator('p').bounding_box()
        self.assertIsNotNone(bounds)
        self.assertGreaterEqual(bounds['x'], -1)
        self.assertLessEqual(bounds['x'] + bounds['width'], width + 1)
        self.assertLessEqual(bounds['y'] + bounds['height'], 901)
        self.assertLessEqual(table['y'] + table['height'], footer['y'] + 1)
        self.assertGreaterEqual(bounds['x'], footer['x'] - 1)
        self.assertGreaterEqual(bounds['y'], footer['y'] - 1)
        self.assertLessEqual(bounds['x'] + bounds['width'], footer['x'] + footer['width'] + 1)
        self.assertLessEqual(bounds['y'] + bounds['height'], footer['y'] + footer['height'] + 1)
        self.assertLessEqual(footer['y'] + footer['height'], 901)
        if width > 600:
            self.assertLessEqual(disclaimer['x'] + disclaimer['width'], bounds['x'] + 1)
            self.assertLess(disclaimer['y'], bounds['y'] + bounds['height'])
            self.assertLess(bounds['y'], disclaimer['y'] + disclaimer['height'])
        self.assertTrue(controls.evaluate('el => el.scrollWidth <= el.clientWidth + 1'))
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        self.assertTrue(controls.evaluate("el => !!el.closest('footer')"))
        expect(self.page.locator('button.table-refresh-now')).to_be_in_viewport()
        expect(self.auto).to_be_in_viewport()

    def test_countdown_poll_pause_manual_and_immediate_enable(self):
        self.open()
        self.settle(31000)
        self.assertEqual(self.requests(), 2)
        expect(self.status).to_have_text(re.compile(r'Next in \d+s'))
        self.auto.uncheck()
        expect(self.status).to_have_text('Auto off')
        self.assertEqual(self.page.evaluate("localStorage.getItem('ev_table_auto_refresh')"), 'false')
        self.settle(65000)
        self.assertEqual(self.requests(), 2)
        self.manual()
        self.assertEqual(self.requests(), 3)
        expect(self.status).to_have_text('Auto off')
        self.auto.check()
        self.settle()
        self.assertEqual(self.requests(), 4, 'Enabling auto must immediately fetch, without waiting 30 seconds')
        expect(self.status).to_have_text(re.compile(r'Next in \d+s'))
        self.settle(1500)
        self.assertEqual(self.requests(), 4)

    def test_saved_off_loads_once_and_suppresses_live_and_lifecycle_updates(self):
        self.open(paused=True)
        expect(self.auto).not_to_be_checked()
        self.settle(65000)
        self.assertEqual(self.requests(), 1)
        self.manual()
        self.assertEqual(self.requests(), 2)
        self.auto.check()
        self.settle()
        self.assertEqual(self.requests(), 3)
        self.assertGreater(self.page.evaluate('fixtureSources.length'), 0)
        self.page.evaluate("fixtureSources.at(-1).emit('odds-update', {dataset:'fixture-table'})")
        self.settle(200)
        self.assertEqual(self.requests(), 4, 'Live updates must work while auto is enabled')
        self.auto.uncheck()
        self.assertTrue(self.page.evaluate('fixtureSources.every(source => source.closed)'))
        self.page.evaluate("""() => {
            for (const source of fixtureSources) {
                source.emit('ready', {});
                source.emit('odds-update', {dataset:'fixture-table'});
            }
            fixtureVisibility(false); fixtureVisibility(true);
            window.dispatchEvent(new Event('pagehide'));
            window.dispatchEvent(new Event('pageshow'));
        }""")
        self.settle(65000)
        self.assertEqual(self.requests(), 4, 'Paused tables must ignore SSE and lifecycle catch-up')
        self.page.clock.resume()  # The replacement Tabulator needs its initial animation frames.
        self.page.reload()
        expect(self.status).to_have_text('Auto off')
        self.assertEqual(self.requests(), 1, 'Reload keeps auto off but still obtains initial data')

    def test_pause_cancels_queued_live_refresh_behind_pending_request(self):
        self.open()
        self.page.evaluate("fixtureTransport.mode = 'hold'")
        self.page.locator('button.table-refresh-now').click()
        expect(self.status).to_have_text('Refreshing…')
        self.assertEqual(self.requests(), 2)
        self.page.evaluate("fixtureSources.at(-1).emit('odds-update', {dataset:'fixture-table'})")
        self.settle(200)
        self.auto.uncheck()
        self.page.evaluate("""() => {
            fixtureTransport.mode = 'auto';
            fixtureTransport.requests.at(-1).release();
        }""")
        self.settle(200)
        self.assertEqual(self.requests(), 2, 'Disabling auto must cancel an invalidation queued behind an active fetch')
        expect(self.status).to_have_text('Auto off')

    def test_failed_refresh_retries_and_countdown_starts_after_completion(self):
        self.open()
        self.page.evaluate("fixtureTransport.mode = 'error'")
        self.manual()
        expect(self.status).to_have_text(re.compile(r'Retry in \d+s'))
        expect(self.page.locator('#data-status')).to_be_visible()
        self.page.evaluate("fixtureTransport.mode = 'hold'")
        self.manual()
        expect(self.status).to_have_text('Refreshing…')
        before = self.requests()
        self.settle(5000)
        self.assertEqual(self.requests(), before)
        self.page.evaluate("""() => {
            fixtureTransport.mode = 'auto';
            fixtureTransport.requests.at(-1).release();
        }""")
        self.settle()
        expect(self.status).to_have_text(re.compile(r'Next in (29|30)s'))
        expect(self.page.locator('#data-status')).to_be_hidden()

    def test_main_and_dingers_branches_have_usable_desktop_and_mobile_controls(self):
        for name in ('main', 'dingers'):
            for width in (1440, 320):
                with self.subTest(page=name, width=width):
                    self.open(name, width, paused=True)
                    self.assert_layout(width)
                    self.manual()
                    self.assertEqual(self.requests(), 2)
                    expect(self.status).to_have_text('Auto off')
                    self.auto.check()
                    self.settle()
                    self.assertEqual(self.requests(), 3)
                    expect(self.status).to_have_text(re.compile(r'Next in \d+s'))
                    self.assert_layout(width)
                    self.auto.uncheck()
                    expect(self.status).to_have_text('Auto off')

    def test_mobile_cards_and_filters_preserve_scroll_on_unchanged_refresh(self):
        for width in (1440, 320):
            with self.subTest(width=width):
                self.open(width=width, paused=True, cards=True)
                self.page.evaluate("""async () => {
                    setOptions('prop-options', ['sog']);
                    await changeFilter();
                }""")
                self.settle()
                self.assert_layout(width)
                self.assertGreater(self.page.locator('#card-container .data-card').count(), 1)
                self.page.evaluate("""() => {
                    const container = document.getElementById('table-container');
                    container.scrollTop = 180;
                    window.fixtureCard = document.querySelector('#card-container .data-card');
                    window.fixtureScroll = container.scrollTop;
                }""")
                self.assertGreater(self.page.evaluate('fixtureScroll'), 0)
                self.manual()
                self.assertEqual(self.requests(), 2)
                self.assertTrue(self.page.evaluate("fixtureCard === document.querySelector('#card-container .data-card')"))
                self.assertLess(abs(self.page.evaluate("document.getElementById('table-container').scrollTop - fixtureScroll")), 2)
                self.assertEqual(self.page.locator('#prop-options input:checked').evaluate_all(
                    'inputs => inputs.map(input => input.value)'), ['sog'])
                self.assertTrue(self.page.evaluate("TABLE.getData('active').every(row => row.prop === 'sog')"))
                self.assert_layout(width)
                if width == 320:
                    self.page.screenshot(path=str(Path(tempfile.gettempdir()) / 'table-refresh-mobile-320.png'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
