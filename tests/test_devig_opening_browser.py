"""Offline browser regression checks for archived versus opening-snapshot prices.

Uses the actual page and canvas exporter with synthetic reports. All nonlocal
network requests are intercepted. Set DEVIG_OPENING_ARTIFACTS to keep screenshots.
"""
import csv
from contextlib import nullcontext
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
import os
from pathlib import Path
import re
import struct
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def cell(**changes):
    return dict(dict(date='2026-10-13', book='fd', prop='atgs', reference='pn;1', method='worst',
                     odds_band='+100 to +199', share_odds_bucket='short', selected=13, wins=4, losses=5,
                     pushes=1, pending=2, ungraded=1, profit_units=5, ev_sum=130,
                     kelly_stake_units=2, kelly_profit_units=-1), **changes)


def source_report(source):
    rows = [cell(profit_units=9, kelly_stake_units=3, kelly_profit_units=6)] if source == 'opening' else [
        cell(), cell(book='dk', profit_units=-2, kelly_stake_units=8, kelly_profit_units=6),
        cell(prop='sog', profit_units=1, kelly_stake_units=1, kelly_profit_units=1)]
    rows += [dict(row, method='probit') for row in rows.copy()]
    return dict(version=1, price_source=source, kelly_version=1, share_odds_version=1, sport='nhl',
                generated_at='2026-10-14T10:00:00Z', window=dict(start='2026-10-07', end='2026-10-13', days=7),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn'])],
                methods=[dict(id='worst', name='Worst-case'), dict(id='probit', name='Probit')],
                config=dict(min_ev=0, max_ev=None, min_liquidity=50, one_sided='site'),
                coverage=dict(event_dates=['2026-10-13'] if source == 'opening' else ['2026-10-12', '2026-10-13'],
                              missing_dates=[], files=[], raw_rows=17 if source == 'opening' else 123),
                notes=[], cells=rows, best_cells=[])


def compact(data):
    dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket']
    metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
               'kelly_stake_units', 'kelly_profit_units']
    dictionaries = {key: sorted({row[key] for row in data['cells']}) for key in dimensions}
    return dict(data, version=2, cell_encoding='indexed-v1', cell_dictionaries=dictionaries,
                cell_fields=dimensions + metrics + ['best_hit', 'highest_odds_hit', 'lowest_odds_hit'], hit_table=[],
                cells=[[dictionaries[key].index(row[key]) for key in dimensions] + [row[key] for key in metrics]
                       for row in data['cells']])


