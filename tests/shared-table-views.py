"""Browser checks for saved views, real formatters, and compact restoration."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(error.stack))
    page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
    page.route('**/auth.js', lambda route: route.fulfill(body=Path('auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'), content_type='application/javascript'))
    page.route('**/api/**', lambda route: route.fulfill(json={'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))

    def visit(path):
        page.goto(f'http://localhost:{server.server_port}/{path}')
        page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        assert page.locator('#custom-view-select').count() == 1
        assert page.locator('#view-select').count() == 0

    def choose(view):
        if page.locator('#overlay').count():
            page.evaluate('openOverlay()')
        page.locator('#custom-view-select').select_option(view)
        if page.locator('#overlay').count():
            page.evaluate('closeOverlay()')

    for name in ['dingers.html', 'tds.html', 'nfl.html', 'nba.html', 'soccer.html']:
        visit(name + '?view=stacked')
        assert page.locator('#custom-view-select').input_value() == 'table'
        if page.locator('#overlay').count():
            assert page.locator('#overlay #custom-view-select').count() == 1
        else:
            assert page.locator('#custom-view-select').is_visible()
        page.evaluate('''async () => {
            RES = null;
            const fields = ['ev','player','book','fairVal','kelly','bookOdds.fd','bookOdds.kal'];
            TABLE.setColumns(TABLE.getColumnDefinitions().filter(col => fields.includes(col.field)));
            TABLE.clearFilter(true);
            TABLE.clearSort();
            await TABLE.replaceData([{player:'test player',team:'bos',sport:'mlb',prop:'hr',
                handicap:0.5,under:false,book:'fd',line:500,ev:8.2,fairVal:450,kelly:0.31,
                bookOdds:{fd:'+500/-700',kal:'+490/-710'},liquidity:{kal:[1200,2500]}}]);
        }''')
        row = page.locator('.tabulator-row').first
        assert row.bounding_box()['height'] == 42, name
        assert '+500' in row.locator('[tabulator-field="bookOdds.fd"] .stacked-odds-line').first.inner_text()
        assert 'FV +450' in row.locator('[tabulator-field="ev"]').inner_text()
        # Some game tables use their own player formatter and retain Best Book.
        combined = page.evaluate("TABLE.getColumn('player')?.getDefinition().formatter === playerFormatter")
        if combined:
            assert '+500' in row.locator('.stacked-player-summary').inner_text()
            assert not page.evaluate("TABLE.getColumn('book').isVisible()")
        choose('compact')
        assert row.bounding_box()['height'] == 24, name
        assert row.locator('.stacked-odds-stack').count() == 0
        assert page.evaluate("TABLE.getColumn('fairVal').isVisible()")
        if combined:
            assert page.evaluate("TABLE.getColumn('book').isVisible()")
        # Rebuilding columns (Customize reorder) must preserve the current layout.
        page.evaluate('TABLE.setColumns(TABLE.getColumnDefinitions())')
        choose('table')
        assert row.bounding_box()['height'] == 42, name
        assert not page.evaluate("TABLE.getColumn('fairVal').isVisible()")
        print(name + ': stacked/compact formatters and column rebuild passed', flush=True)

    choose('compact')
    visit('tds.html')
    assert page.locator('#custom-view-select').input_value() == 'compact'
    choose('mobile')
    visit('nfl.html')
    assert page.locator('#custom-view-select').input_value() == 'mobile'
    assert page.locator('#card-container').evaluate("el=>getComputedStyle(el).display") == 'grid'
    assert not page.locator('#table').is_visible()
    visit('dingers.html?view=table')
    assert page.locator('#custom-view-select').input_value() == 'table'
    visit('dingers.html')
    assert page.locator('#custom-view-select').input_value() == 'mobile'
    choose('table')
    visit('tds.html')
    assert page.locator('#custom-view-select').input_value() == 'table'
    assert not errors, errors
    print('All views persist across pages; explicit URLs override without overwriting the preference.')
    browser.close()
server.shutdown()
