"""Offline checks for the shared devig window: python tests/devig-window.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import re
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CUSTOM = "fd+dk;3+2"
DECIMAL = "pn+circa;0.25+0.75"


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


def setup_profile(page):
    page.evaluate("""({custom, decimal}) => {
        CURR_USER = {id: 'test-profile', tier: 'sharp', metadata: {
            weights: [custom, decimal], favorites: [],
            alias: {[custom]: 'Weekend mix', [decimal]: 'Decimal mix'},
            tags: {[custom]: ['nhl-atgs']}
        }};
        CURR_SESSION = {user: {id: 'test-profile'}};
        window.devigWrites = [];
        SB = {from(table) { return {update(value) { return {eq(key, id) {
            window.devigWrites.push({table, key, id, value: JSON.parse(JSON.stringify(value))});
            return Promise.resolve({error: null});
        }}; }}; }};
        const record = {best: {
            'atgs-vs-fd+dk': {All: {roi: 12, wins: 40, losses: 30, profit: 15, kelly: 4}},
            'attd-vs-fd+dk': {All: {roi: 10, wins: 35, losses: 30, profit: 10, kelly: 3}}
        }};
        RECORD = {worst: record, mult: record};
    }""", {"custom": CUSTOM, "decimal": DECIMAL})


def option(page, value):
    return page.locator("#devig-options-container .devig-radio-item").filter(
        has=page.locator(f'input[name="devig-selection"][value="{value}"]'))


def tab(page, category):
    page.locator(f'.dv-tabs button[data-category="{category}"]').click()


def check_bounds(page, width):
    panel = page.locator("#devig-modal .devig-panel")
    bounds = panel.bounding_box()
    assert bounds and bounds["x"] >= -1 and bounds["y"] >= -1, bounds
    assert bounds["x"] + bounds["width"] <= width + 1, bounds
    assert bounds["y"] + bounds["height"] <= 845, bounds
    assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    for selector in ["#devig-search", "#method-select", "#add-custom-devig", "#load-predefined-devigs"]:
        control = page.locator(selector).bounding_box()
        assert control and control["x"] >= -1 and control["x"] + control["width"] <= width + 1, (selector, control)


def check_page(browser, origin, page_name, width, full=False):
    page = browser.new_page(viewport={"width": width, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    page.goto(f"{origin}/{page_name}.html?devig=fd-dk-pn&weight=1-1-1&method=mult&required=&ou=ou")
    page.wait_for_function("typeof renderDevigOptions === 'function' && typeof getTopDevigs === 'function'")
    setup_profile(page)
    page.locator("#devig-button").click()
    modal = page.locator("#devig-modal")
    assert modal.is_visible()
    check_bounds(page, width)
    assert page.locator("#method-select").input_value() == "mult"
    assert page.locator('.dv-tabs button[data-category]').count() == 5

    tab(page, "custom")
    assert option(page, CUSTOM).count() == 1 and option(page, DECIMAL).count() == 1
    tab(page, "single")
    assert option(page, "fd;1").count() == 1
    assert option(page, CUSTOM).count() == 0
    tab(page, "blends")
    assert option(page, "fd+dk;1+1").count() == 1
    tab(page, "all")
    search = page.locator("#devig-search")
    search.fill("Weekend")
    assert option(page, CUSTOM).count() == 1
    assert page.locator('#devig-options-container input[name="devig-selection"]').count() == 1
    search.fill("no-such-devig-entry")
    assert page.locator('#devig-options-container input[name="devig-selection"]').count() == 0
    search.fill("")

    page.locator("#method-select").select_option("")
    page.wait_for_function("METHOD === '' && !new URL(location.href).searchParams.has('method')")
    assert modal.is_visible()
    assert page.evaluate("CURR_USER.metadata[`${PAGE}-method`]") == ""
    page.locator("#method-select").select_option("mult")
    page.wait_for_function("METHOD === 'mult'")

    if full:
        option(page, CUSTOM).locator(".dv-favorite-btn").click()
        assert modal.is_visible()
        assert page.evaluate("key => CURR_USER.metadata.favorites.includes(key)", CUSTOM)
        tab(page, "favorites")
        assert option(page, CUSTOM).count() == 1
        row = option(page, CUSTOM)
        row.locator(".devig-edit-btn").click()
        row.locator(".devig-name-input").fill("Saturday special")
        row.locator(".devig-save-btn").click()
        page.wait_for_function("key => CURR_USER.metadata.alias[key] === 'Saturday special'", arg=CUSTOM)
        assert modal.is_visible()
        row = option(page, CUSTOM)
        row.locator(".add-prop-btn").click()
        assert page.locator("#prop-selector-modal").is_visible()
        page.locator("#prop-selector-options-container .prop-select-button").filter(has_text=re.compile(r"^ATT[Dd]$", re.I)).click()
        page.wait_for_function("key => CURR_USER.metadata.tags[key].includes('nfl-attd')", arg=CUSTOM)
        assert not page.locator("#prop-selector-modal").is_visible()
        assert modal.is_visible()
        tab(page, "all")
        search.fill("nfl-attd")
        assert option(page, CUSTOM).count() == 1
        search.fill("")
        option(page, CUSTOM).locator(".dv-favorite-btn").click()
        assert not page.evaluate("key => CURR_USER.metadata.favorites.includes(key)", CUSTOM)
        tab(page, "custom")
        option(page, CUSTOM).locator(".dv-delete-btn").click()
        page.wait_for_function("key => !CURR_USER.metadata.weights.includes(key)", arg=CUSTOM)
        assert option(page, CUSTOM).count() == 0 and modal.is_visible()
        tab(page, "all")

        page.locator("#load-predefined-devigs").click()
        assert page.locator("#preloads-modal").is_visible() and not modal.is_visible()
        page.locator("#preloads-close").click()
        assert modal.is_visible() and not page.locator("#preloads-modal").is_visible()
        page.locator("#load-predefined-devigs").click()
        page.locator(".preload-add-btn").first.click()
        page.wait_for_function("DEVIG === 'fd+dk' && WEIGHT === '1+1'")
        assert not modal.is_visible() and not page.locator("#preloads-modal").is_visible()
        page.locator("#devig-button").click()

        page.locator("#add-custom-devig").click()
        assert page.locator("#custom-devig-modal").is_visible() and not modal.is_visible()
        page.locator("#cd-clear").click()
        page.locator("#weight-fd").fill("4")
        page.locator("#weight-pn").fill("1")
        page.wait_for_function("RAW_WEIGHTS.fd === 4 && RAW_WEIGHTS.pn === 1")
        page.locator("#cd-apply").click()
        page.wait_for_function("DEVIG === 'fd+pn' && WEIGHT === '4+1'")
        assert page.evaluate("CURR_USER.metadata.weights.includes('fd+pn;4+1')")
        assert not page.locator("#custom-devig-modal").count()
        page.locator("#devig-button").click()

    tab(page, "all")
    search.fill("")
    page.evaluate("DEVIG_EXCLUDED = ['pn'];")
    option(page, "fd+dk;1+1").locator('input[name="devig-selection"]').check()
    page.wait_for_function("DEVIG === 'fd+dk' && WEIGHT === '1+1' && DEVIG_EXCLUDED.length === 0")
    assert page.evaluate("JSON.stringify(REQUIRED)") == json.dumps(["fd", "dk"], separators=(",", ":"))
    assert not modal.is_visible()
    page.locator("#devig-button").click()
    option(page, "").locator('input[name="devig-selection"]').check()
    page.wait_for_function("DEVIG === '' && WEIGHT === '1'")
    assert not modal.is_visible()
    page.locator("#devig-button").click()
    check_bounds(page, width)
    page.wait_for_function("[...document.querySelectorAll('#devig-modal img.book-img')].every(img => img.complete && img.naturalWidth > 0)")
    assert page.locator("#devig-modal img.book-img").evaluate_all(
        "imgs => imgs.every(img => getComputedStyle(img).display !== 'none' && img.width > 0)")
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"devig-window-{page_name}-{width}.png"))
    page.keyboard.press("Escape")
    assert not modal.is_visible()
    page.locator("#devig-button").click()
    page.locator("#close-devig-modal").click()
    assert not modal.is_visible()
    assert not errors, (page_name, width, errors)
    page.close()
    print(f"PASS: {page_name} {width}px: layout, categories, search, method, selection, close" +
          (", favorites, rename, tags, delete, preloads, custom weights" if full else ""), flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            for name, width, full in [("atgs", 1280, True), ("atgs", 390, True), ("atgs", 320, False),
                                      ("nfl", 390, False), ("main", 1280, False), ("main", 320, False)]:
                check_page(browser, origin, name, width, full)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
