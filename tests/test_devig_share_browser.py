"""Offline browser checks for the Devig Results best-performers share card.

Serves staged files over loopback, falling back to the existing frontend project.
Every external request is intercepted. Clipboard calls are mocked, never posted.
"""
from collections import defaultdict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import struct
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
ROOT = next((parent for parent in STAGED.parents if (parent / 'devig_results.py').is_file()), STAGED.parent / 'odds')
SITE = ROOT.parent / 'frontend'
REPORTS = ROOT / 'out_devig_profit_grid'
ARTIFACTS = None if os.environ.get('DEVIG_SHARE_ARTIFACTS') else TemporaryDirectory(prefix='devig-share-browser-')
OUTPUT = Path(os.environ['DEVIG_SHARE_ARTIFACTS']).resolve() if ARTIFACTS is None else Path(ARTIFACTS.name)
OUTPUT.mkdir(parents=True, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = urlparse(path).path.strip('/')
        if '/' not in name and (STAGED / name).is_file():
            return str(STAGED / name)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def cell(**changes):
    row = dict(dict(date='2026-10-11', book='dk', prop='attd', reference='pn;1', method='worst',
                     odds_band='+100 to +199', share_odds_bucket='short', selected=22, wins=12, losses=8, pushes=0,
                     pending=1, ungraded=1, profit_units=10, ev_sum=50), **changes)
    if row['wins'] and 'best_hit' not in row:
        row['best_hit'] = dict(player=f"{row['book']} {row['reference']} {row['method']} {row['date']} winner",
                               player_id='123', date=row['date'], game='wsh @ la', prop=row['prop'],
                               line=.5, under=False, odds=150, profit_units=1.5,
                               book='fd' if row['book'] == 'best' else row['book'])
    return row


def fixture():
    books = ['fd', 'dk', 'b365', 'mgm', 'br', 'nv']
    references = ['pn;1', 'circa;1', 'pn+circa;1+1', 'nv;1']
    prices = {'short': [199, 399, 150, -200], 'mid': [400, 1000, 999, 650], 'long': [1001, 1500, 2000, 2500]}
    profits = {'short': [[60, 7], [50, 45], [40, 35], [30, 25]],
               'mid': [[30, 35], [60, 42], [20, 15], [50, 55]],
               'long': [[20, 55], [30, 50], [70, 65], [40, 45]]}
    cells = []
    for book_index, book in enumerate(books):
        for bucket, bucket_prices in prices.items():
            for ref_index, reference in enumerate(references):
                for method_index, method in enumerate(['worst', 'power', 'probit']):
                    odds = bucket_prices[ref_index]
                    band = ('Below -200' if odds < -200 else '-200 to -101' if odds < -100 else '+100 to +199' if odds < 200
                            else '+200 to +399' if odds < 400 else '+400 to +699' if odds < 700
                            else '+700 to +999' if odds < 1000 else '+1000 and above')
                    date = '2026-10-04' if book == 'nv' else '2026-10-11'
                    # Power's much higher EV must not displace a more profitable method.
                    hit = dict(player=f'{book} {bucket} {reference} {method} winner', date=date, game='wsh @ la', prop='attd',
                               line=.5, under=False, odds=odds, profit_units=odds / 100 if odds > 0 else 100 / -odds, book=book)
                    cells.append(cell(book=book, date=date, reference=reference, method=method,
                                      odds_band=band, share_odds_bucket=bucket,
                                      profit_units=profits[bucket][ref_index][min(method_index, 1)] - book_index * 2 - (3 if method == 'probit' else 0),
                                      ev_sum=100000 if method == 'power' else 22, best_hit=hit))
    cells.extend(cell(book=book, reference=reference, method='probit', profit_units=5 + index)
                 for book in books for index, reference in enumerate(['kal;1', 'px;1', 'poly;1', 'circa+fd;1+1', 'fd;1']))
    cells.extend([
        cell(book='fd', method='probit', prop='rush_yds', profit_units=400, odds_band='+200 to +399',
             best_hit=dict(player='Rush winner', date='2026-10-11', game='wsh @ la', prop='rush_yds',
                           line=40.5, under=False, odds=399, profit_units=3.99, book='fd')),
        cell(book='nv', prop='<img src=x onerror=window.shareInjected=1>', profit_units=130),
        cell(book='dk', reference='escaped;1', method='probit', profit_units=1000,
             best_hit=dict(player='<img src=x onerror=window.shareInjected=1>', date='2026-10-11', game='wsh @ la', prop='attd',
                           line=.5, under=False, odds=180, profit_units=1.8, book='dk')),
        cell(book='px', method='probit', selected=6, wins=3, losses=1, pushes=0, pending=1, ungraded=1, profit_units=10),
        cell(book='px', reference='circa;1', method='probit', selected=1, wins=1, losses=0,
             pushes=0, pending=0, ungraded=0, profit_units=1.5),
        cell(book='px', reference='mb;1', method='probit', selected=5, wins=0, losses=0,
             pushes=0, pending=5, ungraded=0, profit_units=0),
        cell(book='kal', method='probit', selected=20, wins=0, losses=20, pushes=0, pending=0, ungraded=0, profit_units=-20),
    ])
    return dict(version=1, best_hit_version=1, share_odds_version=1, sport='nfl', generated_at='2026-10-12T12:00:00Z',
                window=dict(start='2026-07-01', end='2026-10-11', season_start='2026-07-01'),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn']), dict(id='circa;1', name='Circa', books=['circa']),
                            dict(id='pn+circa;1+1', name='Pinnacle + Circa', books=['pn', 'circa']),
                            dict(id='nv;1', name='Novig', books=['nv']),
                            dict(id='kal;1', name='Kalshi', books=['kal']), dict(id='px;1', name='ProphetX', books=['px']),
                            dict(id='poly;1', name='Polymarket', books=['poly']), dict(id='mb;1', name='Matchbook', books=['mb']),
                            dict(id='circa+fd;1+1', name='Circa + FanDuel', books=['circa', 'fd']), dict(id='fd;1', name='FanDuel', books=['fd']),
                            dict(id='escaped;1', name='<img src=x onerror=window.shareInjected=1>', books=[])],
                methods=[dict(id='probit', name='Probit'), dict(id='worst', name='Worst-case'), dict(id='power', name='Power'),
                         dict(id='escaped', name='<svg onload=window.shareInjected=1>')],
                config=dict(min_ev=0, max_ev=None, min_liquidity=50, one_sided='site', fee_policy='Estimated fees'),
                coverage=dict(event_dates=['2026-10-04', '2026-10-11'], missing_dates=[], files=[]), notes=[], cells=cells,
                best_cells=[cell(book='best', method='probit', profit_units=250), cell(book='best', reference='circa;1', method='probit', profit_units=200)])


