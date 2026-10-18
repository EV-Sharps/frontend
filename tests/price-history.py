"""Offline price-history component and actual clicked-row integration checks."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import mkdtemp
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
TIMES = ["2026-10-18T12:00:00Z", "2026-10-18T13:00:00Z", "2026-10-18T14:00:00Z"]
POINTS = [
    {"ts": TIMES[0], "fd": 150, "pn": 200, "circa": 175, "dk_under": -210, "circa_under": -250},
    {"ts": TIMES[1], "fd": 180},
    {"ts": TIMES[2], "fd": 160, "pn": 220, "circa": 190, "dk_under": -230, "circa_under": -260},
]
ROW = {
    "player": "history alpha", "sport": "nfl", "prop": "attd", "handicap": "0.5",
    "team": "phi", "opp": "dal", "game": "phi @ dal", "dt": "2099-10-01",
    "under": False, "ouIdx": 0, "pos": "RB", "book": "fd", "line": 160,
    "bookOdds": {"fd": "160/-190", "pn": "220/-270", "circa": "190/-260", "dk": "170/-230"},
    "oddsChart": POINTS, "logs": [0, 1, 0, 2, 0, 1], "bvtLogs": [0, 1],
    "homeLogs": [1, 0], "awayLogs": [0, 1], "snaps": ["60%", "70%"],
    "hitRate": 50, "hitRateLYR": 40, "liquidity": {}, "links": {}, "oppRank": {},
}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def fixture_html():
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/price-history.css">
      <style>html,body{margin:0;min-width:0;overflow:auto;background:#071421;color:#e8edf4}
      body{padding:12px;box-sizing:border-box}#fixture{width:100%;max-width:900px;margin:auto;min-width:0}</style>
      <script src="/page-performance.js"></script><script src="/price-history.js"></script>
      </head><body><main id="fixture"></main></body></html>"""


