"""Offline NBA history modal regression for props, points and threes pages."""
from decimal import Decimal, ROUND_HALF_UP
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
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
    scale = 1 if name == "threes" else 10
    return {key: [value * scale for value in values] for key, values in {
        "logs": [0, 1, 2, 3] * 7,
        "career": [1, 3, 2, 4, 0] * 11,
        "bvt": [0, 4, 2, 1],
        "away": [0, 2, 4, 1, 3] * 5 + [0, 4, 2],
        "home": [1, 0, 0, 3, 2] * 5 + [1, 0, 0],
    }.items()}


def payload_for(name):
    prop = "3ptm" if name == "threes" else "pts"
    rows = []
    for player in ["history alpha", "history beta", "no history"]:
        missing = player == "no history"
        series = histories(name)
        row = {
            "player": player, "prop": prop, "handicap": "2" if name == "threes" else "20", "sport": "nba",
            "under": player == "history beta", "pos": "PG", "avgMin": 30,
            "team": "lal", "opp": "bos", "game": "lal @ bos", "dt": "2099-10-01",
            "book": "fd", "line": 150,
            "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155"},
            "liquidity": {}, "links": {}, "hitRate": 50, "hitRateLYR": 40,
            "hitRates": {"career": {"w": 22, "t": 55, "p": 40}, "bvt": {"w": 1, "t": 4, "p": 25}},
            "logs": [None, "3", True] if missing else series["logs"] + [None, "9", False],
            "careerLogs": [] if missing else series["career"] + [None, "8", False],
            "bvtLogs": None if missing else series["bvt"] + [None, "5", True],
            "homeLogs": [] if missing else ([0, 0, 0] if player == "history beta" else series["home"]),
            "oppRank": 15, "oppPosRank": 20,
        }
        if not missing:
            row["awayLogs"] = series["away"] + [None, "8", False]
        row["ouIdx"] = int(row["under"])
        rows.append(row)
    return {"data": rows, "props": [prop], "games": ["lal @ bos"], "updated": {},
            "times": {"lal @ bos": "2099-10-01T23:00:00Z"}}


def chart(page):
    return page.evaluate("""() => {
        const el = document.getElementById('nba-history-chart');
        return {data: el?.data || [], layout: el?.layout || {}};
    }""")


def metrics(page):
    return page.locator('#nba-history-dialog .nhl-history-stats > div').evaluate_all(
        "items => Object.fromEntries(items.map(item => [item.querySelector('span').textContent, item.querySelector('strong').textContent]))")


def assert_logs(page, expected, line, under=False):
    page.wait_for_function("""expected => {
        const trace = document.getElementById('nba-history-chart')?.data?.find(trace => trace.type === 'bar');
        return JSON.stringify(trace?.y) === JSON.stringify(expected);
    }""", arg=expected)
    page.wait_for_function("""() => {
        const scroll = document.querySelector('#nba-history-dialog .nhl-history-plot-scroll');
        return scroll && scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 1;
    }""")
    result = chart(page)
    hits = sum(value < line if under else value > line for value in expected)
    pushes = expected.count(line)
    average = str((Decimal(sum(expected)) / len(expected)).quantize(Decimal('.1'), rounding=ROUND_HALF_UP)).removesuffix('.0')
    assert metrics(page) == {"Hit rate": f"{round(hits * 100 / len(expected))}% ({hits}/{len(expected)})",
                             "Average": average, "Games": str(len(expected))}, metrics(page)
    trace = result["data"][0]
    colors = ["#94a3b8" if value == line else "#36d399" if (value < line if under else value > line) else "#c57580" for value in expected]
    assert trace["marker"]["color"] == colors
    assert trace["text"] == [str(value) for value in expected]
    assert trace["customdata"][-1][0] == "Latest"
    assert any(shape.get("y0") == line == shape.get("y1") for shape in result["layout"].get("shapes", []))
    assert result["layout"]["yaxis"]["range"][0] <= min(expected)
    if pushes:
        assert f"{pushes} push" in page.locator('#nba-history-dialog .nhl-history-note').inner_text()
    return result


