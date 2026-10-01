"""NHL opponent hit-rate columns, real sorting and saved Customize preferences."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIELD = "hitRates.bvt"


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def payload_for(page_name):
    prop = {"nhl": "sog", "atgs": "atgs", "atgs2": "atgs", "fgs": "fgs"}[page_name]
    specs = [("zero sample", {"w": 0, "t": 5, "p": 0}),
             ("eighty percent", {"w": 4, "t": 5, "p": 80}),
             ("quarter sample", {"w": 1, "t": 4, "p": 25}),
             ("no observations", {"w": 0, "t": 0, "p": 0}),
             ("missing history", None), ("blurred player", {"w": 5, "t": 5, "p": 100})]
    rows = []
    for player, rate in specs:
        under = page_name == "nhl" and player == "eighty percent"
        row = {"player": player, "prop": prop, "handicap": "1.5" if page_name == "atgs2" else "0.5",
               "under": under, "ouIdx": int(under), "sport": "nhl", "team": "tor", "opp": "bos",
               "game": "tor @ bos", "dt": "2099-10-01", "pos": "C", "avgTOI": 21,
               "teamTotal": 3.1, "ppLine": "1", "oppRank": 20, "dvpRank": 18,
               "goalie": "jeremy swayman", "goalieGSAA": 2.4, "goalieSV": .921,
               "book": "fd", "line": 150, "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155"},
               "liquidity": {}, "links": {}, "logs": [0, 1, 0], "hitRate": 33, "hitRateLYR": 20,
               "hitRates": {} if rate is None else {"bvt": rate}, "blurred": player == "blurred player",
               "due": {"g": {"streak": 2, "med": 3, "z_median": .5}}}
        rows.append(row)
    return {"data": rows, "props": [prop], "games": ["tor @ bos"], "updated": {},
            "times": {"tor @ bos": "2099-10-01T23:00:00Z"}}


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width in [("nhl", 1440), ("nhl", 390), ("atgs", 1440), ("atgs2", 390), ("fgs", 1440)]:
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
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData('active').length === 6")
            assert page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()")
            assert page.evaluate("TABLE.getColumn('hitRates.bvt').getWidth()") == 60
            fields = page.evaluate("TABLE.getColumns().map(column => column.getField())")
            if name == "nhl":
                assert fields.index("hitRateLYR") < fields.index(FIELD) < fields.index("game"), fields
            else:
                assert fields.index(FIELD) < fields.index("logs"), fields

            values = page.evaluate("""() => Object.fromEntries(TABLE.getRows('active').map(row => [
                row.getData().player, row.getCell('hitRates.bvt').getElement().textContent.trim()]))""")
            assert values == {"zero sample": "0%", "eighty percent": "80%", "quarter sample": "25%",
                              "no observations": "", "missing history": "", "blurred player": "100%"}, values
            assert page.evaluate("""() => {
                const row = TABLE.getRows('active').find(row => row.getData().player === 'blurred player');
                const cell = row.getCell('hitRates.bvt');
                const value = cell.getElement().querySelector('.blurred');
                return value && getComputedStyle(value).filter !== 'none' && cell.getColumn().getDefinition().tooltip(null, cell) === '';
            }""")
            tooltip = page.evaluate("""() => {
                const row = TABLE.getRows('active').find(row => row.getData().player === 'eighty percent');
                const cell = row.getCell('hitRates.bvt');
                const tooltip = cell.getColumn().getDefinition().tooltip;
                return typeof tooltip === 'function' ? tooltip(null, cell) : cell.getElement().getAttribute('title');
            }""")
            if tooltip:
                assert "4/5" in tooltip, tooltip

            if name == "nhl":
                page.evaluate("void TABLE.scrollToColumn('hitRates.bvt', 'center', false)")
                screenshot = Path(gettempdir()) / f"nhl-opponent-hit-rate-{width}.png"
                page.screenshot(path=str(screenshot))
                print(f"Screenshot: {screenshot}")

            for direction, expected in [("asc", ["zero sample", "quarter sample", "eighty percent", "blurred player"]),
                                        ("desc", ["blurred player", "eighty percent", "quarter sample", "zero sample"])]:
                page.evaluate("direction => TABLE.setSort('hitRates.bvt', direction)", direction)
                ordered = page.evaluate("TABLE.getRows('active').map(row => row.getData().player)")
                assert ordered[:4] == expected, (direction, ordered)
                assert set(ordered[4:]) == {"no observations", "missing history"}, ordered

            if name != "nhl":
                # Legacy saved orders retain every chosen relative position while receiving the new column.
                reorder = page.evaluate("""() => {
                    const build = PAGE === 'atgs' ? buildAtgsColumns : PAGE === 'atgs2' ? buildColumns : buildFgsColumns;
                    const legacy = ['logs', 'player', 'hitRate', 'ev', 'hitRateLYR', 'book'];
                    const columns = build(legacy);
                    const fields = columns.map(column => column.field).filter(Boolean);
                    TABLE.setColumns(columns);
                    return {legacy, fields};
                }""")
                assert [field for field in reorder["fields"] if field in reorder["legacy"]] == reorder["legacy"], reorder
                assert reorder["fields"].count(FIELD) == 1, reorder
                assert reorder["fields"].index(FIELD) < reorder["fields"].index("logs"), reorder

            # A legacy saved layout gets the new column without erasing its existing preferences.
            page.evaluate("""() => {
                ENABLE_AUTH = true;
                CURR_USER = {id:'fixture', metadata:{[PAGE]:['ev', 'player', 'hitRate']}};
                CURR_SESSION = {user:{id:'fixture'}};
                SB = {from:() => ({update:payload => ({eq:async () => {
                    window.savedOpponentProfile = payload.metadata;
                    return {error:null};
                }})})};
                showHideUserTable(true);
                openOverlay();
            }""")
            checkbox = page.locator("#custom_hitRates_bvt")
            assert checkbox.count() == 1 and checkbox.is_checked()
            assert page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()")
            checkbox.uncheck()
            assert not page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()")
            page.evaluate("closeOverlay(); openOverlay()")
            assert not checkbox.is_checked(), "Reopening Customize should retain the in-session hide"
            checkbox.check()
            assert page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()")
            checkbox.uncheck()
            page.evaluate("saveTableSettings()")
            page.wait_for_function("window.savedOpponentProfile?.[PAGE + '-bvt-hit-rate-version'] === 1")
            assert page.evaluate("savedOpponentProfile[PAGE].includes('hitRates_bvt')") is False
            page.evaluate("""() => {
                closeOverlay();
                CURR_USER = JSON.parse(localStorage.getItem('cached_profile'));
                TABLE.setColumns(TABLE.getColumnDefinitions());
                showHideUserTable(true);
                openOverlay();
            }""")
            assert not checkbox.is_checked()
            assert not page.evaluate("TABLE.getColumn('hitRates.bvt').isVisible()"), "Saved hides must survive rebuild/profile restore"
            checkbox.check()
            page.evaluate("saveTableSettings()")
            assert page.evaluate("savedOpponentProfile[PAGE].includes('hitRates_bvt')")
            assert page.evaluate("savedOpponentProfile[PAGE + '-bvt-hit-rate-version']") == 1
            page.evaluate("closeOverlay()")
            assert page.evaluate("TABLE.getColumn('hitRates.bvt').getWidth()") == 60
            assert not errors, errors
            print(f"{name} {width}px: opponent percentages, blank/zero/blurred, sorting, Customize migration/save and reorder passed")
            page.close()
        browser.close()
finally:
    server.shutdown()
