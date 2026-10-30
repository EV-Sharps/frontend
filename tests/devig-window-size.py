"""Offline account-wide devig window size checks: python -B tests/devig-window-size.py."""
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import importlib.util
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("devig_window", ROOT / "tests/devig-window.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def open_window(page, origin, name="atgs"):
    page.goto(f"{origin}/{name}.html?view=compact")
    page.wait_for_function("typeof renderDevigOptions === 'function'")
    page.locator("#devig-button").click()
    assert page.locator("#devig-modal").is_visible()


def bounds(page):
    panel = page.locator("#devig-modal .devig-panel")
    box = panel.bounding_box()
    view = page.viewport_size
    assert box["x"] >= 0 and box["y"] >= 0, box
    assert box["x"] + box["width"] <= view["width"] + 1, box
    assert box["y"] + box["height"] <= view["height"] + 1, box
    assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    for selector in ["#devig-window-size", "#close-devig-modal", "#devig-search", "#add-custom-devig", "#load-predefined-devigs"]:
        rect = page.locator(selector).bounding_box()
        assert rect and rect["x"] >= box["x"] and rect["y"] >= box["y"], (selector, rect)
        assert rect["x"] + rect["width"] <= box["x"] + box["width"] + 1, (selector, rect)
        assert rect["y"] + rect["height"] <= box["y"] + box["height"] + 1, (selector, rect)
    return box


def choose(page, value):
    page.locator("#devig-window-size").select_option(value)
    page.wait_for_function("!document.getElementById('devig-window-size').disabled")
    assert page.locator("#devig-modal").get_attribute("data-window-size") == value
    return bounds(page)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(helper.QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            helper.mock_page(page)
            open_window(page, origin)
            helper.setup_profile(page)
            page.evaluate("applyDevigWindowSize(); cacheProfile(CURR_USER)")
            original = page.evaluate("structuredClone(CURR_USER.metadata)")
            large = bounds(page)
            medium = choose(page, "medium")
            small = choose(page, "small")
            assert large["width"] > medium["width"] > small["width"]
            assert large["height"] > medium["height"] > small["height"], (large, medium, small)
            metadata = page.evaluate("CURR_USER.metadata")
            assert metadata == {**original, "devig_window_size": "small"}
            assert page.evaluate("JSON.parse(localStorage.getItem('cached_profile')).metadata.devig_window_size") == "small"
            assert len(page.evaluate("devigWrites")) == 2
            assert "across all sports" in page.locator("#devig-window-size-status").inner_text()
            page.screenshot(path=str(Path(tempfile.gettempdir()) / "devig-size-small.png"))
            # Search and chosen category survive resizing, and the footer stays pinned.
            helper.tab(page, "single")
            page.locator("#devig-search").fill("FanDuel")
            choose(page, "medium")
            assert page.locator("#devig-search").input_value() == "FanDuel"
            assert page.locator('.dv-tab[data-category="single"]').get_attribute("aria-pressed") == "true"
            choose(page, "small")
            page.locator("#devig-search").fill("")
            helper.tab(page, "all")
            footer = page.locator(".dv-footer").bounding_box()
            page.locator("#devig-options-container").evaluate("el => el.scrollTop = el.scrollHeight")
            assert page.locator(".dv-footer").bounding_box() == footer
            # The cached account setting loads on another sport and on reload.
            for name in ["nfl", "nba", "mlb"]:
                open_window(page, origin, name)
                assert page.locator("#devig-window-size").input_value() == "small"
                assert bounds(page)["width"] == small["width"]
            page.reload()
            page.locator("#devig-button").click()
            assert page.locator("#devig-window-size").input_value() == "small"
            # A fresh browser gets the same value from its profile; guest preferences don't leak.
            fresh = browser.new_page(viewport={"width": 1280, "height": 900})
            helper.mock_page(fresh)
            open_window(fresh, origin)
            assert fresh.locator("#devig-window-size").input_value() == "large"
            fresh.evaluate("metadata => { CURR_USER = {id:'fresh', metadata}; hydrateAfterProfileLoad(); }", metadata)
            assert fresh.locator("#devig-window-size").input_value() == "small"
            fresh.evaluate("CURR_USER = {id:'other',metadata:{}}; hydrateAfterProfileLoad()")
            assert fresh.locator("#devig-window-size").input_value() == "large"
            fresh.close()
            # A failed account save returns to the prior size and never caches the failed value.
            page.evaluate("""() => {
                CURR_SESSION = {user:{id:CURR_USER.id}};
                SB = {from(){ return {update(){ return {eq(){return new Promise(resolve=>window.finishSizeSave=resolve)}}}}}};
            }""")
            page.locator("#devig-window-size").select_option("large")
            page.wait_for_function("typeof finishSizeSave === 'function'")
            assert page.locator("#devig-window-size").is_disabled()
            assert page.evaluate("CURR_USER.metadata.devig_window_size") == "small"
            page.evaluate("finishSizeSave({error:{message:'Fixture failure'}})")
            page.wait_for_function("!document.getElementById('devig-window-size').disabled")
            assert page.locator("#devig-window-size").input_value() == "small"
            assert page.locator("#devig-window-size-status").get_attribute("data-tone") == "error"
            assert page.evaluate("JSON.parse(localStorage.getItem('cached_profile')).metadata.devig_window_size") == "small"
            assert not errors, errors
            page.close()
            print("PASS: sizes, pinned controls, profile save/reload/cross-sport/new browser, account isolation and failed-save rollback", flush=True)
            for width, height in [(320, 844), (390, 568), (700, 390)]:
                page = browser.new_page(viewport={"width": width, "height": height})
                helper.mock_page(page)
                open_window(page, origin)
                for value in ["small", "medium", "large"]:
                    choose(page, value)
                choose(page, "small")
                page.screenshot(path=str(Path(tempfile.gettempdir()) / f"devig-size-{width}.png"))
                page.reload()
                page.locator("#devig-button").click()
                assert page.locator("#devig-window-size").input_value() == "small"
                page.keyboard.press("Escape")
                assert page.locator("#devig-modal").is_hidden()
                page.close()
                print(f"PASS: {width}x{height} all sizes, controls, guest persistence and dismissal", flush=True)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
