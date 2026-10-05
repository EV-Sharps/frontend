"""Fixture-only integration checks, plus screenshots of the real local report.

Run with Python + Playwright. All nonlocal network requests are intercepted.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
ROOT = next((parent for parent in STAGED.parents if (parent / 'devig_results.py').is_file()),
            STAGED.parent / 'odds')
SITE = ROOT.parent / 'frontend'


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = urlparse(path).path.strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def cell(**changes):
    return dict(dict(date='2026-10-01', book='dk', prop='sog', reference='pn;1', method='worst',
                     odds_band='+100 to +199', selected=15, wins=6, losses=4, pushes=2,
                     pending=1, ungraded=2, profit_units=5, ev_sum=40), **changes)


def fixture():
    return dict(version=1, sport='nhl', generated_at='2026-10-05T12:00:00Z',
                window=dict(start='2026-09-28', end='2026-10-04', days=7),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn']), dict(id='fd;1', name='FanDuel', books=['fd'])],
                methods=[dict(id='worst', name='Worst-case'), dict(id='power', name='Power')],
                config=dict(min_ev=0, max_ev=25, min_liquidity=50, one_sided='exclude', fee_policy='Estimated fees'),
                coverage=dict(files=[dict(date='2026-10-01', feed='nhl', rows=25), dict(date='2026-10-02', feed='nhl', rows=25)],
                              raw_rows=50, valid_rows=25, graded_rows=20, unresolved_rows=5,
                              latest_archive_date='2026-10-02', missing_dates=['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-03', '2026-10-04'], reasons={'test_reason': 1},
                              grading_reasons={'missing_or_unverified_stat': 5}),
                notes=['<img src=x onerror=alert(1)>'],
                cells=[cell(), cell(book='fd', profit_units=-3), cell(date='2026-10-02', prop='atgs', profit_units=7),
                       cell(reference='fd;1', profit_units=100), cell(method='power', profit_units=50)])


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
state = dict(status=200, payload=fixture(), signed_in=True, requests=[])
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1440, height=1100))
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('window.EventSource = undefined;')

        def intercept(route):
            url = route.request.url
            if '/api/devig-results' in url:
                state['requests'].append(dict(url=url, auth=route.request.headers.get('authorization')))
                route.fulfill(status=state['status'], json=state['payload'])
            elif 'cdn.jsdelivr.net' in url:
                session = "{access_token: 'fixture-token'}" if state['signed_in'] else 'null'
                route.fulfill(content_type='application/javascript', body='''
                  window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: SESSION}}),
                    onAuthStateChange: fn => {window.authChanged = fn; return {};}
                  }})};'''.replace('SESSION', session))
            elif url.startswith(f'http://127.0.0.1:{server.server_port}/'):
                route.continue_()
            elif 'public-preview.test' in url:
                name = urlparse(url).path.strip('/')
                path = STAGED / name if (STAGED / name).is_file() else SITE / name
                if path.is_file() and '..' not in name:
                    route.fulfill(path=str(path))
                else:
                    route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        url = f'http://127.0.0.1:{server.server_port}/devig-results.html'
        page.goto(url)
        expect(page.locator('#summary-roi')).to_have_text('+25.00%')
        expect(page.locator('#summary-profit')).to_have_text('+9.00u')
        expect(page.locator('#summary-settled')).to_have_text('36')
        expect(page.locator('#summary-unresolved')).to_have_text('3 / 6')
        expect(page.locator('#reference-filter')).to_have_value('pn;1')
        expect(page.locator('#coverage-badge')).to_have_text('2 / 7 days')
        assert page.locator('#daily-chart .is-missing').count() == 5
        assert page.locator('#report-notes img').count() == 0
        assert 'missing or unverified stat: 5' in page.locator('#coverage-reasons').text_content()
        assert state['requests'][-1]['auth'] == 'Bearer fixture-token'
        expect(page.locator('#market-filter option[value="atgs"]')).to_have_text(re.compile(r'ATGS.*Anytime goalscorer'))
        for table in ('#odds-rows', '#book-rows'):
            assert page.locator(f'{table} tr.dv-prop-group').count() == 2
            expect(page.locator(f'{table} tr.dv-prop-group').first).to_have_attribute('data-prop', 'atgs')
            expect(page.locator(f'{table} tr.dv-prop-group[data-prop="atgs"]')).to_contain_text(re.compile(r'ATGS.*Anytime goalscorer'))
            expect(page.locator(f'{table} tr[data-prop="atgs"][data-segment]')).to_contain_text('+7.00u')
        expect(page.locator('#book-rows tr[data-prop="sog"][data-segment="dk"]')).to_contain_text('+5.00u')
        expect(page.locator('#odds-rows tr[data-prop="sog"][data-segment]')).to_contain_text('+2.00u')
        page.locator('#book-rows [data-prop-filter="atgs"]').click()
        expect(page.locator('#market-filter')).to_have_value('atgs')
        expect(page.locator('#summary-profit')).to_have_text('+7.00u')
        for table in ('#odds-rows', '#book-rows'):
            assert page.locator(f'{table} tr.dv-prop-group').count() == 1
            assert page.locator(f'{table} tr[data-prop="sog"]').count() == 0
        page.locator('#reset-filters').click()

        page.select_option('#book-filter', 'dk')
        page.select_option('#market-filter', 'sog')
        expect(page.locator('#summary-profit')).to_have_text('+5.00u')
        assert page.locator('#book-rows tr.dv-prop-group').count() == 1
        assert page.locator('#book-rows tr[data-prop="atgs"]').count() == 0
        assert page.locator('#book-rows tr[data-segment="fd"]').count() == 0
        assert page.locator('#strategy-rows .dv-strategy-button').count() == 3
        page.locator('#strategy-rows .dv-strategy-button').first.click()
        expect(page.locator('#reference-filter')).to_have_value('fd;1')
        expect(page.locator('#summary-profit')).to_have_text('+100.00u')
        page.locator('#reset-filters').click()
        page.locator('#date-end').fill('2026-10-01')
        page.locator('#date-end').press('Tab')
        expect(page.locator('#summary-profit')).to_have_text('+2.00u')
        page.locator('#reset-filters').click()
        page.locator('#min-settled').fill('50')
        page.locator('#min-settled').press('Tab')
        expect(page.locator('#summary-profit')).to_have_text('+9.00u')
        assert page.locator('#strategy-rows .dv-strategy-button').count() == 0
        for table in ('#odds-rows', '#book-rows'):
            assert page.locator(f'{table} tr[data-segment]').count() == 0
            expect(page.locator(f'{table} tr.dv-prop-group[data-prop="atgs"]')).to_be_visible()
        page.locator('#book-rows [data-small-samples="atgs"]').click()
        expect(page.locator('#min-settled')).to_have_value('1')
        expect(page.locator('#summary-profit')).to_have_text('+9.00u')
        assert page.locator('#book-rows tr[data-prop="atgs"][data-segment]').count() == 1
        assert page.locator('#book-rows tr[data-prop="sog"][data-segment]').count() == 2
        page.locator('#min-settled').fill('10')
        page.locator('#min-settled').press('Tab')
        page.locator('#profitable-only').check()
        assert 'FanDuel' not in page.locator('#book-rows').inner_text()
        page.locator('#reset-filters').click()
        page.locator('#date-start').fill('2026-10-04')
        page.locator('#date-end').fill('2026-10-01')
        page.locator('#date-end').press('Tab')
        expect(page.locator('#filter-status')).to_be_visible()
        expect(page.locator('#summary-roi')).to_have_text('—')
        expect(page.locator('#export')).to_be_disabled()
        assert page.locator('.dv-prop-group').count() == 0
        page.locator('#reset-filters').click()

        for width in (390, 320):
            page.set_viewport_size(dict(width=width, height=844))
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Page overflow at {width}px'
        page.set_viewport_size(dict(width=1440, height=1100))

        state['payload']['cells'] = [cell(), cell(prop='atgs', reference='fd;1')]
        page.locator('#refresh').click()
        expect(page.locator('#summary-profit')).to_have_text('+5.00u')
        expect(page.locator('#book-rows tr.dv-prop-group[data-prop="atgs"]')).to_be_visible()
        assert page.locator('#book-rows tr[data-prop="atgs"][data-segment]').count() == 0

        state['payload']['cells'] = [cell(prop='atgs', selected=3, wins=0, losses=0, pushes=0, pending=1, ungraded=2, profit_units=0)]
        page.locator('#refresh').click()
        expect(page.locator('#summary-unresolved')).to_have_text('1 / 2')
        expect(page.locator('#summary-roi')).to_have_text('—')
        expect(page.locator('#book-rows tr.dv-prop-group[data-prop="atgs"]')).to_be_visible()
        assert page.locator('#book-rows tr[data-segment]').count() == 0

        for status in (401, 403):
            state.update(status=status)
            page.locator('#refresh').click()
            expect(page.locator('#access-panel')).to_be_visible()
            expect(page.locator('#report-content')).to_be_hidden()
            assert page.locator('#strategy-rows tr').count() == 0
            assert page.locator('#coverage-files tr').count() == 0
            assert page.locator('.dv-prop-group').count() == 0
            expect(page.locator('#summary-roi')).to_have_text('—')
            state.update(status=200, payload=fixture())
            page.locator('#refresh').click()
            expect(page.locator('#summary-profit')).to_have_text('+9.00u')

        page.evaluate("window.authChanged('SIGNED_OUT', null)")
        expect(page.locator('#access-panel')).to_be_visible()
        expect(page.locator('#report-content')).to_be_hidden()
        assert page.locator('#coverage-files tr').count() == 0
        assert page.locator('.dv-prop-group').count() == 0

        state['signed_in'] = False
        before = len(state['requests'])
        page.goto('http://public-preview.test/devig-results.html?preview=1')
        expect(page.locator('#access-panel')).to_be_visible()
        assert len(state['requests']) == before, 'A public host must not bypass auth via preview=1'
        page.goto(url + '?preview=1')
        expect(page.locator('#summary-profit')).to_have_text('+9.00u')
        assert state['requests'][-1]['url'].startswith(f'http://127.0.0.1:{server.server_port}/api/')
        assert state['requests'][-1]['auth'] is None

        actual = ROOT / 'static' / 'analysis' / 'devig_results' / 'nhl.json'
        if actual.is_file():
            state['payload'] = json.loads(actual.read_text(encoding='utf-8'))
            page.reload()
            expect(page.locator('#report-content')).to_be_visible()
            expect(page.locator('#summary-roi')).not_to_have_text('—')
            for table in ('#odds-rows', '#book-rows'):
                expect(page.locator(f'{table} tr.dv-prop-group').first).to_have_attribute('data-prop', 'atgs')
                expect(page.locator(f'{table} tr.dv-prop-group[data-prop="atgs"]')).to_contain_text(re.compile(r'ATGS.*Anytime goalscorer'))
            assert page.locator('#odds-rows tr[data-prop="atgs"][data-segment]').count() > 0
            page.locator('#strategy-rows .dv-strategy-button').first.scroll_into_view_if_needed()
            assert page.locator('#strategy-rows .dv-strategy-button').first.evaluate('''el => {
              const r = el.getBoundingClientRect();
              return document.elementFromPoint(r.left + 5, r.top + 5) === el;
            }'''), 'Strategy rows must actually paint in the viewport'
            page.locator('#book-rows tr').first.scroll_into_view_if_needed()
            assert page.locator('#book-rows tr').first.evaluate('''el => {
              const r = el.getBoundingClientRect();
              return el.contains(document.elementFromPoint(r.left + 5, r.top + 5));
            }'''), 'Book rows must be reachable and visible'
            page.locator('.dv-breakdowns').screenshot(path=str(STAGED / 'tests' / 'actual-prop-breakdowns-desktop.png'))
            page.evaluate('window.scrollTo(0, 0)')
            page.screenshot(path=str(STAGED / 'tests' / 'actual-desktop-viewport.png'))
            page.screenshot(path=str(STAGED / 'tests' / 'actual-desktop.png'), full_page=True)
            page.set_viewport_size(dict(width=390, height=844))
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.locator('#book-rows tr').first.scroll_into_view_if_needed()
            assert page.evaluate('window.scrollY > 0'), 'Mobile page must scroll to the book results'
            page.evaluate('window.scrollTo(0, 0)')
            page.screenshot(path=str(STAGED / 'tests' / 'actual-mobile-viewport.png'))
            page.screenshot(path=str(STAGED / 'tests' / 'actual-mobile.png'), full_page=True)
            small_atgs = page.locator('#book-rows [data-small-samples="atgs"]')
            if small_atgs.count():
                before = page.locator('#book-rows tr[data-prop="atgs"][data-segment]').count()
                small_atgs.click()
                expect(page.locator('#min-settled')).to_have_value('1')
                assert page.locator('#book-rows tr[data-prop="atgs"][data-segment]').count() > before
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.locator('#book-rows [data-prop-filter="atgs"]').click()
                expect(page.locator('#market-filter')).to_have_value('atgs')
                expect(page.locator('#book-rows tr.dv-prop-group')).to_have_count(1)
                assert page.locator('#book-rows tr[data-prop="atgs"][data-segment]').count() > 0
                page.locator('#book-rows').scroll_into_view_if_needed()
                page.screenshot(path=str(STAGED / 'tests' / 'actual-atgs-mobile.png'))
                page.set_viewport_size(dict(width=320, height=844))
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.locator('#book-rows tr[data-prop="atgs"][data-segment]').first.scroll_into_view_if_needed()
                page.screenshot(path=str(STAGED / 'tests' / 'actual-atgs-mobile-320.png'))
                page.set_viewport_size(dict(width=1440, height=1100))
                page.locator('.dv-breakdowns').screenshot(path=str(STAGED / 'tests' / 'actual-atgs-small-samples-desktop.png'))
            print('Actual report:', page.locator('#summary-roi').inner_text(), page.locator('#summary-profit').inner_text(), page.locator('#summary-settled').inner_text())
        assert not errors, errors
        browser.close()
        print('PASS: prop-isolated rankings, ATGS discovery, small samples, filters, reference isolation, invalid dates, null ROI, 401/403/signout clearing, 320/390px mobile, loopback-only preview; no page errors.')
finally:
    server.shutdown()
