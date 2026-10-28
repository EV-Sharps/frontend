"""Offline Order books integration: python -B tests/prediction-depth.py."""
from copy import deepcopy
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import mkdtemp
from threading import Thread
import re

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 28, 18, tzinfo=timezone.utc)
STAMP = "2026-10-28T17:59:00Z"


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def fixture(sport="nba", prop="pts", line=24.5):
    selected = {
        "player": "depth alpha", "sport": sport, "prop": prop, "handicap": line,
        "game": "tor @ bos", "gameId": "fixture-game", "dt": "2026-10-28",
        "team": "tor", "opp": "bos", "pos": "C", "under": False,
        "book": "px", "line": 1200, "ev": 5, "fairVal": 1000, "kelly": 0.2,
        "bookOdds": {"nv": "1100/-1200", "px": "1200/-1300", "kal": "900/-1100", "poly": "1000/-1250"},
        "liquidity": {"nv": [40, 90], "px": [100, 120], "kal": [25, 15], "poly": [75, 80]},
        "links": {}, "logs": [], "bvtLogs": [], "awayLogs": [], "homeLogs": [],
        "hitRates": {}, "hitRate": 0, "hitRateLYR": 0,
    }
    rows = [selected, {**deepcopy(selected), "under": True},
            {**deepcopy(selected), "handicap": float(line) + 1, "bookOdds": {"px": "1500/-1700"}, "liquidity": {"px": [50, 60]}},
            {**deepcopy(selected), "prop": "reb", "handicap": 7.5, "bookOdds": {"kal": "200/-250"}, "liquidity": {"kal": [35, 45]}}]
    # These tempting prices must never cross player, prop, game, date, or access boundaries.
    for change in [{"player": "other player"}, {"game": "bos @ tor"}, {"gameId": "other-game"},
                   {"dt": "2026-10-29"}, {"sport": "nfl"}, {"blurred": True}]:
        rows.append({**deepcopy(selected), **change, "bookOdds": {"px": "9999/-10000"}, "liquidity": {"px": [9999, 9999]}})
    return {"data": rows, "games": [selected["game"]], "props": [prop, "reb"],
            "times": {selected["game"]: "2026-10-28T23:00:00Z"},
            "updated": {book: STAMP for book in ["nv", "px", "kal", "poly"]}}


def with_novig(payload):
    row = payload["data"][0]
    payload["novigDepth"] = {row["game"]: {row["player"]: {
        "schema_version": 1, "market_id": "fixture-market", "updated": STAMP,
        "expires_at": "2026-10-28T18:04:00Z", "starts_at": payload["times"][row["game"]],
        "sides": [
            {"side": "over", "orders": [{"probability": "0.075", "contracts": 1407}], "truncated": False},
            {"side": "under", "orders": [{"probability": "0.92", "contracts": 9630},
                {"probability": "0.915", "contracts": 98074}, {"probability": "0.91", "contracts": 100000}], "truncated": True},
        ],
    }}}
    return payload


def new_page(browser, base, name):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(8000)
    page.clock.set_fixed_time(NOW)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("window.EventSource = undefined;")
    page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
    page.route("**/auth.js", lambda route: route.fulfill(
        body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
        content_type="application/javascript"))
    page.route(re.compile(r"/record(?:_[a-z]+)*\.js(?:\?.*)?$"), lambda route: route.fulfill(
        body="var RECORD_UPD='';var RECORD={worst:{best:{}},mult:{best:{}}};", content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json={
        "data": [], "games": [], "props": [], "updated": {}, "record": {}, "times": {}}))
    page.goto(f"{base}/{name}.html?view=table")
    page.wait_for_function("document.getElementById('data-status')?.hidden === true && typeof TABLE !== 'undefined' && TABLE")
    # Keep the API's periodic empty fixture from replacing the explicitly installed live payload.
    auto = page.locator(".table-refresh-auto input")
    if auto.count():
        auto.uncheck()
    return page, errors


def install_rows(page, payload):
    page.evaluate("""async payload => {
        RES = null;
        TABLE.clearFilter(true); TABLE.clearSort();
        TABLE.setColumns([
            {title:'Player',field:'player',width:240,formatter:basePlayerFormatter,
                formatterParams:{sport:payload.data[0].sport,noProp:true,fullName:true}},
            {title:'EV',field:'ev',width:80}
        ]);
        await TABLE.setData([payload.data[0]]);
        RES = payload;
        UPDATED[PAGE] = payload.updated;
    }""", payload)


def side_panel(page, side="over"):
    return page.locator(f'section[data-depth-side="{side}"]')


def prices(page, side="over"):
    return side_panel(page, side).locator(".prediction-depth-odds").all_text_contents()


def expect_prices(page, values, side="over"):
    expect(side_panel(page, side).locator(".prediction-depth-odds")).to_have_text(values)


