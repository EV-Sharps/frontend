"""Offline Outliers regression: full-feed line comparison and book freshness headers."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
SPORTS = {
    'nhl': ('sog', ['1.5', '2.5', '3.5'], 'ast', '1.5', 'tor', 'bos'),
    'nfl': ('rec', ['3.5', '4.5', '5.5'], 'rec_yds', '49.5', 'phi', 'dal'),
    'nba': ('pts', ['20.5', '24.5', '29.5'], 'reb', '7.5', 'bos', 'ny'),
    'mlb': ('hits', ['0.5', '1.5', '2.5'], 'tb', '1.5', 'nyy', 'bos'),
}


def ago(minutes):
    # Keep assertions safely away from the next minute boundary.
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes, seconds=20)).isoformat()


def payload_for(sport):
    prop, lines, other, other_line, team, opp = SPORTS[sport]

    def row(key, line, **changes):
        value = {'fixture': key, 'player': 'comparison alpha', 'sport': sport,
                 'prop': prop, 'handicap': line, 'under': False, 'ouIdx': 0,
                 'team': team, 'opp': opp, 'game': f'{team} @ {opp}',
                 'date': '2099-10-01', 'dt': '2099-10-01', 'start': '2099-10-01T23:00:00Z',
                 'book': 'fd', 'line': 150, 'pos': 'C', 'avgMin': 32, 'avgTOI': 21,
                 'teamTotal': 3.1, 'oppRank': 18, 'dvpRank': 20,
                 'bookOdds': {'circa': '125/-155', 'pn': '130/-160',
                              'fd': '150/-180', 'dk': '140/-170', 're': '145/-175'},
                 'liquidity': {}, 'links': {}, 'hitRate': 50, 'hitRateLYR': 45,
                 'hitRateCareer': 48, 'logs': [0, 2, 1, 3],
                 'due': {'g': {'streak': 2, 'med': 3, 'z_median': .5}}}
        value.update(changes)
        return value

    rows = [row(f'line-{index}', line) for index, line in enumerate(lines)]
    rows.append(row('selected-under', lines[1], under=True, ouIdx=1))
    rows.append(row('other-prop', other_line, prop=other,
                    bookOdds={'pn': '175/-210', 'fd': '190/-230', 'dk': '180/-220'}))
    rows.append(row('unrelated-player', '88.5', player='unrelated beta', bookOdds={'fd': '8888/-9999'}))
    rows.append(row('unrelated-game', '77.5', game=f'{team} @ other', bookOdds={'fd': '7777/-8888'}))
    rows.append(row('blurred-line', '66.5', blurred=True, bookOdds={'fd': '6666/-7777'}))
    rows.append(row('blurred-prop', '55.5', prop='private_prop', blurred=True,
                    bookOdds={'fd': '5555/-6666'}))
    return {'data': rows, 'props': [prop, other, 'private_prop'],
            'games': [f'{team} @ {opp}', f'{team} @ other'],
            'times': {f'{team} @ {opp}': '2099-10-01T23:00:00Z'},
            'updated': {'fd': ago(7), 'pn': ago(5), 'circa': ago(3), 're': ago(9), 'kambi': ago(4)}}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


class OutliersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "outliers-tests.log"}',
        ])
        cls.auth = (ROOT / 'auth.js').read_text(encoding='utf-8').replace(
            'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;')

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 900})
        self.page.set_default_timeout(6000)
        self.payloads = {sport: payload_for(sport) for sport in SPORTS}
        self.errors, self.requests = [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script('window.EventSource = undefined;')
        self.page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
        self.page.route('**/auth.js', lambda route: route.fulfill(body=self.auth, content_type='application/javascript'))
        self.page.route('**/api/**', lambda route: route.fulfill(json={'data': [], 'props': [], 'updated': {}}))
        self.page.route('**/api/outliers*', self.respond)

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def respond(self, route):
        sport = parse_qs(urlsplit(route.request.url).query)['sport'][0]
        self.requests.append(sport)
        route.fulfill(json=deepcopy(self.payloads[sport]))

    def open(self, sport='nhl', width=1440):
        self.page.set_viewport_size({'width': width, 'height': 900})
        self.page.goto(f'http://localhost:{self.server.server_port}/outliers.html?sport={sport}&view=compact&ou=ou&devig=pn')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true && typeof RES === 'object' && typeof TABLE?.getData === 'function'")
        self.assertEqual(self.page.evaluate('SPORT'), sport)
        self.assertEqual(self.page.evaluate('RES.data.length'), len(self.payloads[sport]['data']))
        self.assertEqual(self.page.evaluate("TABLE.getColumns().filter(column => column.getField() === 'bookOdds.pn').length"), 1)

    def header_age(self, book):
        return self.page.evaluate("""book => TABLE.getColumn(`bookOdds.${book}`).getElement()
            .querySelector('.time-hdrs')?.textContent || ''""", book)

    def refresh(self):
        before = len(self.requests)
        self.page.evaluate('async () => await fetchProps()')
        self.assertEqual(len(self.requests), before + 1)
        expect(self.page.locator('#data-status')).to_be_hidden()

    def click_player(self, fixture='selected-under'):
        self.page.evaluate("""fixture => {
            document.querySelectorAll('[data-outliers-target]').forEach(el => el.removeAttribute('data-outliers-target'));
            const row = TABLE.getRows('active').find(row => row.getData().fixture === fixture);
            if (!row) throw new Error(`Missing visible fixture ${fixture}`);
            row.getCell('player').getElement().setAttribute('data-outliers-target', 'player');
        }""", fixture)
        self.page.locator('[data-outliers-target="player"] .player-lines-trigger').click()
        expect(self.page.locator('#player-lines-dialog')).to_be_visible()

    def comparison_lines(self):
        return self.page.locator('#player-lines-dialog tbody th').all_text_contents()

    def assert_no_sidebar(self):
        self.assertEqual(self.page.evaluate('window.sidebarCalls'), 0)
        self.assertEqual(self.page.evaluate('TABLE.getSelectedRows().length'), 0)
        expect(self.page.locator('#right-body')).to_be_hidden()
        self.assertEqual(self.page.locator('script[src*="plotly-3"]').count(), 0)

    def test_actual_player_click_compares_full_feed_and_switches_prop_for_all_sports(self):
        for sport in SPORTS:
            with self.subTest(sport=sport):
                self.open(sport)
                prop, lines, other, other_line, *_ = SPORTS[sport]
                self.page.evaluate("""async ({prop, line}) => {
                    setOptions('prop-options', [prop]);
                    await changeFilter();
                    TABLE.setHeaderFilterValue('handicap', line);
                    window.sidebarCalls = 0;
                    const original = rowClick;
                    rowClick = (...args) => { sidebarCalls++; return original(...args); };
                }""", {'prop': prop, 'line': lines[1]})
                self.assertEqual(set(self.page.evaluate("TABLE.getData('active').map(row => row.fixture)")),
                                 {'line-1', 'selected-under'})
                self.assertEqual(self.page.evaluate('TABLE.getData().length'), 7)
                self.click_player()
                expect(self.page.locator('#player-lines-title')).to_have_text('Comparison Alpha')
                self.assertEqual(self.comparison_lines(), lines)
                expect(self.page.locator('#player-lines-count')).to_have_text('3 lines')
                expect(self.page.locator('#player-lines-prop')).to_have_value(prop)
                self.assertEqual(set(self.page.locator('#player-lines-prop option').evaluate_all(
                    'options => options.map(option => option.value)')), {prop, other})
                selected = self.page.locator('#player-lines-dialog tbody tr.is-selected')
                expect(selected.locator('th')).to_have_text(lines[1])
                books = self.page.locator('#player-lines-dialog thead th').all_text_contents()[1:]
                fd = selected.locator('td').nth([book.strip() for book in books].index('FD'))
                self.assertEqual(fd.locator('.player-lines-price > span').all_text_contents(), ['+150', '-180'])
                expect(fd.locator('.player-lines-price > span').first).to_have_attribute('title', 'Over · Highest listed price')
                expect(fd.locator('.player-lines-price > span').last).to_have_attribute('title', 'Under')
                content = self.page.locator('#player-lines-dialog').inner_text()
                for hidden_price in ('8888', '7777', '6666', '5555'):
                    self.assertNotIn(hidden_price, content)
                self.assert_no_sidebar()
                self.page.locator('#player-lines-prop').select_option(other)
                self.assertEqual(self.comparison_lines(), [other_line])
                expect(self.page.locator('#player-lines-count')).to_have_text('1 line')
                expect(self.page.locator('#player-lines-dialog tbody')).to_contain_text('+190')
                expect(self.page.locator('#player-lines-dialog tbody')).to_contain_text('-230')
                self.assert_no_sidebar()
                self.page.locator('.player-lines-close').click()
                expect(self.page.locator('#player-lines-dialog')).to_be_hidden()

    def test_blurred_rows_do_not_get_comparison_buttons_or_expose_their_prices(self):
        self.open()
        self.assertFalse(self.page.evaluate("""() => {
            const row = TABLE.getRows().find(row => row.getData().fixture === 'blurred-line');
            return !!row.getCell('player').getElement().querySelector('.player-lines-trigger');
        }"""))
        self.page.evaluate("window.sidebarCalls = 0;")
        self.click_player('line-1')
        self.assertEqual(self.comparison_lines(), SPORTS['nhl'][1])
        self.assertNotIn('private_prop', self.page.locator('#player-lines-prop').inner_text())
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#player-lines-dialog')).to_be_hidden()

    def test_dialog_fits_and_closes_on_small_mobile_screens(self):
        for width in (390, 320):
            with self.subTest(width=width):
                self.open('nba', width)
                self.page.evaluate("""() => {
                    window.sidebarCalls = 0;
                    const original = rowClick;
                    rowClick = (...args) => { sidebarCalls++; return original(...args); };
                }""")
                self.click_player()
                self.assertEqual(self.comparison_lines(), SPORTS['nba'][1])
                dialog = self.page.locator('#player-lines-dialog')
                box = dialog.bounding_box()
                self.assertGreaterEqual(box['x'], -1)
                self.assertGreaterEqual(box['y'], -1)
                self.assertLessEqual(box['x'] + box['width'], width + 1)
                self.assertLessEqual(box['y'] + box['height'], 901)
                self.assertTrue(dialog.evaluate('el => el.scrollWidth <= el.clientWidth + 1'))
                expect(self.page.locator('.player-lines-close')).to_be_in_viewport()
                self.assert_no_sidebar()
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'outliers-lines-{width}.png'))
                self.page.locator('.player-lines-close').click()
                expect(dialog).to_be_hidden()
                self.click_player()
                self.page.keyboard.press('Escape')
                expect(dialog).to_be_hidden()

    def test_first_payload_timestamp_only_refresh_and_changed_rows_update_headers(self):
        self.open()
        for book, expected in [('fd', '7m'), ('pn', '5m'), ('circa', '3m'), ('re', '9m'), ('kambi', '4m')]:
            self.assertEqual(self.header_age(book), expected, book)
        self.page.evaluate('window.firstOutlierRow = TABLE.getRows()[0]')
        self.payloads['nhl']['updated'].update(fd=ago(2), pn=ago(1))
        self.refresh()
        self.assertEqual(self.header_age('fd'), '2m')
        self.assertEqual(self.header_age('pn'), '1m')
        self.assertTrue(self.page.evaluate('TABLE.getRows()[0] === window.firstOutlierRow'),
                        'A timestamp-only refresh should not replace table rows')
        self.payloads['nhl']['data'][0]['bookOdds']['fd'] = '210/-260'
        self.payloads['nhl']['updated'] = {'fd': ago(11), 're': ago(6)}
        self.refresh()
        self.assertEqual(self.page.evaluate("TABLE.getData().find(row => row.fixture === 'line-0').bookOdds.fd"), '210/-260')
        self.assertEqual(self.header_age('fd'), '11m')
        self.assertEqual(self.header_age('re'), '6m')
        for book in ('pn', 'circa', 'kambi'):
            self.assertEqual(self.header_age(book), '', book)

    def test_mobile_card_name_opens_full_line_comparison_without_expanding_card(self):
        self.open('nhl', 390)
        self.page.evaluate("""async () => {
            setOptions('prop-options', ['sog']);
            await changeView('mobile');
            window.sidebarCalls = 0;
            const original = rowClick;
            rowClick = (...args) => { sidebarCalls++; return original(...args); };
        }""")
        self.page.locator('#handicap-filter').select_option('2.5')
        self.page.evaluate("""() => {
            const card = [...document.querySelectorAll('#card-container .data-card')]
                .find(card => card.playerLinesData.fixture === 'line-1');
            if (!card) throw new Error('Missing filtered player card');
            card.setAttribute('data-outliers-card', 'target');
        }""")
        card = self.page.locator('[data-outliers-card="target"]')
        expanded_before = card.evaluate("el => el.classList.contains('expanded')")
        card.locator('.player-lines-trigger').click()
        expect(self.page.locator('#player-lines-dialog')).to_be_visible()
        self.assertEqual(self.comparison_lines(), SPORTS['nhl'][1])
        self.assertEqual(card.evaluate("el => el.classList.contains('expanded')"), expanded_before)
        self.assert_no_sidebar()
        self.page.locator('.player-lines-close').click()
        expect(self.page.locator('#player-lines-dialog')).to_be_hidden()

    def test_invalid_missing_and_absent_timestamps_clear_previous_labels(self):
        self.open('nfl')
        self.payloads['nfl']['updated'] = {'fd': 'not-a-date', 'pn': '', 'circa': None, 're': 0}
        self.refresh()
        for book in ('fd', 'pn', 'circa', 're', 'kambi'):
            self.assertEqual(self.header_age(book), '', book)
        self.payloads['nfl']['updated'] = {'fd': ago(2), 'pn': ago(4)}
        self.refresh()
        self.assertEqual(self.header_age('fd'), '2m')
        del self.payloads['nfl']['updated']
        self.refresh()
        self.assertEqual(self.header_age('fd'), '')
        self.assertEqual(self.header_age('pn'), '')

    def test_empty_first_and_changed_payloads_still_update_and_clear_book_headers(self):
        self.payloads['mlb']['data'] = []
        self.open('mlb')
        self.assertEqual(self.header_age('fd'), '7m')
        self.assertEqual(self.page.evaluate('TABLE.getData().length'), 0)
        self.payloads['mlb'] = payload_for('mlb')
        self.refresh()
        self.assertGreater(self.page.evaluate('TABLE.getData().length'), 0)
        self.payloads['mlb']['data'] = []
        self.payloads['mlb']['updated'] = {'pn': ago(12)}
        self.refresh()
        self.assertEqual(self.page.evaluate('TABLE.getData().length'), 0)
        self.assertEqual(self.header_age('pn'), '12m')
        self.assertEqual(self.header_age('fd'), '')
        self.payloads['mlb'].pop('updated')
        self.refresh()
        self.assertEqual(self.header_age('pn'), '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
