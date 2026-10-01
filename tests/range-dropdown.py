"""Range dismisses outside clicks without interrupting edits, Apply or Clear."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def payload(name):
    prop = "atgs" if name == "atgs" else "sog"
    row = {
        "player": "auston matthews", "team": "tor", "opp": "bos", "game": "tor @ bos",
        "prop": prop, "pos": "C", "under": False, "ouIdx": 0,
        "handicap": "0.5" if name == "atgs" else "2.5", "dt": "2099-10-01",
        "bookOdds": {"fd": "200/-250", "circa": "140/-160"}, "book": "fd", "line": 200,
        "logs": [1, 0, 3], "hitRate": 33, "hitRateLYR": 40, "hitRateCareer": 40,
        "hitRates": {"szn": {"w": 1, "t": 3, "p": 33}},
        "avgTOI": 21, "teamTotal": 3.1, "ppLine": "1", "oppRank": 10, "dvpRank": 15,
        "goalie": "jeremy swayman", "goalieGSAA": 2.4, "goalieSV": .921,
        "liquidity": {}, "links": {},
    }
    return {"data": [row], "props": [prop], "games": [row["game"]], "updated": {},
            "times": {row["game"]: "2099-10-01T23:00:00Z"}}


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ["atgs", "nhl"]:
            for width in [1440, 390]:
                page = browser.new_page(viewport={"width": width, "height": 900})
                page.set_default_timeout(5000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.add_init_script("window.EventSource = undefined;")
                page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
                page.route("**/auth.js", lambda route: route.fulfill(
                    body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                    content_type="application/javascript"))
                page.route("**/record_nhl.js", lambda route: route.fulfill(
                    body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type="application/javascript"))
                page.route("**/api/**", lambda route: route.fulfill(json=payload(name)))
                view = "mobile" if width < 600 else "compact"
                page.goto(f"http://localhost:{server.server_port}/{name}.html?view={view}&devig=circa&weight=1&method=mult")
                page.wait_for_function("document.getElementById('data-status')?.hidden === true")
                button, panel = page.locator("#range-btn"), page.locator("#range-panel")
                button.click()
                assert panel.is_visible()
                assert button.get_attribute("aria-expanded") == "true"
                page.locator("#range-min").fill("100")
                page.locator("#range-max").click()
                assert panel.is_visible(), "Input interaction must not dismiss Range"
                page.locator("#title").click(position={"x": 1, "y": 1})
                assert panel.is_hidden(), "Ordinary outside clicks dismiss Range"
                assert button.get_attribute("aria-expanded") == "false"
                button.click()
                assert page.locator("#range-min").input_value() == "100", "Dismissal keeps unfinished edits"
                page.locator("#game-dd-button").click()
                assert panel.is_hidden(), "Outside dropdown buttons stop bubbling but must still dismiss Range"
                page.locator("#game-dd-button").click()
                button.click()
                button.click()
                assert panel.is_hidden(), "Range button still toggles closed"
                button.click()
                page.locator("#range-min").press("Escape")
                assert panel.is_hidden()
                assert button.evaluate("element => document.activeElement === element")
                button.click()
                page.locator("#range-max").fill("250")
                panel.get_by_role("button", name="Apply", exact=True).click()
                assert panel.is_hidden()
                assert page.evaluate("[MIN, MAX]") == ["100", "250"]
                assert button.inner_text() == "100 → 250"
                button.click()
                panel.get_by_role("button", name="Clear", exact=True).click()
                assert panel.is_hidden()
                assert page.evaluate("[MIN, MAX]") == ["", ""]
                assert button.inner_text() == "Any"
                assert button.get_attribute("aria-expanded") == "false"
                assert not errors, errors
                print(f"PASS {name} {width}px: outside, inputs, toggle, Escape, Apply and Clear")
                page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
