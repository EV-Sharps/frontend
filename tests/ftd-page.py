"""First/last touchdown page integration with isolated API fixtures."""
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass


game_date = (date.today() + timedelta(days=1)).isoformat()


def player(name, prop, liquidity):
    return {
        "player": name, "prop": prop, "dt": game_date, "team": "phi", "opp": "dal",
        "game": "phi @ dal", "pos": "RB", "handicap": 0.5, "under": False,
        "book": "fd", "line": 700, "bookOdds": {"fd": "700/-1000", "dk": "650/-950", "circa": "600/-900", "nv": "680/-980"},
        "liquidity": {"nv": [liquidity, liquidity]}, "logs": [0, 0, 0] if prop == "ftd" else [0, 1, 0],
        "hitRate": 0 if prop == "ftd" else 33, "hitRateLYR": 20, "snaps": ["60%", "65%", "70%"],
        "usage": {"year": 2026, "weeks": [1, 2, 3], "latest_week": 3,
                  "snaps": {"tot": [40, 45, 50], "pct": ["60%", "65%", "70%"]}},
        "oppRank": {"opp-rz-scoring-pct": {"rank": 8}},
        "dvpRank": 6, "dvpAllowed": 0.7, "dvpGames": 3, "dvpContext": True,
    }


payload = {
    "data": [player("saquon barkley", "ftd", 300), player("kenneth gainwell", "ltd", 50),
             player("anytime leak", "attd", 500)],
    "props": ["ftd", "ltd", "attd"], "games": ["phi @ dal"],
    "times": {"phi @ dal": game_date + "T20:20:00-04:00"}, "updated": {},
}
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, view in ((1440, "compact"), (390, "mobile")):
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(5000)
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url))
            page.add_init_script("window.EventSource = undefined;")
            page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
            page.route("**/auth.js", lambda route: route.fulfill(
                body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                content_type="application/javascript"))
            page.route("**/api/**", lambda route: route.fulfill(json=payload))
            page.goto(f"http://localhost:{server.server_port}/ftd.html?view={view}")
            row_count = "document.querySelectorAll('#card-container .data-card').length" if view == "mobile" else "TABLE.getData('active').length"
            page.wait_for_function(f"document.getElementById('data-status')?.hidden === true && {row_count} === 2")
            assert page.title() == "NFL First / Last Touchdown | +EV Sharps"
            assert any("/api/ftd" in url for url in requests), requests
            assert not any("/api/tds" in url for url in requests), requests
            assert page.evaluate("PAGE === 'ftd' && SPORT === 'nfl'")
            assert page.evaluate("RES.data.every(row => ['ftd','ltd'].includes(row.prop))")
            assert page.locator('#prop-options input[type="checkbox"]').evaluate_all("items => items.map(item => item.value).sort()") == ["ftd", "ltd"]
            page.locator("#page-picker-btn").click()
            assert page.locator('#page-picker-tabs .active').get_attribute("data-key") == "nfl"
            ftd_link = page.locator('#page-picker-panel .pp-page-btn').filter(has=page.locator('.pp-star[data-val="ftd"]'))
            assert ftd_link.locator('.pp-label').inner_text() == "First / Last TD"
            assert "current-page" in ftd_link.get_attribute("class")
            page.locator("#page-picker-btn").click()
            preloads = page.evaluate("getTopDevigs().map(item => item.prop)")
            assert preloads and set(preloads) <= {"ftd", "ltd"}, set(preloads)

            page.evaluate("openOverlay()")
            assert page.locator("#custom_snaps").count() == 1
            assert page.locator("#custom_usage_snaps_tot").count() == 1
            assert page.locator("#custom_dvpRank").count() == 1
            assert page.locator("#custom_dvpAllowed").count() == 1
            page.evaluate("closeOverlay()")

            page.locator("#filterbuilder-dd-button").click()
            page.locator("#fb-liquidity-over-enabled").check()
            page.locator("#fb-liquidity-over-amount").fill("100")
            page.locator("#fb-liquidity-over-book").select_option("nv")
            page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()
            page.wait_for_function(f"{row_count} === 1")
            if view == "mobile":
                assert "Saquon Barkley" in page.locator("#card-container .data-card").inner_text()
            else:
                assert page.evaluate("TABLE.getData('active')[0].prop") == "ftd"
            if not page.locator('#filterbuilder-options button[onclick="clearFilterBuilder()"]').is_visible():
                page.locator("#filterbuilder-dd-button").click()
            page.locator('#filterbuilder-options button[onclick="clearFilterBuilder()"]').click()
            page.wait_for_function(f"{row_count} === 2")
            page.locator("#filterbuilder-dd-button").click()

            if view == "mobile":
                cards = page.locator("#card-container .data-card")
                assert cards.count() == 2
                assert cards.first.is_visible()
                cards.first.locator(".card-arrow-container").click()
                assert "W3" in cards.first.locator(".snap-share-pill").inner_text()
                assert cards.first.locator(".trend-pill").count() >= 4
                first_scorer = cards.filter(has_text="Saquon Barkley")
                assert "0%" in first_scorer.locator(".trend-pill").first.inner_text()
                page.evaluate("changeView('compact')")

            row = page.locator("#table .tabulator-row").first
            row.locator('[tabulator-field="ev"]').click()
            history = page.locator("#nfl-history-dialog")
            assert history.is_visible()
            assert history.locator('[data-history-view="due"]').count() == 0
            history.get_by_role("button", name="Play card", exact=True).click()
            modal = page.locator("#card-modal-overlay")
            assert modal.is_visible()
            assert modal.locator(".data-card.expanded").count() == 1
            assert "6th" in row.locator('[tabulator-field="dvpRank"]').inner_text()
            assert modal.locator(".player-prop-row").evaluate("element => getComputedStyle(element).paddingRight") == "48px"
            page.locator("#card-modal-close").click()
            assert not modal.is_visible()
            row.locator('[tabulator-field="ev"]').click()
            history.get_by_role("button", name="Play card", exact=True).click()
            page.keyboard.press("Escape")
            assert not modal.is_visible()
            row.locator('[tabulator-field="ev"]').click()
            history.get_by_role("button", name="Play card", exact=True).click()
            modal.click(position={"x": 2, "y": 2})
            assert not modal.is_visible()
            assert not errors, errors
            print(f"FTD {width}px: dedicated feed, FTD/LTD isolation, navigation, preloads, Customize, liquidity filters, cards and closing passed")
            page.close()
        browser.close()
finally:
    server.shutdown()
