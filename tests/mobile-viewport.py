"""Offline viewport recovery checks: python -B tests/mobile-viewport.py.

Uses Chromium viewport/scroll events; physical iOS browser chrome and keyboards
still require a device check.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
AT_TOP = "Math.max(Math.abs(scrollY), Math.abs(document.documentElement.scrollTop), Math.abs(document.body.scrollTop)) < 1"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def mock_page(page, without_visual_viewport=False):
    page.set_default_timeout(10000)
    page.add_init_script("window.EventSource = undefined;")
    if without_visual_viewport:
        page.add_init_script("Object.defineProperty(window, 'visualViewport', {value: null, configurable: true});")
    page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
    page.route("**/auth.js", lambda route: route.fulfill(
        body=(ROOT / "auth.js").read_text(encoding="utf-8").replace(
            "let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
        content_type="application/javascript"))
    page.route(re.compile(r"/record(?:_[a-z]+)*\.js(?:\?.*)?$"), lambda route: route.fulfill(
        body="var RECORD_UPD = ''; var RECORD = {worst: {best: {}}, mult: {best: {}}};",
        content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json={
        "data": [], "games": [], "props": [], "updated": {}, "record": {}, "times": {}}))


def wait_frames(page):
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def assert_header_accessible(page):
    assert page.evaluate("""() => {
        const header = document.getElementById('header').getBoundingClientRect();
        const app = document.getElementById('app').getBoundingClientRect();
        const button = document.getElementById('page-picker-btn');
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return header.top >= -1 && app.bottom <= innerHeight + 1 &&
            rect.left >= 0 && rect.right <= innerWidth && button.contains(hit);
    }"""), page.evaluate("""() => ({
        header: document.getElementById('header').getBoundingClientRect().toJSON(),
        app: document.getElementById('app').getBoundingClientRect().toJSON(),
        width: innerWidth, height: innerHeight, bodyScroll: document.body.scrollTop, rootScroll: scrollY
    })""")


def displace_document(page, event="pageshow"):
    displaced = page.evaluate("""event => {
        if (!document.getElementById('viewport-test-spacer')) {
            const spacer = document.createElement('div');
            spacer.id = 'viewport-test-spacer';
            spacer.style.cssText = 'height:1200px;width:1px;pointer-events:none';
            document.body.appendChild(spacer);
        }
        document.documentElement.scrollTop = 96;
        document.body.scrollTop = 96;
        const displaced = Math.max(scrollY, document.documentElement.scrollTop, document.body.scrollTop);
        if (event === 'pageshow') window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
        else if (event === 'visualViewport') visualViewport.dispatchEvent(new Event('resize'));
        else window.dispatchEvent(new Event('resize'));
        return displaced;
    }""", event)
    assert displaced > 0, "Fixture could not simulate accidental document scroll"


def snapshot_local_scroll(page):
    return page.evaluate("""() => ['#table .tabulator-tableholder', '#table-container', '#center-dropdown'].map(selector => {
        const el = document.querySelector(selector);
        return [selector, el.scrollTop, el.scrollLeft];
    })""")


def recover_without_losing_local_scroll(page, event="pageshow"):
    before = snapshot_local_scroll(page)
    displace_document(page, event)
    page.wait_for_function(AT_TOP)
    wait_frames(page)
    assert snapshot_local_scroll(page) == before, "Viewport recovery changed table, card, or filter position"
    assert_header_accessible(page)


def setup_rows(page):
    page.evaluate("""async () => {
        await tableReady;
        RES = null;
        TABLE.clearFilter(true); TABLE.clearSort();
        const rows = Array.from({length: 45}, (_, i) => ({
            player: `viewport player ${String(i).padStart(2, '0')}`, team: 'bos', opp: 'nyr',
            game: 'bos @ nyr', sport: 'nhl', prop: 'atgs', handicap: .5, under: false,
            book: 'fd', line: 150, ev: 45 - i, fairVal: 140, implied: 40, kelly: .3,
            bookOdds: {fd: '150/-170', dk: '140/-160'}, hitRates: {}, logs: []
        }));
        await TABLE.setData(rows);
        initializeCards(rows);
        changeView('table');
    }""")


def check_scrolling(page, view):
    page.evaluate("view => changeView(view)", view)
    selector = '#table-container' if view == 'mobile' else '#table .tabulator-tableholder'
    scrollable = page.locator(selector)
    scrollable.evaluate("el => el.scrollTop = 0")
    bounds = scrollable.bounding_box()
    assert bounds and bounds['height'] > 50, bounds
    page.mouse.move(bounds['x'] + min(180, bounds['width'] / 2),
                    bounds['y'] + min(100, bounds['height'] / 2))
    page.mouse.wheel(0, 500)
    page.wait_for_function("selector => document.querySelector(selector).scrollTop > 0", arg=selector)
    wait_frames(page)
    # Keep an independent horizontal position as well as the vertical row/card position.
    page.locator('#center-dropdown').evaluate("el => el.scrollLeft = 80")
    if view == 'table':
        scrollable.evaluate("el => el.scrollLeft = 120")
    recover_without_losing_local_scroll(page)


def check_focus_and_zoom(page):
    field = page.locator('#table .tabulator-header input').first
    field.evaluate("el => el.focus({preventScroll: true})")
    assert field.evaluate("el => el === document.activeElement")
    displace_document(page, 'visualViewport')
    page.wait_for_timeout(150)
    assert not page.evaluate(AT_TOP), "Recovery fought a focused text field"
    field.evaluate("el => el.blur()")
    page.wait_for_function(AT_TOP)

    page.evaluate("""() => {
        window.viewportTestScale = 2;
        Object.defineProperty(visualViewport, 'scale', {get: () => viewportTestScale, configurable: true});
    }""")
    displace_document(page, 'visualViewport')
    page.wait_for_timeout(150)
    assert not page.evaluate(AT_TOP), "Recovery fought pinch zoom"
    page.evaluate("viewportTestScale = 1; visualViewport.dispatchEvent(new Event('resize'));")
    page.wait_for_function(AT_TOP)
    page.evaluate("delete visualViewport.scale")
    assert_header_accessible(page)


def check_header_controls(page):
    # Revealing an offscreen filter must only move its horizontal strip.
    page.evaluate("""() => {
        const strip = document.getElementById('center-dropdown');
        strip.scrollLeft = 0;
        const controls = [...strip.querySelectorAll('.tf-input, .tf-action')]
            .filter(el => el.getClientRects().length);
        window.viewportTestControl = controls[controls.length - 1];
        viewportTestControl.focus({preventScroll: true});
    }""")
    assert page.evaluate("""() => {
        const strip = document.getElementById('center-dropdown').getBoundingClientRect();
        const control = viewportTestControl.getBoundingClientRect();
        return control.left >= strip.left - 1 && control.right <= strip.right + 1;
    }""")
    assert page.evaluate(AT_TOP)
    page.locator('#page-picker-btn').click()
    assert page.locator('#page-picker-panel').is_visible()
    page.locator('#page-picker-panel .pp-close').click()
    assert page.locator('#page-picker-panel').is_hidden()
    assert_header_accessible(page)


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='ev-viewport-') as temp, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--disable-logging', '--log-file=' + str(Path(temp) / 'browser.log')])
        for name in ('atgs', 'nhl'):
            page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            mock_page(page)
            page.goto(f'http://localhost:{server.server_port}/{name}.html?view=table')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            setup_rows(page)
            for width, height in ((390, 844), (390, 540), (844, 390), (1440, 900)):
                page.set_viewport_size({'width': width, 'height': height})
                wait_frames(page)
                assert_header_accessible(page)
                for view in ('table', 'mobile'):
                    check_scrolling(page, view)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate("changeView('table')")
            check_focus_and_zoom(page)
            check_header_controls(page)
            page.reload()
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            assert_header_accessible(page)
            check_header_controls(page)
            assert not errors, errors
            print(f'{name}: viewport recovery, focus/zoom deferral, table/card scroll, header controls, and reload passed.', flush=True)
            page.close()

        page = browser.new_page(viewport={'width': 390, 'height': 844})
        mock_page(page, without_visual_viewport=True)
        page.goto(f'http://localhost:{server.server_port}/atgs.html?view=table')
        page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        recover_without_losing_local_scroll(page, 'resize')
        check_header_controls(page)
        print('atgs: recovery and navigation without visualViewport passed.', flush=True)
        page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
