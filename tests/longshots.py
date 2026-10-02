"""Offline browser checks for the NHL longshots page; all external requests are mocked."""
import copy
import json
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import tempfile
import sys
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT if (ROOT / 'longshots.html').is_file() else Path('C:/Users/zhech/Documents/frontend')
ARTIFACTS = Path(tempfile.gettempdir()) / 'longshots-browser'
ARTIFACTS.mkdir(exist_ok=True)
NOW = datetime(2026, 10, 2, 16, 0, tzinfo=timezone.utc)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def sample(now=NOW):
    stamp = (now-timedelta(minutes=1)).isoformat()
    stats = dict(n=100, wins=10, profit=12.5, roi=12.5)
    history = dict(open=dict(all=stats, seasons={'2024': stats, '2025': dict(stats, profit=-4, roi=-4)}), close=None)
    hr = dict(reference='hr', reference_quotes={'hr': '700'}, reference_updated={'hr': stamp},
              reference_age_minutes={'hr': 1}, synthetic_reference=True, fair_probability=.09,
              ev=17.0, fair_odds=1011, probit_ev=17.0, worst_ev=-2.3, qualifies=True,
              history=history, history_label='mixed_or_negative')
    pn = dict(hr, reference='pn', reference_quotes={'pn': '1800/-2400'}, reference_updated={'pn': stamp},
              synthetic_reference=False, ev=-12.8, probit_ev=-12.8, worst_ev=-15.2, qualifies=False)
    base = dict(player='test defenseman', game='nyr @ bos', start=(now+timedelta(hours=3)).isoformat(),
                team='nyr', book='fd', price=1200, position='D', quote_updated=stamp, method='probit',
                reference='hr', reference_updated={'hr': stamp}, ev=17.0, fair_odds=1011,
                comparisons=[hr, pn], research_match=True, avgSOG_L10=0, sogGames_L10=10,
                avgTOI=19.5, ppLine='2', teamTotal=3.1, history_label='mixed_or_negative',
                history=history, warnings=['<img src=x onerror=alert(1)>'], link='https://example.com/selection')
    second = dict(base, player='test forward', book='dk', position='LW', avgSOG_L10=2.2, sogGames_L10=8,
                  teamTotal=2.8, research_match=False, link='javascript:alert(1)')
    third = dict(base, player='unknown player', book='fn', position=None, avgSOG_L10=None,
                 sogGames_L10=3, teamTotal=None, research_match=False, link=None)
    return dict(schema_version=1, sport='nhl', market='atgs', date=now.date().isoformat(),
                generated_at=now.isoformat(), refresh_minutes=5, picks=[copy.deepcopy(pick) for pick in [base, second, third]],
                criteria=dict(min_odds=1000, max_odds=3000, min_ev=0, method='probit', max_age_minutes=15,
                              min_minutes_to_start=5, limit_per_book=10),
                books_checked=['fd', 'dk', 'fn', 'mgm', 'espn', 'hr', 'cz'],
                books_summary={book: dict(quoted=50, in_range=10, qualified=1, shown=1) for book in ['fd', 'dk', 'fn']},
                history_metadata=dict(season_labels={'2024': '2024-25', '2025': '2025-26'}))


