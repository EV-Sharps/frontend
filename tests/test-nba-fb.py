"""Offline First Basket page, navigation, feed separation and card regression."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get('NBA_FB_BASE', ROOT))


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        original = Path(super().translate_path(path))
        if original.is_file():
            return str(original)
        return str(BASE / original.relative_to(ROOT))

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def payload(prop):
    return {'updated': {}, 'games': ['bos @ lal'], 'props': [prop],
            'times': {'bos @ lal': '2099-10-19T23:00:00Z'}, 'data': [{
                'player': 'basket fixture', 'prop': prop, 'handicap': '0.5', 'under': False,
                'ouIdx': 0, 'sport': 'nba', 'team': 'bos', 'opp': 'lal', 'pos': 'C',
                'game': 'bos @ lal', 'dt': '2099-10-19', 'avgMin': 32,
                'book': 'fd', 'line': 1000, 'bookOdds': {'fd': '1000', 'dk': '900', 'pn': '850'},
                'liquidity': {}, 'links': {}, 'logs': [], 'hitRates': {},
            }]}


os.chdir(gettempdir())
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        checks = 0
        for width in [1440, 390]:
            for entry in ['fb.html', 'nba.html?market=fb', 'nba.html']:
                first_basket = entry != 'nba.html'
                page = browser.new_page(viewport={'width': width, 'height': 900})
                page.set_default_timeout(6000)
                errors, requests = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script('window.EventSource = undefined;')
                page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
                page.route('**/auth.js', lambda route: route.fulfill(
                    body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                    content_type='application/javascript'))
                page.route('**/record_nba.js', lambda route: route.fulfill(
                    body='let RECORD_UPD = ""; let RECORD = {worst:{best:{}}};', content_type='application/javascript'))

                def respond(route):
                    requests.append(route.request.url)
                    data = payload('fb' if '/api/fb' in route.request.url else 'pts')
                    if '/api/fb' in route.request.url:
                        # A stale or mixed feed must not leak unrelated props or under rows.
                        data['data'].extend([{**data['data'][0], 'player': 'other prop', 'prop': 'pts'},
                                             {**data['data'][0], 'player': 'under row', 'under': True}])
                    route.fulfill(json=data)

                page.route('**/api/**', respond)
                sep = '&' if '?' in entry else '?'
                page.goto(f'http://localhost:{server.server_port}/{entry}{sep}view=compact&devig=pn&weight=1&prop=pts&ou=u')
                if not first_basket:
                    page.evaluate('OU = "o"; document.querySelector("#ou-select").value = "o"; changeFilter();')
                page.wait_for_function('document.getElementById("data-status")?.hidden === true && TABLE.getData("active").length === 1')
                assert page.evaluate('PAGE') == ('fb' if first_basket else 'nba')
                assert page.evaluate('SPORT') == 'nba'
                assert page.evaluate('pagePickerValue()') == ('fb' if first_basket else 'nba')
                assert any(('/api/fb' if first_basket else '/api/nba') in url for url in requests)
                checks += 4
                fields = page.evaluate('TABLE.getColumns().map(column => column.getField())')
                if first_basket:
                    assert page.title() == 'First Basket | +EV Sharps'
                    assert all(field not in fields for field in ['handicap', 'prop', 'oppRank', 'logs', 'hitRate', 'hitRates.career'])
                    assert page.evaluate('PROP') in ['', 'fb']
                    assert page.evaluate('OU') == 'o'
                    assert 'market=fb' in page.url
                    assert 'devig=pn' in page.url
                    assert page.evaluate('getTopDevigs().length') == 0
                    assert page.locator('#prop-options').inner_text().endswith('First Basket')
                    page.evaluate('showCardModal(TABLE.getData("active")[0])')
                    assert 'First Basket' in page.locator('#card-modal-inner').inner_text()
                    assert 'Trends' not in page.locator('#card-modal-inner').inner_text()
                    assert 'undefined' not in page.locator('#card-modal-inner').inner_text()
                    checks += 11
                else:
                    assert 'logs' in fields and 'hitRates.career' in fields
                    assert page.evaluate('FIRST_BASKET_PAGE') is False
                    checks += 2
                assert not errors, errors
                checks += 1
                page.close()
        browser.close()
        print(f'First Basket browser checks passed: {checks}')
finally:
    server.shutdown()
