"""Offline browser checks for the Devig Results best-performers share card.

Serves staged files over loopback, falling back to the existing frontend project.
Every external request is intercepted. Clipboard calls are mocked, never posted.
"""
from collections import defaultdict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import struct
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
ROOT = next((parent for parent in STAGED.parents if (parent / 'devig_results.py').is_file()), STAGED.parent / 'odds')
SITE = ROOT.parent / 'frontend'
OUTPUT = ROOT / 'out_devig_share'
OUTPUT.mkdir(exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = urlparse(path).path.strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def cell(**changes):
    return dict(dict(date='2026-10-11', book='dk', prop='attd', reference='pn;1', method='worst',
                     odds_band='+100 to +199', selected=22, wins=12, losses=8, pushes=0,
                     pending=1, ungraded=1, profit_units=10, ev_sum=50), **changes)


def fixture():
    books = ['dk', 'fd', 'b365', 'mgm', 'nv', 'br']
    references = ['pn;1', 'circa;1', 'pn+circa;1,1']
    cells = [cell(book=books[i % 6], reference=references[i // 6],
                  method='power' if i % 2 else 'worst',
                  date='2026-10-04' if i % 3 == 0 else '2026-10-11',
                  profit_units=20 - i if i < 17 else -5) for i in range(18)]
    cells.extend([
        cell(date='2026-10-11', book='dk', reference='pn;1', profit_units=5),
        cell(book='fd', prop='rush_yds', profit_units=120),
        cell(book='nv', prop='<img src=x onerror=window.shareInjected=1>', profit_units=130),
        cell(book='dk', reference='escaped;1', method='escaped', profit_units=25),
        cell(book='px', selected=6, wins=3, losses=1, pushes=0, pending=1, ungraded=1, profit_units=10),
        cell(book='kal', selected=3, wins=0, losses=0, pushes=0, pending=2, ungraded=1, profit_units=0),
    ])
    return dict(version=1, sport='nfl', generated_at='2026-10-12T12:00:00Z',
                window=dict(start='2026-07-01', end='2026-10-11', season_start='2026-07-01'),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn']),
                            dict(id='circa;1', name='Circa', books=['circa']),
                            dict(id='pn+circa;1,1', name='Pinnacle + Circa', books=['pn', 'circa']),
                            dict(id='escaped;1', name='<img src=x onerror=window.shareInjected=1>', books=[])],
                methods=[dict(id='worst', name='Worst-case'), dict(id='power', name='Power'),
                         dict(id='escaped', name='<svg onload=window.shareInjected=1>')],
                config=dict(min_ev=0, max_ev=None, min_liquidity=50, one_sided='site', fee_policy='Estimated fees'),
                coverage=dict(event_dates=['2026-10-04', '2026-10-11'], missing_dates=[], files=[]),
                notes=[], cells=cells,
                best_cells=[cell(book='best', profit_units=250),
                            cell(book='best', reference='circa;1', method='power', profit_units=200)])


def expected_groups(data, filters, limit, scores=False):
    groups = defaultdict(lambda: dict(settled=0, profit=0))
    for row in data['cells'] + data.get('best_cells', []):
        if not filters['start'] <= row['date'] <= filters['end']:
            continue
        if filters['book'] and row['book'] != filters['book']:
            continue
        if not filters['book'] and row['book'] == 'best':
            continue
        if filters['prop'] and row['prop'] != filters['prop']:
            continue
        group = groups[(row['prop'], row['book'], row['reference'], row['method'])]
        group['settled'] += row['wins'] + row['losses'] + row['pushes']
        group['profit'] += row['profit_units']
    ranked = [(key, value) for key, value in groups.items()
              if value['settled'] >= max(1, filters['minimum'])
              and (not filters['profitableOnly'] or value['profit'] > 0)]
    ranked.sort(key=lambda pair: (-pair[1]['profit'] / pair[1]['settled'], -pair[1]['settled'], -pair[1]['profit']))
    if scores:
        return {key: (round(value['profit'] / value['settled'], 9), value['settled'], round(value['profit'], 9))
                for key, value in ranked}
    return [key for key, _ in ranked[:limit]]


def png_dimensions(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', data[16:24])
    assert 500 <= width <= 8192 and 300 <= height <= 16384, (width, height)
    assert len(data) > 10000, 'Expected a rendered image, not an empty PNG'
    return width, height


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
state = dict(payload=fixture(), status=200, signed_in=True, requests=[])
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1440, height=1100))
        errors = []
        downloads = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('download', lambda download: downloads.append(download))
        page.add_init_script('''window.EventSource = undefined;
          const RealDate = Date; window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : ['2026-10-12T12:00:00Z'])); }
            static now() { return RealDate.parse('2026-10-12T12:00:00Z'); }
          };''')

        def intercept(route):
            url = route.request.url
            if '/api/devig-results' in url:
                state['requests'].append(url)
                route.fulfill(status=state['status'], json=state['payload'])
            elif 'cdn.jsdelivr.net' in url:
                session = "{access_token:'fixture-token'}" if state['signed_in'] else 'null'
                route.fulfill(content_type='application/javascript', body='''window.supabase = {
                  createClient: () => ({auth: {getSession: async () => ({data:{session:SESSION}}),
                  onAuthStateChange: fn => {window.authChanged=fn;return {};}}})};'''.replace('SESSION', session))
            elif url.startswith(f'http://127.0.0.1:{server.server_port}/'):
                route.continue_()
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        url = f'http://127.0.0.1:{server.server_port}/devig-results.html?sport=nfl'
        page.goto(url)
        expect(page.locator('#best-performers')).to_be_enabled()
        expect(page.locator('#market-filter')).to_have_value('attd')
        initial_strategy = (page.locator('#reference-filter').input_value(), page.locator('#method-filter').input_value())
        dialog = page.locator('#performers-dialog')

        def open_card():
            page.locator('#best-performers').click()
            expect(dialog).to_be_visible()
            assert dialog.evaluate('(el) => el.open && el.matches(":modal")')

        def close_card():
            page.locator('#performers-close').click()
            expect(dialog).to_be_hidden()

        def assert_rows(allow_ties=False):
            filters = page.evaluate('''() => ({
              start:document.querySelector('#date-start').value,
              end:document.querySelector('#date-end').value,
              book:document.querySelector('#book-filter').value,
              prop:document.querySelector('#market-filter').value,
              minimum:Number(document.querySelector('#min-settled').value),
              profitableOnly:document.querySelector('#profitable-only').checked})''')
            limit = int(page.locator('#performers-limit').input_value())
            expected = expected_groups(state['payload'], filters, limit)
            actual = page.locator('#performers-rows tr[data-book]').evaluate_all('''rows => rows.map(row => [
              row.dataset.prop, row.dataset.book, row.dataset.reference, row.dataset.method])''')
            if allow_ties:
                scores = expected_groups(state['payload'], filters, limit, scores=True)
                assert [scores[tuple(key)] for key in actual] == [scores[key] for key in expected]
            else:
                assert actual == [list(key) for key in expected], dict(actual=actual, expected=expected)
            assert page.locator('#performers-card img, #performers-card svg').count() == 0
            assert page.evaluate('window.shareInjected || 0') == 0
            return actual

        open_card()
        expect(page.locator('#performers-limit')).to_have_value('10')
        rows = assert_rows()
        assert len(rows) == 10
        assert any(row[2:] != list(initial_strategy) for row in rows), 'Must compare all reference/method groups'
        assert all(row[1] != 'best' for row in rows), 'All books must exclude synthetic best rows'
        card_text = page.locator('#performers-card').inner_text()
        assert re.search(r'flat|1\s*u|one unit', card_text, re.I)
        assert re.search(r'observed|historical', card_text, re.I)
        assert '<img src=x onerror=window.shareInjected=1>' in card_text
        for limit in ('5', '15', '10'):
            page.select_option('#performers-limit', limit)
            assert len(assert_rows()) == int(limit)
        page.locator('#performers-close').focus()
        for _ in range(9):
            page.keyboard.press('Tab')
            # Chromium may visit browser chrome while wrapping (activeElement becomes body),
            # but the inert page controls must never receive focus behind the native dialog.
            assert dialog.evaluate('(el) => el.contains(document.activeElement) || document.activeElement === document.body'), 'Native modal focus escaped'
        page.evaluate("document.querySelector('#date-start').focus()")
        assert not page.locator('#date-start').evaluate('(el) => el === document.activeElement')
        page.keyboard.press('Escape')
        expect(dialog).to_be_hidden()
        expect(page.locator('#best-performers')).to_be_focused()

        # The card applies date/book/market/minimum/profit scope, but never the chosen reference/method.
        page.select_option('#date-preset', 'yesterday')
        page.select_option('#book-filter', 'fd')
        open_card()
        assert_rows()
        close_card()
        page.select_option('#book-filter', 'best')
        open_card()
        assert all(row[1] == 'best' for row in assert_rows())
        close_card()
        page.select_option('#book-filter', '')
        page.select_option('#market-filter', '')
        open_card()
        assert any(row[0] == 'rush_yds' for row in assert_rows())
        close_card()
        page.select_option('#market-filter', 'attd')
        page.locator('#min-settled').fill('1')
        page.locator('#min-settled').press('Tab')
        open_card()
        assert any(row[1] == 'px' for row in assert_rows())
        close_card()
        page.locator('#profitable-only').check()
        open_card()
        assert_rows()
        close_card()
        page.locator('#min-settled').fill('1000')
        page.locator('#min-settled').press('Tab')
        open_card()
        assert_rows()
        expect(page.locator('#performers-copy')).to_be_disabled()
        expect(page.locator('#performers-download')).to_be_disabled()
        close_card()

        page.locator('#reset-filters').click()
        page.locator('#date-start').fill('2026-10-12')
        page.locator('#date-start').press('Tab')
        expect(page.locator('#best-performers')).to_be_disabled()
        page.locator('#reset-filters').click()
        open_card()

        # Real canvas export; clipboard is a local stub and no actual clipboard is changed.
        page.evaluate('''Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{
          write: async items => {
            const blob = await items[0].getType('image/png');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            window.copiedImage = {type:blob.type,size:blob.size,header:[...bytes.slice(0,24)]};
          }}});''')
        page.locator('#performers-copy').click()
        page.wait_for_function('window.copiedImage && window.copiedImage.size > 10000')
        copied = page.evaluate('window.copiedImage')
        assert copied['type'] == 'image/png'
        assert copied['header'][:8] == [137, 80, 78, 71, 13, 10, 26, 10]
        expect(page.locator('#performers-status')).to_contain_text(re.compile('copied', re.I))
        with page.expect_download() as download:
            page.locator('#performers-download').click()
        download = download.value
        assert download.suggested_filename.endswith('.png')
        fixture_png = OUTPUT / 'fixture-best-performers.png'
        download.save_as(fixture_png)
        dimensions = png_dimensions(fixture_png)
        page.evaluate('''Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{
          write: async () => {throw new DOMException('Denied for test', 'NotAllowedError');}
        }});''')
        with page.expect_download() as fallback:
            page.locator('#performers-copy').click()
        fallback_png = OUTPUT / 'fixture-copy-fallback.png'
        fallback.value.save_as(fallback_png)
        assert png_dimensions(fallback_png) == dimensions
        expect(page.locator('#performers-status')).to_contain_text(re.compile('download', re.I))

        for width in (390, 320):
            page.set_viewport_size(dict(width=width, height=844))
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
            expect(page.locator('#performers-close')).to_be_visible()
            expect(page.locator('#performers-download')).to_be_enabled()
            page.screenshot(path=str(OUTPUT / f'fixture-performers-mobile-{width}.png'))
        page.set_viewport_size(dict(width=1440, height=1100))

        # Any auth or sport invalidation clears the protected card and closes its native dialog.
        before = len(downloads)
        page.evaluate('''() => { window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
            window.originalToBlob.call(this, blob => {window.releasePendingImage = () => callback(blob);}, ...args);
          }; }''')
        page.locator('#performers-download').click()
        page.wait_for_function('typeof window.releasePendingImage === "function"')
        page.evaluate("window.authChanged('SIGNED_OUT', null)")
        expect(dialog).to_be_hidden()
        expect(page.locator('#best-performers')).to_be_disabled()
        expect(page.locator('#performers-rows tr')).to_have_count(0)
        page.evaluate('() => {window.releasePendingImage(); HTMLCanvasElement.prototype.toBlob = window.originalToBlob;}')
        expect(page.locator('#performers-status')).to_be_empty()
        assert len(downloads) == before, 'An image preparing before signout must not download afterward'
        page.evaluate("window.authChanged('SIGNED_IN', {access_token:'new-token'})")
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        nhl = fixture()
        nhl['sport'] = 'nhl'
        for row in nhl['cells'] + nhl['best_cells']:
            if row['prop'] == 'attd':
                row['prop'] = 'atgs'
        state['payload'] = nhl
        page.evaluate("document.querySelector('#sport-filter').value='nhl'; document.querySelector('#sport-filter').dispatchEvent(new Event('change'))")
        expect(dialog).to_be_hidden()
        expect(page.locator('#performers-rows tr')).to_have_count(0)
        expect(page.locator('#page-title')).to_have_text('NHL devig results')
        open_card()
        assert all(row[0] != 'attd' for row in assert_rows())
        state['status'] = 403
        page.evaluate("document.querySelector('#refresh').click()")
        expect(dialog).to_be_hidden()
        expect(page.locator('#performers-rows tr')).to_have_count(0)
        expect(page.locator('#access-panel')).to_be_visible()

        # A real report screenshot is optional; no report generation or live API is performed.
        actual = ROOT / 'static/analysis/devig_results/nfl.json'
        if actual.is_file():
            state.update(status=200, payload=json.loads(actual.read_text(encoding='utf-8')))
            page.goto(url)
            expect(page.locator('#best-performers')).to_be_enabled(timeout=20000)
            open_card()
            assert_rows(allow_ties=True)
            page.screenshot(path=str(OUTPUT / 'actual-nfl-performers-dialog.png'))
            with page.expect_download() as download:
                page.locator('#performers-download').click()
            actual_png = OUTPUT / 'actual-nfl-best-performers.png'
            download.value.save_as(actual_png)
            print('Actual NFL PNG:', png_dimensions(actual_png))
            for width in (390, 320):
                page.set_viewport_size(dict(width=width, height=844))
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
                page.screenshot(path=str(OUTPUT / f'actual-nfl-performers-mobile-{width}.png'))
            with page.expect_download() as mobile_download:
                page.locator('#performers-download').click()
            mobile_png = OUTPUT / 'actual-nfl-best-performers-mobile.png'
            mobile_download.value.save_as(mobile_png)
            assert png_dimensions(mobile_png) == png_dimensions(actual_png)
        assert not errors, errors
        browser.close()
        print('PASS: independent performer ranking/filter scopes; native dialog focus/Escape; safe text; real PNG export; mocked clipboard success/fallback; auth/sport clearing; mobile layouts.')
finally:
    server.shutdown()
