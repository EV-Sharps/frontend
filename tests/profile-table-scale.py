"""Offline Profile table-default checks: python -B tests/profile-table-scale.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
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


def mock_page(page, metadata):
    page.set_default_timeout(10000)
    page.add_init_script("localStorage.setItem('odds-table-scale', '60');")
    page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
    auth = (ROOT / "auth.js").read_text(encoding="utf-8") + """
        window.profileWrites = [];
        window.profileSaveError = false;
        handleSession = async () => {
            ACCESS_TOKEN = 'offline-profile-fixture';
            CURR_SESSION = {user: {id: 'profile-fixture', email: 'scale@example.test', identities: []}};
            CURR_USER = {id: 'profile-fixture', tier: 'sharp', metadata: FIXTURE_METADATA};
            SB = {from(table) { return {update(value) { return {async eq(key, id) {
                window.profileWrites.push({table, key, id, value: structuredClone(value)});
                return {error: window.profileSaveError ? {message: 'Offline failure fixture'} : null};
            }}; }}; }};
        };
    """.replace("FIXTURE_METADATA", json.dumps(metadata))
    page.route("**/auth.js", lambda route: route.fulfill(body=auth, content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json={}))


def check_page(browser, origin, metadata, expected, width, full=False):
    page = browser.new_page(viewport={"width": width, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page, metadata)
    page.goto(f"{origin}/profile.html")
    page.wait_for_function("document.body.dataset.profileState === 'ready'")
    select = page.locator("#profile-table-scale")
    save, reset = page.locator("#profile-save"), page.locator("#profile-reset")
    assert select.input_value() == str(expected)
    assert select.locator("option").evaluate_all("nodes => nodes.map(n => Number(n.value))") == page.evaluate("ODDS_TABLE_SCALES")
    assert save.is_disabled() and reset.is_disabled()
    assert page.evaluate("localStorage.getItem('odds-table-scale')") == "60"
    assert "unless" in page.locator("#profile-table-scale-help").inner_text()
    select.scroll_into_view_if_needed()
    bounds = select.bounding_box()
    assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1, bounds
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    if full:
        select.select_option("80")
        assert save.is_enabled() and reset.is_enabled()
        assert "unsaved changes" in page.locator("#profile-save-status").inner_text()
        reset.click()
        assert select.input_value() == str(expected)
        assert save.is_disabled() and reset.is_disabled()
        assert page.evaluate("profileWrites.length") == 0
        select.select_option("80")
        save.click()
        page.wait_for_function("document.getElementById('profile-save-status').textContent === 'All preferences saved.'")
        written = page.evaluate("profileWrites[0]")
        assert written["table"] == "profiles" and written["key"] == "id" and written["id"] == "profile-fixture"
        saved = written["value"]["metadata"]
        assert saved["table_scale"] == 80 and isinstance(saved["table_scale"], int)
        assert saved["table_scales"] == metadata["table_scales"]
        assert saved["custom_fixture"] == metadata["custom_fixture"]
        assert page.evaluate("CURR_USER.metadata.table_scale") == 80
        assert page.evaluate("JSON.parse(localStorage.getItem('cached_profile')).metadata.table_scale") == 80
        assert save.is_disabled() and reset.is_disabled()
        assert page.evaluate("localStorage.getItem('odds-table-scale')") == "60"
        select.select_option("125")
        reset.click()
        assert select.input_value() == "80"
        # A rejected save keeps the prior account preference and allows retry/reset.
        page.evaluate("window.profileSaveError = true")
        select.select_option("60")
        save.click()
        page.wait_for_function("document.getElementById('profile-save-status').dataset.tone === 'error'")
        assert page.evaluate("CURR_USER.metadata.table_scale") == 80
        assert select.input_value() == "60" and save.is_enabled() and reset.is_enabled()
        reset.click()
        assert select.input_value() == "80"
        # Even an injected option cannot submit a value outside the shared allowed set.
        select.evaluate("el => { el.add(new Option('999%', '999')); el.value = '999'; el.dispatchEvent(new Event('change', {bubbles: true})); }")
        count = page.evaluate("profileWrites.length")
        save.click()
        assert page.locator("#profile-save-status").inner_text() == "Choose a valid default table scale."
        assert page.evaluate("profileWrites.length") == count
        assert page.evaluate("CURR_USER.metadata.table_scales") == metadata["table_scales"]
        reset.click()
        assert select.input_value() == "80" and select.locator('option[value="999"]').count() == 0
    select.scroll_into_view_if_needed()
    if width == 320:
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "profile-table-scale-320.png"))
    assert not errors, errors
    page.close()
    print(f"PASS: Profile {width}px default {expected}%" + (", dirty/reset/save/failure/validation/override preservation" if full else ", saved value and layout"), flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            metadata = {"state": "NJ", "unit_size": 100, "table_scales": {"nba": 75, "atgs": 110},
                        "custom_fixture": {"preserve": True}}
            check_page(browser, origin, metadata, 100, 1280, full=True)
            check_page(browser, origin, {**metadata, "table_scale": 75}, 75, 320)
            check_page(browser, origin, {**metadata, "table_scale": 999}, 100, 1280)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