def fixture(empty_opening=False, legacy=False):
    data = source_report('archive')
    if legacy:
        del data['price_source']
    else:
        opening = source_report('opening')
        if empty_opening:
            opening['cells'] = []
            opening['coverage']['event_dates'] = []
            opening['coverage']['raw_rows'] = 0
        data['opening_report'] = compact(opening)
    return compact(data)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    state = {'payload': fixture(), 'requests': []}
    kept = os.environ.get('DEVIG_OPENING_ARTIFACTS')
    if kept:
        Path(kept).mkdir(parents=True, exist_ok=True)
    with (nullcontext(str(Path(kept).resolve())) if kept else TemporaryDirectory(prefix='devig-opening-browser-')) as output:
        previous = os.getcwd()
        os.chdir(output)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    args=['--disable-logging', f'--log-file={Path(output) / "chromium.log"}'])
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script('''
                  window.EventSource = undefined;
                  const RealDate = Date;
                  window.Date = class extends RealDate {
                    constructor(...args) { super(...(args.length ? args : ['2026-10-14T12:00:00Z'])); }
                    static now() { return RealDate.parse('2026-10-14T12:00:00Z'); }
                  };
                  window.__canvasText = [];
                  const nativeFill = CanvasRenderingContext2D.prototype.fillText;
                  CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                    window.__canvasText.push(String(text)); return nativeFill.call(this, text, ...args);
                  };
                ''')

                def intercept(route):
                    if urlparse(route.request.url).path == '/api/devig-results':
                        state['requests'].append(route.request.url)
                        route.fulfill(json=state['payload'])
                    elif route.request.url.startswith(origin + '/'):
                        route.continue_()
                    else:
                        route.fulfill(status=200, content_type='application/javascript', body='')

                context.route('**/*', intercept)
                page.goto(f'{origin}/devig-results.html', wait_until='networkidle')
                expect(page.locator('#report-content')).to_be_visible()
                page.select_option('#market-filter', 'atgs')
                expect(page.locator('#price-source')).to_have_value('archive')
                expect(page.locator('#summary-roi')).to_have_text('+15.00%')
                expect(page.locator('#coverage-badge')).to_have_text('2 / 7 days')
                expect(page.locator('#coverage-totals')).to_contain_text('123 raw rows')
                requests_before = len(state['requests'])
                page.select_option('#price-source', 'opening')
                expect(page.locator('#summary-profit')).to_have_text('+9.00u')
                expect(page.locator('#summary-roi')).to_have_text('+90.00%')
                expect(page.locator('#summary-settled')).to_have_text('10')
                expect(page.locator('#coverage-badge')).to_have_text('1 / 7 days')
                expect(page.locator('#coverage-totals')).to_contain_text('17 raw rows')
                note = page.locator('#price-source-note').inner_text()
                assert re.search(r'open', note, re.I), note
                assert re.search(r'(?:four|4)\s+(?:sports)?books', note, re.I), note
                assert re.search(r'snapshot|recorded|saved|captured', note, re.I), note
                assert re.search(r'first|literal|true|original', note, re.I), note
                assert len(state['requests']) == requests_before
                assert page.evaluate("localStorage.getItem('devig_results_price_source')") == 'opening'
                print('PASS opening source switches independent compact results and coverage without refetching')

                page.reload(wait_until='networkidle')
                expect(page.locator('#price-source')).to_have_value('opening')
                expect(page.locator('#summary-roi')).to_have_text('+90.00%')
                page.locator('#staking-kelly').click()
                expect(page.locator('#summary-profit')).to_have_text('+6.00u')
                expect(page.locator('#summary-roi')).to_have_text('+200.00%')
                with page.expect_download() as download:
                    page.locator('#export').click()
                assert 'opening' in download.value.suggested_filename
                target = Path(output) / 'opening.csv'
                download.value.save_as(target)
                rows = list(csv.DictReader(StringIO(target.read_text(encoding='utf-8-sig'))))
                assert all(row['price_source'] == 'opening' and row['staking'] == 'quarter-kelly' for row in rows)
                total = next(row for row in rows if row['section'] == 'summary')
                assert float(total['net_units']) == 6 and float(total['settled_stake_units']) == 3
                assert float(total['roi_percent']) == 200
                print('PASS source preference, quarter-Kelly calculation, and CSV labels agree')

                page.locator('#best-performers').click()
                expect(page.locator('#performers-description')).to_contain_text(re.compile('opening', re.I))
                expect(page.locator('#performers-footnotes')).to_contain_text(re.compile('opening', re.I))
                expect(page.locator('#performers-rows tr[data-book="fd"] .dv-share-financials b')).to_have_text('+6.00u')
                expect(page.locator('#performers-rows tr[data-book="fd"] .dv-share-financials span')).to_have_text('+200.00% ROI')
                assert page.locator('#performers-rows tr[data-book="dk"]').count() == 0
                with page.expect_download() as download:
                    page.locator('#performers-download').click()
                assert 'opening' in download.value.suggested_filename
                target = Path(output) / 'opening-share.png'
                download.value.save_as(target)
                data = target.read_bytes()
                assert data[:8] == b'\x89PNG\r\n\x1a\n'
                assert struct.unpack('>II', data[16:24])[0] > 600
                text = ' '.join(page.evaluate('window.__canvasText'))
                assert re.search('opening', text, re.I) and '+200.00%' in text
                page.locator('#performers-close').click()
                print('PASS share matrix and real PNG use opening values and source labels')

                page.select_option('#price-source', 'archive')
                page.select_option('#book-filter', 'dk')
                page.select_option('#market-filter', 'atgs')
                page.select_option('#method-filter', 'probit')
                page.select_option('#date-preset', 'custom')
                page.locator('#date-start').fill('2026-10-12')
                page.locator('#date-start').dispatch_event('change')
                page.locator('#date-end').fill('2026-10-13')
                page.locator('#date-end').dispatch_event('change')
                expected_filters = {key: page.locator('#' + key).input_value() for key in
                                    ['book-filter', 'market-filter', 'reference-filter', 'method-filter', 'date-start', 'date-end']}
                page.select_option('#price-source', 'opening')
                for key, value in expected_filters.items():
                    expect(page.locator('#' + key)).to_have_value(value)
                expect(page.locator('#empty-state')).to_be_visible()
                expect(page.locator('#summary-settled')).to_have_text('0')
                expect(page.locator('#summary-roi')).to_have_text('-')
                page.select_option('#price-source', 'archive')
                expect(page.locator('#summary-roi')).to_have_text('+75.00%')
                page.select_option('#book-filter', 'fd')
                page.select_option('#market-filter', 'sog')
                page.select_option('#price-source', 'opening')
                expect(page.locator('#market-filter')).to_have_value('sog')
                expect(page.locator('#empty-state')).to_be_visible()
                expect(page.locator('#summary-settled')).to_have_text('0')
                print('PASS source changes preserve dates, strategy, and absent book/market filters without widening the sample')

                page.select_option('#book-filter', '')
                page.select_option('#market-filter', 'atgs')
                for width in (390, 1440):
                    page.set_viewport_size({'width': width, 'height': 1000})
                    box = page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})')
                    assert box['scroll'] <= box['width'] + 1, box
                    assert page.locator('#price-source').evaluate('(node) => {const b=node.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth;}')
                    if kept:
                        page.evaluate('window.scrollTo(0, 0)')
                        page.screenshot(path=str(Path(output) / f'opening-{width}.png'))
                print('PASS source selector fits 390px and 1440px layouts')

                state['payload'] = fixture(empty_opening=True)
                page.reload(wait_until='networkidle')
                expect(page.locator('#price-source')).to_have_value('opening')
                assert not page.locator('#price-source option[value="opening"]').evaluate('(option) => option.disabled')
                expect(page.locator('#empty-state')).to_be_visible()
                expect(page.locator('#summary-settled')).to_have_text('0')
                expect(page.locator('#summary-roi')).to_have_text('-')
                expect(page.locator('#coverage-badge')).to_have_text('0 / 7 days')
                print('PASS an available but empty opening report remains selected without archived fallback')

                state['payload'] = fixture(legacy=True)
                page.reload(wait_until='networkidle')
                expect(page.locator('#price-source')).to_have_value('archive')
                assert page.locator('#price-source option[value="opening"]').evaluate('(option) => option.disabled')
                expect(page.locator('#price-source-note')).to_contain_text(re.compile('rebuil[dt]|unavailable|not available|not include|older', re.I))
                page.select_option('#market-filter', 'atgs')
                page.locator('#staking-flat').click()
                expect(page.locator('#summary-roi')).to_have_text('+15.00%')
                with page.expect_download() as download:
                    page.locator('#export').click()
                assert 'opening' not in download.value.suggested_filename
                target = Path(output) / 'legacy.csv'
                download.value.save_as(target)
                legacy_rows = list(csv.DictReader(StringIO(target.read_text(encoding='utf-8-sig'))))
                assert all(row['price_source'] == 'archive' for row in legacy_rows)
                print('PASS legacy reports disable opening and export honest archive labels')

                assert not errors, errors
                context.close()
                browser.close()
                print('PASS no browser JavaScript errors or live API calls')
                if kept:
                    print(f'Visual review screenshots: {output}')
        finally:
            server.shutdown()
            server.server_close()
            os.chdir(previous)


if __name__ == '__main__':
    main()
