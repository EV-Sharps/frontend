"""Opening capture column against real pages with isolated API/profile fixtures."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_default_timeout(7000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("window.EventSource = undefined;")
        page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
        page.route("**/auth.js", lambda route: route.fulfill(
            body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
            content_type="application/javascript"))
        page.route("**/api/**", lambda route: route.fulfill(json={
            "data": [], "games": [], "props": [], "updated": {}, "record": {}, "times": {},
        }))

        def visit(path):
            errors.clear()
            page.goto(f"http://localhost:{server.server_port}/{path}")
            page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && TABLE.getColumns().some(c => c.getField() === 'openingPrice')")
            assert page.evaluate("TABLE.getColumns().filter(c => c.getField() === 'openingPrice').length") == 1, path
            assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()"), path
            assert not errors, (path, errors)

        sport_pages = [
            "nba", "nfl", "wnba", "ncaab", "ncaaf", "nhl", "mlb", "soccer", "ufc",
            "baseball_ncaa", "wbc", "olympics", "futures", "nfl_futures", "dingers", "tds",
            "atgs", "fgs", "ftd", "strikeouts", "threes", "pts", "ncaafprops", "preseason",
            "cup", "dingers2", "atgs2", "tds2", "outliers",
        ] if '--quotes-only' not in sys.argv else []
        for name in sport_pages:
            visit(name + ".html?view=compact")
            print(f"{name}: shared Open column present", flush=True)
        for sport in (["mlb", "nba", "nfl", "nhl", "wnba", "ncaab", "ncaaf", "soccer"] if sport_pages else []):
            visit(f"main.html?sport={sport}&view=compact")
            print(f"main/{sport}: shared Open column present", flush=True)

        visit("nba.html?view=compact")
        page.evaluate("""async () => {
            RES = null;
            TABLE.clearFilter(true);
            TABLE.clearSort();
            const checkpoint = (fd, dk) => ({
                captured:'2026-09-30T12:00:00+00:00',
                updated:{fd:'2026-09-30T11:59:00+00:00'},
                books:{fd,dk,mgm:115,circa:-105},
            });
            window.openingFixture = {
                id:1, player:'test player', sport:'nba', team:'bos', opp:'nyk', game:'bos @ nyk',
                prop:'pts', handicap:20.5, under:false, ouIdx:0, book:'fd', line:150,
                ev:5, fairVal:100, implied:50, kelly:0.1, logs:[21,19,25],
                bookOdds:{fd:'150/-170',dk:'140/-165',mgm:'130/-160',circa:'100/-120'},
                opening:[checkpoint(120,110),checkpoint(-140,-135),checkpoint(250,240)],
            };
            await TABLE.setData([structuredClone(openingFixture)]);
        }""")

        def displayed():
            return page.evaluate("TABLE.getRow(1).getCell('openingPrice').getElement().textContent")

        assert displayed() == "+120"
        tooltip = page.locator('.tabulator-row .opening-price').get_attribute('title')
        assert "FD opening capture:" in tooltip and "four sportsbooks" in tooltip
        assert "DK: +110" in tooltip and "quote updated:" in tooltip
        page.evaluate("TABLE.getRow(1).update({book:'dk', line:210})")
        assert displayed() == "+110", "Opening must follow the displayed book and ignore boosts"
        page.evaluate("TABLE.getRow(1).update({under:true, ouIdx:1})")
        assert displayed() == "-135"
        page.evaluate("TABLE.getRow(1).update({ouIdx:2})")
        assert displayed() == "+240", "Three-way index must stay distinct"
        page.evaluate("TABLE.getRow(1).update({ouIdx:0, under:false, book:'hr'})")
        assert displayed() == "-", "A late book must not borrow another checkpoint quote"
        page.evaluate("TABLE.getRow(1).update({book:'fd', opening:[null, openingFixture.opening[1]]})")
        assert displayed() == "-", "A missing side must not borrow the opposite opener"
        page.evaluate("TABLE.getRow(1).update({opening:openingFixture.opening, blurred:true})")
        assert displayed() == "-" and page.locator('.tabulator-row .opening-price').count() == 0
        page.evaluate("TABLE.getRow(1).update({blurred:false, circa_blurred:true, book:'circa'})")
        assert displayed() == "-"
        page.evaluate("TABLE.getRow(1).update({book:'fd'})")
        assert "CIRCA" not in page.locator('.tabulator-row .opening-price').get_attribute('title')
        page.evaluate("localStorage.setItem('odds_format','decimal'); TABLE.getRow(1).reformat()")
        assert displayed() == "2.20"
        page.evaluate("localStorage.removeItem('odds_format'); TABLE.getRow(1).reformat()")

        for view in ["table", "compact"]:
            page.evaluate("view => changeView(view)", view)
            assert displayed() == "+120"
            assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        page.evaluate("TABLE.getColumn('openingPrice').hide(); changeView('table'); changeView('compact'); openOverlay()")
        assert not page.locator('#custom_openingPrice').is_checked()
        page.locator('#custom_openingPrice').check()
        assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        page.evaluate("closeOverlay()")

        # An existing reorder alone must not opt users into the new column,
        # even when its full order already contains hidden Open.
        page.evaluate("""() => {
            ENABLE_AUTH = true;
            CURR_USER = {metadata:{[`${PAGE}-order`]:['ev','book','openingPrice','player']}};
            showHideUserTable(true);
            openOverlay();
        }""")
        assert not page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        assert not page.locator('#custom_openingPrice').is_checked()
        page.evaluate("TABLE.setColumns(buildNbaColumns(CURR_USER.metadata[`${PAGE}-order`]))")
        assert not page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        page.evaluate("closeOverlay(); changeView('table'); changeView('compact')")
        assert not page.evaluate("TABLE.getColumn('openingPrice').isVisible()")

        page.evaluate("""() => {
            ENABLE_AUTH = true;
            CURR_USER = {metadata:{[PAGE]:['ev','player','book']}};
            CURR_SESSION = {user:{id:'fixture'}};
            SB = {from:()=>({update:payload=>({eq:async()=>{
                window.savedProfile = payload.metadata;
                return {error:null};
            }})})};
            showHideUserTable(true);
            openOverlay();
        }""")
        assert not page.locator('#custom_openingPrice').is_checked(), "Older saved layouts keep Open hidden by default"
        page.evaluate("saveTableSettings()")
        assert page.evaluate("savedProfile[`${PAGE}-opening-column-version`]") == 1
        assert not page.evaluate("savedProfile[PAGE].includes('openingPrice')")
        page.evaluate("""() => {
            CURR_USER = {metadata:JSON.parse(JSON.stringify(savedProfile))};
            TABLE.setColumns(buildNbaColumns(['ev','book','player']));
            showHideUserTable(true);
            openOverlay();
        }""")
        assert not page.locator('#custom_openingPrice').is_checked()
        assert not page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        page.locator('#custom_openingPrice').check()
        page.evaluate("saveTableSettings()")
        assert page.evaluate("savedProfile[PAGE].includes('openingPrice')")
        page.evaluate("TABLE.setColumns(buildNbaColumns(['ev','book','player'])); showHideUserTable(true); openOverlay()")
        assert page.evaluate("TABLE.getColumn('openingPrice').isVisible()")
        assert page.locator('#custom_openingPrice').is_checked()
        page.evaluate("openColReorder()")
        assert page.locator('#col-reorder-list [data-key="openingPrice"]').count() == 1
        page.evaluate("closeColReorder(); closeOverlay(); CURR_USER = null; ENABLE_AUTH = false")
        assert page.evaluate("buildNbaColumns(['player','openingPrice','book','ev']).map(c => c.field).indexOf('openingPrice') < buildNbaColumns(['player','openingPrice','book','ev']).map(c => c.field).indexOf('book')")

        page.evaluate("""async () => {
            TABLE.clearSort();
            await TABLE.setData([
                {...openingFixture,id:1},
                {...openingFixture,id:2,under:true,ouIdx:1},
                {...openingFixture,id:3,opening:[]},
            ]);
        }""")
        for direction, expected in [('asc', [2, 1, 3]), ('desc', [1, 2, 3])]:
            page.evaluate("dir => TABLE.setSort('openingPrice', dir)", direction)
            assert page.evaluate("TABLE.getData('active').map(row => row.id)") == expected
        page.evaluate("initializeCards([openingFixture]); changeView('mobile')")
        assert page.locator('#card-container .card-opening-price, #card-container .opening-price').count() == 0
        assert page.locator('#card-container .evbook-odds-large').inner_text() == '+150'

        # Real filter changes replace rows; captures must survive recalculated prices.
        page.evaluate("""async () => {
            await changeView('compact');
            RES = {data:[structuredClone(openingFixture), {...structuredClone(openingFixture),id:2,under:true,ouIdx:1}]};
            DEVIG = 'circa'; WEIGHT = '1';
            document.getElementById('book-select').value = 'fd';
            document.getElementById('ou-select').value = 'o';
            document.getElementById('boost-select').value = '0';
            await changeFilter();
        }""")
        assert displayed() == '+120'
        page.locator('#book-select').select_option('dk')
        page.wait_for_function("TABLE.getRow(1).getData().book === 'dk'")
        assert displayed() == '+110'
        page.locator('#boost-select').select_option('50')
        page.wait_for_function("TABLE.getRow(1).getData().line === 210")
        assert displayed() == '+110'
        page.locator('#ou-select').select_option('u')
        page.wait_for_function("TABLE.getData('active').length === 1 && TABLE.getData('active')[0].under")
        assert page.evaluate("TABLE.getRow(2).getCell('openingPrice').getElement().textContent") == '-135'
        assert not errors, errors
        print("Opening quote selection, side indices, boosts, missing values, privacy, decimal display, views, saved preferences, reorder, sorting and cards passed.", flush=True)
        browser.close()
finally:
    server.shutdown()
    server.server_close()