def click_row(page, player, modifiers=None):
    page.evaluate("""player => {
        for (const el of document.querySelectorAll('[data-history-fixture]')) el.removeAttribute('data-history-fixture');
        const row = TABLE.getRows('active').find(row => row.getData().player === player);
        row.getCell('ev').getElement().setAttribute('data-history-fixture', 'target');
    }""", player)
    page.locator('[data-history-fixture="target"]').click(modifiers=modifiers or [])


def open_player(page, player):
    page.evaluate("player => NbaHistory.open(TABLE.getData('active').find(row => row.player === player))", player)
    page.wait_for_function("document.getElementById('nba-history-dialog')?.open")


os.chdir(gettempdir())
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ["nba", "pts", "threes"]:
            for width in [1440, 390, 320]:
                page = browser.new_page(viewport={"width": width, "height": 900})
                page.set_default_timeout(6000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.add_init_script("window.EventSource = undefined;")
                page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
                page.route("**/auth.js", lambda route: route.fulfill(
                    body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                    content_type="application/javascript"))
                page.route("**/record_nba.js", lambda route: route.fulfill(
                    body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type="application/javascript"))
                page.route("**/api/**", lambda route: route.fulfill(json=payload_for(name)))
                pending_plotly = []
                if name == "nba" and width == 1440:
                    page.route("**/plotly-3.0.0.min.js", lambda route: pending_plotly.append(route))
                page.goto(f"http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
                page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData('active').length === 3")
                assert page.evaluate("typeof NbaHistory.open") == "function"
                widths = page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])")
                click_row(page, "history alpha")
                page.wait_for_function("document.getElementById('nba-history-dialog')?.open")
                popup = page.locator("#nba-history-dialog")
                assert popup.locator('[data-history-view]:visible').all_text_contents() == ["Game logs", "Career", "Logs vs Opp", "Away", "Home", "Movement", "Order books"]
                assert popup.locator('[data-history-view="logs"]').get_attribute("aria-selected") == "true"
                assert popup.locator('[data-history-view="due"]').count() == 0

                if name == "nba" and width == 1440:
                    page.wait_for_function("!!document.querySelector('script[src*=\"plotly-3\"]')")
                    page.wait_for_timeout(50)
                    assert pending_plotly, "Plotly should load lazily for history"
                    open_player(page, "history beta")
                    page.evaluate("NbaHistory.close()")
                    for route in pending_plotly:
                        route.fulfill(path=str(ROOT / "plotly-3.0.0.min.js"), content_type="application/javascript")
                    page.wait_for_function("!!window.Plotly")
                    page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                    assert not popup.evaluate("element => element.open"), "A late chart must not reopen a closed dialog"
                    open_player(page, "history alpha")

                assert "History Alpha" in page.locator("#nba-history-title").inner_text()
                context = popup.locator('.nhl-history-context').inner_text()
                assert "LAL @ BOS" in context, context
                line = 2 if name == "threes" else 20
                assert f"Over {line}" in context, context
                assert "three" in context.lower() if name == "threes" else "points" in context.lower(), context
                series = histories(name)
                for view, history in series.items():
                    popup.locator(f'[data-history-view="{view}"]').click()
                    for size in ["20", "10", "all"]:
                        popup.locator(f'[data-history-range="{size}"]').click()
                        current = assert_logs(page, history if size == "all" else history[-int(size):], line)
                    if view in ["away", "home"]:
                        assert current["layout"]["xaxis"]["title"]["text"] == f"{view.title()} games"
                        assert f"{view} games" in popup.locator('.nhl-history-note').inner_text()
                    if view == "career":
                        assert "career" in popup.locator('.nhl-history-note').inner_text().lower()
                        assert "career" in current["layout"]["xaxis"]["title"]["text"].lower()
                    popup.locator('[data-history-range="20"]').click()

                home = popup.locator('[data-history-view="home"]')
                home.press("Home")
                logs = popup.locator('[data-history-view="logs"]')
                assert logs.get_attribute("aria-selected") == "true"
                logs.press("ArrowRight")
                assert popup.locator('[data-history-view="career"]').get_attribute("aria-selected") == "true"
                popup.locator('[data-history-view="career"]').press("End")
                order_books = popup.locator('[data-history-view="orderbooks"]')
                assert order_books.get_attribute("aria-selected") == "true"
                assert page.locator('#nba-history-panel').get_attribute('aria-labelledby') == order_books.get_attribute('id')
                bounds = popup.bounding_box()
                assert 0 <= bounds["x"] and bounds["x"] + bounds["width"] <= width + 1, bounds
                assert 0 <= bounds["y"] and bounds["y"] + bounds["height"] <= 901, bounds
                tabs = popup.locator('.nhl-history-tabs').evaluate("el => ({width:el.clientWidth, scroll:el.scrollWidth})")
                assert tabs['scroll'] <= tabs['width'] + 1, tabs
                if name == "nba":
                    popup.locator('[data-history-view="career"]').click()
                    assert_logs(page, series['career'][-20:], line)
                    screenshot = Path(gettempdir()) / f"nba-history-{width}.png"
                    page.screenshot(path=str(screenshot))
                    print(f"Screenshot: {screenshot}")
                page.keyboard.press("Escape")
                assert not popup.evaluate("element => element.open")
                assert page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])") == widths

                open_player(page, "history beta")
                assert "Under" in popup.locator('.nhl-history-context').inner_text()
                for view, history in series.items():
                    popup.locator(f'[data-history-view="{view}"]').click()
                    assert_logs(page, [0, 0, 0] if view == "home" else history[-20:], line, under=True)
                open_player(page, "no history")
                for view in series:
                    popup.locator(f'[data-history-view="{view}"]').click()
                    assert popup.locator('.nhl-history-empty').is_visible()
                    assert metrics(page) == {}, "Missing history must not display a 0% hit rate"
                    assert not chart(page)["data"], "Missing history must clear the previous player's chart"
                popup.get_by_role('button', name='Close player history').click()
                page.evaluate("NbaHistory.open({...TABLE.getData('active')[0], blurred:true})")
                assert not popup.evaluate("element => element.open"), "Blurred rows must not reveal history"

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
                for modifier in ["Control", "Shift"]:
                    click_row(page, "history alpha", modifiers=[modifier])
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
                page.evaluate("closeCardModal()")
                open_player(page, "history alpha")
                popup.get_by_role('button', name='Compare prices', exact=True).click()
                page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
                assert not popup.evaluate("element => element.open")
                assert "History Alpha" in page.locator('#player-lines-dialog').inner_text()
                page.keyboard.press("Escape")
                page.locator('.tabulator-row .player-lines-trigger').filter(has_text='Alpha').click()
                page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
                assert not popup.evaluate("element => element.open"), "Player comparison controls must not open history"
                page.keyboard.press("Escape")

                if name == "nba" and width == 1440:
                    # Match the backend's percentage rounding at exact .5 ties.
                    for hits, percentage in [(1, 12), (5, 62)]:
                        values = [line + 1] * hits + [0] * (8 - hits)
                        page.evaluate("""({values, hits, percentage}) => NbaHistory.open({
                            ...TABLE.getData('active').find(row => row.player === 'history alpha'),
                            careerLogs:values, hitRates:{career:{w:hits,t:8,p:percentage}}
                        })""", {"values": values, "hits": hits, "percentage": percentage})
                        popup.locator('[data-history-view="career"]').click()
                        popup.locator('[data-history-range="all"]').click()
                        assert_logs(page, values, line)
                        assert metrics(page)["Hit rate"] == f"{percentage}% ({hits}/8)"
                        page.keyboard.press("Escape")
                    page.evaluate("""NbaHistory.open({...TABLE.getData('active')[0],
                        player:'<img src=x onerror="window.historyInjected=1">',
                        game:'<svg onload="window.historyInjected=2">'})""")
                    assert popup.locator('.nhl-history-header img, .nhl-history-header svg').count() == 0
                    assert not page.evaluate("window.historyInjected")
                    assert "<" in page.locator('#nba-history-title').inner_text()
                    page.keyboard.press("Escape")
                assert not errors, errors
                print(f"{name} {width}px: row/history, career/opponent/venue series, ranges, under/over pushes, keyboard, bounds and card/price actions passed", flush=True)
                page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
