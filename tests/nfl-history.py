"""Offline NFL player-history integration across props and touchdown pages."""
from functools import partial
from decimal import Decimal, ROUND_HALF_UP
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from math import floor
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def histories(name):
    if name == "nfl":
        return {"logs": [-2, 0, 2, 6] * 7, "bvt": [0, 4, 2, -1],
                "away": [0, 2, 4, 1, 3] * 5 + [-2, 4, 2], "home": [1, 0, 0, 3, 2] * 5 + [1, 0, 0]}
    if name == "ftd":
        return {"logs": [0, 0, 1, 0] * 7, "bvt": [0, 1, 0, 0],
                "away": [0, 1, 0, 0, 1] * 5 + [1, 0, 0], "home": [1, 0, 0, 0, 0] * 5 + [0, 1, 0]}
    return {"logs": [0, 1, 2, 3] * 7, "bvt": [0, 3, 2, 1],
            "away": [0, 2, 4, 1, 3] * 5 + [0, 4, 2], "home": [1, 0, 0, 3, 2] * 5 + [1, 0, 0]}


def payload_for(name):
    prop = {"nfl": "rush_yd", "tds": "attd", "tds2": "2+td", "ftd": "ftd"}[name]
    rows = []
    for player in ["history alpha", "history beta", "no history"]:
        missing = player == "no history"
        series = histories(name)
        row = {
            "player": player, "prop": "ltd" if name == "ftd" and player == "history beta" else prop,
            "handicap": "2" if name == "nfl" else "0.5", "sport": "nfl",
            "under": name == "nfl" and player == "history beta", "pos": "RB",
            "team": "phi", "opp": "dal", "game": "phi @ dal", "dt": "2099-10-01",
            "book": "fd", "line": 150,
            "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155"},
            "liquidity": {}, "links": {}, "hitRate": 50, "hitRateLYR": 40,
            # Numeric-only TDS2 logs also exercise the older card fallback.
            "logs": [None, "3", True] if missing else series["logs"] + ([] if name == "tds2" else [None, "9", False]),
            "bvtLogs": None if missing else series["bvt"] + [None, "5", True],
            "homeLogs": [] if missing else ([0, 0, 0] if player == "history beta" else series["home"]),
            "snaps": ["60%", "65%", "70%"], "oppRank": {"opp-rz-scoring-pct": {"rank": 8}},
            "dvpRank": 6, "dvpAllowed": .7, "dvpGames": 3, "dvpContext": True,
            "due": {"g": {"btwn": [0, 1, 2], "streak": 4}},
        }
        if not missing:
            row["awayLogs"] = series["away"] + [None, "8", False]
        row["ouIdx"] = int(row["under"])
        rows.append(row)
    return {"data": rows, "props": sorted({row["prop"] for row in rows}), "games": ["phi @ dal"],
            "updated": {}, "times": {"phi @ dal": "2099-10-01T23:00:00Z"}}


def chart(page):
    return page.evaluate("""() => {
        const el = document.getElementById('nfl-history-chart');
        return {data: el?.data || [], layout: el?.layout || {}};
    }""")


def metrics(page):
    return page.locator('#nfl-history-dialog .nhl-history-stats > div').evaluate_all(
        "items => Object.fromEntries(items.map(item => [item.querySelector('span').textContent, item.querySelector('strong').textContent]))")


def assert_logs(page, expected, line, under=False):
    page.wait_for_function("""expected => {
        const trace = document.getElementById('nfl-history-chart')?.data?.find(trace => trace.type === 'bar');
        return JSON.stringify(trace?.y) === JSON.stringify(expected);
    }""", arg=expected)
    result = chart(page)
    hits = sum(value < line if under else value > line for value in expected)
    average = str((Decimal(sum(expected)) / len(expected)).quantize(Decimal('.1'), rounding=ROUND_HALF_UP)).removesuffix('.0')
    assert metrics(page) == {"Hit rate": f"{floor(hits * 100 / len(expected) + .5)}% ({hits}/{len(expected)})",
                             "Average": average, "Games": str(len(expected))}, metrics(page)
    trace = result["data"][0]
    colors = ["#94a3b8" if value == line else "#36d399" if (value < line if under else value > line) else "#c57580" for value in expected]
    assert trace["marker"]["color"] == colors
    assert trace["text"] == [str(value) for value in expected]
    assert trace["customdata"][-1][0] == "Latest"
    assert any(shape.get("y0") == line == shape.get("y1") for shape in result["layout"].get("shapes", []))
    assert result["layout"]["yaxis"]["range"][0] <= min(expected)
    if min(expected) < 0:
        assert result["layout"]["yaxis"]["range"][0] < min(expected), "Negative labels need space above the x axis"
    return result


