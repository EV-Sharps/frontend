"""Offline browser regression for NHL Due, recent, opponent and venue histories."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from math import floor
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LOGS = [0, 1, 2, 3] * 7
AWAY_LOGS = [0, 2, 4, 1, 3] * 5 + [0, 4, 2]
HOME_LOGS = [1, 0, 0, 3, 2] * 5 + [1, 0, 0]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # Browser contexts can close while logo requests are still in flight.


def payload_for(name):
    prop = {"nhl": "sog", "atgs": "atgs", "atgs2": "atgs", "fgs": "fgs"}[name]
    handicap = {"nhl": "2", "atgs": "0.5", "atgs2": "1.5", "fgs": "0.5"}[name]
    rows = []
    for player in ["history alpha", "history beta", "no history"]:
        missing = player == "no history"
        row = {
            "player": player, "prop": prop, "handicap": handicap, "sport": "nhl",
            "under": player == "history beta" and name == "nhl", "pos": "C",
            "team": "tor", "opp": "bos", "game": "tor @ bos", "dt": "2099-10-01",
            "avgTOI": 21, "teamTotal": 3.1, "ppLine": "1", "oppRank": 20,
            "dvpRank": 18, "goalie": "jeremy swayman", "goalieGSAA": 2.4,
            "goalieSV": .921, "book": "fd", "line": 150,
            "bookOdds": {"fd": "150/-170", "dk": "140/-165", "pn": "130/-160", "circa": "125/-155"},
            "liquidity": {}, "links": {}, "hitRate": 50, "hitRateLYR": 40,
            "logs": [None, "3", True] if missing else LOGS + [None, "9", False],
            "bvtLogs": None if missing else ([0, 3, 2, 1, None, "5", True] if player == "history alpha" else [7, 0]),
            "awayLogs": None if missing else (AWAY_LOGS + [None, "9", False] if player == "history alpha" else [2, 0, 4, 1]),
            "homeLogs": [] if missing else (HOME_LOGS + [None, "8", True] if player == "history alpha" else [0, 0, 0]),
            "hitRates": {"bvt": {"w": 1, "t": 4, "p": 25}},
            "due": {} if missing else {"g": {"btwn": [1, 3, 0, 2], "streak": 4, "med": 1.5, "avg": 1.5, "z_median": .5}},
        }
        row["ouIdx"] = int(row["under"])
        if missing:
            del row["awayLogs"]  # An older feed may omit the new fields entirely.
        rows.append(row)
    payload = {"data": rows, "props": [prop], "games": ["tor @ bos"], "updated": {},
               "times": {"tor @ bos": "2099-10-01T23:00:00Z"}}
    if name == "atgs":
        payload["comparisonOdds"] = {
            "tor @ bos": {"history alpha": {"1.5": {"fd": "1000", "dk": "1100"},
                                            "2.5": {"dk": "4000"}, "3.5": {"fd": "9000"}},
                          "other player": {"1.5": {"fd": "8888"}}},
            "nyr @ buf": {"history alpha": {"1.5": {"fd": "7777"}}},
        }
    return payload


def chart(page):
    return page.evaluate("""() => {
        const el = document.getElementById('nhl-history-chart');
        return {data: el?.data || [], layout: el?.layout || {}, stats: document.querySelector('.nhl-history-stats')?.textContent};
    }""")


def wait_values(page, expected):
    page.wait_for_function("""expected => {
        const trace = document.getElementById('nhl-history-chart')?.data?.find(trace => trace.type === 'bar');
        return JSON.stringify(trace?.y) === JSON.stringify(expected);
    }""", arg=expected)
    return chart(page)


def metrics(page):
    return page.locator('.nhl-history-stats > div').evaluate_all("items => Object.fromEntries(items.map(item => [item.querySelector('span').textContent, item.querySelector('strong').textContent]))")


def assert_logs(page, expected, line, under=False):
    result = wait_values(page, expected)
    hits = sum(value < line if under else value > line for value in expected)
    average = str(round(sum(expected) / len(expected), 1)).removesuffix('.0')
    assert metrics(page) == {"Hit rate": f"{floor(hits * 100 / len(expected) + .5)}% ({hits}/{len(expected)})",
                             "Average": average, "Games": str(len(expected))}, metrics(page)
    trace = result['data'][0]
    wanted = ["#94a3b8" if value == line else "#36d399" if (value < line if under else value > line) else "#c57580" for value in expected]
    assert trace['marker']['color'] == wanted, trace
    assert trace['text'] == [str(value) for value in expected]
    assert trace['customdata'][-1][0] == 'Latest'
    return result


def click_row(page, player, modifiers=None):
    page.evaluate("""player => {
        for (const el of document.querySelectorAll('[data-history-fixture]')) el.removeAttribute('data-history-fixture');
        const row = TABLE.getRows('active').find(row => row.getData().player === player);
        const cell = row.getCell(PAGE === 'atgs2' ? 'outlier' : 'ev');
        cell.getElement().setAttribute('data-history-fixture', 'target');
    }""", player)
    page.locator('[data-history-fixture="target"]').click(modifiers=modifiers or [])


def open_player(page, player):
    page.evaluate("player => NhlHistory.open(TABLE.getData('active').find(row => row.player === player))", player)
    page.wait_for_function("document.getElementById('nhl-history-dialog')?.open")


def tab(page, view):
    page.locator(f'[data-history-view="{view}"]').click()


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width in [("atgs", 1440), ("atgs", 390), ("atgs", 320), ("nhl", 1440), ("nhl", 390), ("atgs2", 390), ("fgs", 1440)]:
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("window.EventSource = undefined;")
            page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
            page.route("**/auth.js", lambda route: route.fulfill(
                body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
                content_type="application/javascript"))
            page.route("**/record_nhl.js", lambda route: route.fulfill(
                body="let RECORD_UPD = ''; let RECORD = {worst:{best:{}}};", content_type="application/javascript"))
            page.route("**/api/**", lambda route: route.fulfill(json=payload_for(name)))
            pending_plotly = []
            if name == "atgs" and width == 1440:
                page.route("**/plotly-3.0.0.min.js", lambda route: pending_plotly.append(route))
            page.goto(f"http://localhost:{server.server_port}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
            page.wait_for_function("document.getElementById('data-status')?.hidden === true && TABLE.getData('active').length === 3")
            assert page.evaluate("typeof NhlHistory.open") == "function"
            widths = page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])")
            focus = page.locator("#table input").first
            focus.focus()
            click_row(page, "history alpha")
            page.wait_for_function("document.getElementById('nhl-history-dialog')?.open")

            if name == "atgs" and width == 1440:
                # A delayed script must not reopen or render a stale player's closed dialog.
                page.wait_for_function("!!document.querySelector('script[src*=\"plotly-3\"]')")
                page.wait_for_timeout(50)
                assert pending_plotly, "Plotly should load lazily when history opens"
                tab(page, "logs")
                open_player(page, "history beta")
                page.evaluate("NhlHistory.close()")
                for route in pending_plotly:
                    route.fulfill(path=str(ROOT / "plotly-3.0.0.min.js"), content_type="application/javascript")
                page.wait_for_function("!!window.Plotly")
                page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
                open_player(page, "history alpha")

            assert "History Alpha" in page.locator("#nhl-history-title").inner_text()
            assert "BOS" in page.locator(".nhl-history-context").inner_text().upper()
            due = page.locator('[data-history-view="due"]')
            assert due.is_enabled() == (name == "atgs")
            if name == "atgs":
                page.wait_for_function("document.getElementById('nhl-history-chart')?.data?.length > 0")
                assert due.get_attribute("aria-selected") == "true"
                due_chart = chart(page)
                assert due_chart['data'][0]['x'] == [0, 1, 2, 3]
                assert due_chart['data'][0]['y'] == [1, 1, 1, 1]
                assert due_chart['layout']['shapes'][0]['x0'] == due_chart['layout']['shapes'][0]['x1'] == 4
                assert metrics(page) == {"Current gap": "4 games", "Median gap": "1.5 games", "Average gap": "1.5 games"}
                tab(page, "logs")
            else:
                assert page.locator('[data-history-view="logs"]').get_attribute("aria-selected") == "true"
            line = float(payload_for(name)['data'][0]['handicap'])
            current = assert_logs(page, LOGS[-20:], line)
            assert any(shape.get("y0") == float(payload_for(name)["data"][0]["handicap"]) == shape.get("y1")
                       for shape in current["layout"].get("shapes", [])), current["layout"]
            tab(page, "bvt")
            assert_logs(page, [0, 3, 2, 1], line)
            assert "BOS" in page.locator(".nhl-history-note").inner_text().upper()
            if name == 'nhl':
                screenshot = Path(gettempdir()) / f"nhl-history-opponent-{width}.png"
                page.screenshot(path=str(screenshot))
                print(f"Screenshot: {screenshot}")
            tab(page, "logs")
            assert_logs(page, LOGS[-20:], line)
            page.locator('[data-history-range="10"]').click()
            assert_logs(page, LOGS[-10:], line)
            page.locator('[data-history-range="all"]').click()
            assert_logs(page, LOGS, line)
            page.locator('[data-history-range="20"]').click()
            assert_logs(page, LOGS[-20:], line)

            # Venue histories are independent chronological series, not filtered
            # subsets of the already-truncated recent-game logs.
            for venue, history in [("away", AWAY_LOGS), ("home", HOME_LOGS)]:
                tab(page, venue)
                assert page.locator(f'[data-history-view="{venue}"]').inner_text() == venue.title()
                venue_chart = assert_logs(page, history[-20:], line)
                assert venue_chart["layout"]["xaxis"]["title"]["text"] == f"{venue.title()} games"
                assert f"{venue} games" in page.locator('.nhl-history-note').inner_text()
                page.locator('[data-history-range="10"]').click()
                assert_logs(page, history[-10:], line)
                page.locator('[data-history-range="all"]').click()
                assert_logs(page, history, line)
                assert f"All {len(history)} available" in page.locator('.nhl-history-note').inner_text()
                page.locator('[data-history-range="20"]').click()
                assert_logs(page, history[-20:], line)

            away_tab = page.locator('[data-history-view="away"]')
            home_tab = page.locator('[data-history-view="home"]')
            away_tab.focus()
            away_tab.press("ArrowRight")
            assert home_tab.get_attribute("aria-selected") == "true"
            assert_logs(page, HOME_LOGS[-20:], line)
            home_tab.press("ArrowLeft")
            assert away_tab.get_attribute("aria-selected") == "true"
            assert_logs(page, AWAY_LOGS[-20:], line)
            away_tab.press("Home")
            first_view = "due" if name == "atgs" else "logs"
            first_tab = page.locator(f'[data-history-view="{first_view}"]')
            assert first_tab.get_attribute("aria-selected") == "true"
            first_tab.press("End")
            assert home_tab.get_attribute("aria-selected") == "true"
            assert page.locator('#nhl-history-panel').get_attribute('aria-labelledby') == home_tab.get_attribute('id')
            assert_logs(page, HOME_LOGS[-20:], line)

            bounds = page.locator("#nhl-history-dialog").bounding_box()
            assert 0 <= bounds["x"] and bounds["x"] + bounds["width"] <= width + 1, bounds
            assert 0 <= bounds["y"] and bounds["y"] + bounds["height"] <= 901, bounds
            if width < 600:
                tabs = page.locator('.nhl-history-tabs').evaluate("""element => {
                    const box = element.getBoundingClientRect();
                    return {left:box.left, right:box.right, width:element.clientWidth, scroll:element.scrollWidth,
                        buttons:[...element.querySelectorAll('button')].map(button => {
                            const rect = button.getBoundingClientRect();
                            return {left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom};
                        })};
                }""")
                assert len(tabs['buttons']) == 5
                assert tabs['scroll'] <= tabs['width'] + 1, tabs
                assert all(bounds['x'] <= item['left'] and item['right'] <= bounds['x'] + bounds['width']
                           for item in tabs['buttons']), tabs
                for index, first in enumerate(tabs['buttons']):
                    for second in tabs['buttons'][index + 1:]:
                        assert (first['right'] <= second['left'] + 1 or second['right'] <= first['left'] + 1
                                or first['bottom'] <= second['top'] + 1 or second['bottom'] <= first['top'] + 1), tabs
            if name == "atgs":
                screenshot = Path(gettempdir()) / f"nhl-history-{width}.png"
                page.screenshot(path=str(screenshot))
                print(f"Screenshot: {screenshot}")
            page.keyboard.press("Escape")
            assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
            assert page.evaluate("TABLE.getColumns().map(column => [column.getField(), column.getWidth()])") == widths

            open_player(page, "history beta")
            if name == 'nhl':
                assert_logs(page, LOGS[-20:], line, under=True)
            tab(page, "bvt")
            assert_logs(page, [7, 0], line, under=name == 'nhl')
            tab(page, "away")
            assert_logs(page, [2, 0, 4, 1], line, under=name == 'nhl')
            tab(page, "home")
            assert_logs(page, [0, 0, 0], line, under=name == 'nhl')
            assert "History Beta" in page.locator("#nhl-history-title").inner_text()
            open_player(page, "no history")
            assert due.is_disabled()
            assert page.locator(".nhl-history-empty").is_visible()
            tab(page, "bvt")
            assert page.locator(".nhl-history-empty").is_visible()
            assert not chart(page)["data"], "Missing history must not retain previous player bars"
            for venue in ["away", "home"]:
                tab(page, venue)
                assert page.locator('.nhl-history-empty').is_visible()
                assert venue in page.locator('.nhl-history-empty').inner_text().lower()
                assert not chart(page)['data'], f"Missing {venue} history must clear previous bars"
                assert metrics(page) == {}, "Empty histories must not appear as 0% hit rates"
            if name == 'atgs':
                page.evaluate("NhlHistory.open({...TABLE.getData('active').find(row => row.player === 'history alpha'), under:true})")
                assert due.is_disabled(), 'An under must not inherit anytime goals gap history'
                assert_logs(page, LOGS[-20:], line, under=True)
                page.evaluate("""NhlHistory.open({
                    ...TABLE.getData('active').find(row => row.player === 'history alpha'),
                    due:{g:{btwn:[19], streak:3, med:0, avg:0}}
                })""")
                single_gap = wait_values(page, [1])
                assert single_gap['data'][0]['x'] == [19]
                assert metrics(page) == {"Current gap": "3 games", "Median gap": "19 games", "Average gap": "19 games"}, metrics(page)
            page.evaluate("NhlHistory.close()")

            click_row(page, "history alpha", modifiers=["Control"])
            assert page.locator("#card-modal-overlay").evaluate("element => element.classList.contains('open')")
            assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
            page.evaluate("closeCardModal()")

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
            page.get_by_role("button", name="Play card", exact=True).click()
            assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
            assert page.locator("#card-modal-overlay").evaluate("element => element.classList.contains('open')")
            page.evaluate("closeCardModal()")
            open_player(page, "history alpha")
            page.get_by_role("button", name="Compare prices", exact=True).click()
            page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
            assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
            if name == "atgs":
                assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ["0.5", "1.5", "2.5", "3.5"]
                comparison = page.locator('#player-lines-dialog').inner_text()
                assert all(f"+{price}" in comparison for price in [1000, 1100, 4000, 9000]), comparison
                assert "+8888" not in comparison and "+7777" not in comparison, comparison
                assert page.evaluate("RES.data.length") == 3, "Comparison must not reinsert alternate full rows in the main table"
            page.keyboard.press("Escape")
            if name == "nhl":
                page.locator('.tabulator-row .player-lines-trigger').filter(has_text="Alpha").click()
                page.wait_for_function("document.getElementById('player-lines-dialog')?.open")
                assert not page.evaluate("document.getElementById('nhl-history-dialog').open")
                page.keyboard.press("Escape")
            assert not errors, errors
            print(f"{name} {width}px: row popup, venue series/ranges, over/under/zero stats, keyboard tabs, empty history, mobile bounds and card actions passed")
            page.close()
        browser.close()
finally:
    server.shutdown()
