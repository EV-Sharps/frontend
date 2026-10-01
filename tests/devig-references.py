"""Devig reference-book controls keep pricing inputs separate from bet availability."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
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
            # Reload/close can cancel in-flight static assets on Windows.
            pass


def payload_for(page_name):
    rows = []
    for name, missing in [("full market", None), ("without fanduel", "fd"),
                          ("without pinnacle", "pn"), ("without draftkings", "dk")]:
        for under in ([False, True] if page_name == "nhl" else [False]):
            odds = {"fd": "500/-800", "dk": "100/-110", "pn": "100/-110", "br": "400/-500"}
            if missing:
                del odds[missing]
            rows.append({
                "player": name, "prop": "sog" if page_name == "nhl" else "attd",
                "sport": "nhl" if page_name == "nhl" else "nfl", "pos": "C" if page_name == "nhl" else "RB",
                "under": under, "ouIdx": int(under), "handicap": "0.5", "dt": "2099-10-01",
                "team": "tor" if page_name == "nhl" else "phi", "opp": "bos" if page_name == "nhl" else "dal",
                "game": "tor @ bos" if page_name == "nhl" else "phi @ dal", "bookOdds": odds,
                "book": "fd", "line": 500, "logs": [0, 1, 0], "snaps": ["70%"], "hitRate": 33,
                "hitRateLYR": 20, "hitRates": {"szn": {"w": 1, "t": 3, "p": 33}},
                "liquidity": {}, "links": {}, "avgTOI": 21, "teamTotal": 3.1, "ppLine": "1",
                "oppRank": 10 if page_name == "nhl" else {"opp-rz-scoring-pct": {"rank": 10}},
                "dvpRank": 15, "goalie": "jeremy swayman", "goalieGSAA": 2.4, "goalieSV": .921,
            })
    game = rows[0]["game"]
    return {"data": rows, "props": [rows[0]["prop"]], "games": [game], "updated": {},
            "times": {game: "2099-10-01T23:00:00Z"}}


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width, view in [("nhl", 1440, "compact"), ("nhl", 390, "mobile"), ("nhl", 320, "mobile"), ("tds", 1440, "compact")]:
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(5000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("window.EventSource = undefined;")
            page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
            page.route("**/auth.js", lambda route: route.fulfill(
                body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                content_type="application/javascript"))
            for script in ("record_nhl.js", "record_nfl.js"):
                page.route(f"**/{script}", lambda route: route.fulfill(
                    body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type="application/javascript"))
            payload = payload_for(name)
            page.route("**/api/**", lambda route: route.fulfill(json=payload))
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view={view}&devig=fd-dk-pn&weight=1-1-1&method=mult&required=&ou=ou")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")

            def menu():
                if not page.locator("#required-options").is_visible():
                    page.locator("#required-button").click()

            def choose(book, state):
                menu()
                row = page.locator(f'#required-options .devig-reference-row[data-book="{book}"]')
                row.locator("label").filter(has=page.locator(f'input[type="radio"][value="{state}"]')).click()
                assert row.locator('input[type="radio"]:checked').count() == 1
                assert row.locator(f'input[type="radio"][value="{state}"]').is_checked()

            def action(name):
                menu()
                page.locator(f'#required-options button[data-act="{name}"]').click()
                assert page.locator("#required-options .devig-reference-row").evaluate_all(
                    "rows => rows.every(row => row.querySelectorAll('input[type=radio]:checked').length === 1)")

            def expect_players(players):
                expected = sorted(f"{player}:{side}" for player in players for side in ([0, 1] if name == "nhl" else [0]))
                page.wait_for_function("""expected => {
                    const rows = CURRENT_VIEW === 'mobile'
                        ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData)
                        : TABLE.getData('active');
                    return JSON.stringify(rows.map(row => `${row.player}:${row.under ? 1 : 0}`).sort()) === JSON.stringify(expected);
                }""", arg=expected)

            def full_row(under=False):
                return page.evaluate("under => RES.data.find(row => row.player === 'full market' && row.under === under)", under)

            def expect_probability(probability):
                page.wait_for_function("""probability => {
                    const row = RES.data.find(row => row.player === 'full market' && !row.under);
                    return Math.abs(Number(row.implied) - probability * 100) < .011;
                }""", arg=probability)

            players = ["full market", "without fanduel", "without pinnacle", "without draftkings"]
            expect_players(players)
            assert page.locator('#required-dd > .select-label').inner_text() == "Devig books"
            menu()
            assert page.locator('#required-options input[type="radio"][data-book="fd"]').evaluate_all("inputs => inputs.map(input => input.value)") == ["optional", "required", "excluded"]
            assert page.locator('#required-options .devig-reference-row[data-book="fd"] [role="radiogroup"]').count() == 1
            assert page.locator('#required-options .devig-reference-row[data-book="fd"] .devig-reference-choices label').all_inner_texts() == ["Use", "Req", "Excl"]
            initial_prop = page.evaluate("({prop:PROP, label:document.getElementById('prop-dd-button').textContent})")
            # Multiplicative fair probabilities calculated independently of the application.
            fd_probability = (1 / 6) / ((1 / 6) + (8 / 9))
            other_probability = .5 / (.5 + 110 / 210)
            baseline = (fd_probability + 2 * other_probability) / 3
            expect_probability(baseline)
            if name == "nhl" and width == 1440:
                # Native radio groups must work with keyboard arrows as well as label clicks.
                page.locator('#required-options input[data-book="fd"][value="optional"]').press("ArrowRight")
                assert page.locator('#required-options input[data-book="fd"][value="required"]').is_checked()
                expect_players(["full market", "without pinnacle", "without draftkings"])
                page.locator('#required-options input[data-book="fd"][value="required"]').press("ArrowRight")
                assert page.locator('#required-options input[data-book="fd"][value="excluded"]').is_checked()
                expect_players(players)
                assert page.evaluate("({prop:PROP, label:document.getElementById('prop-dd-button').textContent})") == initial_prop
                choose("fd", "optional")
                expect_probability(baseline)
            choose("fd", "excluded")
            expect_probability(other_probability)
            expect_players(players)
            assert page.evaluate("DEVIG_EXCLUDED.includes('fd')")
            assert "fd" not in page.evaluate("getUserWeights()")
            row = full_row()
            assert row["book"] == "fd" and row["line"] == 500, row
            assert row["bookOdds"]["fd"] == "500/-800"
            assert abs(float(row["ev"]) - (other_probability * 600 - 100)) <= .051, row
            if name == "nhl":
                under = full_row(True)
                assert abs(float(under["implied"]) - (1 - other_probability) * 100) < .011, under
                assert under["book"] == "dk" and under["line"] == -110, under
            if view == "mobile":
                display = page.evaluate("""() => {
                    const card = [...document.querySelectorAll('#card-container .data-card')]
                        .find(card => card.playerLinesData.player === 'full market' && !card.playerLinesData.under);
                    const fd = card.querySelector('.book-odd-item:has(img[alt="fd"])');
                    const pill = [...card.querySelectorAll('.metric-pill')].find(pill => pill.textContent.includes('Equal'));
                    return {fdBest:fd.classList.contains('is-best-book'), fdDevig:fd.classList.contains('is-devig-book'),
                        fdOdds:fd.querySelector('.book-odd-value').textContent,
                        references:[...pill.querySelectorAll('img')].map(image => image.alt).sort()};
                }""")
                assert display["fdBest"] and not display["fdDevig"], display
                assert "500" in display["fdOdds"] and "800" in display["fdOdds"], display
                assert display["references"] == ["dk", "pn"], display
            assert page.evaluate("({prop:PROP, label:document.getElementById('prop-dd-button').textContent})") == initial_prop

            choose("pn", "required")
            expect_players(["full market", "without fanduel", "without draftkings"])
            action("all")
            expect_players(["full market", "without fanduel"])
            assert page.locator('#required-options input[data-book="fd"][value="excluded"]').is_checked()
            assert page.evaluate("DEVIG_EXCLUDED") == ["fd"]
            action("any")
            expect_players(players)
            assert page.evaluate("DEVIG_EXCLUDED") == ["fd"]
            assert not page.evaluate("REQUIRED.length")
            action("reset")
            expect_probability(baseline)
            expect_players(players)
            assert not page.evaluate("DEVIG_EXCLUDED.length || REQUIRED.length")

            choose("fd", "excluded")
            choose("pn", "required")
            expect_players(["full market", "without fanduel", "without draftkings"])
            page.wait_for_function("new URL(location.href).searchParams.get('devig_excluded') === 'fd'")
            page.reload()
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            expect_players(["full market", "without fanduel", "without draftkings"])
            expect_probability(other_probability)
            assert page.locator('#required-options input[data-book="fd"][value="excluded"]').is_checked()
            assert page.locator('#required-options input[data-book="pn"][value="required"]').is_checked()
            if width <= 390:
                menu()
                bounds = page.locator("#required-options").bounding_box()
                assert bounds["width"] <= 280 and bounds["x"] >= 8 and bounds["x"] + bounds["width"] <= width - 8, bounds
                for control in page.locator("#required-options .devig-reference-choices").all():
                    box = control.bounding_box()
                    assert box["width"] >= 90 and box["x"] >= bounds["x"] and box["x"] + box["width"] <= bounds["x"] + bounds["width"], box
                page.screenshot(path=str(Path(tempfile.gettempdir()) / f"devig-references-mobile-{width}.png"))

            page.locator("#devig-button").click()
            page.locator('#devig-options-container input[name="devig-selection"][value="fd+dk;1+1"]').check()
            page.wait_for_function("DEVIG === 'fd+dk' && DEVIG_EXCLUDED.length === 0")
            expect_players(["full market", "without pinnacle"])
            page.wait_for_function("!new URL(location.href).searchParams.get('devig_excluded')")
            assert page.locator('#required-options input[data-book="fd"][value="required"]').is_checked()

            if name == "nhl":
                # Market Avg is the primary use case: exclusions change its reference sample,
                # while optional books and the best betting quote remain available.
                page.locator("#devig-button").click()
                page.locator('#devig-options-container input[name="devig-selection"][value=""]').check()
                page.wait_for_function("DEVIG === '' && DEVIG_EXCLUDED.length === 0")
                expect_players(players)
                expect_probability(baseline)
                choose("fd", "excluded")
                expect_probability(other_probability)
                expect_players(players)
                assert full_row()["book"] == "fd"
                choose("pn", "required")
                expect_players(["full market", "without fanduel", "without draftkings"])
                menu()
                if width <= 390:
                    bounds = page.locator("#required-options").bounding_box()
                    assert bounds["width"] <= 280 and bounds["x"] >= 8 and bounds["x"] + bounds["width"] <= width - 8, bounds
                    assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 900 and bounds["height"] <= 440, bounds
                page.screenshot(path=str(Path(tempfile.gettempdir()) / f"devig-references-market-{width}.png"))
                for book in page.locator("#required-options .devig-reference-row[data-book]").evaluate_all("rows => rows.map(row => row.dataset.book)"):
                    choose(book, "excluded")
                expect_players([])
                assert page.locator("#required-options .devig-reference-empty").is_visible()
                assert "All reference books are excluded" in page.locator("#required-options .devig-reference-empty").inner_text()
                action("reset")
                expect_players(players)
                expect_probability(baseline)
                assert not page.evaluate("DEVIG_EXCLUDED.length || REQUIRED.length")
            assert not errors, errors
            print(f"{name} {width}px: fair odds/EV, available betting books, required/optional/excluded, All/Any/Reset, URL restore and preset switch passed" +
                  ("; Market Avg and all-excluded recovery passed" if name == "nhl" else ""))
            page.close()
        browser.close()
finally:
    server.shutdown()