def reference_order(reference):
    books = sorted(set(reference.get('books', reference['id'].split(';')[0].split('+'))))
    priorities = ['circa', 'pn', 'circa+pn', 'kal', 'nv', 'px', 'poly', 'mb']
    signature = '+'.join(books)
    priority = priorities.index(signature) if signature in priorities else 8 if 'circa' in books or 'pn' in books else 9
    return priority, reference['id']


def expected_groups(data, filters):
    rows = data['cells'] + data.get('best_cells', [])
    columns = sorted(data['references'], key=reference_order)
    order = ['fd', 'dk', 'b365', 'mgm', 'cz', 'hr', 'fn', 'br', 'espn']
    books = ([filters['book']] if filters['book'] else sorted({r['book'] for r in rows
             if r['book'] != 'best' and (not filters['prop'] or r['prop'] == filters['prop'])},
             key=lambda book: (order.index(book) if book in order else len(order), book)))
    known = dict.fromkeys(['Below -200', '-200 to -101', '+100 to +199', '+200 to +399'], 'short')
    known.update(dict.fromkeys(['+400 to +699', '+700 to +999'], 'mid'))
    ambiguous = set()
    groups = defaultdict(lambda: dict(settled=0, profit=0, wins=0, losses=0, pushes=0, cells=[]))
    for row in rows:
        if row['method'] != filters['method'] or not filters['start'] <= row['date'] <= filters['end']:
            continue
        if filters['book'] and row['book'] != filters['book'] or not filters['book'] and row['book'] == 'best':
            continue
        if filters['prop'] and row['prop'] != filters['prop']:
            continue
        bucket = known.get(row['odds_band'])
        if data.get('share_odds_version') == 1:
            stated = row.get('share_odds_bucket')
            bucket = stated if (stated == bucket if bucket else row['odds_band'] == '+1000 and above' and stated in ('mid', 'long')) else None
        key = (row['book'], row['reference'])
        if filters['bucket'] != 'all':
            if bucket is None:
                affected = ('mid', 'long') if row['odds_band'] == '+1000 and above' else ('short', 'mid', 'long')
                if filters['bucket'] in affected:
                    ambiguous.add(key)
                continue
            if bucket != filters['bucket']:
                continue
        group = groups[key]
        group['settled'] += row['wins'] + row['losses'] + row['pushes']
        group['profit'] += row['profit_units']
        for metric in ('wins', 'losses', 'pushes'):
            group[metric] += row[metric]
        group['cells'].append(row)
    result = []
    for book in books:
        cells = []
        for column in columns:
            key = (book, column['id'])
            value = groups.get(key)
            reason = 'rebuild' if key in ambiguous else 'empty' if not value or not value['settled'] else 'unprofitable' if filters['profitableOnly'] and value['profit'] <= 0 else None
            if value:
                value['hit_status'], value['hits'] = winning_hits(data, value['cells'])
            cells.append(dict(reference=column['id'], value=None if reason else value, reason=reason))
        result.append(dict(book=book, cells=cells))
    return columns, result


