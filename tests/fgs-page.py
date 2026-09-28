"""Offline browser integration for the separate first/last goalscorer page."""
from copy import deepcopy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def scorer(player, prop, odds, liquidity):
    return {
        "player": player, "prop": prop, "handicap": "0.5", "under": False,
        "ouIdx": 0, "sport": "nhl", "team": "tor", "opp": "bos",
        "game": "tor @ bos", "dt": "2099-10-01", "pos": "C", "avgTOI": 21,
        "teamTotal": 3.15, "ppLine": "1", "oppRank": 20, "dvpRank": 18,
        "goalie": "jeremy swayman", "goalieGSAA": 2.4, "goalieSV": 0.921,
        "book": "fd", "line": odds, "bookOdds": {
            "fd": f"{odds}/-1800", "dk": f"{odds-25}/-1800",
            "pn": "700/-1100", "circa": "720/-1100", "px": "750/-1100",
        },
        "liquidity": {"px": [liquidity, 10]}, "links": {},
        "logs": [0, 0, 1, 0, 0], "hitRate": 20, "hitRateLYR": 12,
        "hitRates": {"szn": {"w": 1, "t": 5, "p": 20}},
        # Anytime-goal due data must not become a first-goal statistic.
        "due": {"g": {"streak": 2, "med": 3, "z_median": 0.5}},
    }


payload = {
    "data": [scorer("auston matthews", "fgs", 900, 100),
             scorer("william nylander", "fgs", 1100, 25),
             scorer("auston matthews", "lgs", 1000, 200),
             scorer("anytime fixture", "atgs", 150, 500)],
    "props": ["fgs"], "games": ["tor @ bos"], "updated": {},
    "times": {"tor @ bos": "2099-10-01T23:00:00Z"},
}
record_script = """
let RECORD_UPD = '2026-09-28T12:00:00Z';
let RECORD = {};
for (const method of ['worst', 'probit']) {
    RECORD[method] = {best: {}};
    for (const prop of ['fgs', 'lgs', 'atgs', 'sog']) {
        RECORD[method].best[prop+'-vs-pn+circa'] = {
            All: {wins: 10, losses: 40, roi: 5, kelly_roi: 4, profit: 2.5, kelly: 2}
        };
    }
}
"""

server = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for width, view in [(1440, "compact"), (390, "mobile")]:
            page = browser.new_page(viewport={"width": width, "height": 900})
            errors, requests = [], []
            response = {"payload": deepcopy(payload)}
            page.on("pageerror", lambda error: errors.append(error.stack))
            page.set_default_timeout(5000)
            page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
            page.route("**/auth.js", lambda route: route.fulfill(
                body=Path("auth.js").read_text(encoding="utf-8").replace(
                    "let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                content_type="application/javascript"))
            page.route("**/record_nhl.js", lambda route: route.fulfill(
                body=record_script, content_type="application/javascript"))

            def api(route):
                requests.append(route.request.url)
                route.fulfill(json=response["payload"])

            page.route("**/api/**", api)
            url = f"http://localhost:{server.server_port}/fgs.html?view={view}&devig=pn-circa&weight=1-1"
            page.goto(url, wait_until="load")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            assert any("/api/fgs" in request for request in requests), requests
            assert page.title() == "NHL First / Last Goalscorer | +EV Sharps"
            assert page.evaluate("PAGE") == "fgs"
            assert page.evaluate("SPORT") == "nhl"
            assert page.evaluate("RES.data.length") == 3
            assert page.evaluate("RES.props.slice().sort()") == ["fgs", "lgs"]
            assert page.evaluate("getTopDevigs('best').map(d => d.prop).sort()") == ["fgs", "lgs"]
            assert page.evaluate("Object.keys(buildFGSSeasonRecord().worst.best).sort()") == [
                "fgs-vs-pn+circa", "lgs-vs-pn+circa"]
            assert not page.evaluate("TABLE.getColumn('due.g.streak')")
            assert page.locator("#fb-liquidity-ev-enabled").count() == 1

            page.locator("#page-picker-btn").evaluate("el => el.click()")
            assert page.locator("#page-picker-grid .current-page .pp-star").get_attribute("data-val") == "fgs"
            page.locator("#page-picker-btn").evaluate("el => el.click()")

            page.evaluate("openOverlay()")
            assert page.locator("#custom_teamTotal").count() == 1
            page.locator("#custom-view-select").select_option("compact")
            page.evaluate("closeOverlay()")
            page.wait_for_function("TABLE.getData('active').length === 3")
            assert not page.evaluate("TABLE.getHeaderFilters().length")
            page.locator(".tabulator-row .tabulator-cell[tabulator-field='player']").first.click()
            assert page.locator("#card-modal-overlay").evaluate("el => el.classList.contains('open')")
            assert page.locator("#card-modal-inner .data-card").count() == 1
            assert page.locator("#card-modal-inner .player-prop-row").evaluate("el => getComputedStyle(el).paddingRight") == "48px"
            page.keyboard.press("Escape")
            assert not page.locator("#card-modal-overlay").evaluate("el => el.classList.contains('open')")

            page.evaluate("openOverlay()")
            page.locator("#custom-view-select").select_option(view)
            page.evaluate("closeOverlay()")
            page.locator("#filterbuilder-dd-button").click()
            page.locator("#fb-liquidity-ev-enabled").check()
            page.locator("#fb-liquidity-ev-book").select_option("px")
            page.locator("#fb-liquidity-ev-amount").fill("50")
            page.locator("#filterbuilder-options button", has_text="Apply").click()
            if view == "mobile":
                page.wait_for_function("document.querySelectorAll('#card-container .data-card').length === 2")
                assert "Nylander" not in page.locator("#card-container").inner_text()
            else:
                page.wait_for_function("TABLE.getData('active').length === 2")
            page.locator("#filterbuilder-options button", has_text="Clear").click()
            if view == "mobile":
                page.wait_for_function("document.querySelectorAll('#card-container .data-card').length === 3")
            else:
                page.wait_for_function("TABLE.getData('active').length === 3")

            response["payload"] = {**payload, "data": [], "games": [], "props": []}
            page.goto(url, wait_until="load")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            assert page.evaluate("TABLE.getData().length") == 0
            assert not errors, errors
            print(f"FGS {width}px: endpoint, FGS/LGS rows, presets, Customize, card, filters and empty state passed")
            page.close()
        browser.close()
finally:
    server.shutdown()
