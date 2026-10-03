"""Offline UI checks: python tests/book-multiselect.py (requires Playwright)."""
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
    DEVIG = 'pn'; WEIGHT = '1'; REQUIRED = []; DEVIG_EXCLUDED = [];
    document.getElementById('ou-select').value = 'o';
    RES.data = [
        {player:'test player', bookOdds:{fd:'300/-140',dk:'400/-160',b365:'900/120',pn:'100/-120'}},
        {player:'missing selected', bookOdds:{b365:'700/110',pn:'100/-120'}}
    ].map((row,id) => ({...row, id, game:'bos @ tor', team:'bos', opp:'tor', pos:'C',
        sport:SPORT, prop:PAGE==='atgs'||PAGE==='atgs2'?'atgs':PAGE==='main'?'ml':'rec',
        handicap:0.5, under:false, logs:[0,1,0,2], hitRates:{}, percs:{}, batter_percs:{},
        savant:{}, pitcherData:{}, pitcher:'test pitcher', throws:'R', bats:'R'}));
    await changeFilter();
}"""


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for name, width in [('atgs', 1280), ('atgs', 390), ('atgs2', 390), ('nfl', 1280), ('mlb', 1280), ('main', 1280)]:
                page = browser.new_page(viewport={'width': width, 'height': 844})
                page.set_default_timeout(10000)
                page.add_init_script('window.EventSource = undefined;')
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
                page.route('**/auth.js', lambda route: route.fulfill(
                    body=(ROOT/'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                    content_type='application/javascript'))
                page.route('**/api/**', lambda route: route.fulfill(json={
                    'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
                url = f'http://localhost:{server.server_port}/{name}.html?devig=pn&weight=1&book=fd,dk'
                page.goto(url)
                page.wait_for_function("document.getElementById('data-status')?.hidden === true")
                page.evaluate(FIXTURE)
                assert page.locator('#book-filter-value').inner_text() == 'FD + DK'
                assert page.evaluate("TABLE.getData()[0].book") == 'dk'
                assert page.evaluate("TABLE.getData().length") == 1
                expected_ev = page.evaluate("RES.data[0].ev")
                assert float(expected_ev) > 100
                label = page.locator('#prop-dd-button').inner_text()
                page.locator('#book-filter-button').click()
                menu = page.locator('#book-options')
                assert menu.is_visible()
                assert menu.locator('[data-book-action="done"]').count() == 0
                bounds = menu.bounding_box()
                assert 0 <= bounds['x'] and bounds['x'] + bounds['width'] <= width
                assert page.locator('#book-options input:checked').count() == 2
                page.locator('#book-options input[value="dk"]').uncheck()
                page.wait_for_function("TABLE.getData()[0]?.book === 'fd'")
                assert menu.is_visible()
                assert page.locator('#prop-dd-button').inner_text() == label
                page.locator('#book-options input[value="dk"]').check()
                page.wait_for_function("TABLE.getData()[0]?.book === 'dk'")
                assert page.evaluate("new URL(location).searchParams.get('book')") == 'fd,dk'
                if name == 'atgs':
                    page.evaluate("""() => {
                        RECORD = {worst:{fd:{'atgs-vs-pn':{All:{wins:3,losses:2,roi:10}}},dk:{'atgs-vs-pn':{All:{wins:4,losses:2,roi:20}}}}};
                        METHOD=''; initDevPicker(getTopDevigs(BOOK));
                    }""")
                    page.keyboard.press('Escape')
                    page.locator('#dev-picker .dev-chip').first.click()
                    assert page.evaluate('BOOK') == 'fd,dk'
                    assert page.locator('#book-filter-value').inner_text() == 'FD + DK'
                    page.locator('#book-filter-button').click()
                page.locator('#book-options [data-book-action="none"]').click()
                page.wait_for_function('TABLE.getData().length === 0')
                assert page.locator('#book-filter-value').inner_text() == 'None'
                page.locator('#book-options [data-book-action="all"]').click()
                page.wait_for_function('TABLE.getData().length === 2')
                assert page.locator('#book-filter-value').inner_text() == 'All'
                # The first book click from All selects only that book.
                fd = page.locator('#book-options input[value="fd"]')
                dk = page.locator('#book-options input[value="dk"]')
                fd.click()
                page.wait_for_function("TABLE.getData()[0]?.book === 'fd'")
                assert page.locator('#book-options input:checked').count() == 1
                assert page.locator('#book-filter-value').inner_text() == 'FD'
                assert page.evaluate("new URL(location).searchParams.get('book')") == 'fd'
                dk.click()
                page.wait_for_function("TABLE.getData()[0]?.book === 'dk'")
                assert page.locator('#book-filter-value').inner_text() == 'FD + DK'
                dk.click()
                page.wait_for_function("TABLE.getData()[0]?.book === 'fd'")
                fd.click()
                page.wait_for_function('TABLE.getData().length === 0')
                assert page.locator('#book-filter-value').inner_text() == 'None'
                page.locator('#book-options [data-book-action="all"]').click()
                dk.focus()
                page.keyboard.press('Space')
                page.wait_for_function("TABLE.getData()[0]?.book === 'dk'")
                assert page.locator('#book-options input:checked').count() == 1
                assert page.locator('#book-filter-value').inner_text() == 'DK'
                assert menu.is_visible()
                page.keyboard.press('Escape')
                assert not menu.is_visible()
                assert page.locator('#book-filter-button').get_attribute('aria-expanded') == 'false'
                page.locator('#book-filter-button').click()
                page.mouse.click(width - 5, 830)
                assert not menu.is_visible()
                # Rebuilds preserve the selection and reuse a single dropdown.
                page.evaluate("setBookSelection('fd,dk'); renderBookSelect(); changeFilter();")
                assert page.locator('#book-filter-button').count() == 1
                assert page.locator('#book-options').count() == 1
                page.reload()
                page.wait_for_selector('#book-filter-button')
                assert page.locator('#book-filter-value').inner_text() == 'FD + DK'
                page.goto(url.split('?')[0] + '?book=fd')
                page.wait_for_selector('#book-filter-button')
                assert page.locator('#book-filter-value').inner_text() == 'FD'
                page.goto(url.split('?')[0])
                page.wait_for_selector('#book-filter-button')
                assert page.locator('#book-filter-value').inner_text() == 'All'
                if name == 'atgs' and width == 390:
                    page.locator('#book-filter-button').click()
                    page.screenshot(path=str(Path(tempfile.gettempdir())/'book-multiselect-mobile.png'))
                assert not errors, (name, width, errors)
                print(f'PASS: {name} {width}px: prices, checkboxes, None/All, dismissal, presets and URLs', flush=True)
                page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
