"""Offline NBA career/opponent rates, saved layouts and mobile-card regression."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ["hitRates.career", "hitRates.bvt"]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def payload_for(name):
    prop = "3ptm" if name == "threes" else "pts"
    specs = [("zero sample", {"w": 0, "t": 5, "p": 0}, {"w": 0, "t": 4, "p": 0}),
             ("eighty percent", {"w": 960, "t": 1200, "p": 80}, {"w": 3, "t": 4, "p": 75}),
             ("quarter sample", {"w": 1, "t": 4, "p": 25}, {"w": 1, "t": 5, "p": 20}),
             ("no observations", {"w": 0, "t": 0, "p": 0}, {"w": 0, "t": 0, "p": 0}),
             ("missing history", None, None),
             ("blurred player", {"w": 5, "t": 5, "p": 100}, {"w": 4, "t": 4, "p": 100})]
    rows = []
    for player, career, opponent in specs:
        under = player == "eighty percent"
        rows.append({
            "player": player, "prop": prop, "handicap": "2.5" if name == "threes" else "20.5",
            "under": under, "ouIdx": int(under), "sport": "nba", "team": "lal", "opp": "bos",
            "game": "lal @ bos", "dt": "2099-10-01", "pos": "PG", "avgMin": 30,
            "oppRank": 20, "oppPosRank": 18, "book": "fd", "line": 150,
            "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155"},
            "liquidity": {}, "links": {}, "logs": [0, 1, 0], "hitRate": 33, "hitRateLYR": 20,
            # Legacy scalar values must not invent a zero-sample or missing career percentage.
            "hitRateCareer": 99,
            "hitRates": {"lyr": {"w": 40, "t": 80, "p": 50}, "szn": {"w": 1, "t": 3, "p": 33},
                         "L5": {"w": 3, "t": 5, "p": 60}, "L10": {"w": 7, "t": 10, "p": 70},
                         "L20": {"w": 12, "t": 20, "p": 60},
                         **({"career": career, "bvt": opponent} if career is not None else {})},
            "blurred": player == "blurred player",
        })
    return {"data": rows, "props": [prop], "games": ["lal @ bos"], "updated": {},
            "times": {"lal @ bos": "2099-10-01T23:00:00Z"}}


def trend_values(card):
    return card.locator(".trend-row-history .trend-pill").evaluate_all("""items => Object.fromEntries(items.map(item => [
        item.querySelector('.trend-label').textContent,
        {p:item.querySelector('.trend-pct').textContent, counts:item.querySelector('.trend-frac')?.textContent}
    ]))""")


# Chromium's debug log belongs outside the checkout, as do test screenshots.
os.chdir(gettempdir())
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ["nba", "pts", "threes"]:
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
                page.route("**/record_nba.js", lambda route: route.fulfill(
                    body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type="application/javascript"))
                payload = payload_for(name)
                page.route("**/api/**", lambda route: route.fulfill(json=payload))
                page.goto(f"http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
                page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData('active').length === 6")
                fields = page.evaluate("TABLE.getColumns().map(column => column.getField())")
                assert fields.index("hitRateLYR") < fields.index(FIELDS[0]) < fields.index(FIELDS[1]) < fields.index("game"), fields

                for field, upper, lower, fraction in [(FIELDS[0], "80%", "25%", "960/1200"), (FIELDS[1], "75%", "20%", "3/4")]:
                    assert page.evaluate("field => TABLE.getColumn(field).isVisible()", field)
                    assert page.evaluate("field => TABLE.getColumn(field).getWidth()", field) == 60
                    values = page.evaluate("""field => Object.fromEntries(TABLE.getRows('active').map(row => [
                        row.getData().player, row.getCell(field).getElement().textContent.trim()]))""", field)
                    assert values == {"zero sample": "0%", "eighty percent": upper, "quarter sample": lower,
                                      "no observations": "", "missing history": "", "blurred player": "100%"}, values
                    assert page.evaluate("""field => {
                        const row = TABLE.getRows('active').find(row => row.getData().player === 'blurred player');
                        const cell = row.getCell(field);
                        const value = cell.getElement().querySelector('.blurred');
                        return value && getComputedStyle(value).filter !== 'none' && cell.getColumn().getDefinition().tooltip(null, cell) === '';
                    }""", field)
                    tooltip = page.evaluate("""field => {
                        const row = TABLE.getRows('active').find(row => row.getData().player === 'eighty percent');
                        const cell = row.getCell(field);
                        return cell.getColumn().getDefinition().tooltip(null, cell);
                    }""", field)
                    assert fraction in tooltip, tooltip
                    for direction, expected in [("asc", ["zero sample", "quarter sample", "eighty percent", "blurred player"]),
                                                ("desc", ["blurred player", "eighty percent", "quarter sample", "zero sample"])]:
                        page.evaluate("([field, direction]) => TABLE.setSort(field, direction)", [field, direction])
                        ordered = page.evaluate("TABLE.getRows('active').map(row => row.getData().player)")
                        assert ordered[:4] == expected, (field, direction, ordered)
                        assert set(ordered[4:]) == {"no observations", "missing history"}, ordered

                if name == "nba":
                    reorder = page.evaluate("""() => {
                        const legacy = ['logs', 'player', 'hitRate', 'ev', 'hitRateLYR', 'book'];
                        const columns = buildNbaColumns(legacy);
                        const fields = columns.map(column => column.field).filter(Boolean);
                        TABLE.setColumns(columns);
                        return {legacy, fields};
                    }""")
                    assert [field for field in reorder["fields"] if field in reorder["legacy"]] == reorder["legacy"], reorder
                    assert all(reorder["fields"].count(field) == 1 for field in FIELDS), reorder

                page.evaluate("""() => {
                    ENABLE_AUTH = true;
                    CURR_USER = {id:'fixture', metadata:{[PAGE]:['ev', 'player', 'hitRate']}};
                    CURR_SESSION = {user:{id:'fixture'}};
                    SB = {from:() => ({update:payload => ({eq:async () => {
                        window.savedNbaProfile = payload.metadata;
                        return {error:null};
                    }})})};
                    showHideUserTable(true);
                    openOverlay();
                }""")
                for field in FIELDS:
                    checkbox = page.locator("#custom_" + field.replace(".", "_"))
                    assert checkbox.count() == 1 and checkbox.is_checked()
                    checkbox.uncheck()
                    assert not page.evaluate("field => TABLE.getColumn(field).isVisible()", field)
                    page.evaluate("closeOverlay(); openOverlay()")
                    assert not checkbox.is_checked(), "Reopening Customize should retain the in-session hide"
                    checkbox.check()
                    assert page.evaluate("field => TABLE.getColumn(field).isVisible()", field)
                page.locator("#custom_hitRates_bvt").uncheck()
                page.evaluate("saveTableSettings()")
                page.wait_for_function("window.savedNbaProfile?.[PAGE + '-nba-history-hit-rates-version'] === 1")
                assert page.evaluate("savedNbaProfile[PAGE].includes('hitRates_career')")
                assert not page.evaluate("savedNbaProfile[PAGE].includes('hitRates_bvt')")
                page.evaluate("""() => {
                    closeOverlay();
                    CURR_USER = JSON.parse(localStorage.getItem('cached_profile'));
                    TABLE.setColumns(TABLE.getColumnDefinitions());
                    showHideUserTable(true);
                    openOverlay();
                }""")
                assert page.locator("#custom_hitRates_career").is_checked()
                assert not page.locator("#custom_hitRates_bvt").is_checked()
                assert not page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()"), "Saved hides must survive rebuild/profile restore"
                page.locator("#custom_hitRates_bvt").check()
                page.evaluate("saveTableSettings(); closeOverlay()")
                assert page.evaluate("savedNbaProfile[PAGE].includes('hitRates_bvt')")

                # Real cards consume the same selected-side API values, including an under.
                page.evaluate("changeView('mobile')")
                page.wait_for_function("document.querySelectorAll('#card-container .data-card').length === 6")
                card = page.locator("#card-container .data-card").filter(has=page.locator(".player-name", has_text="Eighty Percent"))
                if card.count() == 0:
                    card = page.locator("#card-container .data-card").filter(has=page.locator(".player-name", has_text="eighty percent"))
                values = trend_values(card)
                assert values["Career"] == {"p": "80%", "counts": "960/1200"}, values
                assert values["vs Opp"] == {"p": "75%", "counts": "3/4"}, values
                for player in ["no observations", "missing history"]:
                    other = page.locator("#card-container .data-card").filter(has=page.locator(".player-name", has_text=player.title()))
                    values = trend_values(other)
                    assert "Career" not in values and "vs Opp" not in values, values
                zero = page.locator("#card-container .data-card").filter(has=page.locator(".player-name", has_text="Zero Sample"))
                assert trend_values(zero)["Career"] == {"p": "0%", "counts": "0/5"}
                assert trend_values(zero)["vs Opp"] == {"p": "0%", "counts": "0/4"}
                blurred = page.locator("#card-container .data-card").filter(has=page.locator(".player-name", has_text="Blurred Player"))
                assert blurred.locator(".trend-row-history .trend-pill").evaluate_all("""items => items
                    .filter(item => ['Career','vs Opp'].includes(item.querySelector('.trend-label').textContent))
                    .every(item => getComputedStyle(item.querySelector('.trend-box')).filter !== 'none')""")
                card.locator(".card-arrow-container").click()
                assert card.locator(".card-body-collapsed").is_visible()
                assert card.locator(".trend-row-history").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
                if name == "nba":
                    card.scroll_into_view_if_needed()
                    screenshot = Path(gettempdir()) / f"nba-hit-rates-{width}.png"
                    page.screenshot(path=str(screenshot))
                    print(f"Screenshot: {screenshot}")
                assert not errors, errors
                print(f"{name} {width}px: career/opponent values, sorting, Customize migration/save, reorder and mobile cards passed", flush=True)
                page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