def click_row(page, player, modifiers=None):
    page.evaluate("""player => {
        for (const el of document.querySelectorAll('[data-history-fixture]')) el.removeAttribute('data-history-fixture');
        const row = TABLE.getRows('active').find(row => row.getData().player === player);
        row.getCell(PAGE === 'tds2' ? 'outlier' : 'ev').getElement().setAttribute('data-history-fixture', 'target');
    }""", player)
    page.locator('[data-history-fixture="target"]').click(modifiers=modifiers or [])


def open_player(page, player):
    page.evaluate("player => NflHistory.open(TABLE.getData('active').find(row => row.player === player))", player)
    page.wait_for_function("document.getElementById('nfl-history-dialog')?.open")


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width in [("nfl", 1440), ("nfl", 390), ("nfl", 320), ("tds", 1440),
                            ("tds", 390), ("tds2", 1440), ("tds2", 390), ("ftd", 1440), ("ftd", 390)]:
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("window.EventSource = undefined;")
            page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
            page.route("**/auth.js", lambda route: route.fulfill(
                body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                content_type="application/javascript"))
            page.route("**/api/**", lambda route: route.fulfill(json=payload_for(name)))
            pending_plotly = []
            if name == "nfl" and width == 1440:
                page.route("**/plotly-3.0.0.min.js", lambda route: pending_plotly.append(route))
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData('active').length === 3")
            assert page.evaluate("typeof NflHistory.open") == "function"
            widths = page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])")
            click_row(page, "history alpha")
            page.wait_for_function("document.getElementById('nfl-history-dialog')?.open")
            popup = page.locator("#nfl-history-dialog")
            assert popup.locator('[data-history-view="due"]').count() == 0
            assert popup.locator('[data-history-view]').all_text_contents() == ["Game logs", "Logs vs Opp", "Away", "Home"]
            assert popup.locator('[data-history-view="logs"]').get_attribute("aria-selected") == "true"

            if name == "nfl" and width == 1440:
                page.wait_for_function("!!document.querySelector('script[src*=\"plotly-3\"]')")
                page.wait_for_timeout(50)
                assert pending_plotly, "Plotly must load lazily for the popup"
                open_player(page, "history beta")
                page.evaluate("NflHistory.close()")
                for route in pending_plotly:
                    route.fulfill(path=str(ROOT / "plotly-3.0.0.min.js"), content_type="application/javascript")
                page.wait_for_function("!!window.Plotly")
                page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                assert not popup.evaluate("element => element.open")
                open_player(page, "history alpha")

            assert "History Alpha" in page.locator("#nfl-history-title").inner_text()
            context = popup.locator('.nhl-history-context').inner_text()
            assert "PHI @ DAL" in context, context
            line = 2 if name == "nfl" else 1.5 if name == "tds2" else .5
            assert f"Over {line:g}" in context, context
            series = histories(name)
            for view, history in series.items():
                popup.locator(f'[data-history-view="{view}"]').click()
                for size in ["20", "10", "all"]:
                    popup.locator(f'[data-history-range="{size}"]').click()
                    current = assert_logs(page, history if size == "all" else history[-int(size):], line)
                if view in ["away", "home"]:
                    assert current["layout"]["xaxis"]["title"]["text"] == f"{view.title()} games"
                    assert f"{view} games" in popup.locator('.nhl-history-note').inner_text()
                popup.locator('[data-history-range="20"]').click()
            assert "touchdown" in context.lower() if name in ["tds", "tds2", "ftd"] else "rushing" in context.lower(), context
            assert popup.locator('.nhl-history-z').count() == 0

            home = popup.locator('[data-history-view="home"]')
            home.press("Home")
            logs = popup.locator('[data-history-view="logs"]')
            assert logs.get_attribute("aria-selected") == "true"
            logs.press("End")
            assert home.get_attribute("aria-selected") == "true"
            assert page.locator('#nfl-history-panel').get_attribute('aria-labelledby') == home.get_attribute('id')
            bounds = popup.bounding_box()
            assert 0 <= bounds["x"] and bounds["x"] + bounds["width"] <= width + 1, bounds
            assert 0 <= bounds["y"] and bounds["y"] + bounds["height"] <= 901, bounds
            tabs = popup.locator('.nhl-history-tabs').evaluate("element => ({width:element.clientWidth, scroll:element.scrollWidth})")
            assert tabs['scroll'] <= tabs['width'] + 1, tabs
            if name == "nfl":
                popup.locator('[data-history-view="logs"]').click()
                assert_logs(page, series['logs'][-20:], line)
                screenshot = Path(gettempdir()) / f"nfl-history-{width}.png"
                page.screenshot(path=str(screenshot))
                print(f"Screenshot: {screenshot}")
            page.keyboard.press("Escape")
            assert not popup.evaluate("element => element.open")
            assert page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])") == widths

            open_player(page, "history beta")
            assert_logs(page, series["logs"][-20:], line, under=name == "nfl")
            popup.locator('[data-history-view="home"]').click()
            assert_logs(page, [0, 0, 0], line, under=name == "nfl")
            if name == "ftd":
                assert "Last touchdown" in popup.locator('.nhl-history-context').inner_text()
            open_player(page, "no history")
            for view in series:
                popup.locator(f'[data-history-view="{view}"]').click()
                assert popup.locator('.nhl-history-empty').is_visible()
                assert metrics(page) == {}, "Missing logs cannot be reported as 0% hits"
                assert not chart(page)["data"], "Missing logs must clear the prior player's chart"
            popup.get_by_role('button', name='Close player history').click()

            page.evaluate("""() => {
                CURR_USER = {metadata:{}};
                CURR_SESSION = {user:{id:'history-fixture'}};
                SB = {from:() => ({update:() => ({eq:async () => ({error:null})})})};
                refreshWatchlistStars();
            }""")
            star = page.locator('#table .watchlist-star').first
            before = star.get_attribute('aria-pressed')
            star.click()
            page.wait_for_function("!pendingWatchlistPlayers.size")
            assert star.get_attribute('aria-pressed') != before
            assert not popup.evaluate("element => element.open"), "Favoriting must not open history"
            click_row(page, "history alpha", modifiers=["Control"])
            assert page.locator('#card-modal-overlay').is_visible()
            assert not popup.evaluate("element => element.open")
            page.evaluate("closeCardModal()")

            focus = page.locator('#table input').first
            focus.focus()
            before = page.evaluate("""() => {
                window.historyFixtureFocus = document.activeElement;
                return [scrollX, scrollY, document.querySelector('.tabulator-tableholder').scrollLeft];
            }""")
            open_player(page, "history alpha")
            page.keyboard.press("Escape")
            assert page.evaluate("document.activeElement === window.historyFixtureFocus")
            assert page.evaluate("[scrollX, scrollY, document.querySelector('.tabulator-tableholder').scrollLeft]") == before
            open_player(page, "history alpha")
            popup.get_by_role('button', name='Play card', exact=True).click()
            assert not popup.evaluate("element => element.open")
            assert page.locator('#card-modal-overlay .data-card.expanded').count() == 1
            if name == "tds2":
                rates = page.evaluate("cardHitRates(TABLE.getData('active').find(row => row.player === 'history alpha'))")
                assert rates['L20'] == {'w': 10, 't': 20, 'p': 50}, rates
                l20 = page.locator('#card-modal-overlay .trend-pill').filter(has=page.get_by_text('L20', exact=True))
                assert l20.locator('.trend-pct').inner_text() == '50%'
                assert l20.locator('.trend-frac').inner_text() == '10/20'
            page.evaluate("closeCardModal()")
            open_player(page, "history alpha")
            popup.get_by_role('button', name='Compare prices', exact=True).click()
            page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
            assert not popup.evaluate("element => element.open")
            assert "History Alpha" in page.locator('#player-lines-dialog').inner_text()
            if name == "tds2":
                assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ["1.5"]
                assert page.evaluate("TABLE.getData('active')[0].handicap") == "0.5", "Price comparison must not mutate the original feed"
            page.keyboard.press("Escape")
            if name == "tds2" and width == 390:
                page.evaluate("NflHistory.open({...TABLE.getData('active').find(row => row.player === 'history alpha'), prop:'3+td'})")
                assert_logs(page, series['logs'][-20:], 2.5)
                assert 'Over 2.5' in popup.locator('.nhl-history-context').inner_text()
                rates = page.evaluate("cardHitRates({...TABLE.getData('active').find(row => row.player === 'history alpha'), prop:'3+td'})")
                assert rates['L20'] == {'w': 5, 't': 20, 'p': 25}, rates
                page.keyboard.press('Escape')
            if name == 'nfl':
                page.locator('.tabulator-row .player-lines-trigger').filter(has_text='Alpha').click()
                page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
                assert not popup.evaluate("element => element.open")
                page.keyboard.press("Escape")
            assert not errors, errors
            print(f"{name} {width}px: row/history, independent series, ranges, side/line stats, empty states, keyboard, bounds and card/price actions passed")
            page.close()
        browser.close()
finally:
    server.shutdown()
