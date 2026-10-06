"""Offline NHL column reorder checks: python -B tests/nhl-reorder.py."""
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
        window.reorderWrites = [];
        SB = {from(table) { return {update(value) { return {eq(key, id) {
            window.reorderWrites.push({table, key, id, value: JSON.parse(JSON.stringify(value))});
            return Promise.resolve({error: null});
        }}; }}; }};
        document.querySelectorAll('#overlay .loggedOut').forEach(el => el.style.display = 'none');
    }""")


def fields(page):
    return page.evaluate("TABLE.getColumns().map(column => column.getField()).filter(Boolean)")


def keys(page):
    return page.locator("#col-reorder-list [data-key]").evaluate_all("nodes => nodes.map(node => node.dataset.key)")


def state(page):
    return page.evaluate("""() => ({
        filters: TABLE.getFilters(), headerFilters: TABLE.getHeaderFilters(),
        sorters: TABLE.getSorters().map(sort => ({field: sort.field, dir: sort.dir})),
        visibility: Object.fromEntries(TABLE.getColumns().map(column => [column.getField(), column.isVisible()]))
    })""")


def open_reorder(page):
    page.locator(".cx-reorder").click()
    page.wait_for_function("document.querySelector('.cx-panel').inert")
    modal = page.locator("#col-reorder-modal")
    assert modal.is_visible()
    bounds = modal.locator(".modal-content").bounding_box()
    viewport = page.viewport_size
    assert bounds and bounds["x"] >= -1 and bounds["y"] >= -1, bounds
    assert bounds["x"] + bounds["width"] <= viewport["width"] + 1, bounds
    assert bounds["y"] + bounds["height"] <= viewport["height"] + 1, bounds
    assert modal.locator(".modal-content").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    return modal


def move_second_first(page, touch=False):
    items = page.locator("#col-reorder-list [data-key]")
    expected = items.nth(1).get_attribute("data-key")
    if touch:
        source, target = items.nth(1).bounding_box(), items.first.bounding_box()
        client = page.context.new_cdp_session(page)
        client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [
            {"x": source["x"] + source["width"] / 2, "y": source["y"] + source["height"] / 2}]})
        client.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": target["x"] + target["width"] / 2, "y": target["y"] + 3}]})
        client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        client.detach()
    else:
        items.nth(1).drag_to(items.first)
    page.wait_for_function("key => document.querySelector('#col-reorder-list [data-key]').dataset.key === key", arg=expected)


def check_utilities(page):
    columns = fields(page)
    assert len(columns) == len(set(columns)), columns
    assert all(columns.count(field) == 1 for field in ("roiRecord", "openingPrice", "_watchlist", "game")), columns
    assert columns[0] == "_watchlist" and columns[-1] == "game", columns


def expect_order(page, order):
    page.wait_for_function("""order => JSON.stringify(TABLE.getColumns()
        .map(column => column.getField()).filter(field => field && !['_watchlist', 'game'].includes(field))
        .map(field => field.replaceAll('.', '_'))) === JSON.stringify(order)""", arg=order)


def check_profile_restore(context, origin, saved, width):
    # A new navigation must use the cached profile before the live profile arrives.
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    view = "mobile" if width < 600 else "table"
    page.goto(f"{origin}/nhl.html?view={view}")
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    expect_order(page, saved)
    assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()"), "Order-only NHL profile hid Open on reload"
    check_utilities(page)

    # Reconcile a changed live profile while either the table or phone cards are active.
    setup_profile(page)
    late_order = [saved[-1], *saved[:-1]]
    page.evaluate("""order => {
        CURR_USER.metadata['nhl-order'] = order;
        TABLE.setHeaderFilterValue('player', 'fixture');
        TABLE.setSort([{column: 'ev', dir: 'asc'}]);
        hydrateAfterProfileLoad();
    }""", late_order)
    expect_order(page, late_order)
    assert page.evaluate("TABLE.getHeaderFilters().some(filter => filter.field === 'player' && filter.value === 'fixture')")
    assert page.evaluate("TABLE.getSorters().map(sort => ({field: sort.field, dir: sort.dir}))") == [{"field": "ev", "dir": "asc"}]
    assert page.evaluate("reorderWrites.length") == 0
    assert page.evaluate("CURRENT_VIEW") == view
    assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()"), "Order-only live profile hid Open"
    check_utilities(page)

    # An explicit column-visibility preference still takes priority over the default.
    page.evaluate("""order => {
        CURR_USER.metadata.nhl = TABLE.getColumns()
            .filter(column => column.isVisible() && column.getField() !== 'openingPrice')
            .map(column => column.getField().replaceAll('.', '_'));
        CURR_USER.metadata['nhl-order'] = order;
        hydrateAfterProfileLoad();
    }""", saved)
    expect_order(page, saved)
    page.wait_for_function("!TABLE.getColumn('openingPrice').isVisible()")
    assert page.evaluate("reorderWrites.length") == 0
    assert not errors, errors
    page.close()


def check_page(browser, origin, width):
    context = browser.new_context(viewport={"width": width, "height": 844 if width > 320 else 568},
                                  has_touch=width < 600)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    page.goto(f"{origin}/nhl.html?view=compact")
    page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && typeof openColReorder === 'function'")
    setup_profile(page)
    page.locator("#customize").click()
    page.locator("#custom-view-select").select_option("table")
    page.locator('#custom_kelly').uncheck()
    page.evaluate("""() => {
        TABLE.setHeaderFilterValue('player', 'fixture');
        TABLE.setSort([{column: 'ev', dir: 'asc'}]);
        TABLE.setFilter([{field: 'prop', type: '=', value: 'sog'}]);
    }""")
    before = state(page)
    original_fields = fields(page)
    modal = open_reorder(page)
    original = keys(page)
    full = page.evaluate("document.getElementById('col-reorder-list')._fullColumnOrder")
    assert len(original) >= 2 and len(full) > len(original)
    assert len(full) == len(set(full))
    assert 'kelly' not in original and 'kelly' in full
    assert not any(key in original for key in ("_watchlist", "game"))
    expected_visible = [field.replace(".", "_") for field in original_fields
                        if before["visibility"][field] and field not in ("_watchlist", "game")]
    assert original == expected_visible, (original, expected_visible)
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"nhl-reorder-{width}.png"))

    move_second_first(page, touch=width < 600)
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    assert not modal.is_visible() and page.locator("#overlay").is_visible()
    assert page.locator(".cx-reorder").evaluate("el => document.activeElement === el")
    assert page.evaluate("reorderWrites.length") == 0
    assert fields(page) == original_fields and state(page) == before

    modal = open_reorder(page)
    assert keys(page) == original
    move_second_first(page, touch=width < 600)
    expected = [original[1], original[0], *original[2:]]
    modal.locator('button[onclick="saveColReorder()"] ').click()
    page.wait_for_function("reorderWrites.length === 1 && document.getElementById('col-reorder-modal').style.display === 'none'")
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    saved = page.evaluate("CURR_USER.metadata['nhl-order']")
    assert len(saved) == len(full) and set(saved) == set(full)
    assert [key for key in saved if key in original] == expected
    assert all(saved.index(key) == full.index(key) for key in full if key not in original)
    write = page.evaluate("reorderWrites[0]")
    assert write["table"] == "profiles" and write["key"] == "id" and write["id"] == "fixture"
    assert write["value"]["metadata"]["nhl-order"] == saved
    assert page.evaluate("JSON.parse(localStorage.getItem('cached_profile')).metadata['nhl-order']") == saved
    assert state(page) == before, (state(page), before)
    check_utilities(page)
    assert [field.replace(".", "_") for field in fields(page)
            if field not in ("_watchlist", "game")] == saved
    modal = open_reorder(page)
    assert keys(page) == expected
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.cx-panel').inert")

    # Guest changes apply to the current table and reopening uses that live order.
    page.evaluate("ENABLE_AUTH = false; CURR_USER = null; CURR_SESSION = null;")
    modal = open_reorder(page)
    assert keys(page) == expected
    move_second_first(page, touch=width < 600)
    modal.locator('button[onclick="saveColReorder()"] ').click()
    page.wait_for_function("document.getElementById('col-reorder-modal').style.display === 'none'")
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    assert page.evaluate("reorderWrites.length") == 1
    assert state(page) == before
    open_reorder(page)
    assert keys(page) == original
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.cx-panel').inert")
    check_utilities(page)
    if width == 1280:
        # Dragging table headers must also be reflected the next time Reorder opens.
        page.evaluate("TABLE.moveColumn('goalie', 'ev', false)")
        visibility = state(page)["visibility"]
        live = [field.replace('.', '_') for field in fields(page)
                if visibility[field] and field not in ("_watchlist", "game")]
        open_reorder(page)
        assert keys(page) == live and live[0] == 'goalie'
        page.keyboard.press("Escape")
        page.wait_for_function("!document.querySelector('.cx-panel').inert")
    if width in (1280, 390):
        check_profile_restore(context, origin, saved, width)
    assert not errors, errors
    context.close()
    print(f"PASS: NHL {width}px: visible columns, {'touch' if width < 600 else 'drag'}, cancel, saved/guest order, table state, utilities" +
          (", cached/live profile restore" if width in (1280, 390) else ""), flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            for width in (1280, 390, 320):
                check_page(browser, origin, width)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
