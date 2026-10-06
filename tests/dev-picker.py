"""Offline devig preset card checks: python tests/dev-picker.py (requires Playwright)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import re
import tempfile

from playwright.sync_api import sync_playwright

STAGED = Path(__file__).resolve().parents[1]
ROOT = STAGED if (STAGED / 'atgs.html').is_file() else STAGED.parents[1].parent / 'frontend'


class QuietHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = path.split('?', 1)[0].strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def mock_page(page, props):
    page.set_default_timeout(10000)
    page.add_init_script("window.EventSource = undefined;")
    page.route("https://**/*", lambda route: route.fulfill(body="", content_type="application/javascript"))
    page.route("**/auth.js", lambda route: route.fulfill(
        body=(ROOT / "auth.js").read_text(encoding="utf-8").replace(
            "let ENABLE_AUTH = true;", "let ENABLE_AUTH = false;"),
        content_type="application/javascript"))
    page.route(re.compile(r"/record(?:_[a-z]+)*\.js(?:\?.*)?$"), lambda route: route.fulfill(
        body="var RECORD_UPD = ''; var RECORD = {worst: {best: {}}};",
        content_type="application/javascript"))
    page.route("**/api/**", lambda route: route.fulfill(json={
        "data": [], "games": [], "props": props, "updated": {}, "record": {}, "times": {}}))


def card(page, devig, prop="atgs", book="best"):
    return page.locator(
        f'#dev-picker .dev-chip-wrap[data-prop="{prop}"][data-book="{book}"] '
        f'> button.dev-chip[data-value="{devig}"]')


def assert_selected(page, selected):
    assert page.locator('#dev-picker button[aria-pressed="true"]').count() == 1
    assert selected.get_attribute("aria-pressed") == "true"


def assert_bounds(page, width):
    row = page.locator("#dev-picker-row")
    bounds = row.bounding_box()
    assert bounds and bounds["x"] >= -1 and bounds["x"] + bounds["width"] <= width + 1, bounds
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    assert page.locator("#dev-picker").get_attribute("role") == "group"
    assert page.locator("#dev-picker .dev-chip").evaluate_all("""buttons => buttons.every(button =>
        button.tagName === 'BUTTON' && button.type === 'button' &&
        ['true', 'false'].includes(button.getAttribute('aria-pressed')) &&
        button.contains(button.querySelector('.dev-subinfo')))
    """)
    for selector in ["#dev-window-select", ".dev-manage-btn", ".dev-picker-actions"]:
        bounds = row.locator(selector).bounding_box()
        assert bounds and bounds["x"] >= -1 and bounds["x"] + bounds["width"] <= width + 1, (selector, bounds)


def check_atgs(browser, origin, width):
    page = browser.new_page(viewport={"width": width, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page, ["atgs"])
    page.goto(f"{origin}/atgs.html?devig=fd-dk&weight=1-1&required=fd,dk")
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    page.evaluate("""async () => {
        const stats = (roi, wins, losses) => ({roi, wins, losses, profit: roi / 10, kelly: 1});
        RECORD = {worst: {best: {
            'atgs-vs-fd+dk': {All: stats(91, 800, 500), SZN: stats(14, 12, 8), L7: stats(8.4, 24, 18)},
            'atgs-vs-pn+circa': {All: stats(80, 700, 500), L7: stats(-5.2, 19, 25)},
            'atgs-vs-b365': {All: stats(999, 600, 100)},
            'atgs-vs-cz': {All: stats(0, 5, 5), L7: stats(0, 5, 5)},
            'atgs-vs-mgm': {All: stats(2, 6, 4), L7: stats(2, 6, 4)},
            'atgs-vs-bol': {All: stats(1, 6, 5), L7: stats(1, 6, 5)},
            'atgs-vs-fd': {L7: {roi: 24, wins: 2}},
            'atgs-vs-dk': {L7: stats(500, 0, 0)},
            'atgs-vs-nv': {L7: stats('', 2, 1)},
            'atgs-vs-px': {L7: stats(900, 'invalid', 1)}
        }}};
        RECORD_UPD = '2026-10-04T14:00:00Z';
        METHOD = ''; DEV_WINDOW = 'L7'; DEVIG = 'fd+dk'; WEIGHT = '1+1';
        REQUIRED = ['fd', 'dk']; DEVIG_EXCLUDED = [];
        setBookSelection(''); setOptions('prop-options', ['atgs']);
        await initDevPicker(getTopDevigs('best'));
        addRecordSummaryButtons(RECORD, () => RECORD);
    }""")
    assert_bounds(page, width)
    first = card(page, "fd+dk")
    assert_selected(page, first)
    assert first.locator(".dev-roi").inner_text().startswith("+8.4%")
    assert "24W" in first.locator(".dev-record").inner_text()
    assert "18L" in first.locator(".dev-record").inner_text()
    assert "91%" not in first.inner_text() and "800W" not in first.inner_text()
    assert card(page, "b365").locator(".dev-no-record").inner_text() == "No L7 data"
    assert page.locator("#dev-picker .dev-chip").first.get_attribute("data-value") == "fd+dk"
    ranked = page.evaluate("getTopDevigs('best').map(row => ({devig: row.devig, hasRecord: row.hasRecord}))")
    negative_index = next(i for i, row in enumerate(ranked) if row["devig"] == "atgs-vs-pn+circa")
    for devig in ["b365", "fd", "dk", "nv", "px"]:
        index = next(i for i, row in enumerate(ranked) if row["devig"] == f"atgs-vs-{devig}")
        assert index > negative_index and ranked[index]["hasRecord"] is False
        assert card(page, devig).locator(".dev-no-record").inner_text() == "No L7 data"

    # Current-season data is a separate window; missing SZN never borrows All.
    page.locator('#dev-window-select').select_option('SZN')
    assert page.locator('#dev-window-select option[value="SZN"]').get_attribute('title') == 'Current season'
    assert card(page, 'fd+dk').locator('.dev-roi').inner_text().startswith('+14%')
    assert '12W' in card(page, 'fd+dk').locator('.dev-record').inner_text()
    assert card(page, 'b365').locator('.dev-no-record').inner_text() == 'No SZN data'
    missing = page.evaluate("getTopDevigs('best').find(row => row.devig === 'atgs-vs-b365')")
    assert missing['hasRecord'] is False and missing['roi'] is None
    assert missing['recordWindow'] == 'SZN'
    pills = page.evaluate("""() => {
        const host = document.createElement('div');
        host.innerHTML = renderCardRecord({book: 'best', prop: 'atgs'});
        return [...host.querySelectorAll('.trend-pill')].map(pill => ({
            label: pill.querySelector('.trend-label').textContent,
            record: pill.querySelector('.trend-frac').textContent,
            roi: pill.querySelector('.trend-pct').textContent,
        }));
    }""")
    assert {'label': 'SZN', 'record': '12-8', 'roi': '+14%'} in pills
    assert {'label': 'All-time', 'record': '800-500', 'roi': '+91%'} in pills
    assert all(pill['label'] != 'Season' for pill in pills)
    page.locator('#dev-window-select').select_option('L7')

    # Navigation moves focus without changing the selected preset.
    first.focus()
    buttons = page.locator("#dev-picker .dev-chip")
    for key, index in [("ArrowRight", 1), ("End", buttons.count() - 1), ("Home", 0)]:
        page.keyboard.press(key)
        assert buttons.nth(index).evaluate("button => button === document.activeElement")
        assert_selected(page, first)

    # ROI and record are part of the button's hit area; clicking either applies the mix.
    page.evaluate("DEVIG_EXCLUDED = ['pn'];")
    second = card(page, "pn+circa")
    second.locator(".dev-record").click()
    page.wait_for_function("DEVIG === 'pn+circa' && WEIGHT === '1+1'")
    assert page.evaluate("REQUIRED") == ["pn", "circa"]
    assert page.evaluate("DEVIG_EXCLUDED") == []
    assert_selected(page, second)
    assert page.locator('#prop-options input:checked').evaluate_all("inputs => inputs.map(input => input.value)") == ["atgs"]
    assert page.evaluate("new URL(location).searchParams.get('weight')") == "1-1"

    first.focus()
    page.keyboard.press("Space")
    page.wait_for_function("DEVIG === 'fd+dk'")
    assert_selected(page, first)

    # Rebuilding for a different period keeps both existing summary handlers.
    actions = page.locator(".dev-picker-actions")
    assert actions.locator(".record-summary-btn").count() == 2
    page.locator("#dev-window-select").select_option("All")
    assert card(page, "b365").locator(".dev-roi").inner_text().startswith("+999%")
    assert actions.locator(".record-summary-btn").count() == 2
    actions.get_by_role("button", name="Season", exact=True).click()
    assert page.locator("#record-summary-modal").is_visible()
    page.evaluate("_summaryMethod = 'worst'; _renderSummaryTable();")
    page.locator('#record-window-toggle button[data-window="SZN"]').click()
    assert page.evaluate("_summaryCell(_summaryComputeGrid(), 'best', 'atgs-vs-fd+dk').val") == 14
    assert page.evaluate("_summaryCell(_summaryComputeGrid(), 'best', 'atgs-vs-b365')") is None
    assert 'SZN' in page.evaluate('_summaryFilterLabel()')
    page.locator('#record-window-toggle button[data-window="L7"]').click()
    assert page.evaluate("_summaryCell(_summaryComputeGrid(), 'best', 'atgs-vs-fd+dk').val") == 8.4
    page.evaluate("document.getElementById('record-summary-modal').classList.remove('open')")
    page.locator("#dev-window-select").select_option("L7")
    actions.locator(".record-summary-btn").first.click()
    assert page.locator("#record-summary-modal").is_visible()
    page.evaluate("document.getElementById('record-summary-modal').classList.remove('open')")
    actions.locator(".dev-manage-btn").click()
    assert page.locator("#devig-modal").is_visible()
    page.locator("#close-devig-modal").click()
    assert actions.locator(".dev-manage-btn").evaluate("button => button === document.activeElement")

    # Custom unequal weights must not claim to be the equal-weight preset.
    page.evaluate("WEIGHT = '3+1'; changeFilter();")
    assert page.locator('#dev-picker button[aria-pressed="true"]').count() == 0
    page.evaluate("DEVIG = 'dk+fd'; WEIGHT = '2+2'; initDevPicker(getTopDevigs('best'));")
    assert_selected(page, card(page, "fd+dk"))

    if width < 600:
        picker = page.locator("#dev-picker")
        assert picker.evaluate("el => el.scrollWidth > el.clientWidth")
        last = page.locator("#dev-picker .dev-chip").last
        last.focus()
        page.keyboard.press("Enter")
        assert_selected(page, last)
        page.wait_for_function("""() => {
            const strip = document.getElementById('dev-picker').getBoundingClientRect();
            const active = document.querySelector('#dev-picker [aria-pressed="true"]').getBoundingClientRect();
            return active.left >= strip.left - 1 && active.right <= strip.right + 1;
        }""")
    assert_bounds(page, width)
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f"dev-picker-atgs-{width}.png"))
    assert not errors, errors
    page.close()
    print(f"PASS: ATGS {width}px cards, exact periods, selection, keyboard, summary actions and Manage", flush=True)


def check_context(browser, origin):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page, ["rec", "rush"])
    page.goto(f"{origin}/nfl.html?devig=pn-circa&weight=1-1&book=fd,dk&prop=rec")
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    page.evaluate("""async () => {
        const periods = {All: {roi: 10, wins: 8, losses: 4}, L7: {roi: 5, wins: 4, losses: 2}};
        RECORD = {worst: {
            fd: {'rec-vs-pn+circa': periods, 'rush-vs-pn+circa': periods},
            dk: {'rec-vs-pn+circa': periods, 'rush-vs-pn+circa': periods}
        }};
        METHOD = ''; DEV_WINDOW = 'L7'; DEVIG = 'pn+circa'; WEIGHT = '1+1';
        setBookSelection('fd,dk'); setOptions('prop-options', ['rec']);
        await initDevPicker(getTopDevigs(BOOK));
    }""")
    dk = card(page, "pn+circa", "rec", "dk")
    dk.click()
    assert_selected(page, dk)
    assert page.evaluate("BOOK") == "fd,dk"
    assert page.locator("#book-filter-value").inner_text() == "FD + DK"
    assert page.evaluate("getOptions('prop-options')") == ["rec"]
    page.locator("#dev-window-select").select_option("All")
    assert_selected(page, card(page, "pn+circa", "rec", "dk"))

    # Selecting another prop applies it, while preserving the checked betting group.
    page.evaluate("setOptions('prop-options', ['rec', 'rush']); filterDevPickerByProps(['rec', 'rush']);")
    rush = card(page, "pn+circa", "rush", "fd")
    rush.locator(".dev-subinfo").click()
    assert page.evaluate("getOptions('prop-options')") == ["rush"]
    assert page.locator("#prop-dd-button").inner_text() == "RUSH"
    assert page.evaluate("BOOK") == "fd,dk"
    assert_selected(page, rush)

    # A single betting book changes to the card's context when selecting a preset.
    page.evaluate("setBookSelection('fd'); setOptions('prop-options', ['rec', 'rush']); initDevPicker(getTopDevigs());")
    card(page, "pn+circa", "rec", "dk").click()
    assert page.evaluate("BOOK") == "dk"
    assert page.locator("#book-filter-value").inner_text() == "DK"
    assert page.evaluate("getOptions('prop-options')") == ["rec"]
    assert_selected(page, card(page, "pn+circa", "rec", "dk"))
    assert_bounds(page, 390)

    # Main-market team totals represent the two checked home/away options.
    page.evaluate("""() => {
        PAGE = 'main';
        const menu = document.getElementById('prop-options'); menu.replaceChildren();
        ['away_total', 'home_total', 'ml'].forEach(prop => createOption(prop, menu));
        setOptions('prop-options', ['away_total', 'home_total']); setBookSelection('');
        const periods = {All: {roi: 10, wins: 4, losses: 2}, L7: {roi: 5, wins: 2, losses: 1}};
        RECORD = {worst: {best: {'team_total-vs-pn+circa': periods}}};
        initDevPicker(getTopDevigs('best'));
    }""")
    totals = card(page, "pn+circa", "team_total")
    assert totals.is_visible()
    assert_selected(page, totals)
    page.locator("#dev-window-select").select_option("L7")
    assert totals.is_visible()
    assert_selected(page, totals)
    assert not errors, errors
    page.close()
    print("PASS: duplicate prop/book context, stable selection, multi-book retention and prop/book updates", flush=True)


def check_recap_toolbar(browser, origin, name):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    mock_page(page, ["hr"])
    record = {"worst": {"best": {"hr-vs-pn": {"All": {"roi": 8, "wins": 5, "losses": 3}}}}}
    page.route("**/api/**", lambda route: route.fulfill(json={
        "data": [{"id": 1, "player": "fixture player", "prop": "hr", "bookOdds": {}}],
        "games": [], "props": ["hr"], "updated": {}, "record": record, "times": {}}))
    page.goto(f"{origin}/{name}.html?devig=pn&weight=1")
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    toolbar = page.locator("#dev-picker-row .dev-picker-col")
    assert not toolbar.locator(".dev-window-control").is_visible()
    assert not toolbar.locator("#dev-record-upd").is_visible()
    assert toolbar.locator(".dev-picker-actions button").all_text_contents() == ["Yest", "Season", "Manage"]
    assert card(page, "pn", "hr").is_visible()
    assert page.evaluate("RES.data.length") == 1
    toolbar.get_by_role("button", name="Yesterday", exact=True).click()
    assert page.locator("#record-summary-modal").is_visible()
    page.evaluate("document.getElementById('record-summary-modal').classList.remove('open')")
    toolbar.locator(".dev-manage-btn").click()
    assert page.locator("#devig-modal").is_visible()
    page.locator("#close-devig-modal").click()
    assert toolbar.locator(".dev-manage-btn").evaluate("button => button === document.activeElement")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    assert not errors, errors
    page.close()
    print(f"PASS: {name} compact toolbar, summary actions and Manage", flush=True)


def check_cheat_season(browser, origin):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    mock_page(page, ['atgs'])
    stats = lambda roi, wins, losses: {'roi': roi, 'wins': wins, 'losses': losses, 'profit': roi / 10, 'kelly': .5}
    record = {'nhl': {'probit': {'best': {
        'atgs-vs-pn': {'All': stats(90, 80, 20), 'SZN': stats(12, 7, 3), 'L7': stats(3, 4, 2)},
        'atgs-vs-fd': {'All': stats(800, 100, 10)},
    }}}}
    legacy_long = {'nhl': {'probit': {'best': {'atgs-vs-pn': {'All': stats(999, 100, 10)}}}}}
    page.route('**/record.js', lambda route: route.fulfill(
        body='var RECORD_UPD="2026-10-06T12:00:00Z"; var RECORD=' + json.dumps(record) + ';',
        content_type='application/javascript'))
    page.route('**/record_long.js', lambda route: route.fulfill(
        body='var RECORD_LONG=' + json.dumps(legacy_long) + ';', content_type='application/javascript'))
    page.goto(f'{origin}/cheat.html?sport=nhl')
    page.locator('#min-bets').select_option('1')
    page.locator('#window-select').select_option('SZN')
    assert page.locator('#window-select option[value="SZN"]').get_attribute('title') == 'Current season'
    rows = page.evaluate('parseRecord(RES).best')
    assert len(rows) == 1 and rows[0]['vs'] == 'pn' and rows[0]['r'] == 12
    assert '7W-3L' in page.locator('#dashboard').inner_text()
    assert '100W' not in page.locator('#dashboard').inner_text()
    page.locator('#view-toggle-btn').click()
    assert page.locator('.matrix-table .matrix-cell:not(.empty)').count() == 1
    assert '+12%' in page.locator('.matrix-table').inner_text()
    assert '800%' not in page.locator('.matrix-table').inner_text()
    page.locator('#window-select').select_option('L7')
    assert '+3%' in page.locator('.matrix-table').inner_text()
    assert page.locator('.matrix-table .matrix-cell:not(.empty)').count() == 1
    page.locator('#window-select').select_option('SZN')
    page.locator('#odds-type').select_option('longshots')
    page.wait_for_function('RECORD_LONG_TMP !== null')
    assert page.evaluate('parseRecord(RES).best') == []
    assert page.locator('.matrix-table .matrix-cell:not(.empty)').count() == 0
    page.locator('#view-toggle-btn').click()
    assert page.locator('#dashboard .entry').count() == 0
    page.locator('#window-select').select_option('All')
    assert '100W-10L' in page.locator('#dashboard').inner_text()
    page.locator('#window-select').select_option('SZN')
    page.select_option('#odds-type', index=0)
    assert '7W-3L' in page.locator('#dashboard').inner_text()
    assert not errors, errors
    page.close()
    print('PASS: Cheat SZN/L7 exact windows in cards and matrix; legacy longshots never fall back to All', flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            origin = f"http://localhost:{server.server_port}"
            for width in [1280, 390, 320]:
                check_atgs(browser, origin, width)
            check_context(browser, origin)
            for name in ["recap", "nfl_recap"]:
                check_recap_toolbar(browser, origin, name)
            check_cheat_season(browser, origin)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
