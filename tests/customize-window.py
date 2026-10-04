"""Offline Customize checks: python -B tests/customize-window.py (Playwright)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


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
    page.evaluate("""() => {
        ENABLE_AUTH = true;
        CURR_USER = {id: 'fixture', tier: 'sharp', metadata: {}};
        CURR_SESSION = {user: {id: 'fixture'}};
        window.customizeWrites = [];
        SB = {from(table) { return {update(value) { return {eq(key, id) {
            window.customizeWrites.push({table, key, id, value: JSON.parse(JSON.stringify(value))});
            return Promise.resolve({error: null});
        }}; }}; }};
        document.getElementById('save-table').style.display = 'inline-flex';
        document.querySelectorAll('#overlay .loggedOut').forEach(el => el.style.display = 'none');
        window.originalCustomizeNodes = [...document.querySelectorAll('#overlay input, #overlay select')];
    }""")


def tab(page, category):
    page.locator(f'.cx-tabs button[data-category="{category}"]').click()


def open_window(page):
    page.locator("#customize").click()
    assert page.locator("#overlay").is_visible()


def layout(page, width, height=844):
    panel = page.locator("#overlay .cx-panel")
    bounds = panel.bounding_box()
    assert bounds and bounds["x"] >= -1 and bounds["y"] >= -1, bounds
    assert bounds["x"] + bounds["width"] <= width + 1, bounds
    assert bounds["y"] + bounds["height"] <= height + 1, bounds
    assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    body = panel.locator(".cx-body")
    footer = panel.locator(".cx-footer").bounding_box()
    body_bounds = body.bounding_box()
    assert body_bounds["y"] + body_bounds["height"] <= footer["y"] + 1
    body.evaluate("el => el.scrollTop = el.scrollHeight")
    assert panel.locator(".cx-footer").bounding_box() == footer
    assert panel.locator("#save-table").is_visible()
    body.evaluate("el => el.scrollTop = 0")


def check_visibility_and_bulk(page):
    search = page.locator("#cx-column-search")
    tab(page, "columns")
    search.fill("kelly")
    checkbox = page.locator("#custom_kelly")
    assert checkbox.is_visible() and not checkbox.is_disabled()
    before = page.locator("#items input").evaluate_all("nodes => Object.fromEntries(nodes.map(n => [n.id,n.checked]))")
    page.locator(".cx-hide-all").click()
    assert not checkbox.is_checked() and not page.evaluate("TABLE.getColumn('kelly').isVisible()")
    after = page.locator("#items input").evaluate_all("nodes => Object.fromEntries(nodes.map(n => [n.id,n.checked]))")
    assert all(after[key] == value for key, value in before.items() if key != "custom_kelly")
    page.locator(".cx-show-all").click()
    assert checkbox.is_checked() and page.evaluate("TABLE.getColumn('kelly').isVisible()")
    page.locator(".cx-hide-all").click()
    page.keyboard.press("Escape")
    open_window(page)
    assert not checkbox.is_checked(), "Reopening restored a stale saved value"
    assert not page.evaluate("TABLE.getColumn('kelly').isVisible()")
    assert page.evaluate("customizeWrites.length") == 0
    tab(page, "books")
    search.fill("draftkings")
    assert page.locator('.cx-column-row:not([hidden])').count() == 1
    assert page.locator("#custom_bookOdds_dk").is_visible()
    search.fill("no-such-column")
    assert page.locator("#cx-empty").is_visible()
    search.fill("")


def check_search_anchor(page):
    search = page.locator("#cx-column-search")
    original_y = search.bounding_box()["y"]
    for value in ["kelly", "no-matching-column-anywhere"]:
        search.fill(value)
        assert abs(search.bounding_box()["y"] - original_y) <= 1, "Search moved while typing"
    tab(page, "defaults")
    assert not search.is_visible()
    tab(page, "all")
    assert abs(search.bounding_box()["y"] - original_y) <= 1
    search.fill("")
    assert page.locator(".cx-panel").evaluate("el => el.style.height") == ""


def check_views(page):
    page.locator("#custom-view-select").select_option("table")
    assert page.locator("#header-view-select").input_value() == "table"
    assert page.evaluate("localStorage.getItem('odds-view')") == "table"
    assert page.evaluate("new URL(location.href).searchParams.get('view')") == "table"
    assert page.locator("#custom_fairVal").is_disabled()
    tab(page, "columns")
    page.locator("#cx-column-search").fill("fair")
    disabled = page.locator("#custom_fairVal").is_checked()
    page.locator(".cx-hide-all").click()
    assert page.locator("#custom_fairVal").is_checked() == disabled
    page.locator(".cx-show-all").click()
    assert page.locator("#custom_fairVal").is_checked() == disabled
    page.locator("#cx-column-search").fill("")
    page.locator("#custom-view-select").select_option("compact")
    assert page.locator("#header-view-select").input_value() == "compact"
    assert not page.locator("#custom_fairVal").is_disabled()
    if page.locator("#custom-ou-select").count():
        page.locator("#custom-ou-select").select_option("u")
        assert page.locator("#ou-select").input_value() == "u"
        assert page.evaluate("OU") == "u"


def check_save(page):
    tab(page, "all")
    page.locator("#custom_kelly").uncheck()
    expected = page.locator("#items input:checked").evaluate_all("nodes => nodes.map(node => node.id.replace(/^custom_/, '')).sort()")
    tab(page, "defaults")
    assert not page.locator("#items").is_visible()
    assert page.locator("#custom-devig-select").is_visible()
    page.locator("#custom-devig-select").select_option("fd+dk;1+1")
    page.locator("#save-table").click()
    page.wait_for_function("customizeWrites.length === 1")
    assert page.evaluate("[...CURR_USER.metadata[PAGE]].sort()") == expected
    assert page.evaluate("CURR_USER.metadata[`${PAGE}-devig`]") == "fd+dk;1+1"
    page.keyboard.press("Escape")
    open_window(page)
    assert not page.locator("#custom_kelly").is_checked()
    tab(page, "defaults")
    assert page.locator("#custom-devig-select").input_value() == "fd+dk;1+1"
    tab(page, "all")


def check_reorder(page):
    page.locator("#custom-view-select").select_option("table")
    page.locator(".cx-reorder").click()
    modal = page.locator("#col-reorder-modal")
    page.wait_for_function("document.querySelector('.cx-panel').inert")
    assert modal.is_visible()
    bounds = modal.locator(".modal-content").bounding_box()
    viewport = page.viewport_size
    assert bounds["x"] >= -1 and bounds["y"] >= -1, bounds
    assert bounds["x"] + bounds["width"] <= viewport["width"] + 1, bounds
    assert bounds["y"] + bounds["height"] <= viewport["height"] + 1, bounds
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"customize-reorder-{page.evaluate('PAGE')}-{viewport['width']}.png"))
    original = page.locator("#col-reorder-list [data-key]").evaluate_all("nodes => nodes.map(node => node.dataset.key)")
    full = page.evaluate("document.getElementById('col-reorder-list')._fullColumnOrder")
    assert len(original) >= 2 and len(full) >= len(original)
    page.locator("#col-reorder-list [data-key]").nth(1).drag_to(page.locator("#col-reorder-list [data-key]").first)
    assert page.locator("#col-reorder-list [data-key]").first.get_attribute("data-key") == original[1]
    page.keyboard.press("Escape")
    assert not modal.is_visible() and page.locator("#overlay").is_visible()
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    assert page.evaluate("customizeWrites.length") == 1
    assert page.locator(".cx-reorder").evaluate("el => el === document.activeElement")
    page.locator(".cx-reorder").click()
    assert page.locator("#col-reorder-list [data-key]").first.get_attribute("data-key") == original[0]
    page.locator("#col-reorder-list [data-key]").nth(1).drag_to(page.locator("#col-reorder-list [data-key]").first)
    modal.locator('button[onclick="saveColReorder()"] ').click()
    page.wait_for_function("customizeWrites.length === 2 && document.getElementById('col-reorder-modal').style.display === 'none'")
    saved = page.evaluate("CURR_USER.metadata[`${PAGE}-order`]")
    assert len(saved) == len(full) and set(saved) == set(full)
    assert [key for key in saved if key in original][:2] == [original[1], original[0]]
    assert all(saved.index(key) == full.index(key) for key in full if key not in original), "Hidden group slots moved"
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    assert page.locator("#overlay").is_visible()


def check_page(browser, origin, name, width, full=False, legacy=False):
    page = browser.new_page(viewport={"width": width, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    page.goto(f"{origin}/{name}.html?view=compact")
    page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && typeof openOverlay === 'function'")
    setup_profile(page)
    if legacy:
        page.evaluate("document.querySelectorAll('#custom-view-select, #custom-ou-select, #custom-devig-select').forEach(node => node.remove())")
    open_window(page)
    assert page.locator("#overlay").get_attribute("role") == "dialog"
    if not legacy:
        assert page.evaluate("originalCustomizeNodes.every(node => document.getElementById(node.id) === node)")
    layout(page, width)
    if not legacy:
        check_search_anchor(page)
    ids = page.locator("#overlay [id]").evaluate_all("nodes => nodes.map(node => node.id)")
    assert len(ids) == len(set(ids))
    if name == "atgs" and width == 1280:
        page.evaluate("document.getElementById('custom_openingPrice').parentElement.remove(); ensureOpeningColumnControl();")
        page.wait_for_function("document.getElementById('custom_openingPrice').parentElement.classList.contains('cx-column-row')")
        page.locator("#cx-column-search").fill("openingPrice")
        assert page.locator("#custom_openingPrice").is_visible()
        page.locator("#cx-column-search").fill("")
    if full:
        check_visibility_and_bulk(page)
        check_views(page)
        check_save(page)
        if page.locator(".cx-reorder").count():
            check_reorder(page)
        layout(page, width)
    if legacy:
        assert page.locator('.cx-tabs button[data-category="defaults"]').count() == 0
        assert page.locator("#custom-view-select, #custom-devig-select").count() == 0
    if not legacy:
        tab(page, "all")
        page.locator("#cx-column-search").fill("")
    page.wait_for_function("[...document.querySelectorAll('#overlay img')].every(img => img.complete)")
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"customize-window-{name}-{width}{'-legacy' if legacy else ''}.png"))
    page.keyboard.press("Escape")
    assert not page.locator("#overlay").is_visible()
    assert page.locator("#customize").evaluate("el => document.activeElement === el")
    open_window(page)
    page.locator("#overlay").click(position={"x": 2, "y": 2})
    assert not page.locator("#overlay").is_visible()
    assert page.evaluate("document.body.style.overflow") != "hidden"
    if width == 320:
        page.set_viewport_size({"width": width, "height": 568})
        open_window(page)
        page.wait_for_function("document.querySelector('#overlay .cx-panel').getBoundingClientRect().bottom <= 569")
        layout(page, width, 568)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / f"customize-window-{name}-320-short.png"))
    assert not errors, (name, width, errors)
    page.close()
    print(f"PASS: {name} {width}px" + (" legacy optional controls" if legacy else "") +
          ": bounds, scroll, footer, dismissal" + (", live visibility, filtered bulk, view, save, nested reorder" if full else ""), flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            for name, width, full, legacy in [("atgs", 1280, True, False), ("atgs", 390, True, False),
                                              ("atgs", 320, False, False), ("dingers", 1280, True, False),
                                              ("dingers", 320, False, False), ("nfl", 390, False, False),
                                              ("main", 320, True, False), ("ncaaf", 390, True, False),
                                              ("atgs", 390, False, True)]:
                check_page(browser, origin, name, width, full, legacy)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
