"""Offline populated-table scale regression: python -B tests/table-scale.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def payload():
    rows = []
    for index in range(120):
        rows.append({
            "player": f"scale player {index:03}", "prop": "atgs", "handicap": "0.5",
            "sport": "nhl", "under": False, "ouIdx": 0, "pos": "C", "team": "tor",
            "opp": "bos", "game": "tor @ bos", "dt": "2099-10-01", "avgTOI": 21,
            "teamTotal": 3.1, "ppLine": "1", "oppRank": 20, "dvpRank": 18,
            "goalie": "jeremy swayman", "goalieGSAA": 2.4, "goalieSV": .921,
            "book": "fd", "line": 150, "liquidity": {}, "links": {},
            "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160",
                         "circa": "125/-155", "mgm": "145/-165", "cz": "140/-160"},
            "hitRate": 50, "hitRateLYR": 40, "logs": [0, 1, 2, 3] * 7,
            "bvtLogs": [0, 3, 2, 1], "awayLogs": [0, 2, 4, 1] * 7,
            "homeLogs": [1, 0, 3, 2] * 7,
            "hitRates": {"bvt": {"w": 1, "t": 4, "p": 25}},
            "due": {"g": {"btwn": [1, 3, 0, 2], "streak": 4, "med": 1.5,
                            "avg": 1.5, "z": 1.94, "z_median": .5}},
        })
    return {"data": rows, "props": ["atgs"], "games": ["tor @ bos"], "updated": {},
            "times": {"tor @ bos": "2099-10-01T23:00:00Z"}}


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
    page.route("**/api/**", lambda route: route.fulfill(json=payload() if "/atgs" in page.url else {
        "data": [], "props": [], "games": [], "updated": {}, "times": {}, "record": {}}))


def settle(page):
    page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def load(page, origin, name="atgs"):
    page.goto(f"{origin}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
    page.wait_for_function("typeof TABLE !== 'undefined' && TABLE?.initialized")
    if name == "atgs":
        page.wait_for_function("TABLE.getData('active').length === 120")
    settle(page)


def open_customize(page):
    page.locator("#customize").click()
    assert page.locator("#overlay").is_visible()


def scale(page, value):
    if not page.locator("#overlay").is_visible():
        open_customize(page)
    page.locator("#custom-table-scale").select_option(str(value))
    page.keyboard.press("Escape")
    settle(page)
    assert page.evaluate("getOddsTableScale()") == value
    assert page.locator("#table").evaluate("el => getComputedStyle(el).zoom") == str(value / 100).removesuffix(".0")


def metrics(page):
    return page.evaluate("""() => {
        const table = document.getElementById('table');
        const holder = table.querySelector('.tabulator-tableholder');
        const rect = table.getBoundingClientRect(), bounds = holder.getBoundingClientRect();
        const rows = TABLE.getRows('active').filter(row => {
            const r = row.getElement().getBoundingClientRect();
            return r.height && r.top >= bounds.top && r.bottom <= bounds.bottom;
        });
        const columns = TABLE.getColumns().filter(col => col.isVisible()).map(col => {
            const r = col.getElement().getBoundingClientRect();
            return {field: col.getField(), left: r.left, right: r.right, width: r.width};
        });
        return {width: rect.width, height: rect.height, left: rect.left, top: rect.top,
            logicalWidth: table.clientWidth, logicalHeight: table.clientHeight,
            rowHeight: rows[0]?.getElement().getBoundingClientRect().height,
            visibleRows: rows.length,
            visibleColumns: columns.filter(c => c.left >= rect.left && c.right <= rect.right).length,
            playerLeft: TABLE.getColumn('player').getElement().getBoundingClientRect().left};
    }""")


def assert_alignment(page):
    result = page.evaluate("""() => {
        const table = document.getElementById('table'), bounds = table.getBoundingClientRect();
        const holder = table.querySelector('.tabulator-tableholder').getBoundingClientRect();
        const row = TABLE.getRows('active').find(row => {
            const r = row.getElement().getBoundingClientRect();
            return r.height && r.top >= holder.top && r.bottom <= holder.bottom;
        });
        return TABLE.getColumns().filter(c => c.isVisible()).map(col => {
            const header = col.getElement().getBoundingClientRect();
            const cell = row.getCell(col.getField())?.getElement().getBoundingClientRect();
            return cell && {field: col.getField(), header: header.left, cell: cell.left,
                headerWidth: header.width, cellWidth: cell.width, right: header.right};
        }).filter(c => c && c.right > bounds.left && c.header < bounds.right);
    }""")
    assert result
    for column in result:
        assert abs(column["header"] - column["cell"]) <= 1.5, column
        assert abs(column["headerWidth"] - column["cellWidth"]) <= 1.5, column


def check_click_and_scroll(page):
    holder = page.locator("#table .tabulator-tableholder")
    holder.evaluate("el => { el.scrollLeft = 420; el.scrollTop = 900; }")
    settle(page)
    assert holder.evaluate("el => el.scrollLeft") > 0
    assert holder.evaluate("el => el.scrollTop") > 0
    frozen = metrics(page)["playerLeft"]
    holder.evaluate("el => el.scrollLeft = 800")
    settle(page)
    assert abs(metrics(page)["playerLeft"] - frozen) <= 1.5
    assert_alignment(page)
    holder.evaluate("el => el.scrollLeft = 0")
    settle(page)
    player = page.evaluate("""() => {
        const bounds = document.querySelector('#table .tabulator-tableholder').getBoundingClientRect();
        const row = TABLE.getRows('active').find(row => {
            const r = row.getElement().getBoundingClientRect();
            return r.height && r.top >= bounds.top + 30 && r.bottom < bounds.bottom;
        });
        row.getCell('ev').getElement().setAttribute('data-scale-click', 'target');
        return row.getData().player;
    }""")
    page.locator('[data-scale-click="target"]').click()
    page.wait_for_function("document.getElementById('nhl-history-dialog')?.open")
    assert player.title() in page.locator("#nhl-history-title").inner_text()
    dialog = page.locator("#nhl-history-dialog").bounding_box()
    assert dialog["x"] >= 0 and dialog["x"] + dialog["width"] <= page.viewport_size["width"] + 1
    page.keyboard.press("Escape")
    assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
    holder.evaluate("el => { el.scrollLeft = 0; el.scrollTop = 0; }")
    settle(page)


def screenshot(page, name):
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"table-scale-{name}.png"))


def check_populated(browser, origin):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    load(page, origin)
    assert page.evaluate("getOddsTableScale()") == 100
    assert page.locator("#table").evaluate("el => el.style.zoom") == ""
    standard = metrics(page)
    assert standard["visibleRows"] > 5
    screenshot(page, "atgs-100")
    button = page.locator("#customize").bounding_box()
    scale(page, 80)
    small = metrics(page)
    assert abs(small["width"] - standard["width"]) <= 2, (standard, small)
    assert abs(small["height"] - standard["height"]) <= 2, (standard, small)
    assert small["logicalWidth"] > standard["logicalWidth"] * 1.2
    assert small["visibleRows"] > standard["visibleRows"], (standard, small)
    assert small["visibleColumns"] > standard["visibleColumns"], (standard, small)
    assert abs(small["rowHeight"] / standard["rowHeight"] - .8) < .03
    assert page.locator("#customize").bounding_box() == button
    assert page.evaluate("localStorage.getItem('odds-table-scale')") == "80"
    screenshot(page, "atgs-80")
    check_click_and_scroll(page)
    for value in [75, 125]:
        scale(page, value)
        current = metrics(page)
        assert abs(current["width"] - standard["width"]) <= 2, current
        assert abs(current["height"] - standard["height"]) <= 2, current
        assert_alignment(page)
        check_click_and_scroll(page)
    scale(page, 80)
    open_customize(page)
    page.locator("#custom-view-select").select_option("table")
    page.keyboard.press("Escape")
    settle(page)
    assert page.locator("#table").evaluate("el => el.style.zoom") == "0.8"
    assert_alignment(page)
    check_click_and_scroll(page)
    # Rebuilding the column definitions follows the saved reorder path.
    page.evaluate("TABLE.setColumns(buildAtgsColumns())")
    settle(page)
    assert_alignment(page)
    assert page.locator("#table").evaluate("el => el.style.zoom") == "0.8"
    open_customize(page)
    page.locator("#custom-view-select").select_option("mobile")
    page.keyboard.press("Escape")
    page.wait_for_function("document.querySelector('#card-container')?.children.length > 0")
    cards = page.locator("#card-container")
    before = cards.locator(":scope > *").first.bounding_box()
    assert cards.evaluate("el => getComputedStyle(el).zoom") == "1"
    scale(page, 125)
    assert cards.locator(":scope > *").first.bounding_box() == before
    scale(page, 80)
    open_customize(page)
    page.locator("#custom-view-select").select_option("compact")
    page.keyboard.press("Escape")
    settle(page)
    assert_alignment(page)
    page.reload()
    page.wait_for_function("TABLE?.initialized && TABLE.getData('active').length === 120")
    settle(page)
    assert page.locator("#table").evaluate("el => el.style.zoom") == "0.8"
    open_customize(page)
    assert page.locator("#custom-table-scale").input_value() == "80"
    page.keyboard.press("Escape")
    load(page, origin, "nba")
    assert page.locator("#table").evaluate("el => el.style.zoom") == "0.8"
    open_customize(page)
    assert page.locator("#custom-table-scale").input_value() == "80"
    assert page.locator("#custom-table-scale option").evaluate_all("nodes => nodes.map(n => n.value)") == ["75", "80", "90", "100", "110", "125"]
    assert not errors, errors
    print(f"PASS: populated ATGS 100/80/75/125, rows {standard['visibleRows']} -> {small['visibleRows']}, "
          f"columns {standard['visibleColumns']} -> {small['visibleColumns']}; frozen/header scroll, row clicks, "
          "views/cards/rebuild/reload and NBA preference", flush=True)
    page.close()


def check_small_layout(browser, origin, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    load(page, origin)
    scale(page, 80)
    assert_alignment(page)
    open_customize(page)
    panel = page.locator(".cx-panel")
    box = panel.bounding_box()
    assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= width + 1 and box["y"] + box["height"] <= height + 1, box
    assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    assert page.locator("#custom-table-scale").is_visible()
    assert page.locator("#cx-scale-help").is_visible()
    footer = panel.locator(".cx-footer").bounding_box()
    body = panel.locator(".cx-body").bounding_box()
    assert body["y"] + body["height"] <= footer["y"] + 1
    panel.locator(".cx-body").evaluate("el => el.scrollTop = el.scrollHeight")
    assert panel.locator(".cx-footer").bounding_box() == footer
    screenshot(page, f"customize-{width}x{height}")
    assert not errors, errors
    page.close()
    print(f"PASS: Customize scale {width}x{height} bounds, footer and populated table alignment", flush=True)


def check_storage(browser, origin, blocked=False):
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    if blocked:
        page.add_init_script("""const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
            Storage.prototype.getItem = function(key) {
                if (key === 'odds-table-scale') throw new DOMException('Blocked', 'SecurityError');
                return get.call(this, key);
            };
            Storage.prototype.setItem = function(key, value) {
                if (key === 'odds-table-scale') throw new DOMException('Blocked', 'SecurityError');
                return set.call(this, key, value);
            };""")
    else:
        page.add_init_script("localStorage.setItem('odds-table-scale', 'invalid');")
    load(page, origin)
    assert page.evaluate("getOddsTableScale()") == 100
    assert page.locator("#table").evaluate("el => el.style.zoom") == ""
    scale(page, 80)
    assert_alignment(page)
    assert not errors, errors
    page.close()
    print("PASS: " + ("blocked" if blocked else "invalid") + " scale storage falls back and remains usable", flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            check_populated(browser, origin)
            for width, height in [(320, 844), (390, 568)]:
                check_small_layout(browser, origin, width, height)
            check_storage(browser, origin)
            check_storage(browser, origin, blocked=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
