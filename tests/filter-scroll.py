"""Run from the repository root with Python and Playwright installed."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import tempfile

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


FIXTURE = """async () => {
    DEVIG = 'pn'; WEIGHT = '100';
    document.getElementById('book-select').value = 'fd';
    document.getElementById('ou-select').value = 'ou';
    RES.data = Array.from({length: 1500}, (_, i) => ({
        id: i, player: 'test player ' + i, team: 'bal', opp: 'kc', away: true,
        game: i % 2 ? 'bal @ kc' : 'bal @ pit', sport: 'nfl',
        prop: i % 3 ? 'attd' : 'rec_yds', handicap: i % 3 ? 0.5 : 49.5,
        under: false, logs: [0, 1, 0, 2], snaps: ['60%', '70%'], pos: 'WR', hitRates: {},
        bookOdds: {
            pn: (200 + i % 100) + '/-' + (240 + i % 100),
            fd: (250 + i % 100) + '/-' + (300 + i % 100),
            dk: (240 + i % 100) + '/-' + (290 + i % 100),
            circa: '220/-260', kal: '260/-310', nv: '270/-320', px: '280/-330'
        },
        usage: {weeks: [1, 2], snaps: {tot: [35, 40], pct: [60, 70]},
            targets: {tot: [5, 7]}, looks: {tot: [2, 3]}}
    }));
    await changeFilter();
}"""

SNAPSHOT = """() => {
    const holder = document.querySelector('#table .tabulator-tableholder');
    const rect = holder.getBoundingClientRect();
    const rows = [...holder.querySelectorAll('.tabulator-row')];
    return {
        top: holder.scrollTop,
        visible: rows.filter(row => {
            const r = row.getBoundingClientRect();
            return r.bottom > rect.top && r.top < rect.bottom;
        }).length,
        firstRowVisible: !!rows[0] && rows[0].getBoundingClientRect().top >= rect.top - 1
            && rows[0].getBoundingClientRect().top < rect.bottom,
        background: getComputedStyle(holder.querySelector('.tabulator-table')).backgroundColor
    };
}"""


def assert_top(page):
    state = page.evaluate(SNAPSHOT)
    assert state['top'] == 0 and state['visible'] > 0 and state['firstRowVisible'], state
    assert state['background'] == 'rgb(24, 26, 27)', state


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=[
                '--disable-logging', '--log-file=' + str(Path(tempfile.gettempdir()) / 'filter-scroll-browser.log')
            ])
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace(
                    'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript'))
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
            page.goto(f'http://localhost:{server.server_port}/tds.html?devig=pn&weight=100&book=fd')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate(FIXTURE)

            for view in ('table', 'compact'):
                page.evaluate('(view) => { CURRENT_VIEW = view; applyOddsTableView(); }', view)
                for index in range(4):
                    page.evaluate("document.querySelector('#table .tabulator-tableholder').scrollTop = 18000")
                    page.wait_for_timeout(60)
                    page.evaluate("""async index => {
                        document.getElementById('book-select').value = index % 2 ? 'fd' : 'dk';
                        await changeFilter();
                    }""", index)
                    # Check before any wheel/scroll event could repair stale virtual padding.
                    assert_top(page)
                    page.wait_for_timeout(60)
                    assert_top(page)
                print(f'{view}: repeated filter resets render rows immediately', flush=True)

            # A devig change and an empty result must also reset safely.
            page.evaluate("document.querySelector('#table .tabulator-tableholder').scrollTop = 6000")
            page.wait_for_timeout(60)
            page.evaluate("async () => { DEVIG = 'circa'; await changeFilter(); }")
            assert_top(page)
            page.evaluate("async () => { document.getElementById('book-select').value='dk'; document.getElementById('min-odds').value='99999'; await changeFilter(); }")
            assert page.evaluate("TABLE.getDataCount('active')") == 0
            page.evaluate("async () => { document.getElementById('min-odds').value=''; document.getElementById('book-select').value='fd'; await changeFilter(); }")
            assert_top(page)

            # Group headers must survive the reset.
            page.evaluate("TABLE.setGroupBy('game')")
            page.evaluate("document.querySelector('#table .tabulator-tableholder').scrollTop = 6000")
            page.wait_for_timeout(60)
            page.evaluate("async () => { document.getElementById('book-select').value='dk'; await changeFilter(); }")
            assert_top(page)
            assert page.locator('#table .tabulator-group').count() > 0
            page.evaluate("TABLE.setGroupBy(false)")

            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate("async () => { CURRENT_VIEW='mobile'; applyOddsTableView(); await changeFilter(); document.getElementById('table-container').scrollTop=1000; document.getElementById('book-select').value='fd'; await changeFilter(); }")
            assert page.evaluate("document.getElementById('table-container').scrollTop") == 0
            assert page.locator('#card-container .data-card').first.is_visible()
            assert not errors, errors
            print('Devig changes, empty results, grouped rows, and mobile cards passed.', flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