def winning_hits(data, rows):
    winners = [row for row in rows if row['wins'] > 0]
    if not winners:
        return 'none', []
    if data.get('best_hit_version') != 1:
        return 'rebuild', []
    hits = [row.get('best_hit') for row in winners]
    if any(not hit or not (hit.get('player') or hit.get('game')) for hit in hits):
        return 'unavailable', []
    selected = max(hit['profit_units'] for hit in hits)
    return 'available', [hit for hit in hits if hit['profit_units'] == selected]


def png_dimensions(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', data[16:24])
    assert 500 <= width <= 8192 and 300 <= height <= 32768, (width, height)
    assert len(data) > 10000, 'Expected a rendered image, not an empty PNG'
    return width, height


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
state = dict(payload=fixture(), status=200, signed_in=True, requests=[])
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--disable-logging', f'--log-file={OUTPUT / "chromium.log"}'])
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
            elif urlparse(url).hostname == 'public-preview.test':
                name = urlparse(url).path.strip('/')
                path = STAGED / name if (STAGED / name).is_file() else SITE / name
                if path.is_file() and '..' not in name:
                    route.fulfill(path=str(path))
                else:
                    route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        url = 'https://public-preview.test/devig-results.html?sport=nfl'
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

        def assert_mobile(width):
            page.set_viewport_size(dict(width=width, height=844))
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
            expect(page.locator('#performers-close')).to_be_visible()
            expect(page.locator('#performers-download')).to_be_enabled()
            assert page.locator('.dv-share-scroll').evaluate('(el) => el.getBoundingClientRect().height') >= 180, 'Controls must leave room for the card'
            for selector in ('#performers-method', '#performers-range', '#performers-limit', '#performers-columns', '#performers-copy', '#performers-download', '#performers-close'):
                assert page.locator(selector).evaluate('(el) => {const box=el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;}'), (width, selector)

        def assert_rows(allow_ties=False):
            filters = page.evaluate("""() => ({start:document.querySelector('#date-start').value,
              end:document.querySelector('#date-end').value, book:document.querySelector('#book-filter').value,
              prop:document.querySelector('#market-filter').value, minimum:Number(document.querySelector('#min-settled').value),
              profitableOnly:document.querySelector('#profitable-only').checked,
              method:document.querySelector('#performers-method').value,bucket:document.querySelector('#performers-range').value})""")
            columns, groups = expected_groups(state['payload'], filters)
            requested = page.locator('#performers-limit').input_value()
            limit = (len(groups) or 1) if requested == 'all' else int(requested)
            page_index = int(re.search(r'page (\d+)', page.locator('#performers-page').inner_text(), re.I).group(1)) - 1
            devig_first = int(re.search(r'Devigs (\d+)', page.locator('#performers-devigs-page').inner_text()).group(1)) - 1
            column_count = int(page.locator('#performers-columns').input_value())
            visible_columns = columns[devig_first:devig_first + column_count]
            actual_columns = page.locator('#performers-head th[data-reference]').evaluate_all('headers => headers.map(header => header.dataset.reference)')
            assert actual_columns == [column['id'] for column in visible_columns], (actual_columns, visible_columns)
            visible_groups = groups[page_index * limit:(page_index + 1) * limit]
            headings = page.locator('#performers-rows tr[data-book]').evaluate_all('rows => rows.map(row => row.dataset.book)')
            assert headings == [group['book'] for group in visible_groups], (headings, visible_groups)
            actual = []
            for group_index, group in enumerate(visible_groups):
                book_row = page.locator('#performers-rows tr[data-book]').nth(group_index)
                expect(book_row.locator('th')).to_have_count(1)
                expect(book_row.locator('td')).to_have_count(len(visible_columns))
                for column in visible_columns:
                    cell = next(cell for cell in group['cells'] if cell['reference'] == column['id'])
                    table_cell = book_row.locator('td[data-reference="' + column['id'] + '"]')
                    expect(table_cell).to_have_count(1)
                    entries = table_cell.locator('.dv-share-leader')
                    value = cell['value']
                    expect(entries).to_have_count(1 if value else 0)
                    if value is None:
                        missing = table_cell.locator('.dv-share-missing')
                        expect(missing).to_have_text('Rebuild report' if cell['reason'] == 'rebuild' else '-')
                        detail = {'empty': 'No settled offers', 'rebuild': 'Rebuild report', 'unprofitable': 'Not profitable'}[cell['reason']]
                        assert detail in missing.get_attribute('title')
                        continue
                    expect(entries).to_have_attribute('data-method', filters['method'])
                    expect(entries).to_have_attribute('data-reference', column['id'])
                    actual.append([group['book'], column['id'], filters['method']])
                    financials = entries.locator('.dv-share-financials')
                    profit = float(financials.locator('b').inner_text().replace('u', '').replace(',', ''))
                    roi = float(financials.locator('span').inner_text().replace('% ROI', '').replace(',', ''))
                    assert abs(profit - value['profit']) < .00501, (filters, group['book'], column, profit, value)
                    assert abs(roi - 100 * value['profit'] / value['settled']) < .00501
                    assert f"{value['settled']:,} settled" in entries.inner_text()
                    record_pattern = r'[^0-9]+'.join(re.escape(f"{value[key]:,}") for key in ('wins', 'losses', 'pushes'))
                    assert re.search(record_pattern, entries.inner_text()), (record_pattern, entries.inner_text())
                    hit_text = entries.locator('.dv-share-hit').inner_text()
                    if value['hit_status'] != 'available':
                        expected = {'rebuild': 'Rebuild report', 'none': 'No settled wins', 'unavailable': 'unavailable'}[value['hit_status']]
                        assert expected in hit_text, hit_text
                        continue
                    assert any((hit.get('player') or hit['game']).casefold() in hit_text.casefold() and
                               (f"+{hit['odds']:g}" if hit['odds'] > 0 else f"{hit['odds']:g}") in hit_text for hit in value['hits']), (hit_text, value['hits'])
            assert page.locator('#performers-card img, #performers-card svg').count() == 0
            assert page.evaluate('window.shareInjected || 0') == 0
            assert 'Fewer than' not in page.locator('#performers-card').inner_text()
            expect(page.locator('#performers-books-pagination')).to_be_hidden() if len(groups) <= limit else expect(page.locator('#performers-books-pagination')).to_be_visible()
            return actual

        open_card()
        expect(page.locator('#performers-method')).to_have_value('probit')
        expect(page.locator('#performers-range')).to_have_value('all')
        expect(page.locator('#performers-limit')).to_have_value('all')
        expect(page.locator('#performers-columns')).to_have_value('8')
        assert page.locator('#performers-columns option').evaluate_all('options => options.map(option => option.value)') == ['4', '8', '12']
        assert page.locator('#performers-head th').all_inner_texts() == ['Betting book', 'Circa', 'Pinnacle', 'Circa + Pinnacle', 'Kalshi', 'Novig', 'ProphetX', 'Polymarket', 'Matchbook']
        rows = assert_rows()
        assert len(rows) == 45
        assert all(row[2] == 'probit' and row[0] != 'best' for row in rows)
        expect(page.locator('tr[data-book="fd"] td[data-reference="pn;1"] .dv-share-financials b')).to_have_text('+88.00u')
        expect(page.locator('#method-filter')).to_have_value(initial_strategy[1])
        card_text = page.locator('#performers-card').inner_text()
        assert re.search(r'flat|1\s*u|one unit', card_text, re.I)
        assert re.search(r'observed|historical', card_text, re.I)
        for method in ('power', 'worst', 'probit'):
            page.select_option('#performers-method', method)
            assert_rows()
            assert all(value == method for value in page.locator('.dv-share-leader').evaluate_all('leaders => leaders.map(leader => leader.dataset.method)'))
            expect(page.locator('#method-filter')).to_have_value(initial_strategy[1])
        for bucket in ('short', 'mid', 'long', 'all'):
            page.select_option('#performers-range', bucket)
            assert_rows()
            if bucket == 'short':
                assert '+399' in page.locator('tr[data-book="fd"] td[data-reference="circa;1"]').inner_text()
                assert '+1000' not in page.locator('#performers-rows').inner_text()
            if bucket == 'mid':
                assert '+400' in page.locator('tr[data-book="fd"] td[data-reference="pn;1"]').inner_text()
                assert '+1000' in page.locator('tr[data-book="fd"] td[data-reference="circa;1"]').inner_text()
                assert '+1001' not in page.locator('#performers-rows').inner_text()
            if bucket == 'long':
                assert '+1001' in page.locator('tr[data-book="fd"] td[data-reference="pn;1"]').inner_text()
                assert '+1000' not in page.locator('#performers-rows').inner_text()
        # Every reference stays on the axis, including those without the chosen method.
        seen_columns = []
        while True:
            assert_rows()
            seen_columns.extend(page.locator('#performers-head th[data-reference]').evaluate_all('headers => headers.map(header => header.dataset.reference)'))
            if page.locator('#performers-devigs-next').is_disabled():
                break
            page.locator('#performers-devigs-next').click()
        assert seen_columns == [column['id'] for column in sorted(state['payload']['references'], key=reference_order)]
        assert '<img src=x onerror=window.shareInjected=1>' in page.locator('#performers-card').inner_text()
        assert page.locator('#performers-head th[data-reference]').count() == 3
        with page.expect_download() as last_columns:
            page.locator('#performers-download').click()
        last_png = OUTPUT / 'fixture-last-devig-page.png'
        last_columns.value.save_as(last_png)
        png_dimensions(last_png)
        while page.locator('#performers-devigs-prev').is_enabled():
            page.locator('#performers-devigs-prev').click()
        expect(page.locator('#performers-prev')).to_be_disabled()
        page.select_option('#performers-limit', '3')
        page.locator('#performers-next').click()
        first_book_on_second_page = page.locator('#performers-rows tr[data-book]').first.get_attribute('data-book')
        page.locator('#performers-devigs-next').click()
        assert_rows()
        assert page.locator('#performers-rows tr[data-book]').first.get_attribute('data-book') == first_book_on_second_page
        expect(page.locator('#performers-prev')).to_be_enabled()
        for column_count in ('4', '12', '8'):
            page.select_option('#performers-columns', column_count)
            assert_rows()
            assert page.locator('#performers-rows tr[data-book]').first.get_attribute('data-book') == first_book_on_second_page
            expect(page.locator('#performers-devigs-prev')).to_be_disabled()
        page.locator('#performers-devigs-next').click()
        page.select_option('#performers-limit', '6')
        assert_rows()
        expect(page.locator('#performers-devigs-prev')).to_be_enabled()
        page.locator('#performers-devigs-prev').click()
        assert_rows()
        for limit in ('1', '6', '3', 'all'):
            page.select_option('#performers-limit', limit)
            assert_rows()
            if limit == 'all':
                expect(page.locator('#performers-next')).to_be_disabled()
                expect(page.locator('tr[data-book="px"] .dv-share-leader')).to_have_count(2)
                expect(page.locator('tr[data-book="kal"] .dv-share-hit')).to_contain_text('No settled wins')
        # A click on the backdrop dismisses; inside clicks and drags beginning inside do not.
        page.locator('#performers-dialog-title').click()
        expect(dialog).to_be_visible()
        inside = page.locator('#performers-dialog-title').bounding_box()
        page.mouse.move(inside['x'] + 8, inside['y'] + 8)
        page.mouse.down()
        page.mouse.move(2, 2)
        page.mouse.up()
        expect(dialog).to_be_visible()
        # An unpaired click cannot masquerade as a full pointer gesture on the backdrop.
        dialog.dispatch_event('click', dict(clientX=2, clientY=2, button=0))
        expect(dialog).to_be_visible()
        page.mouse.click(2, 2)
        expect(dialog).to_be_hidden()
        expect(page.locator('#best-performers')).to_be_focused()
        open_card()
        assert_rows()
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

        page.select_option('#method-filter', 'power')
        open_card()
        expect(page.locator('#performers-method')).to_have_value('probit')
        assert_rows()
        close_card()
        page.select_option('#method-filter', initial_strategy[1])

        # Date/book/market/profit scope applies; the main minimum and strategy do not.
        page.select_option('#date-preset', 'yesterday')
        page.select_option('#book-filter', 'fd')
        open_card()
        assert_rows()
        close_card()
        page.select_option('#book-filter', 'best')
        open_card()
        assert all(row[0] == 'best' for row in assert_rows())
        close_card()
        page.select_option('#book-filter', '')
        page.select_option('#market-filter', '')
        open_card()
        page.select_option('#performers-range', 'short')
        assert_rows()
        assert 'Rush winner' in page.locator('#performers-card').inner_text(), 'All-market best hit stays in its chosen strategy'
        close_card()
        page.select_option('#market-filter', 'attd')
        page.locator('#min-settled').fill('1')
        page.locator('#min-settled').press('Tab')
        open_card()
        page.select_option('#performers-limit', 'all')
        assert any(row[0] == 'px' for row in assert_rows())
        close_card()
        page.locator('#profitable-only').check()
        open_card()
        assert_rows()
        close_card()
        # Even one settlement remains visible with a much higher main-table minimum.
        page.locator('#min-settled').fill('1000')
        page.locator('#min-settled').press('Tab')
        open_card()
        assert_rows()
        expect(page.locator('tr[data-book="px"] td[data-reference="circa;1"] .dv-share-leader')).to_contain_text('1 settled')
        expect(page.locator('tr[data-book="px"] td[data-reference="pn;1"] .dv-share-leader')).to_contain_text('4 settled')
        expect(page.locator('tr[data-book="px"] td[data-reference="mb;1"] .dv-share-missing')).to_have_text('-')
        expect(page.locator('tr[data-book="px"] td[data-reference="mb;1"] .dv-share-missing')).to_have_attribute('title', 'No settled offers in this selection.')
        expect(page.locator('#performers-copy')).to_be_enabled()
        expect(page.locator('#performers-download')).to_be_enabled()
        close_card()

        page.locator('#reset-filters').click()
        page.locator('#date-start').fill('2026-10-12')
        page.locator('#date-start').press('Tab')
        expect(page.locator('#best-performers')).to_be_disabled()
        page.locator('#reset-filters').click()
        open_card()
        page.select_option('#performers-limit', 'all')
        page.select_option('#performers-range', 'all')

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
            assert_mobile(width)
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
                for field in ('best_hit', 'highest_odds_hit', 'lowest_odds_hit'):
                    if row.get(field):
                        row[field]['prop'] = 'atgs'
        state['payload'] = nhl
        page.evaluate("document.querySelector('#sport-filter').value='nhl'; document.querySelector('#sport-filter').dispatchEvent(new Event('change'))")
        expect(dialog).to_be_hidden()
        expect(page.locator('#performers-rows tr')).to_have_count(0)
        expect(page.locator('#page-title')).to_have_text('NHL devig results')
        open_card()
        assert_rows()
        assert 'NHL' in page.locator('#performers-subtitle').inner_text()
        close_card()
        page.select_option('#market-filter', 'atgs')
        open_card()
        assert_rows()
        assert 'ATGS' in page.locator('#performers-subtitle').inner_text()
        state['status'] = 403
        page.evaluate("document.querySelector('#refresh').click()")
        expect(dialog).to_be_hidden()
        expect(page.locator('#performers-rows tr')).to_have_count(0)
        expect(page.locator('#access-panel')).to_be_visible()

        # Legacy reports explicitly request a rebuild rather than inventing winning players.
        state.update(status=200, payload=fixture())
        del state['payload']['best_hit_version']
        page.goto(url)
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        assert_rows()
        assert 'Rebuild report for best hits' in page.locator('#performers-card').inner_text()
        close_card()

        # Old +1000-and-above cells cannot tell exact +1000 apart from longer prices.
        state['payload'] = fixture()
        del state['payload']['share_odds_version']
        page.goto(url)
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        assert_rows()
        expect(page.locator('tr[data-book="fd"] td[data-reference="pn;1"] .dv-share-leader')).to_have_count(1)
        for bucket in ('mid', 'long'):
            page.select_option('#performers-range', bucket)
            assert_rows()
            expect(page.locator('tr[data-book="fd"] td[data-reference="pn;1"] .dv-share-leader')).to_have_count(0)
            expect(page.locator('tr[data-book="fd"] td[data-reference="pn;1"]')).to_contain_text('Rebuild report')
            expect(page.locator('tr[data-book="fd"] td[data-reference="kal;1"] .dv-share-missing')).to_have_text('-')
            expect(page.locator('tr[data-book="fd"] td[data-reference="kal;1"] .dv-share-missing')).to_have_attribute('title', 'No settled offers in this selection.')
        page.select_option('#performers-range', 'short')
        assert_rows()
        expect(page.locator('tr[data-book="fd"] td[data-reference="pn;1"] .dv-share-leader')).to_have_count(1)
        expect(page.locator('#performers-download')).to_be_enabled()
        close_card()

        # Missing winning metadata changes only the best-hit label, not settled profit rankings.
        state['payload'] = fixture()
        next(row for row in state['payload']['cells'] if row['book'] == 'fd' and row['reference'] == 'pn;1' and row['method'] == 'probit')['best_hit'] = None
        page.goto(url)
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        assert_rows()
        leader = page.locator('tr[data-book="fd"] td[data-reference="pn;1"] .dv-share-leader')
        expect(leader.locator('.dv-share-hit')).to_contain_text('Best hit unavailable')
        expect(leader.locator('.dv-share-financials b')).to_have_text('+88.00u')
        close_card()

        # Probit stays the default when it has no data; another method is never silently substituted.
        state['payload'] = fixture()
        for key in ('cells', 'best_cells'):
            state['payload'][key] = [row for row in state['payload'][key] if row['method'] != 'probit']
        state['payload']['methods'] = [method for method in state['payload']['methods'] if method['id'] != 'probit']
        page.goto(url)
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        expect(page.locator('#performers-method')).to_have_value('probit')
        assert_rows()
        expect(page.locator('#performers-rows .dv-share-leader')).to_have_count(0)
        expect(page.locator('#performers-head th[data-reference]')).to_have_count(8)
        expect(page.locator('#performers-download')).to_be_disabled()
        page.select_option('#performers-method', 'worst')
        assert_rows()
        expect(page.locator('#performers-download')).to_be_enabled()
        close_card()

        # A real report screenshot is optional; no report generation or live API is performed.
        actual = REPORTS / 'nfl.json'
        if not actual.is_file():
            actual = ROOT / 'static/analysis/devig_results/nfl.json'
        if actual.is_file():
            state.update(status=200, payload=json.loads(actual.read_text(encoding='utf-8')))
            page.goto(url)
            expect(page.locator('#best-performers')).to_be_enabled(timeout=20000)
            open_card()
            expect(page.locator('#performers-limit')).to_have_value('all')
            expect(page.locator('#performers-columns')).to_have_value('8')
            expect(page.locator('#performers-books-pagination')).to_be_hidden()
            assert dialog.bounding_box()['width'] >= 1400
            assert_rows(allow_ties=True)
            page.screenshot(path=str(OUTPUT / 'actual-nfl-performers-dialog.png'))
            with page.expect_download() as download:
                page.locator('#performers-download').click()
            actual_png = OUTPUT / 'actual-nfl-best-performers.png'
            download.value.save_as(actual_png)
            print('Actual NFL PNG:', png_dimensions(actual_png))
            print('Actual NFL default book rows:', page.locator('#performers-rows tr[data-book]').count())
            for width in (390, 320):
                assert_mobile(width)
                page.screenshot(path=str(OUTPUT / f'actual-nfl-performers-mobile-{width}.png'))
            with page.expect_download() as mobile_download:
                page.locator('#performers-download').click()
            mobile_png = OUTPUT / 'actual-nfl-best-performers-mobile.png'
            mobile_download.value.save_as(mobile_png)
            assert png_dimensions(mobile_png) == png_dimensions(actual_png)
            page.set_viewport_size(dict(width=1440, height=1100))
            page.select_option('#performers-columns', '12')
            assert_rows(allow_ties=True)
            expect(page.locator('#performers-next')).to_be_disabled()
            with page.expect_download() as all_download:
                page.locator('#performers-download').click()
            all_png = OUTPUT / 'actual-nfl-all-books-12-devigs.png'
            all_download.value.save_as(all_png)
            assert png_dimensions(all_png)[0] > png_dimensions(actual_png)[0]
            print('Actual NFL 12-devig PNG:', png_dimensions(all_png))
            page.select_option('#performers-columns', '8')
        actual_nhl = REPORTS / 'nhl.json'
        if actual_nhl.is_file():
            state.update(status=200, payload=json.loads(actual_nhl.read_text(encoding='utf-8')))
            # Keep exact ATGS cells; a full 62MB raw report crosses Playwright's
            # JSON protocol much more slowly than production's gzip response.
            for key in ('cells', 'best_cells'):
                state['payload'][key] = [row for row in state['payload'][key] if row['prop'] == 'atgs']
            page.set_viewport_size(dict(width=1440, height=1100))
            page.goto(url.replace('sport=nfl', 'sport=nhl'))
            expect(page.locator('#best-performers')).to_be_enabled(timeout=20000)
            page.select_option('#market-filter', 'atgs')
            open_card()
            expect(page.locator('#performers-limit')).to_have_value('all')
            expect(page.locator('#performers-columns')).to_have_value('8')
            expect(page.locator('#performers-books-pagination')).to_be_hidden()
            assert_rows(allow_ties=True)
            page.screenshot(path=str(OUTPUT / 'actual-nhl-performers-dialog.png'))
            with page.expect_download() as download:
                page.locator('#performers-download').click()
            nhl_png = OUTPUT / 'actual-nhl-best-performers.png'
            download.value.save_as(nhl_png)
            print('Actual NHL PNG:', png_dimensions(nhl_png))
            assert_mobile(320)
            page.screenshot(path=str(OUTPUT / 'actual-nhl-performers-mobile-320.png'))
            page.set_viewport_size(dict(width=1440, height=1100))
        # Team markets keep their game identity and the actual handicap semantics.
        main_lines = fixture()
        main_lines.update(sport='nhl', best_cells=[], cells=[])
        for prop, reference, line, profit in [('ml', 'pn;1', 0, 10), ('spread', 'circa;1', -1.5, 11),
                                              ('1p_spread', 'pn+circa;1+1', 1.5, 12)]:
            main_lines['cells'].append(cell(book='fd', prop=prop, reference=reference, method='probit', profit_units=profit,
                 best_hit=dict(player='', date='2026-10-11', game='nyr @ det', prop=prop,
                               line=line, under=False, odds=150, profit_units=1.5, book='fd')))
        state.update(status=200, payload=main_lines)
        page.goto(url.replace('sport=nfl', 'sport=nhl'))
        expect(page.locator('#best-performers')).to_be_enabled()
        open_card()
        assert_rows()
        hit_texts = page.locator('#performers-rows .dv-share-leader[data-reference]').evaluate_all('''cells => Object.fromEntries(
          cells.map(cell => [cell.dataset.reference, cell.textContent + ' ' + cell.querySelector('.dv-share-hit').title]))''')
        assert all('nyr @ det +150' in text for text in hit_texts.values())
        assert 'o0' not in hit_texts['pn;1'] and 'u0' not in hit_texts['pn;1']
        assert '-1.5' in hit_texts['circa;1'] and 'o-1.5' not in hit_texts['circa;1']
        assert '+1.5' in hit_texts['pn+circa;1+1'] and 'o1.5' not in hit_texts['pn+circa;1+1']
        assert not errors, errors
        browser.close()
        print('PASS: All books/8 devigs by default; independent two-axis pagination and 4/8/12 column counts; one-settlement visibility regardless of main minimum; compact empty cells; Probit method, records, hits and exact odds scopes; guarded backdrop dismissal, focus/Escape; safe text; real default/12-column PNGs; mocked clipboard fallback; auth/export clearing; legacy metadata; 320/390px layouts.')
finally:
    server.shutdown()
    if ARTIFACTS is not None:
        ARTIFACTS.cleanup()