def check_layout(page, dialog, artifacts, stem):
    for width in [1280, 390, 320]:
        page.set_viewport_size({"width": width, "height": 844})
        for selector in [dialog, ".prediction-depth", ".prediction-depth-controls", "section[data-depth-side]", ".prediction-depth-levels"]:
            for item in page.locator(selector).all():
                box = item.bounding_box()
                assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, (selector, box)
                assert item.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), selector
        yes, no = side_panel(page), side_panel(page, "under")
        expect(yes).to_be_visible()
        expect(no).to_be_visible()
        expect(yes.locator("h4")).to_have_text("Yes")
        expect(no.locator("h4")).to_have_text("No")
        yes_box, no_box = yes.bounding_box(), no.bounding_box()
        assert abs(yes_box["y"] - no_box["y"]) <= 1, (width, yes_box, no_box)
        assert no_box["x"] >= yes_box["x"] + yes_box["width"] - 1, (width, yes_box, no_box)
        box = page.locator(dialog).bounding_box()
        assert box["y"] >= -1 and box["y"] + box["height"] <= 845, box
        for button in page.locator(f"{dialog} [role=tab]:visible").all():
            box = button.bounding_box()
            assert box["x"] >= -1 and box["x"] + box["width"] <= width + 1, box
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        page.screenshot(path=str(artifacts / f"{stem}-{width}.png"))