def new_page(browser, width=1440):
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.set_default_timeout(8000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("window.EventSource = undefined;")
    page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
    return page, errors


def mount(page, row):
    page.evaluate("""row => {
      window.fixtureController?.destroy();
      window.fixtureController = PriceHistory.mount(document.getElementById('fixture'), row);
    }""", row)


def wait_chart(page, selector=".price-history-chart"):
    page.wait_for_function("""selector => {
      const element = document.querySelector(selector);
      return element && Array.isArray(element.data) && element.data.length > 0;
    }""", arg=selector)


def chart(page, selector=".price-history-chart"):
    return page.locator(selector).evaluate("element => ({data:element.data||[],layout:element.layout||{}})")


def assert_fits(locator, width):
    box = locator.bounding_box()
    assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, box
    dimensions = locator.evaluate("element => ({width:element.clientWidth,scroll:element.scrollWidth})")
    assert dimensions["scroll"] <= dimensions["width"] + 1, dimensions


def component_checks(browser, base, temporary):
    for width in [1440, 390, 320]:
        page, errors = new_page(browser, width)
        page.route("**/__price-history-fixture.html", lambda route: route.fulfill(body=fixture_html(), content_type="text/html"))
        page.goto(base + "/__price-history-fixture.html")
        mount(page, ROW)
        wait_chart(page)
        assert set(page.locator('[data-price-book]').evaluate_all("items => items.map(item=>item.dataset.priceBook)")) == {"fd", "pn", "circa"}
        result = chart(page)
        assert len(result["data"]) == 3, "Every recorded book must be visible initially"
        for trace in result["data"]:
            assert len(trace["x"]) == 3, "Chart must not append a synthetic now observation"
            assert trace["x"][-1] == page.evaluate("value => Date.parse(value)", TIMES[-1])
        assert sum(trace["y"][1] is None for trace in result["data"]) == 2, result["data"]
        assert all(trace.get("connectgaps") is not True for trace in result["data"])
        page.locator('[data-price-book="pn"]').click()
        wait_chart(page)
        assert len(chart(page)["data"]) == 3, "Focusing a book must preserve the comparison by default"
        assert page.locator('[data-price-first]').inner_text() == '+200'
        assert page.locator('[data-price-last]').inner_text() == '+220'
        assert page.locator('[data-price-move]').inner_text() == '-2.08 pp'
        page.locator('[data-price-scale="probability"]').click()
        page.wait_for_function("document.querySelector('[data-price-scale=probability]').getAttribute('aria-pressed') === 'true'")
        wait_chart(page)
        assert chart(page)['layout']['yaxis']['range'][0] < chart(page)['layout']['yaxis']['range'][1]
        page.locator('[data-price-scale="odds"]').click()
        page.locator('[data-price-compare]').uncheck()
        page.wait_for_function("document.querySelector('.price-history-chart')?.data?.length === 1")
        page.locator('[data-price-compare]').check()
        page.wait_for_function("document.querySelector('.price-history-chart')?.data?.length === 3")
        assert_fits(page.locator('.price-history'), width)
        page.screenshot(path=str(Path(temporary) / f"price-history-{width}.png"))

        # An under selection may use only independently recorded *_under values.
        mount(page, {**ROW, "under": True, "ouIdx": 1, "circa_blurred": True})
        wait_chart(page)
        assert page.locator('[data-price-book]').evaluate_all("items => items.map(item=>item.dataset.priceBook)") == ["dk"]
        assert len(chart(page)["data"]) == 1
        assert chart(page)["data"][0]["y"][1] is None
        assert page.evaluate("row => PriceHistory.hasData({...row,under:true,oddsChart:[{ts:row.oddsChart[0].ts,fd:150}]})", ROW) is False
        assert page.evaluate("row => PriceHistory.hasData({...row,blurred:true})", ROW) is False
        assert page.evaluate("row => PriceHistory.hasData({...row,oddsChart:[]})", ROW) is False
        assert page.evaluate("row => PriceHistory.hasData({...row,oddsChart:[{ts:'not-a-date',fd:150}]})", ROW) is False
        assert page.evaluate("row => PriceHistory.hasData({...row,oddsChart:[{ts:row.oddsChart[0].ts,fd:150},{ts:row.oddsChart[0].ts,fd:null}]})", ROW) is False
        for invalid in [None, True, "", "150garbage", 0, 99, -99, -100000, -20000, -10660]:
            assert page.evaluate("""({row,value}) => PriceHistory.hasData({...row,
              oddsChart:[{ts:row.oddsChart[0].ts,fd:value}]})""", {"row": ROW, "value": invalid}) is False, invalid

        mount(page, {**ROW, "oddsChart": [{"ts": TIMES[0], "fd": 150}]})
        wait_chart(page)
        assert len(chart(page)["data"]) == 1
        assert len(chart(page)["data"][0]["x"]) == 1
        assert page.locator('[data-price-direction]').inner_text() == 'One capture'
        mount(page, {**ROW, "oddsChart": [{"ts": TIMES[0], "fd": 110}, {"ts": TIMES[2], "fd": -110}]})
        wait_chart(page)
        crossover = chart(page)
        assert abs(crossover['data'][0]['y'][0] - 10000 / 210) < 0.0001
        assert abs(crossover['data'][0]['y'][1] - 11000 / 210) < 0.0001
        assert crossover['layout']['yaxis']['range'][0] > crossover['layout']['yaxis']['range'][1]
        assert all(abs(int(tick.replace(',', '').lstrip('+'))) >= 100 for tick in crossover['layout']['yaxis']['ticktext'])
        page.evaluate("fixtureController.destroy()")
        assert page.locator('#fixture .price-history').count() == 0
        assert not errors, errors
        page.close()
        print(f"PASS component, normalization, sides, gaps and layout at {width}px")


def deferred_disposal(browser, base):
    page, errors = new_page(browser)
    pending = []
    page.route("**/__price-history-fixture.html", lambda route: route.fulfill(body=fixture_html(), content_type="text/html"))
    page.route("**/plotly-3.0.0.min.js", lambda route: pending.append(route))
    page.goto(base + "/__price-history-fixture.html")
    mount(page, ROW)
    page.wait_for_function("!!document.querySelector('script[src*=\"plotly-3\"]')")
    page.wait_for_timeout(30)
    assert pending
    page.evaluate("fixtureController.destroy()")
    for route in pending:
        route.fulfill(path=str(ROOT / "plotly-3.0.0.min.js"), content_type="application/javascript")
    page.wait_for_function("!!window.Plotly")
    page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    assert page.locator('#fixture .price-history').count() == 0
    assert not errors, errors
    page.close()
    print("PASS deferred Plotly disposal")


def table_payload(name):
    prop = {"tds": "attd", "tds2": "2+td", "nfl": "rush_yd", "dingers": "hr", "charts": "hr", "tracker": "hr"}[name]
    first = {**ROW, "prop": prop, "sport": "mlb" if prop == "hr" else "nfl"}
    second = {**first, "player": "history beta", "oddsChart": [{"ts": TIMES[0], "fd": 350}, {"ts": TIMES[2], "fd": 400}]}
    missing = {**first, "player": "no price history"}
    missing.pop("oddsChart")
    return {"data": [first, second, missing], "props": [prop], "games": ["phi @ dal"],
            "updated": {}, "times": {"phi @ dal": "2099-10-01T23:00:00Z"}}


def setup_actual_page(page, name, base):
    page.route("**/auth.js", lambda route: route.fulfill(
        body=(ROOT / "auth.js").read_text(encoding="utf-8").replace("let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
        content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json=table_payload(name)))
    page.goto(f"{base}/{name}.html?view=compact&devig=pn-circa&weight=1-1&ou=ou")
    page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && TABLE.getData('active').length === 3")


def nfl_dialog_checks(browser, base, temporary):
    for name, width in [("tds", 1440), ("tds", 390), ("tds", 320), ("nfl", 390), ("tds2", 390)]:
        page, errors = new_page(browser, width)
        setup_actual_page(page, name, base)
        # A real table-cell click must open the existing player detail dialog.
        page.evaluate("""() => {
          const row=TABLE.getRows('active').find(item=>item.getData().player==='history alpha');
          row.getCell(PAGE==='tds2'?'outlier':'ev').getElement().dataset.priceFixture='open';
        }""")
        page.locator('[data-price-fixture="open"]').click()
        page.wait_for_function("document.getElementById('nfl-history-dialog')?.open")
        popup = page.locator('#nfl-history-dialog')
        prices = popup.locator('[data-history-view="pricehistory"]')
        assert prices.is_visible()
        prices.click()
        wait_chart(page, '#nfl-history-price-history .price-history-chart')
        assert popup.locator('.player-history-game-content').is_hidden()
        assert popup.locator('.nhl-history-ranges').is_hidden()
        assert_fits(popup, width)
        assert_fits(popup.locator('.price-history'), width)
        if name == 'tds':
            page.screenshot(path=str(Path(temporary) / f"tds-price-history-{width}.png"))
        popup.locator('[data-history-view="logs"]').click()
        assert popup.locator('.player-history-game-content').is_visible()
        prices.click()
        page.evaluate("NflHistory.open(TABLE.getData('active').find(row=>row.player==='history beta'))")
        popup.locator('[data-history-view="pricehistory"]').click()
        wait_chart(page, '#nfl-history-price-history .price-history-chart')
        assert popup.locator('[data-price-book]').evaluate_all("items=>items.map(item=>item.dataset.priceBook)") == ["fd"]
        page.evaluate("NflHistory.open(TABLE.getData('active').find(row=>row.player==='no price history'))")
        assert popup.locator('[data-history-view="pricehistory"]').is_hidden()
        assert popup.locator('.price-history').count() == 0
        popup.locator('[data-history-view="logs"]').press('End')
        assert popup.locator('[data-history-view="home"]').get_attribute('aria-selected') == 'true'
        page.keyboard.press('Escape')
        assert not popup.evaluate('element=>element.open')
        assert not errors, errors
        page.close()
        print(f"PASS {name} clicked-row price tab, replacement and close at {width}px")


def deferred_dialog_checks(browser, base):
    for action in ['close', 'replace']:
        page, errors = new_page(browser, 390)
        pending = []
        page.route('**/plotly-3.0.0.min.js', lambda route: pending.append(route))
        setup_actual_page(page, 'tds', base)
        page.evaluate("NflHistory.open(TABLE.getData('active').find(row=>row.player==='history alpha'))")
        popup = page.locator('#nfl-history-dialog')
        popup.locator('[data-history-view="pricehistory"]').click()
        page.wait_for_function("!!document.querySelector('script[src*=\"plotly-3\"]')")
        page.wait_for_timeout(30)
        assert pending
        if action == 'close':
            popup.locator('.nhl-history-close').click()
        else:
            page.evaluate("NflHistory.open(TABLE.getData('active').find(row=>row.player==='history beta'))")
            popup.locator('[data-history-view="pricehistory"]').click()
        for route in pending:
            route.fulfill(path=str(ROOT / 'plotly-3.0.0.min.js'), content_type='application/javascript')
        page.wait_for_function('!!window.Plotly')
        if action == 'close':
            page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            assert popup.locator('.js-plotly-plot').count() == 0
            assert not popup.evaluate('element=>element.open')
        else:
            wait_chart(page, '#nfl-history-price-history .price-history-chart')
            assert popup.locator('.js-plotly-plot').count() == 1
            assert popup.locator('[data-price-first]').inner_text() == '+350'
            assert popup.locator('[data-price-last]').inner_text() == '+400'
        assert not errors, errors
        page.close()
        print(f'PASS deferred dialog {action} before Plotly loads')


def setup_hr_page(page, name, base):
    page.route('**/auth.js', lambda route: route.fulfill(
        body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
        content_type='application/javascript'))
    page.route('**/api/**', lambda route: route.fulfill(json=[] if 'popular' in route.request.url
        else {'data': [], 'games': [], 'props': [], 'updated': {}}))
    page.goto(f'{base}/{name}.html?view=compact')
    page.wait_for_function("typeof TABLE !== 'undefined' && TABLE")
    if name != 'tracker':
        page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    else:
        page.wait_for_function("typeof trackerFetchPending !== 'undefined' && !trackerFetchPending")
        if page.locator('#toggle-bets').is_visible():
            page.locator('#toggle-bets').click()
    rows = table_payload(name)['data']
    for row in rows:
        row.update(team='nyy', opp='bos', game='nyy @ bos',
                   homerLogs={'pa': {'btwn': [2, 3, 4], 'streak': 2, 'med': 3, 'avg': 3},
                              'bbe': {'btwn': [1, 2], 'streak': 1, 'med': 2, 'avg': 2}})
    page.evaluate('''async rows => {
      TABLE.setColumns([{title:'Player',field:'player',width:210}]);
      TABLE.clearFilter(true);
      await TABLE.replaceData(rows);
      TABLE.getRows().forEach(row=>row.getElement().dataset.priceFixture=row.getData().player);
    }''', rows)
    page.wait_for_function("TABLE.getData('active').length === 3")


def hr_sidebar_checks(browser, base, temporary, cases=None):
    for name, width in cases or [('dingers', 1440), ('dingers', 390), ('charts', 1440), ('charts', 390), ('tracker', 1440), ('tracker', 390)]:
        page, errors = new_page(browser, width)
        setup_hr_page(page, name, base)
        page.locator('[data-price-fixture="history alpha"]').click()
        selector = page.locator('#btwn-select')
        if name == 'dingers':
            assert selector.input_value() == 'pa', 'Retain the existing default detail view'
            selector.select_option('odds')
        else:
            assert selector.input_value() == 'odds'
        wait_chart(page, '#price-history-panel .price-history-chart')
        assert page.locator('#price-history-panel').is_visible()
        assert page.locator('#chart').is_hidden()
        assert_fits(page.locator('#price-history-panel .price-history'), width)
        page.screenshot(path=str(Path(temporary) / f'{name}-price-history-{width}.png'))
        # Selecting another detail view removes the mounted price chart.
        if name != 'tracker':
            selector.select_option('pa')
            assert page.locator('#price-history-panel').is_hidden()
            assert page.locator('#price-history-panel .price-history').count() == 0
            selector.select_option('odds')
            wait_chart(page, '#price-history-panel .price-history-chart')
        # The real row-selection callback must replace the mounted dataset.
        page.evaluate("rowClick(TABLE.getRows().find(row=>row.getData().player==='history beta'))")
        if name == 'dingers':
            selector.select_option('odds')
        wait_chart(page, '#price-history-panel .price-history-chart')
        assert page.locator('#price-history-panel [data-price-book]').evaluate_all('items=>items.map(item=>item.dataset.priceBook)') == ['fd']
        assert page.locator('#price-history-panel [data-price-last]').inner_text() == '+400'
        page.evaluate("rowClick(TABLE.getRows().find(row=>row.getData().player==='no price history'))")
        assert page.locator('#price-history-panel').is_hidden()
        assert page.locator('#price-history-panel .price-history').count() == 0
        assert page.locator('#btwn-select option[value="odds"]').is_disabled()
        page.evaluate("rowClick(TABLE.getRows().find(row=>row.getData().player==='history alpha'))")
        if name == 'dingers':
            selector.select_option('odds')
        wait_chart(page, '#price-history-panel .price-history-chart')
        page.evaluate('closeRightBody()')
        assert page.locator('#right-body').is_hidden()
        assert page.locator('#price-history-panel .price-history').count() == 0
        assert not errors, errors
        page.close()
        print(f'PASS {name} actual row click, view/row replacement, no history and close at {width}px')


def short_viewport_scroll(browser, base, temporary):
    page, errors = new_page(browser, 390)
    page.set_viewport_size({'width': 390, 'height': 600})
    setup_hr_page(page, 'dingers', base)
    page.locator('[data-price-fixture="history alpha"]').click()
    page.locator('#btwn-select').select_option('odds')
    wait_chart(page, '#price-history-panel .price-history-chart')
    scroll_area = page.locator('#table-container')
    assert scroll_area.evaluate("element=>['auto','scroll'].includes(getComputedStyle(element).overflowY)")
    assert scroll_area.evaluate('element=>element.scrollHeight > element.clientHeight')
    box = scroll_area.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.wheel(0, 1200)
    page.wait_for_function("document.getElementById('table-container').scrollTop > 0")
    page.wait_for_function("""() => {
      const note=document.querySelector('#price-history-panel .price-history-footnote').getBoundingClientRect();
      const area=document.getElementById('table-container').getBoundingClientRect();
      const footer=document.querySelector('.site-footer').getBoundingClientRect();
      return note.top >= area.top && note.bottom <= Math.min(area.bottom,footer.top)+1;
    }""")
    page.screenshot(path=str(Path(temporary) / 'dingers-price-history-390x600-bottom.png'))
    page.mouse.wheel(0, -1200)
    page.wait_for_function("document.getElementById('table-container').scrollTop === 0")
    selector = page.locator('#btwn-select')
    close = page.locator('#right-body button[title="Close"]')
    for control in [selector, close]:
        bounds = control.bounding_box()
        assert bounds and bounds['y'] >= box['y'] - 1 and bounds['y'] + bounds['height'] <= box['y'] + box['height'] + 1, bounds
    page.screenshot(path=str(Path(temporary) / 'dingers-price-history-390x600-top.png'))
    close.click()
    assert page.locator('#right-body').is_hidden()
    assert page.locator('#table').is_visible()
    assert not errors, errors
    page.close()
    print('PASS 390x600 history scroll to bottom and back to view selector/close')


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        temporary = mkdtemp(prefix="evsharps-price-history-")
        print(f"Screenshots: {temporary}")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-logging", f"--log-file={Path(temporary) / 'chromium.log'}"])
            base = f"http://localhost:{server.server_port}"
            component_checks(browser, base, temporary)
            deferred_disposal(browser, base)
            nfl_dialog_checks(browser, base, temporary)
            deferred_dialog_checks(browser, base)
            hr_sidebar_checks(browser, base, temporary)
            short_viewport_scroll(browser, base, temporary)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
