"""Offline NHL filter UI integration for props and goalscorer tables/cards."""
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


def fixture(name, prop, position, l10, last_year, liquidity=100, under=False, handicap=0.5):
    rates = {} if l10 is None else {
        "L10": {"w": l10 / 10, "t": 10, "p": l10},
        "lyr": {"w": last_year / 10, "t": 10, "p": last_year},
    }
    return {
        "player": name, "prop": prop, "handicap": str(handicap), "under": under,
        "ouIdx": int(under), "sport": "nhl", "pos": position, "team": "tor", "opp": "bos",
        "game": "tor @ bos", "dt": "2099-10-01", "avgTOI": 21, "teamTotal": 3.15,
        "ppLine": "1", "oppRank": 20, "dvpRank": 18, "goalie": "jeremy swayman",
        "goalieGSAA": 2.4, "goalieSV": 0.921, "book": "fd", "line": 150,
        "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155", "px": "135/-160"},
        "liquidity": {"px": [liquidity, liquidity]}, "links": {}, "logs": [0, 1, 0],
        "hitRates": rates, "due": {"g": {"streak": 2, "med": 3, "z_median": 0.5}},
    }


def payload_for(page_name):
    prop = {"nhl": "sog", "atgs": "atgs", "atgs2": "atgs", "fgs": "fgs"}[page_name]
    handicap = 1.5 if page_name == "atgs2" else 0.5
    specs = [
        ("center match", "C", 80, 60, 100),
        ("center low rate", "C", 40, 60, 100),
        ("left wing", "LW", 80, 60, 100),
        ("center high year", "C", 80, 90, 100),
        ("center low liquidity", "C", 80, 60, 10),
        ("missing history", "D", None, None, 100),
        ("zero goalie", "G", 0, 0, 100),
        ("right wing", "RW", 80, 60, 100),
    ]
    rows = [fixture(name, prop, pos, l10, lyr, liquidity,
                    under=page_name == "nhl" and name == "center match", handicap=handicap)
            for name, pos, l10, lyr, liquidity in specs]
    if page_name == "atgs":
        measurements = [(3, 20), (2.99, 21), (3.15, 19.99), (None, 21),
                        (3.15, None), (3.4, 22), (3.15, 21), (3.15, 21)]
        for row, (goals, toi) in zip(rows, measurements):
            row.update(teamTotal=goals, avgTOI=toi)
    return {"data": rows, "props": [prop], "games": ["tor @ bos"], "updated": {},
            "times": {"tor @ bos": "2099-10-01T23:00:00Z"}}


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--disable-logging", "--log-file=" +
            str(Path(tempfile.gettempdir()) / "nhl-filters-browser.log")])
        for name, width, view in [("nhl", 1440, "compact"), ("nhl", 390, "mobile"),
                                  ("atgs", 1440, "compact"), ("atgs", 390, "mobile"), ("atgs2", 390, "mobile"),
                                  ("fgs", 1440, "compact")]:
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
            payload = payload_for(name)
            page.route("**/api/**", lambda route: route.fulfill(json=payload))
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view={view}&devig=pn-circa&weight=1-1")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")

            def names():
                return page.evaluate("""() => (CURRENT_VIEW === 'mobile'
                    ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
                    : TABLE.getData('active').map(row => row.player)).sort()""")

            def expect(expected):
                page.wait_for_function("""expected => JSON.stringify((CURRENT_VIEW === 'mobile'
                    ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
                    : TABLE.getData('active').map(row => row.player)).sort()) === JSON.stringify(expected)""", arg=sorted(expected))

            def menu():
                if not page.locator("#fb-hitrate-enabled").is_visible():
                    page.locator("#filterbuilder-dd-button").click()

            def rule(field="L10", comparator="gte", value="80"):
                menu()
                page.get_by_role("button", name="Add hit-rate rule", exact=True).click()
                assert page.locator("#fb-hitrate-enabled").is_checked()
                row = page.locator("#fb-hitrate-rows .fb-stat-row").last
                row.locator(".fb-stat-field").select_option(field)
                row.locator(".fb-stat-cmp").select_option(comparator)
                row.locator(".fb-stat-value").fill(value)

            def apply():
                menu()
                page.locator('#filterbuilder-options button[onclick="applyFilterBuilder()"]').click()

            def clear():
                menu()
                page.locator('#filterbuilder-options button[onclick="clearFilterBuilder()"]').click()

            def prop_state():
                return page.evaluate("""() => ({prop:PROP, label:document.getElementById('prop-dd-button').textContent,
                    checked:[...document.querySelectorAll('#prop-options input:checked')].map(input => input.value)})""")

            all_names = sorted(row["player"] for row in payload["data"])
            expect(all_names)
            assert page.locator("#fb-hitrate-enabled").count() == 1
            assert page.locator("#fb-teamtotal-enabled").count() == int(name == "atgs")
            assert page.locator("#fb-ttoi-enabled").count() == int(name == "atgs")
            assert page.locator("#fb-position-value option").evaluate_all("options => options.map(option => option.value)") == ["C", "LW", "RW", "D", "G", "W", "F"]
            initial_prop = prop_state()
            rule()
            assert page.locator(".fb-stat-field option").evaluate_all("options => options.map(option => option.value)") == ["szn", "L5", "L10", "L20", "lyr", "career"]
            assert names() == all_names, "Editing a rule must wait for Apply"
            assert prop_state() == initial_prop, "Filter editing changed the Prop selection"
            apply()
            high_rate = ["center match", "left wing", "center high year", "center low liquidity", "right wing"]
            expect(high_rate)

            if name == "nhl":
                rule("lyr", "lte", "60")
                if width == 390:
                    page.locator("#fb-hitrate-enabled").scroll_into_view_if_needed()
                    panel = page.locator("#filterbuilder-options").bounding_box()
                    assert panel["x"] >= 0 and panel["x"] + panel["width"] <= width, panel
                    for control in page.locator("#fb-hitrate-rows select, #fb-hitrate-rows input").all():
                        bounds = control.bounding_box()
                        assert bounds["width"] >= 50 and bounds["x"] >= panel["x"] and bounds["x"] + bounds["width"] <= panel["x"] + panel["width"], bounds
                    page.screenshot(path=str(Path(tempfile.gettempdir()) / "nhl-filters-mobile.png"))
                page.locator("#fb-position-enabled").check()
                page.locator("#fb-position-value").select_option("C")
                page.locator("#fb-liquidity-ev-enabled").check()
                page.locator("#fb-liquidity-ev-book").select_option("px")
                page.locator("#fb-liquidity-ev-amount").fill("50")
                assert names() == sorted(high_rate), "New criteria applied before Apply"
                assert prop_state() == initial_prop
                apply()
                expect(["center match"])
                # The winning row is an Under with side-aware 80%; it must not be inverted.
                assert page.evaluate("RES.data.find(row => row.player === 'center match').under")
                page.evaluate("changeView(CURRENT_VIEW === 'mobile' ? 'compact' : 'mobile')")
                expect(["center match"])
                page.evaluate("changeView(CURRENT_VIEW === 'mobile' ? 'compact' : 'mobile')")
                expect(["center match"])

                page.evaluate("""() => {
                    CURR_USER = {id:'fixture', metadata:{}};
                    CURR_SESSION = {user:{id:'fixture'}};
                    SB = {from:() => ({update:payload => ({eq:async () => {
                        window.savedFilterMetadata = payload.metadata;
                        return {error:null};
                    }})})};
                }""")
                menu()
                page.locator("#fb-name-input").fill("Centers with history")
                page.locator('#filterbuilder-options button[onclick="saveFilterBuilder()"]').click()
                page.wait_for_function("window.savedFilterMetadata?.['nhl-savedFilters']?.length === 1")
                assert page.evaluate("savedFilterMetadata['nhl-savedFilters'][0].config.hitRate.rows.length") == 2
                clear()
                expect(all_names)
                assert not page.locator("#fb-hitrate-enabled").is_checked()
                assert not page.locator("#fb-position-enabled").is_checked()
                assert page.locator("#fb-hitrate-rows .fb-stat-row").count() == 0
                menu()
                page.locator("#fb-saved-select").select_option("0")
                expect(["center match"])
                page.reload()
                page.wait_for_function("document.getElementById('data-status')?.hidden === true")
                expect(all_names)
                assert page.locator("#filterbuilder-dd-button").inner_text() == "None"
                assert page.locator('#fb-saved-select option[value="0"]').inner_text() == "Centers with history"
                assert not page.locator("#fb-hitrate-enabled").is_checked()
                assert not page.locator("#fb-position-enabled").is_checked()
                rule("L10", "lte", "0")
                apply()
                expect(["zero goalie"])
                clear()
                expect(all_names)
                # A broad position is an OR within that choice, combined with other criteria by AND.
                menu()
                page.locator("#fb-position-enabled").check()
                page.locator("#fb-position-value").select_option("W")
                apply()
                expect(["left wing", "right wing"])
                page.locator("#fb-position-value").select_option("F")
                apply()
                expect([player for player in all_names if player not in ["missing history", "zero goalie"]])

            clear()
            expect(all_names)
            if name == "atgs":
                menu()
                for prefix, default in [("fb-teamtotal", "3"), ("fb-ttoi", "20")]:
                    assert not page.locator(f"#{prefix}-enabled").is_checked()
                    assert page.locator(f"#{prefix}-min").input_value() == default
                # Older saved combinations do not activate newly added rules or erase defaults.
                page.evaluate("applyFilterBuilderToDOM({position:{enabled:true,value:'C'}})")
                for prefix, default in [("fb-teamtotal", "3"), ("fb-ttoi", "20")]:
                    assert not page.locator(f"#{prefix}-enabled").is_checked()
                    assert page.locator(f"#{prefix}-min").input_value() == default
                clear()
                for prefix in ["fb-teamtotal", "fb-ttoi"]:
                    page.locator(f"#{prefix}-enabled").check()
                assert names() == all_names, "ATGS minima applied before Apply"
                apply()
                matching = ["center match", "missing history", "zero goalie", "right wing"]
                expect(matching)
                assert page.locator("#filterbuilder-dd-button").inner_text() == "2 Filters"
                page.evaluate("changeView(CURRENT_VIEW === 'mobile' ? 'compact' : 'mobile')")
                expect(matching)
                page.evaluate("changeView(CURRENT_VIEW === 'mobile' ? 'compact' : 'mobile')")
                expect(matching)
                page.evaluate("changeFilter()")
                expect(matching)
                menu()
                page.locator("#fb-teamtotal-min").fill("3.3")
                page.locator("#fb-ttoi-min").fill("21.5")
                assert names() == sorted(matching), "Editing active minima applied before Apply"
                apply()
                expect(["missing history"])
                page.evaluate("""() => {
                    CURR_USER = {id:'fixture', metadata:{}};
                    CURR_SESSION = {user:{id:'fixture'}};
                    SB = {from:() => ({update:payload => ({eq:async () => {
                        window.savedFilterMetadata = payload.metadata;
                        return {error:null};
                    }})})};
                }""")
                menu()
                page.locator("#fb-name-input").fill("Goals and ice time")
                page.locator('#filterbuilder-options button[onclick="saveFilterBuilder()"]').click()
                page.wait_for_function("window.savedFilterMetadata?.['atgs-savedFilters']?.length === 1")
                saved = page.evaluate("savedFilterMetadata['atgs-savedFilters'][0].config")
                assert saved["teamTotal"] == {"enabled": True, "min": "3.3"}
                assert saved["ttoi"] == {"enabled": True, "min": "21.5"}
                clear()
                expect(all_names)
                assert not page.locator("#fb-teamtotal-enabled").is_checked()
                assert not page.locator("#fb-ttoi-enabled").is_checked()
                menu()
                page.locator("#fb-saved-select").select_option("0")
                expect(["missing history"])
                assert page.locator("#fb-teamtotal-min").input_value() == "3.3"
                assert page.locator("#fb-ttoi-min").input_value() == "21.5"
                clear()
                expect(all_names)
                page.reload()
                page.wait_for_function("document.getElementById('data-status')?.hidden === true")
                expect(all_names)
                assert page.locator("#filterbuilder-dd-button").inner_text() == "None"
                assert page.locator("#fb-teamtotal-min").input_value() == "3"
                assert page.locator("#fb-ttoi-min").input_value() == "20"
            assert prop_state() == initial_prop
            assert not errors, errors
            print(f"{name} {width}px: hit-rate and position UI, Apply/Clear, prop isolation passed" +
                  ("; combined criteria, cards/table parity, zero/missing data, presets/reload passed" if name == "nhl" else
                   "; team goals/TTOI defaults, boundaries, missing data, drafts, view parity, presets/reload passed" if name == "atgs" else ""))
            page.close()
        browser.close()
finally:
    server.shutdown()