def comparison_checks(browser, base, artifacts):
    page, errors = new_page(browser, base, "nba")
    payload = fixture()
    install_rows(page, payload)
    page.locator("#table .player-lines-trigger").click()
    expect(page.locator("#player-lines-dialog")).to_be_visible()
    assert page.evaluate("typeof PredictionDepth") == "undefined", "Depth code should load on demand"
    page.locator("#player-lines-tab-depth").click()
    expect_prices(page, ["+1,200", "+1,100", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,200", "-1,250", "-1,300"], "under")
    expect(side_panel(page).locator(".prediction-depth-total strong").first).to_have_text("$240")
    expect(side_panel(page, "under").locator(".prediction-depth-total strong").first).to_have_text("$305")
    assert side_panel(page).locator(".prediction-depth-source > span").all_text_contents() == ["PX", "NV", "POLY", "KAL"]
    expect(side_panel(page)).to_contain_text("Over 24.5")
    expect(side_panel(page, "under")).to_contain_text("Under 24.5")
    check_layout(page, "#player-lines-dialog", artifacts, "nba-order-books")
    page.get_by_label("Order book line", exact=True).select_option("25.5")
    expect_prices(page, ["+1,500"])
    expect_prices(page, ["-1,700"], "under")
    expect(side_panel(page)).to_contain_text("Over 25.5")
    expect(side_panel(page, "under")).to_contain_text("Under 25.5")
    page.locator("#player-lines-prop").select_option("reb")
    expect_prices(page, ["+200"])
    expect_prices(page, ["-250"], "under")
    assert page.get_by_label("Order book line", exact=True).input_value() == "7.5"
    page.locator("#player-lines-prop").select_option("pts")
    expect_prices(page, ["+1,200", "+1,100", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,200", "-1,250", "-1,300"], "under")

    # A live payload change must update the open panel, not reuse the clicked row snapshot.
    page.evaluate("""() => {
        RES.data = RES.data.map(row => ({...row,bookOdds:{...row.bookOdds,px:'1300/-1400'}}));
        window.dispatchEvent(new Event('odds-rendered'));
    }""")
    expect_prices(page, ["+1,300", "+1,100", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,200", "-1,250", "-1,400"], "under")
    page.evaluate("RES.data = []; window.dispatchEvent(new Event('odds-rendered'))")
    for side in ["over", "under"]:
        expect(side_panel(page, side).locator(".prediction-depth-empty")).to_contain_text("no longer in the current data")
        assert prices(page, side) == []
    page.locator("#player-lines-tab-lines").click()
    assert page.locator(".prediction-depth").count() == 0
    page.locator(".player-lines-close").click()
    page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
    assert page.locator(".prediction-depth").count() == 0
    assert not errors, errors
    page.close()
    print("NBA player click: lazy loading, sorting, both sides, line/prop isolation, refresh/removal, cleanup and 1280/390/320 layout passed.")


def history_checks(browser, base, artifacts):
    page, errors = new_page(browser, base, "atgs")
    payload = with_novig(fixture("nhl", "atgs", "0.5"))
    install_rows(page, payload)
    page.locator('#table .tabulator-cell[tabulator-field="ev"]').click()
    expect(page.locator("#nhl-history-dialog")).to_be_visible()
    page.locator('[data-history-view="orderbooks"]').click()
    expect_prices(page, ["+1,200", "+1,150", "+1,076", "+1,011", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,233", "-1,250", "-1,300"], "under")
    assert side_panel(page).locator(".prediction-depth-source > span").all_text_contents().count("NV") == 3
    assert side_panel(page, "under").locator(".prediction-depth-source > span").all_text_contents().count("NV") == 1
    assert "+1,100" not in prices(page), "Full NV depth must replace the saved top quote"
    expect(side_panel(page).locator(".prediction-depth-total strong").first).to_have_text("$381")
    expect(side_panel(page, "under").locator(".prediction-depth-total strong").first).to_have_text("$228")
    expect(side_panel(page).locator(".prediction-depth-coverage")).to_contain_text("Novig: top 20 levels")
    expect(side_panel(page, "under").locator(".prediction-depth-coverage")).to_contain_text("Novig: available depth")
    expect(side_panel(page)).to_contain_text("Goal")
    expect(side_panel(page, "under")).to_contain_text("No goal")
    check_layout(page, "#nhl-history-dialog", artifacts, "atgs-order-books")
    page.get_by_label("Order book line", exact=True).select_option("1.5")
    expect_prices(page, ["+1,500"])
    expect_prices(page, ["-1,700"], "under")
    page.get_by_label("Order book line", exact=True).select_option("0.5")
    # Expired depth may not resurrect the previously recorded NV top quote.
    page.evaluate("RES.novigDepth['tor @ bos']['depth alpha'].expires_at = '2026-10-28T18:00:00Z'; window.dispatchEvent(new Event('odds-rendered'))")
    expect_prices(page, ["+1,200", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,250", "-1,300"], "under")
    page.locator('[data-history-view="logs"]').click()
    assert page.locator(".prediction-depth").count() == 0
    page.locator('[data-history-view="orderbooks"]').click()
    expect_prices(page, ["+1,200", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,250", "-1,300"], "under")
    page.locator(".nhl-history-close").click()
    page.evaluate("RES.data = []; window.dispatchEvent(new Event('odds-rendered'))")
    assert page.locator(".prediction-depth").count() == 0
    assert page.locator(".player-history-depth-host").inner_html() == ""
    assert not errors, errors
    page.close()
    print("ATGS row click: full Novig depth, no duplicate top quote, complementary sides, alternate line, expiry, close and responsive tabs passed.")


def grouped_prices_checks(browser, base, artifacts):
    page, errors = new_page(browser, base, "nba")
    payload = fixture()
    payload["data"] = payload["data"][:2]
    for row in payload["data"]:
        row["bookOdds"] = {"nv": "200/-250", "px": "200/-250", "kal": "200/-300", "poly": "300/-250"}
    install_rows(page, payload)
    page.locator("#table .player-lines-trigger").click()
    page.locator("#player-lines-tab-depth").click()
    expect_prices(page, ["+300", "+200"])
    expect_prices(page, ["-250", "-300"], "under")
    yes = side_panel(page).locator('[data-price="200"]')
    no = side_panel(page, "under").locator('[data-price="-250"]')
    for row, books, total in [(yes, ["NV", "PX", "KAL"], "$165"), (no, ["NV", "PX", "POLY"], "$290")]:
        expect(row).to_have_count(1)
        expect(row.locator(".prediction-depth-odds")).to_have_count(1)
        expect(row.locator(".prediction-depth-source > span")).to_have_text(books)
        expect(row.locator(".prediction-depth-size-label")).to_have_text(total)
        expect(row.locator(".prediction-depth-segment")).to_have_count(3)
    expect(side_panel(page).locator(".prediction-depth-total strong").first).to_have_text("$240")
    expect(side_panel(page, "under").locator(".prediction-depth-total strong").first).to_have_text("$305")

    colors = {}
    for row, amounts in [(yes, {"nv": 40, "px": 100, "kal": 25}), (no, {"nv": 90, "px": 120, "poly": 80})]:
        bar = row.locator(".prediction-depth-bar")
        bar_width = bar.bounding_box()["width"]
        assert bar_width > 0
        for book, amount in amounts.items():
            segment = row.locator(f'.prediction-depth-segment[data-book="{book}"]')
            fraction = segment.bounding_box()["width"] / bar_width
            assert abs(fraction - amount / sum(amounts.values())) < 0.01, (book, fraction)
            assert f"${amount}" in segment.get_attribute("title")
            color = segment.evaluate("el => getComputedStyle(el).backgroundColor")
            assert color not in ["transparent", "rgba(0, 0, 0, 0)"]
            if book in colors:
                assert colors[book] == color, "A book must use the same color on both sides"
            colors[book] = color
        track_width = row.locator(".prediction-depth-size").bounding_box()["width"]
        assert abs(bar_width / track_width - sum(amounts.values()) / 290) < 0.02
    assert len(set(colors.values())) == 4, colors
    expect(page.locator(".prediction-depth-legend [data-book]")).to_have_count(4)
    for book in colors:
        legend = page.locator(f'.prediction-depth-legend [data-book="{book}"]')
        expect(legend).to_be_visible()
        assert legend.locator("i").evaluate("el => getComputedStyle(el).backgroundColor") == colors[book]
    check_layout(page, "#player-lines-dialog", artifacts, "grouped-order-books")
    for sources in page.locator(".prediction-depth-sources").all():
        assert sources.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), "Grouped book labels overflow at 320px"

    # Updating one paired quote splits both merged rows without losing the other books.
    page.evaluate("""() => {
        RES.data = RES.data.map(row => ({...row,bookOdds:{...row.bookOdds,px:'250/-275'}}));
        window.dispatchEvent(new Event('odds-rendered'));
    }""")
    expect_prices(page, ["+300", "+250", "+200"])
    expect_prices(page, ["-250", "-275", "-300"], "under")
    expect(yes.locator(".prediction-depth-source > span")).to_have_text(["NV", "KAL"])
    expect(yes.locator(".prediction-depth-size-label")).to_have_text("$65")
    page.evaluate("payload => {RES=payload; window.dispatchEvent(new Event('odds-rendered'));}", payload)
    expect_prices(page, ["+300", "+200"])
    expect(yes.locator(".prediction-depth-size-label")).to_have_text("$165")

    # Unknown stake stays visible as an offer but cannot inflate the segment, total, or weighted average.
    page.evaluate("""() => {
        RES.data = RES.data.map(row => ({...row,liquidity:{...row.liquidity,px:[null,120]}}));
        window.dispatchEvent(new Event('odds-rendered'));
    }""")
    expect(yes.locator(".prediction-depth-source > span")).to_have_text(["NV", "PX", "KAL"])
    expect(yes.locator('.prediction-depth-segment[data-book="px"]')).to_have_count(0)
    expect(yes.locator(".prediction-depth-size-label")).to_contain_text("$65")
    expect(side_panel(page)).to_contain_text("unknown size")
    expect(side_panel(page).locator(".prediction-depth-total strong").first).to_have_text("$140")
    expect(side_panel(page).locator(".prediction-depth-total strong").nth(1)).to_have_text("+254")
    expect(side_panel(page, "under").locator(".prediction-depth-total strong").first).to_have_text("$305")
    assert not errors, errors
    page.close()
    print("Merged prices: one row per price, book-color segments, proportional stakes, shared scale, live split/merge, unknown-size exclusion and mobile fit passed.")


def loader_checks(browser, base):
    page, errors = new_page(browser, base, "nba")
    install_rows(page, fixture())
    attempts = []

    def load(route):
        attempts.append(route)
        if len(attempts) == 1:
            route.abort()
        elif len(attempts) == 2:
            pass  # Resolve after the actual close click to exercise the pending-load race.
        else:
            route.continue_()

    page.route("**/prediction-depth.js", load)
    page.locator("#table .player-lines-trigger").click()
    page.locator("#player-lines-tab-depth").click()
    expect(page.get_by_role("button", name="Try again", exact=True)).to_be_visible()
    page.get_by_role("button", name="Try again", exact=True).click()
    expect(page.locator(".player-lines-depth")).to_contain_text("Loading order books")
    page.locator(".player-lines-close").click()
    assert len(attempts) == 2
    attempts[-1].fulfill(body=(ROOT / "prediction-depth.js").read_text(encoding="utf-8"), content_type="application/javascript")
    page.wait_for_function("typeof PredictionDepth !== 'undefined'")
    assert page.locator(".prediction-depth").count() == 0, "Late script completion reopened closed content"
    page.locator("#table .player-lines-trigger").click()
    page.locator("#player-lines-tab-depth").click()
    expect_prices(page, ["+1,200", "+1,100", "+1,000", "+900"])
    expect_prices(page, ["-1,100", "-1,200", "-1,250", "-1,300"], "under")
    assert page.locator("link[data-prediction-depth]").count() == 1
    assert page.locator(".prediction-depth").count() == 1
    page.keyboard.press("Escape")
    expect(page.locator("#player-lines-dialog")).not_to_be_visible()
    assert page.locator(".prediction-depth").count() == 0
    assert not errors, errors
    page.close()
    print("Loading failure/retry, close during pending script, reopen without duplicate mounts, and Escape cleanup passed.")


def main():
    artifacts = Path(mkdtemp(prefix="prediction-depth-browser-"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-logging", f"--log-file={artifacts / 'chromium.log'}"])
            base = f"http://localhost:{server.server_port}"
            comparison_checks(browser, base, artifacts)
            history_checks(browser, base, artifacts)
            grouped_prices_checks(browser, base, artifacts)
            loader_checks(browser, base)
            browser.close()
    finally:
        server.shutdown()
    print(f"Screenshots: {artifacts}")


if __name__ == "__main__":
    main()
