"""Offline wheel/resize regression: python -B tests/card-view-scroll.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ROW_COUNT = 65


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def mock_page(page):
    page.set_default_timeout(10000)
    page.add_init_script("window.EventSource = undefined;")
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


def point_inside(page, locator):
    bounds = locator.bounding_box()
    assert bounds and bounds["height"] > 0, bounds
    page.mouse.move(bounds["x"] + min(250, bounds["width"] / 2),
                    bounds["y"] + min(120, bounds["height"] / 2))


def last_card_visible(page):
    return page.evaluate("""count => {
        const cards = document.querySelectorAll('#card-container .data-card');
        if (cards.length !== count) return false;
        const last = cards[cards.length - 1].getBoundingClientRect();
        const container = document.getElementById('table-container').getBoundingClientRect();
        return last.top >= container.top - 1 &&
            last.bottom <= Math.min(container.bottom, innerHeight) + 1;
    }""", ROW_COUNT)


def scroll_cards(page, lazy=False):
    container = page.locator("#table-container")
    container.evaluate("el => el.scrollTop = 0")
    if lazy:
        assert 0 < page.locator("#card-container .data-card").count() < ROW_COUNT
    point_inside(page, container)
    page.mouse.wheel(0, 700)
    page.wait_for_function("document.getElementById('table-container').scrollTop > 0")
    # Wheel events must also drive the existing lazy loader through all batches.
    for _ in range(10):
        if last_card_visible(page):
            break
        page.mouse.wheel(0, 20000)
        page.wait_for_function("""() => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        })""")
    assert last_card_visible(page), page.evaluate("""() => ({
        rendered: document.querySelectorAll('#card-container .data-card').length,
        top: document.getElementById('table-container').scrollTop,
        height: document.getElementById('table-container').clientHeight,
        total: document.getElementById('table-container').scrollHeight
    })""")
    assert "Player 64" in page.locator("#card-container .data-card").last.inner_text()


def scroll_table(page, view):
    page.evaluate("view => changeView(view)", view)
    assert page.locator("#card-container").is_hidden()
    holder = page.locator("#table .tabulator-tableholder")
    holder.evaluate("el => el.scrollTop = 0")
    point_inside(page, holder)
    page.mouse.wheel(0, 700)
    page.wait_for_function("document.querySelector('#table .tabulator-tableholder').scrollTop > 0")
    page.mouse.wheel(0, 20000)
    page.wait_for_function("""() => {
        const holder = document.querySelector('#table .tabulator-tableholder');
        return holder.scrollTop + holder.clientHeight >= holder.scrollHeight - 1;
    }""")


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ("atgs", "nhl", "tds"):
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            mock_page(page)
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view=mobile")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate("""async count => {
                RES = null;
                TABLE.clearFilter(true); TABLE.clearSort();
                const rows = Array.from({length: count}, (_, i) => ({
                    player: `player ${String(i).padStart(2, '0')}`, team: 'bos', opp: 'nyr',
                    game: 'bos @ nyr', prop: PAGE === 'tds' ? 'attd' : 'atgs',
                    handicap: .5, under: false, book: 'fd', line: 150,
                    ev: count - i, fairVal: 140, implied: 40, kelly: .3,
                    bookOdds: {fd: '150/-170', dk: '140/-160'}, hitRates: {}, logs: []
                }));
                await TABLE.setData(rows);
                initializeCards(rows);
                changeView('mobile');
            }""", ROW_COUNT)
            scroll_cards(page, lazy=True)
            for width, height in ((1440, 900), (390, 844), (1920, 1080)):
                page.set_viewport_size({"width": width, "height": height})
                scroll_cards(page)
            for view in ("table", "compact"):
                scroll_table(page, view)
                page.evaluate("changeView('mobile')")
                scroll_cards(page)
            assert not errors, errors
            print(f"{name}: desktop wheel/lazy loading, 390px resize, and table/compact switching passed.", flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
