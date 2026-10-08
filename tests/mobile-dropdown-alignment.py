"""Offline mobile dropdown preference checks (requires Python Playwright)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MENUS = [
    ("#page-picker-btn", "#page-picker-panel"),
    ("#book-filter-button", "#book-options"),
    ("#prop-dd-button", "#prop-options"),
    ("#game-dd-button", "#game-options"),
    ("#required-button", "#required-options"),
    ("#exclude-dd .chkdd-btn", '.chkdd-menu[aria-label="Exclude books"]'),
    ("#range-btn", "#range-panel"),
    ("#filterbuilder-dd-button", "#filterbuilder-options"),
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def mock_page(page):
    page.set_default_timeout(5000)
    page.add_init_script("window.EventSource = undefined;")
    page.route("https://**/*", lambda route: route.fulfill(
        body="", content_type="application/javascript"))
    page.route("**/auth.js", lambda route: route.fulfill(
        body=(ROOT / "auth.js").read_text(encoding="utf-8").replace(
            "let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
        content_type="application/javascript"))
    page.route("**/record_nhl.js", lambda route: route.fulfill(
        body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};",
        content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json={
        "data": [], "props": ["atgs"], "games": ["tor @ bos"],
        "updated": {}, "record": {}, "times": {"tor @ bos": "2099-10-01T23:00:00Z"},
    }))


def ready(page):
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")


def check_menus(page, alignment, width):
    for button_selector, panel_selector in MENUS:
        button = page.locator(button_selector)
        panel = page.locator(panel_selector)
        button.click()
        assert panel.is_visible(), (button_selector, alignment, width)
        bounds = panel.bounding_box()
        assert bounds["x"] >= 7, (panel_selector, bounds)
        assert bounds["x"] + bounds["width"] <= width - 7, (panel_selector, bounds)
        if width <= 600:
            gap = bounds["x"] if alignment == "left" else width - bounds["x"] - bounds["width"]
            assert abs(gap - 8) <= 1, (panel_selector, alignment, width, bounds)
        else:
            anchor = button.bounding_box()
            expected = max(8, min(anchor["x"], width - bounds["width"] - 8))
            assert abs(bounds["x"] - expected) <= 1, (panel_selector, alignment, width, anchor, bounds)
        # Clicking the toggle again is shared by all menu types and leaves each closed.
        button.click()
        assert panel.is_hidden(), panel_selector


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with TemporaryDirectory(prefix="ev-dropdown-test-") as temporary, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=[
                "--disable-logging", f"--log-file={Path(temporary) / 'chromium.log'}",
            ])
            for width, view in [(390, "compact"), (390, "mobile"), (600, "compact"),
                                (601, "mobile"), (1440, "compact"), (1440, "mobile")]:
                page = browser.new_page(viewport={"width": width, "height": 900})
                mock_page(page)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://localhost:{server.server_port}/atgs.html?view={view}&devig=circa&weight=1&method=mult")
                ready(page)
                assert page.evaluate("getMobileDropdownAlignment()") == "right"
                check_menus(page, "right", width)
                # Account hydration is read when opening, without requiring a reload.
                page.evaluate("""() => {
                    CURR_USER = {id: 'dropdown-preference-test', metadata: {mobile_dropdown_alignment: 'left'}};
                    cacheProfile(CURR_USER);
                }""")
                check_menus(page, "left", width)
                page.reload()
                ready(page)
                assert page.evaluate("getMobileDropdownAlignment()") == "left"
                check_menus(page, "left", width)
                page.evaluate("""() => {
                    CURR_USER.metadata.mobile_dropdown_alignment = 'right';
                    cacheProfile(CURR_USER);
                }""")
                page.reload()
                ready(page)
                assert page.evaluate("getMobileDropdownAlignment()") == "right"
                check_menus(page, "right", width)
                page.evaluate("CURR_USER.metadata.mobile_dropdown_alignment = 'invalid'")
                assert page.evaluate("getMobileDropdownAlignment()") == "right"
                assert not errors, (width, view, errors)
                print(f"PASS {width}px {view}: eight menus, default/right/left, cached reloads and desktop anchoring", flush=True)
                page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
