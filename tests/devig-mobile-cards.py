"""Offline regression for devig comparisons without Tabulator row mutators."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ('atgs2', 'dingers2', 'tds2', 'outliers', 'atgs'):
            page = browser.new_page(viewport={'width': 390, 'height': 844})
            page.set_default_timeout(5000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace(
                    'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript'))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
            page.goto(f'http://localhost:{server.server_port}/{name}.html?view=mobile&devig=pn&weight=1')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate('''async () => {
                await tableReady;
                DEVIG = 'pn'; WEIGHT = '1'; REQUIRED = []; DEVIG_EXCLUDED = [];
                updateRequiredDropdown();
                setBookSelection('');
                document.querySelectorAll('#exclude-options input').forEach(input => input.checked = false);
                document.getElementById('ou-select').value = 'o';
                document.getElementById('boost-select').value = '0';
                document.getElementById('min-odds').value = '';
                document.getElementById('max-odds').value = '';
                const prop = PAGE === 'dingers2' ? 'hr' : PAGE === 'tds2' ? 'attd' : 'atgs';
                const base = {prop, handicap: .5, under: false, ouIdx: 0,
                    sport: SPORT, team: 'tor', opp: 'bos', game: 'tor @ bos',
                    pos: 'C', links: {}, logs: [], hitRates: {}, ev: null};
                RES = {data: [
                    {...base, player: 'alpha scorer', bookOdds: {pn: '500', fd: '700', dk: '600'}},
                    {...base, player: 'beta scorer', handicap: 1.5, game: 'bos @ tor',
                        bookOdds: {pn: '500', fd: '650', dk: '550'}},
                    {...base, player: 'gamma no edge', bookOdds: {pn: '500', fd: '400', dk: '400'}}
                ]};
                const games = document.getElementById('game-options');
                games.replaceChildren();
                createOption('tor @ bos', games); createOption('bos @ tor', games);
                await changeFilter();
            }''')
            cards = page.locator('#card-container .data-card')

            def names():
                return cards.evaluate_all('cards => cards.map(card => card.playerLinesData.player)')

            def quote(player, percent, book, odds):
                card = cards.filter(has=page.locator('.player-name', has_text=player))
                expect(card).to_have_count(1)
                expect(card.locator('.ev-value')).to_have_text(percent)
                expect(card.locator('.book-img-large')).to_have_attribute('alt', book)
                expect(card.locator('.evbook-odds-large')).to_have_text(odds)

            # changeFilter renders cards from fresh API rows: the hidden table never received them.
            assert page.evaluate('TABLE.getData().length') == 0
            assert page.evaluate("RES.data.every(row => !Object.hasOwn(row, 'outlierPct'))")
            if name == 'atgs':
                assert cards.count() == 3
                for card in cards.all():
                    row = card.evaluate('card => card.playerLinesData')
                    expected_ev = f"{'+' if float(row['ev']) >= 0 else ''}{row['ev']}%"
                    expect(card.locator('.ev-value')).to_have_text(expected_ev)
                    assert 'from devig' not in card.locator('.ev-section').inner_text()
                assert not errors, errors
                print('atgs: ordinary EV card display unchanged.', flush=True)
                page.close()
                continue

            assert names() == ['alpha scorer', 'beta scorer'], names()
            quote('Alpha Scorer', '25.00%', 'fd', '+700')
            quote('Beta Scorer', '20.00%', 'fd', '+650')

            # Search and line filters must use the supplied card rows, including on Outliers.
            page.locator('#player-search').fill('beta')
            expect(cards).to_have_count(1)
            assert names() == ['beta scorer']
            page.locator('#player-search').fill('')
            expect(cards).to_have_count(2)
            page.locator('#handicap-filter').select_option('1.5')
            assert names() == ['beta scorer']
            page.locator('#handicap-filter').select_option('')
            assert names() == ['alpha scorer', 'beta scorer']
            page.evaluate('''async () => {
                document.querySelector('#game-options input[value="tor @ bos"]').checked = false;
                await changeFilter();
            }''')
            assert names() == ['beta scorer']
            page.evaluate('''async () => {
                document.querySelector('#game-options input[value="tor @ bos"]').checked = true;
                setBookSelection('dk');
                await changeFilter();
            }''')
            quote('Alpha Scorer', '14.29%', 'dk', '+600')

            # Changing the reference and live price must recalculate without table refreshes.
            page.evaluate('''async () => {
                DEVIG = 'dk'; REQUIRED = []; updateRequiredDropdown(); setBookSelection('fd');
                await changeFilter();
            }''')
            quote('Alpha Scorer', '12.50%', 'fd', '+700')
            page.evaluate('''async () => {
                RES.data[0].bookOdds.fd = '900';
                await changeFilter();
            }''')
            quote('Alpha Scorer', '30.00%', 'fd', '+900')
            assert page.evaluate('TABLE.getData().length') == 0

            # A composite can choose a different quote than traditional EV. Keep its source intact.
            page.evaluate('''async () => {
                DEVIG = 'pn+fd'; WEIGHT = '1+1'; REQUIRED = []; updateRequiredDropdown();
                setBookSelection('');
                RES.data[0].bookOdds.fd = '700';
                await changeFilter();
            }''')
            quote('Alpha Scorer', '2.04%', 'dk', '+600')
            assert page.evaluate('''() => {
                const before = JSON.stringify(RES.data);
                applyFilters();
                return before === JSON.stringify(RES.data)
                    && RES.data.every(row => !Object.hasOwn(row, 'outlierPct'));
            }'''), 'Rendering comparisons must not mutate the source rows or their EV quote'

            # Null EV must not discard a valid raw comparison or become a fabricated zero.
            page.evaluate('''async () => {
                DEVIG = 'pn'; WEIGHT = '0'; REQUIRED = []; updateRequiredDropdown();
                await changeFilter();
            }''')
            assert page.evaluate('RES.data.every(row => row.ev === null)')
            assert names() == ['alpha scorer', 'beta scorer'], names()
            quote('Alpha Scorer', '25.00%', 'fd', '+700')
            page.evaluate('''async () => {
                DEVIG = 'circa'; WEIGHT = '1'; REQUIRED = []; updateRequiredDropdown();
                await changeFilter();
            }''')
            assert cards.count() == 0, 'Missing reference must not show a fake 0% comparison'
            assert not errors, errors
            print(f'{name}: initial cards, filters, quote selection, refresh, null EV and missing references passed.', flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
