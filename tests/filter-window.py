"""Offline filter-window checks: python -B tests/filter-window.py (Playwright)."""
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
        CURR_USER = {id: 'test-profile', tier: 'sharp', metadata: {}};
        CURR_SESSION = {user: {id: 'test-profile'}};
        window.filterWrites = [];
        SB = {from(table) { return {update(value) { return {eq(key, id) {
            window.filterWrites.push({table, key, id, value: JSON.parse(JSON.stringify(value))});
            return Promise.resolve({error: null});
        }}; }}; }};
    }""")


def control(page, field):
    return page.locator(f"#{field}")


def open_window(page):
    if not page.locator("#filterbuilder-options").is_visible():
        page.locator("#filterbuilder-dd-button").click()


def action(page, function):
    open_window(page)
    page.locator(f'#filterbuilder-options button[onclick="{function}()"]').click()


def config(page):
    return page.evaluate("JSON.stringify(FB_CONFIG)")


def prop_state(page):
    return page.evaluate("""() => ({
        label: document.getElementById('prop-dd-button')?.textContent || '',
        props: [...document.querySelectorAll('#prop-options input:checked')].map(input => input.value)
    })""")


def check_layout(page, width, height=844):
    panel = page.locator("#filterbuilder-options")
    bounds = panel.bounding_box()
    assert bounds and bounds["x"] >= -1 and bounds["y"] >= -1, bounds
    assert bounds["x"] + bounds["width"] <= width + 1, bounds
    assert bounds["y"] + bounds["height"] <= height + 1, bounds
    assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    footer = panel.locator(".fb-window-footer").bounding_box()
    body = panel.locator(".fb-window-body")
    body_bounds = body.bounding_box()
    assert footer and body_bounds, (footer, body_bounds)
    assert footer["y"] + footer["height"] <= height + 1, footer
    assert body_bounds["y"] + body_bounds["height"] <= footer["y"] + 1, (body_bounds, footer)
    body.evaluate("el => el.scrollTop = el.scrollHeight")
    assert panel.locator('button[onclick="applyFilterBuilder()"]').is_visible()
    assert panel.locator('button[onclick="clearFilterBuilder()"]').is_visible()
    assert panel.locator(".fb-window-footer").bounding_box() == footer
    body.evaluate("el => el.scrollTop = 0")


def check_presets(page):
    current = config(page)
    # Save As stores the draft without applying it.
    draft_input = page.locator(".fb-rule.is-enabled input[type=number]").first
    if draft_input.count():
        draft_input.fill(str(float(draft_input.input_value()) + 1))
        assert control(page, "fb-draft-status").inner_text() == "Changes not applied"
    draft = page.evaluate("JSON.stringify(readFilterBuilderFromDOM())")
    control(page, "fb-name-input").fill("Fixture rules")
    action(page, "saveFilterBuilder")
    page.wait_for_function("filterWrites.length === 1")
    assert config(page) == current, "Save As applied draft rules"
    assert page.evaluate("CURR_USER.metadata[`${PAGE}-savedFilters`][0].name") == "Fixture rules"
    action(page, "clearFilterBuilder")
    assert page.locator('#filterbuilder-options input[id$="-enabled"]:checked').count() == 0
    assert control(page, "fb-name-input").input_value() == ""
    assert page.locator("#filterbuilder-dd-button").inner_text() == "None"
    assert control(page, "fb-draft-status").inner_text() == "Choose rules above"
    if control(page, "fb-liquidity-match").count():
        assert control(page, "fb-liquidity-match").input_value() == "all"
    assert page.locator("#filterbuilder-options .fb-stat-row").count() == 0
    control(page, "fb-saved-select").select_option("0")
    assert config(page) == draft, "Loading a preset did not restore and apply the saved rules"
    assert control(page, "fb-draft-status").inner_text() == "Filters applied"
    assert control(page, "fb-name-input").input_value() == "Fixture rules"
    action(page, "deleteSavedFilterBuilder")
    page.wait_for_function("filterWrites.length === 2")
    assert page.evaluate("CURR_USER.metadata[`${PAGE}-savedFilters`].length") == 0
    assert config(page) == draft, "Deleting the saved preset changed active filtering"
    assert control(page, "fb-saved-select").locator("option").count() == 1


def check_liquidity(page):
    initial = config(page)
    assert control(page, "fb-draft-status").inner_text() == "Choose rules above"
    control(page, "fb-liquidity-amount").fill("75")
    assert control(page, "fb-draft-status").inner_text() == "Choose rules above"
    assert not control(page, "fb-draft-status").evaluate("el => el.classList.contains('is-dirty')")
    assert page.locator(".fb-liquidity-group input[type=checkbox]").count() == 3
    assert page.locator(".fb-liquidity-rule").count() == 3
    for prefix in ["fb-liquidity-over", "fb-liquidity", "fb-liquidity-ev"]:
        control(page, f"{prefix}-enabled").check()
        control(page, f"{prefix}-book").select_option("px")
        control(page, f"{prefix}-amount").fill("50")
    assert config(page) == initial, "Editing liquidity applied before Apply"
    assert page.locator(".fb-liquidity-rule.is-enabled").count() == 3
    assert control(page, "fb-draft-status").inner_text() == "Changes not applied"
    action(page, "applyFilterBuilder")
    assert control(page, "fb-draft-status").inner_text() == "Filters applied"
    assert page.evaluate("filterWrites.length") == 0
    assert page.evaluate("FB_CONFIG.liquidityMatch") == "all"
    assert not page.evaluate("passesFilterBuilder({under:false, liquidity:{px:[60,20]}})")
    assert page.evaluate("passesFilterBuilder({under:false, liquidity:{px:[60,60]}})")
    control(page, "fb-liquidity-match").select_option("any")
    assert page.evaluate("FB_CONFIG.liquidityMatch") == "all"
    assert control(page, "fb-draft-status").inner_text() == "Changes not applied"
    action(page, "applyFilterBuilder")
    assert page.evaluate("passesFilterBuilder({under:false, liquidity:{px:[60,20]}})")
    assert page.locator("#filterbuilder-dd-button").inner_text() == "3 Filters"
    action(page, "clearFilterBuilder")
    assert control(page, "fb-draft-status").inner_text() == "Choose rules above"


def check_nhl(page):
    initial = config(page)
    page.get_by_role("button", name="Add hit-rate rule", exact=True).click()
    assert control(page, "fb-hitrate-enabled").is_checked()
    row = page.locator("#fb-hitrate-rows .fb-stat-row").first
    row.locator(".fb-stat-field").select_option("L10")
    row.locator(".fb-stat-cmp").select_option("gte")
    row.locator(".fb-stat-value").fill("60")
    page.get_by_role("button", name="Add hit-rate rule", exact=True).click()
    assert page.locator("#fb-hitrate-rows .fb-stat-row").count() == 2
    page.locator("#fb-hitrate-rows .fb-row-remove").last.click()
    assert page.locator("#fb-hitrate-rows .fb-stat-row").count() == 1
    control(page, "fb-position-enabled").check()
    control(page, "fb-position-value").select_option("C")
    assert config(page) == initial
    action(page, "applyFilterBuilder")
    assert page.evaluate("passesFilterBuilder({pos:'C', hitRates:{L10:{p:70,t:10}}})")
    assert not page.evaluate("passesFilterBuilder({pos:'D', hitRates:{L10:{p:70,t:10}}})")
    assert not page.evaluate("passesFilterBuilder({pos:'C', hitRates:{L10:{p:50,t:10}}})")
    assert page.evaluate("filterWrites.length") == 0


def check_mlb(page):
    initial = config(page)
    for kind, field, value in [("pitcher", "p_era", "4"), ("batter", "ba", ".3")]:
        control(page, f"fb-{kind}stat-enabled").check()
        page.locator(f'#filterbuilder-options button[onclick*="{kind}Stat"]').click()
        rows = page.locator(f"#fb-{kind}stat-rows .fb-stat-row")
        rows.first.locator(".fb-stat-field").select_option(field)
        rows.first.locator(".fb-stat-value").fill(value)
        page.locator(f'#filterbuilder-options button[onclick*="{kind}Stat"]').click()
        assert rows.count() == 2
        page.locator(f"#fb-{kind}stat-rows .fb-row-remove").last.click()
        assert rows.count() == 1
    assert config(page) == initial
    action(page, "applyFilterBuilder")
    assert page.evaluate("passesFilterBuilder({pitcherData:{p_era:5},savant:{ba:.32}})")
    assert not page.evaluate("passesFilterBuilder({pitcherData:{p_era:3},savant:{ba:.32}})")
    assert not page.evaluate("passesFilterBuilder({pitcherData:{p_era:5},savant:{ba:.2}})")
    assert page.evaluate("filterWrites.length") == 0


def check_page(browser, origin, page_name, width, full=False):
    page = browser.new_page(viewport={"width": width, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page)
    page.goto(f"{origin}/{page_name}.html")
    page.wait_for_function("document.getElementById('filterbuilder-dd')?.dataset.filterBuilderInit === '1'")
    setup_profile(page)
    original_props = prop_state(page)
    open_window(page)
    panel = page.locator("#filterbuilder-options")
    assert panel.evaluate("el => el.classList.contains('fb-window')")
    assert panel.evaluate("el => el.parentElement === document.body")
    check_layout(page, width)
    ids = panel.locator("[id]").evaluate_all("nodes => nodes.map(node => node.id)")
    assert len(ids) == len(set(ids)), "The shell duplicated original field IDs"

    if full:
        if control(page, "fb-liquidity-enabled").count():
            check_liquidity(page)
        if control(page, "fb-hitrate-enabled").count():
            check_nhl(page)
        elif control(page, "fb-pitcherstat-enabled").count():
            check_mlb(page)
        else:
            control(page, "fb-line-enabled").check()
            control(page, "fb-line-min").fill("100")
            action(page, "applyFilterBuilder")
        check_presets(page)
        assert prop_state(page) == original_props, "Editing the filter window changed prop controls"
        check_layout(page, width)
    panel.locator(".fb-window-body").evaluate("el => el.scrollTop = 0")
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"filter-window-{page_name}-{width}.png"))
    page.keyboard.press("Escape")
    assert not panel.is_visible()
    assert page.locator("#filterbuilder-dd-button").evaluate("el => document.activeElement === el")
    open_window(page)
    page.locator(".fb-close").click()
    assert not panel.is_visible()
    assert page.locator("#filterbuilder-dd-button").evaluate("el => document.activeElement === el")
    open_window(page)
    page.mouse.click(2, 842)
    assert not panel.is_visible()
    open_window(page)
    assert panel.is_visible()
    if width == 390:
        page.set_viewport_size({"width": width, "height": 380})
        page.wait_for_function("document.getElementById('filterbuilder-options').getBoundingClientRect().bottom <= 381")
        check_layout(page, width, 380)
    if page_name == "dingers" and width == 320:
        page.set_viewport_size({"width": width, "height": 568})
        page.wait_for_function("document.getElementById('filterbuilder-options').getBoundingClientRect().bottom <= 569")
        for _ in range(8):
            page.locator('#filterbuilder-options button[onclick*="pitcherStat"]').click()
        check_layout(page, width, 568)
        assert panel.locator(".fb-window-body").evaluate("el => el.scrollHeight > el.clientHeight")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "filter-window-dingers-320-short.png"))
    if page_name == "top_pitches" and width == 1280:
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": width, "height": 568})
        page.evaluate("""() => {
            const trigger = document.getElementById('filterbuilder-dd');
            document.body.appendChild(trigger);
            trigger.style.cssText = 'position:fixed;left:200px;bottom:16px;z-index:9999;';
        }""")
        open_window(page)
        above = """() => document.getElementById('filterbuilder-options').getBoundingClientRect().bottom
            <= document.getElementById('filterbuilder-dd-button').getBoundingClientRect().top - 5"""
        page.wait_for_function(above)
        for _ in range(8):
            page.locator('#filterbuilder-options button[onclick*="pitcherStat"]').click()
        page.wait_for_function(above)
        check_layout(page, width, 568)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "filter-window-top_pitches-above.png"))
    assert not errors, (page_name, width, errors)
    page.close()
    print(f"PASS: {page_name} {width}px: bounds, scroll, pinned footer, dismissal" +
          (", rules, Apply-only state, preset save/load/delete, Clear, prop isolation" if full else ""), flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            for name, width, full in [("atgs", 1280, True), ("atgs", 390, True), ("atgs", 320, False),
                                      ("dingers", 1280, True), ("dingers", 390, True), ("dingers", 320, False),
                                      ("main", 320, True), ("top_pitches", 1280, True), ("top_pitches", 390, True)]:
                check_page(browser, origin, name, width, full)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
