"""Offline dense-price chart checks: ticks, stable book styles and local controls."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 2, 19, 0, tzinfo=timezone.utc)
BOOKS = ["b365", "bol", "br", "bv", "circa", "cz", "dk", "espn", "fd", "fn", "hr", "kal", "mgm", "nv", "pn", "px"]
NAMES = dict(zip(BOOKS, ["bet365", "BetOnline", "BetRivers", "Bovada", "Circa", "Caesars", "DraftKings", "ESPN BET",
                         "FanDuel", "Fanatics", "Hard Rock", "Kalshi", "BetMGM", "Novig", "Pinnacle", "ProphetX"]))
TIMES = [(NOW - timedelta(minutes=30 * (3 - index))).isoformat() for index in range(4)]


def selection(index, player):
    return dict(id=f"{index:024x}", game="nyy @ bos", start=(NOW + timedelta(hours=3)).isoformat(),
                player=player, prop="hr", handicap="0.5", side=0, side_labels=["Over", "Under"],
                first_at=TIMES[0], last_at=TIMES[-1], point_count=4, reference_books=["circa", "pn"],
                first_fair=466, current_fair=462, first_probability=100 / 566,
                current_probability=100 / 562, change_pp=.126, status="ok")


ROWS = [selection(1, "aaron judge"), selection(2, "shohei ohtani")]
CATALOG = dict(sport="mlb", day="2026-10-02", updated=NOW.isoformat(), interval_minutes=30,
               max_age_minutes=60, props=["hr"], books=BOOKS, total=2, offset=0, limit=100, rows=ROWS, status="ok")


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def chart(page):
    return page.evaluate("""() => {
        const chart = document.getElementById('movement-chart');
        return {data:chart.data, axis:chart.layout.yaxis, range:chart._fullLayout.yaxis.range};
    }""")


def styles(page):
    return {trace["name"]: (trace["line"]["color"], trace["line"].get("dash", "solid"))
            for trace in chart(page)["data"] if not trace["name"].endswith(" fair")}


def assert_ticks(page, minimum=5):
    result = chart(page)
    low, high = sorted(result["range"])
    ticks = [(value, label) for value, label in zip(result["axis"]["tickvals"], result["axis"]["ticktext"])
             if low <= value <= high]
    assert len(ticks) >= minimum, (result["range"], ticks)
    assert len({label for _, label in ticks}) == len(ticks), ticks
    assert all(label.startswith("+") for _, label in ticks), ticks
    for probability, label in ticks:
        price = float(label.replace("+", "").replace(",", ""))
        assert abs(probability - 10000 / (price + 100)) < .000001, ticks
    return ticks


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
requests = []
state = {"even": False}
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        page.set_default_timeout(6000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.clock.install(time=NOW)

        def intercept(route):
            address = route.request.url
            if "/api/line-movement?" in address:
                query = {key: values[0] for key, values in parse_qs(urlsplit(address).query).items()}
                requests.append(query)
                data = deepcopy(CATALOG)
                if "id" in query:
                    row = next(item for item in data.pop("rows") if item["id"] == query["id"])
                    data["selection"] = row
                    keys = BOOKS if row["id"] == ROWS[0]["id"] else [book for book in reversed(BOOKS) if book not in ["bol", "bv", "hr"]]
                    data["points"] = []
                    for index, timestamp in enumerate(TIMES):
                        prices = {book: 450 + BOOKS.index(book) + [0, 2, -1, 1][index] for book in keys}
                        if index == 3:
                            prices["px"] = None  # Never carry the prior quoted price into the latest chip.
                        fair = [466, 464, 460, 462][index]
                        if state["even"]:
                            prices = {book: [110, 100, -105, -110][index] for book in keys}
                            fair = [105, 100, -103, -107][index]
                        probability = 100 / (fair + 100) if fair > 0 else -fair / (100 - fair)
                        data["points"].append(dict(ts=timestamp, prices=prices, fair=fair, probability=probability))
                route.fulfill(json=data)
            elif "cdn.jsdelivr.net" in address:
                route.fulfill(content_type="application/javascript", body="""window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: {access_token:'fixture-token'}}}),
                    onAuthStateChange: () => ({})
                }})};""")
            elif address.startswith(f"http://localhost:{server.server_port}/"):
                route.continue_()
            else:
                route.fulfill(status=404, body="")

        page.route("**/*", intercept)
        page.goto(f"http://localhost:{server.server_port}/movement.html?sport=mlb")
        page.wait_for_function("document.getElementById('movement-chart').data?.length === 17")
        baseline = styles(page)
        assert len(baseline) == len(set(baseline.values())) == 16, baseline
        initial = chart(page)
        assert initial["range"][0] > initial["range"][1], "American odds keep the probability axis reversed"
        assert abs(initial["data"][0]["y"][0] - 10000 / 550) < .000001
        assert_ticks(page)
        px = page.locator('.movement-book[data-book="px"] .book-price')
        assert px.inner_text() in ["-", "—", "N/A", "No quote"], px.inner_text()
        fd_price = page.locator('.movement-book[data-book="fd"] .book-price')
        expect(fd_price).to_have_text("+459")
        latest_time = page.locator('#book-price-time').inner_text()
        count = len(requests)

        # Hover uses the selected capture, including missing quotes; mouse-out restores the latest.
        page.evaluate("""() => {
            const chart = document.getElementById('movement-chart');
            chart.emit('plotly_hover', {points:[{pointNumber:1, curveNumber:0, x:chart.data[0].x[1], data:chart.data[0]}]});
        }""")
        expect(fd_price).to_have_text("+460")
        expect(px).to_have_text("+467")
        assert page.locator('#book-price-time').inner_text() != latest_time
        page.evaluate("document.getElementById('movement-chart').emit('plotly_unhover', {})")
        expect(fd_price).to_have_text("+459")
        assert page.locator('#book-price-time').inner_text() == latest_time
        assert px.inner_text() in ["-", "—", "N/A", "No quote"]

        focus = page.locator('.book-focus[data-focus-book="fd"]')
        focus.click()
        expect(focus).to_have_attribute("aria-pressed", "true")
        traces = chart(page)["data"]
        assert len(traces) == 17, "Focus should retain context from the other books"
        assert next(trace for trace in traces if trace["name"] == NAMES["fd"]).get("opacity", 1) > min(
            trace.get("opacity", 1) for trace in traces if trace["name"] != NAMES["fd"] and not trace["name"].endswith(" fair"))
        focus.click()
        expect(focus).to_have_attribute("aria-pressed", "false")

        # Real Plotly relayout events refresh labels without discarding the chosen zoom.
        zoom = [10000 / 552, 10000 / 566]
        old_ticks = chart(page)["axis"]["tickvals"]
        page.evaluate("range => Plotly.relayout('movement-chart', {'yaxis.range':range})", zoom)
        time_zoom = [datetime.fromisoformat(TIMES[1]).timestamp() * 1000,
                     datetime.fromisoformat(TIMES[2]).timestamp() * 1000 + 300000]
        page.evaluate("range => Plotly.relayout('movement-chart', {'xaxis.range':range})", time_zoom)
        page.clock.run_for(100)
        assert chart(page)["axis"]["tickvals"] != old_ticks
        assert_ticks(page)
        page.locator('#book-options input[value="fd"]').uncheck()
        assert len(chart(page)["data"]) == 16
        assert all(abs(a - b) < .000001 for a, b in zip(chart(page)["range"], zoom)), (chart(page)["range"], zoom, chart(page)["axis"])
        assert page.evaluate("document.getElementById('movement-chart')._fullLayout.xaxis.range") == time_zoom
        page.locator('#show-all-books').click()
        assert len(chart(page)["data"]) == 17
        assert styles(page) == baseline
        page.locator('#hide-all-books').click()
        assert len(chart(page)["data"]) == 1 and chart(page)["data"][0]["name"].endswith(" fair")
        assert page.locator('#book-options input:checked').count() == 0
        page.locator('#show-all-books').click()
        assert page.locator('#book-options input:checked').count() == 16
        assert len(requests) == count, "Display controls must not download history again"
        page.evaluate("Plotly.relayout('movement-chart', {'xaxis.autorange':true, 'yaxis.autorange':true})")
        page.clock.run_for(100)
        assert chart(page)['range'][0] > chart(page)['range'][1], 'Autoscale must preserve the American-odds direction'
        assert_ticks(page)

        # Missing books in another selection must not shift every following color/dash.
        page.locator('#catalog-rows tr').nth(1).locator('button').click()
        expect(page.locator('#chart-title')).to_have_text('Shohei Ohtani')
        for name, style in styles(page).items():
            assert style == baseline[name], (name, style, baseline[name])
        page.locator('#catalog-rows tr').first.locator('button').click()
        expect(page.locator('#chart-title')).to_have_text('Aaron Judge')
        assert styles(page) == baseline
        assert_ticks(page)
        page.screenshot(path=str(Path(gettempdir()) / 'movement-dense-desktop.png'), full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        page.clock.run_for(400)
        page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width <= 390")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert_ticks(page)
        for selector in ['#movement-chart', '#book-options', '#show-all-books', '#hide-all-books']:
            box = page.locator(selector).bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= 391, (selector, box)
        page.screenshot(path=str(Path(gettempdir()) / 'movement-dense-mobile.png'), full_page=True)

        # Crossing even money stays continuous in probability space, with valid
        # American prices on both sides and a single even-money tick.
        state['even'] = True
        page.locator('#refresh').click()
        page.wait_for_function("document.getElementById('movement-chart').data?.[0]?.y?.[0] > 40")
        crossed = chart(page)
        expected = [10000 / 210, 50, 10500 / 205, 11000 / 210]
        assert all(abs(a - b) < .000001 for a, b in zip(crossed['data'][0]['y'], expected))
        labels = crossed['axis']['ticktext']
        assert any(label.startswith('+') for label in labels) and any(label.startswith('-') for label in labels), labels
        assert len(labels) == len(set(labels)), labels
        assert sum(abs(float(label.replace(',', ''))) == 100 for label in labels) == 1, labels
        for value, label in zip(crossed['axis']['tickvals'], labels):
            price = float(label.replace(',', ''))
            assert abs(price) >= 100, labels
            implied = 10000 / (price + 100) if price > 0 else -price * 100 / (100 - price)
            assert abs(value - implied) < .000001, (value, label)
        assert crossed['range'][0] > crossed['range'][1]
        assert not errors, errors
        print('Dense movement checks passed: adaptive ticks/zoom, 16 stable styles, hover/latest prices, focus/all/none and mobile fit.')
        print(f'Screenshots: {Path(gettempdir()) / "movement-dense-desktop.png"}, {Path(gettempdir()) / "movement-dense-mobile.png"}')
        browser.close()
finally:
    server.shutdown()