state = {'status': 200, 'payload': sample(), 'requests': 0, 'mode': 'normal', 'held': None}
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--disable-logging', f'--log-file={ARTIFACTS / "chromium.log"}'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1050})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=NOW)

        def intercept(route):
            if '/api/longshots' in route.request.url:
                state['requests'] += 1
                if state['mode'] == 'hold':
                    state['held'] = route
                elif state['mode'] == 'fail':
                    route.abort('failed')
                else:
                    route.fulfill(status=state['status'], json=state['payload'])
            elif 'cdn.jsdelivr.net' in route.request.url:
                route.fulfill(content_type='application/javascript', body='''
                  window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                    onAuthStateChange: fn => {window.authChanged = fn; return {};}
                  }})};''')
            elif route.request.url.startswith(f'http://localhost:{server.server_port}/'):
                route.continue_()
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        page.goto(f'http://localhost:{server.server_port}/longshots.html')
        expect(page.locator('.rec-pick')).to_have_count(3)
        assert page.locator('#research-filter').is_checked() is False
        assert '0.00' in page.locator('.ls-sog-cell').first.inner_text()
        assert 'n = 10' in page.locator('.ls-sog-cell').first.inner_text()
        assert 'need 5' in page.locator('.ls-sog-cell').nth(2).inner_text()
        assert page.locator('.rec-pick a[href="https://example.com/selection"]').count() == 1
        assert page.locator('#picks a[href^="javascript"], #picks [onerror], #picks img[src="x"]').count() == 0
        assert page.locator('#book-filter option').count() == 8
        assert page.locator('#book-filter option[value="pn"], #book-filter option[value="bol"]').count() == 0
        page.locator('#page-picker-btn').click()
        assert page.locator('.pp-tab.active').get_attribute('data-key') == 'nhl'
        assert page.locator('.pp-page-btn.current-page.pp-sharp').inner_text().startswith('Longshots')
        page.locator('#page-picker-btn').click()
        page.locator('.rec-toggle').first.focus()
        page.keyboard.press('Enter')
        assert page.locator('.rec-toggle').first.get_attribute('aria-expanded') == 'true'
        assert '<img src=x' in page.locator('.ls-details').first.inner_text()
        assert page.locator('.ls-comparison').first.is_visible()
        assert '-12.8% EV' in page.locator('.ls-comparison').nth(1).inner_text()
        assert '2024-25' in page.locator('.ls-history-table').first.inner_text()
        assert '2025-26' in page.locator('.ls-history-table').first.inner_text()
        assert 'No matching sample' in page.locator('.ls-history-table').first.inner_text()
        assert '-4.0%' in page.locator('.ls-history-table').first.inner_text()

        def refresh():
            page.evaluate('window.refreshLongshots()')

        refresh()
        assert page.locator('.rec-toggle').first.get_attribute('aria-expanded') == 'true'
        page.wait_for_function('Array.from(document.querySelectorAll("#picks img")).every(img => img.complete && img.naturalWidth > 0)')
        page.screenshot(path=str(ARTIFACTS / 'desktop.png'), full_page=True)
        page.locator('#research-filter').check()
        expect(page.locator('.rec-pick')).to_have_count(1)
        page.locator('#research-filter').uncheck()
        page.select_option('#position-filter', 'F')
        expect(page.locator('.rec-pick')).to_have_count(1)
        page.select_option('#position-filter', 'D')
        expect(page.locator('.rec-pick')).to_have_count(1)
        page.select_option('#position-filter', '')
        page.locator('.ls-context-filters > summary').click()
        page.locator('#ev-filter').fill('18')
        expect(page.locator('.rec-pick')).to_have_count(0)
        page.locator('#ev-filter').fill('17')
        expect(page.locator('.rec-pick')).to_have_count(3)
        page.locator('#ev-filter').fill('')
        page.locator('#sog-filter').fill('0')
        expect(page.locator('.rec-pick')).to_have_count(2)
        page.locator('#sog-filter').fill('1')
        expect(page.locator('.rec-pick')).to_have_count(1)
        page.locator('#sog-filter').fill('')
        page.locator('#goals-filter').fill('3')
        expect(page.locator('.rec-pick')).to_have_count(1)
        page.locator('#goals-filter').fill('')
        page.locator('#search-filter').fill('nobody')
        expect(page.locator('.rec-pick')).to_have_count(0)
        assert 'No offers match' in page.locator('#empty-state').inner_text()
        page.locator('#search-filter').fill('')
        page.select_option('#book-filter', 'hr')
        expect(page.locator('.rec-pick')).to_have_count(0)
        page.select_option('#book-filter', '')
        for width in (320, 390, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(ARTIFACTS / 'mobile.png'), full_page=True)
        assert page.locator('.rec-book-cell img').first.is_visible()

        # All published betting books and upcoming dates match the probit scan.
        state['payload'] = sample()
        state['payload'].update(date=None, slate_date='2026-10-02')
        added_books = ['b365', 'bol', 'kal', 'nv', 'px', 'poly', 'mb']
        for book in added_books:
            offer = copy.deepcopy(state['payload']['picks'][0])
            offer.update(player=f'{book} player', book=book, research_match=False,
                         start=(NOW+timedelta(days=1)).isoformat(),
                         net_price_estimate=1150 if book == 'kal' else 1200, liquidity=75)
            state['payload']['picks'].append(offer)
        state['payload']['books_checked'] += added_books
        state['payload']['books_summary'].update({book: dict(quoted=10, in_range=5, qualified=1, shown=1) for book in added_books})
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(10)
        assert page.locator('#book-filter option').count() == 15
        assert page.locator('#book-filter option[value="b365"]').inner_text() == 'bet365'
        assert page.locator('#book-filter option[value="bol"]').inner_text() == 'BetOnline'
        assert page.locator('#book-count').inner_text() == '14'
        assert 'bet365: 10 quoted' in page.locator('#coverage').text_content()
        assert 'Up to 10 offers per book' in page.locator('#criteria').text_content()
        expected_keys = ['|'.join([pick['game'], pick['player'], pick['book']]) for pick in state['payload']['picks']]
        assert page.locator('.rec-pick').evaluate_all('(rows) => rows.map(row => row.dataset.key)') == expected_keys
        page.select_option('#book-filter', 'b365')
        expect(page.locator('.rec-pick')).to_have_count(1)
        assert 'Oct 3' in page.locator('.ls-player-cell').inner_text()
        refresh()
        assert page.locator('#book-filter').input_value() == 'b365'
        page.select_option('#book-filter', 'kal')
        assert '~+1150 after fees' in page.locator('.rec-book-cell').inner_text()
        page.locator('.rec-toggle').click()
        assert 'Available liquidity $75' in page.locator('.ls-details').inner_text()
        page.select_option('#book-filter', '')
        # A null date also works without optional slate metadata, using generated_at.
        del state['payload']['slate_date']
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(10)
        page.wait_for_function('Array.from(document.querySelectorAll("#picks img")).every(img => img.complete && img.naturalWidth > 0)')
        # Only Circa/Pinnacle remain reference-only even if the feed lists them.
        state['payload']['books_checked'] += ['pn', 'circa']
        for book in ['pn', 'circa']:
            state['payload']['picks'].append(dict(state['payload']['picks'][0], book=book))
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(10)
        assert page.locator('#book-filter option[value="pn"], #book-filter option[value="circa"]').count() == 0
        state['payload'] = sample()
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)

        # Midnight expiry refers to the snapshot day, not an upcoming game's date.
        midnight = datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)
        before_midnight = midnight-timedelta(minutes=1)
        state['payload'] = sample(before_midnight)
        state['payload'].update(date=None, slate_date='2026-10-02')
        page.clock.set_system_time(before_midnight)
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)
        page.clock.set_system_time(midnight)
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(0)
        state['payload'] = sample(midnight)
        state['payload'].update(date=None, slate_date='2026-10-03')
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)
        page.clock.set_system_time(NOW)
        state['payload'] = sample()
        refresh()

        # Book, primary-reference, report and start freshness all fail closed.
        for mutate in (
            lambda data: data['picks'][0].update(quote_updated=(NOW-timedelta(minutes=16)).isoformat()),
            lambda data: data['picks'][0]['comparisons'][0].update(reference_updated={'hr': (NOW-timedelta(minutes=16)).isoformat()}),
            lambda data: data['picks'][0].update(start=(NOW+timedelta(minutes=5)).isoformat()),
            lambda data: data['picks'][0].update(quote_updated=(NOW+timedelta(minutes=1)).isoformat()),
        ):
            state['payload'] = copy.deepcopy(sample())
            mutate(state['payload'])
            refresh()
            expect(page.locator('.rec-pick')).to_have_count(2)
        state['payload'] = copy.deepcopy(sample())
        state['payload']['picks'][0]['comparisons'][1]['reference_updated']['pn'] = (NOW-timedelta(minutes=16)).isoformat()
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)
        assert 'reference expired; estimates hidden' in page.locator('.ls-details').first.inner_text()
        assert '-12.8%' not in page.locator('.ls-details').first.inner_text()
        for key, value in [('generated_at', (NOW-timedelta(minutes=16)).isoformat()), ('date', '2026-10-01')]:
            state['payload'] = sample()
            state['payload'][key] = value
            refresh()
            expect(page.locator('.rec-pick')).to_have_count(0)
            assert 'out of date' in page.locator('#freshness-status').inner_text()

        # Genuine empty publication and reference-only offered books.
        state['payload'] = sample()
        state['payload']['picks'] = []
        state['payload']['books_summary'] = {}
        refresh()
        assert page.locator('#empty-state').is_visible()
        assert page.locator('#empty-state h2').inner_text() == 'No qualifying offers'
        state['payload'] = sample()
        state['payload']['books_checked'].append('pn')
        state['payload']['picks'][0]['book'] = 'pn'
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(2)

        # Denied access clears previously rendered data and a later success recovers.
        state['status'] = 403
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(0)
        assert page.locator('#access-panel').is_visible()
        assert page.locator('#report-content').is_hidden()
        state['status'], state['payload'] = 200, sample()
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)

        # Timeout releases the button; stale cached offers disappear after failed polling.
        state['mode'] = 'hold'
        page.evaluate('() => { window.refreshLongshots(); }')
        page.wait_for_timeout(30)
        page.clock.fast_forward(21000)
        expect(page.locator('#request-status')).to_contain_text('timed out')
        assert page.locator('#refresh').is_enabled()
        if state['held']:
            state['held'].abort('failed')
            state['held'] = None
        state['mode'] = 'fail'
        page.clock.fast_forward(16 * 60000)
        expect(page.locator('.rec-pick')).to_have_count(0)
        assert 'out of date' in page.locator('#freshness-status').inner_text()
        state['mode'] = 'normal'
        page.clock.set_system_time(NOW)
        refresh()
        expect(page.locator('.rec-pick')).to_have_count(3)

        # Hidden pages do not poll; visibility restoration immediately rechecks the clock.
        page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'})")
        before = state['requests']
        page.clock.fast_forward(60000)
        page.wait_for_timeout(30)
        assert state['requests'] == before
        page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(100)
        assert state['requests'] > before

        # Signout clears private results immediately, before the next API response.
        state['mode'] = 'hold'
        page.evaluate("window.authChanged('SIGNED_OUT', null)")
        expect(page.locator('.rec-pick')).to_have_count(0)
        assert page.locator('#access-panel').is_visible()
        page.wait_for_timeout(30)
        if state['held']:
            state['held'].fulfill(status=403, json={'error': 'Sharp membership required'})
            state['held'] = None
        if len(sys.argv) > 1:
            state['mode'], state['status'] = 'normal', 200
            state['payload'] = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
            page.clock.set_system_time(datetime.fromisoformat(state['payload']['generated_at']))
            page.evaluate("window.authChanged('SIGNED_IN', {access_token: 'preview-token'})")
            expect(page.locator('.rec-pick')).to_have_count(min(50, len(state['payload']['picks'])))
            page.set_viewport_size({'width': 1440, 'height': 1050})
            page.locator('.ls-context-filters > summary').click()
            page.locator('.rec-toggle').first.click()
            page.wait_for_function('Array.from(document.querySelectorAll("#picks img")).every(img => img.complete && img.naturalWidth > 0)')
            page.screenshot(path=str(ARTIFACTS / 'desktop-real.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(ARTIFACTS / 'mobile-real.png'), full_page=True)
            page.evaluate('window.scrollTo(0, 0)')
            page.screenshot(path=str(ARTIFACTS / 'mobile-viewport.png'), full_page=False)
            page.locator('.rec-pick').first.scroll_into_view_if_needed()
            page.screenshot(path=str(ARTIFACTS / 'mobile-offer.png'), full_page=False)
            if len(state['payload']['picks']) > 50:
                page.locator('#show-more').click()
                expect(page.locator('.rec-pick')).to_have_count(min(100, len(state['payload']['picks'])))
            expected_keys = ['|'.join([pick['game'], pick['player'], pick['book']]) for pick in state['payload']['picks']]
            assert page.locator('.rec-pick').evaluate_all('(rows) => rows.map(row => row.dataset.key)') == expected_keys[:100]
            assert page.locator('#book-filter option[value="b365"]').count() == 1
            assert page.locator('#book-filter option[value="bol"]').count() == 1
            page.locator('#research-filter').check()
            expect(page.locator('.rec-pick')).to_have_count(sum(pick['research_match'] for pick in state['payload']['picks']))
        assert not errors, errors
        browser.close()
        print(f'PASS: desktop/mobile, dynamic books, upcoming games, midnight rollover, fees/liquidity, filters, all-reference history, escaping, freshness, empty, access, timeout and visibility. Screenshots: {ARTIFACTS}')
finally:
    server.shutdown()
