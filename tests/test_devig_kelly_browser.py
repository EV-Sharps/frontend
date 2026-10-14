"""Offline integration checks for the Devig Results staking toggle.

Real HTML, CSS, JS, CSV downloads, and canvas exports; synthetic report data only.
Run with Python + Playwright. Every nonlocal network request is intercepted.
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
    return dict(dict(date='2026-10-12', book='fd', prop='atgs', reference='pn;1', method='worst',
                     odds_band='+100 to +199', share_odds_bucket='short', selected=13, wins=4, losses=5,
                     pushes=1, pending=2, ungraded=1, profit_units=5, ev_sum=130,
                     kelly_stake_units=2, kelly_profit_units=-1), **changes)


def fixture(legacy=False):
    rows = [cell(), cell(date='2026-10-13', book='dk', profit_units=-2, kelly_stake_units=8, kelly_profit_units=6),
            cell(method='probit'), cell(method='probit', book='dk', profit_units=-2,
                                       kelly_stake_units=8, kelly_profit_units=6)]
    data = dict(version=1, kelly_version=1, share_odds_version=1, sport='nhl',
                generated_at='2026-10-14T10:00:00Z',
                window=dict(start='2026-10-07', end='2026-10-13', days=7),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn'])],
                methods=[dict(id='worst', name='Worst-case'), dict(id='probit', name='Probit')],
                config=dict(min_ev=0, max_ev=None, min_liquidity=50, one_sided='site'),
                coverage=dict(event_dates=['2026-10-12', '2026-10-13'], missing_dates=[], files=[]),
                notes=[], cells=rows)
    if legacy:
        del data['kelly_version']
        for row in rows:
            del row['kelly_stake_units']
            del row['kelly_profit_units']
    return data


def compact_fixture():
    data = fixture()
    dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket']
    metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
               'kelly_stake_units', 'kelly_profit_units']
    dictionaries = {key: sorted({row[key] for row in data['cells']}) for key in dimensions}
    data['cells'] = [[dictionaries[key].index(row[key]) for key in dimensions] + [row[key] for key in metrics]
                     for row in data['cells']]
    data.update(version=2, cell_encoding='indexed-v1',
                cell_fields=dimensions + metrics + ['best_hit', 'highest_odds_hit', 'lowest_odds_hit'],
                cell_dictionaries=dictionaries, hit_table=[])
    return data


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    state = {'payload': compact_fixture(), 'requests': []}
    kept_output = os.environ.get('DEVIG_KELLY_ARTIFACTS')
    if kept_output:
        Path(kept_output).mkdir(parents=True, exist_ok=True)
    with (nullcontext(str(Path(kept_output).resolve())) if kept_output else TemporaryDirectory(prefix='devig-kelly-browser-')) as directory:
        previous_directory = os.getcwd()
        os.chdir(directory)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    args=['--disable-logging', f'--log-file={Path(directory) / "chromium.log"}'])
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
                  const originalFillText = CanvasRenderingContext2D.prototype.fillText;
                  CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
                    window.__canvasText.push(String(text));
                    return originalFillText.call(this, text, ...args);
                  };
                ''')

                def intercept(route):
                    url = route.request.url
                    if urlparse(url).path == '/api/devig-results':
                        state['requests'].append(url)
                        route.fulfill(json=state['payload'])
                    elif url.startswith(origin + '/'):
                        route.continue_()
                    else:
                        route.fulfill(status=200, content_type='application/javascript', body='')

                context.route('**/*', intercept)
                url = f'{origin}/devig-results.html'
                page.goto(url, wait_until='networkidle')
                expect(page.locator('#report-content')).to_be_visible()
                expect(page.locator('#staking-flat')).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#staking-kelly')).to_be_enabled()
                expect(page.locator('#summary-roi')).to_have_text('+15.00%')
                expect(page.locator('#summary-profit')).to_have_text('+3.00u')
                expect(page.locator('#summary-settled')).to_have_text('20')
                initial_requests = len(state['requests'])
                page.locator('#staking-kelly').click()
                expect(page.locator('#staking-kelly')).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#staking-flat')).to_have_attribute('aria-pressed', 'false')
                expect(page.locator('#summary-roi')).to_have_text('+50.00%')
                expect(page.locator('#summary-profit')).to_have_text('+5.00u')
                expect(page.locator('#summary-settled')).to_have_text('20')
                expect(page.locator('#summary-unresolved')).to_have_text('4 / 2')
                note = page.locator('#staking-note').inner_text()
                assert re.search(r'100\s*(?:u|units)', note, re.I), note
                assert re.search(r'(?:no|without|non[- ]?)\s*compound', note, re.I), note
                assert len(state['requests']) == initial_requests, 'Changing staking must not fetch a different result sample'
                assert page.evaluate("localStorage.getItem('devig_results_staking')") == 'quarter-kelly'
                print('PASS compact Kelly report toggles profit and risk-based ROI without changing counts or refetching')

                page.reload(wait_until='networkidle')
                expect(page.locator('#staking-kelly')).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#summary-roi')).to_have_text('+50.00%')
                with page.expect_download() as download:
                    page.locator('#export').click()
                csv_path = Path(directory) / 'kelly.csv'
                download.value.save_as(csv_path)
                rows = list(csv.DictReader(StringIO(csv_path.read_text(encoding='utf-8-sig'))))
                assert all(row['staking'] == 'quarter-kelly' for row in rows)
                total = next(row for row in rows if row['section'] == 'summary')
                assert float(total['settled_stake_units']) == 10
                assert float(total['net_units']) == 5
                assert float(total['roi_percent']) == 50
                print('PASS saved staking preference and CSV retain the correct risk, net profit, and ROI')

                page.locator('#best-performers').click()
                expect(page.locator('#performers-dialog')).to_be_visible()
                fd = page.locator('#performers-rows tr[data-book="fd"] td[data-reference="pn;1"]')
                dk = page.locator('#performers-rows tr[data-book="dk"] td[data-reference="pn;1"]')
                expect(fd.locator('.dv-share-financials b')).to_have_text('-1.00u')
                expect(fd.locator('.dv-share-financials span')).to_have_text('-50.00% ROI')
                expect(dk.locator('.dv-share-financials b')).to_have_text('+6.00u')
                expect(dk.locator('.dv-share-financials span')).to_have_text('+75.00% ROI')
                footnotes = page.locator('#performers-footnotes').inner_text()
                assert re.search(r'kelly', footnotes, re.I), footnotes
                assert re.search(r'100\s*(?:u|units)', footnotes, re.I), footnotes
                with page.expect_download() as image_download:
                    page.locator('#performers-download').click()
                png = Path(directory) / 'kelly-share.png'
                image_download.value.save_as(png)
                contents = png.read_bytes()
                assert contents[:8] == b'\x89PNG\r\n\x1a\n'
                width, height = struct.unpack('>II', contents[16:24])
                assert width > 600 and height > 200
                painted = ' '.join(page.evaluate('window.__canvasText'))
                assert re.search(r'kelly', painted, re.I), painted
                assert re.search(r'100\s*(?:u|units)', painted, re.I), painted
                assert re.search(r'(?:no|without|non[- ]?)\s*compound', painted, re.I), painted
                assert '-50.00%' in painted and '+75.00%' in painted
                page.locator('#performers-close').click()
                print('PASS share matrix and real PNG include Kelly ROI and the fixed-bankroll staking explanation')

                for width in (390, 1440):
                    page.set_viewport_size({'width': width, 'height': 1000})
                    size = page.evaluate('({scroll: document.documentElement.scrollWidth, width: innerWidth})')
                    assert size['scroll'] <= size['width'] + 1, size
                    for selector in ('#staking-flat', '#staking-kelly'):
                        assert page.locator(selector).evaluate('(node) => { const b=node.getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth; }')
                    page.locator('#staking-flat').click()
                    expect(page.locator('#summary-roi')).to_have_text('+15.00%')
                    page.locator('#staking-kelly').click()
                    expect(page.locator('#summary-roi')).to_have_text('+50.00%')
                    if kept_output:
                        page.evaluate('window.scrollTo(0, 0)')
                        page.screenshot(path=str(Path(directory) / f'kelly-{width}.png'))
                print('PASS staking controls work at 390px and 1440px without page overflow')

                state['payload'] = fixture(legacy=True)
                page.reload(wait_until='networkidle')
                expect(page.locator('#report-content')).to_be_visible()
                expect(page.locator('#staking-kelly')).to_be_disabled()
                expect(page.locator('#staking-flat')).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#summary-roi')).to_have_text('+15.00%')
                note = page.locator('#staking-note').inner_text()
                assert re.search(r'rebuild|unavailable|not available|not include|older|updated', note, re.I), note
                with page.expect_download() as legacy_download:
                    page.locator('#export').click()
                legacy_path = Path(directory) / 'legacy.csv'
                legacy_download.value.save_as(legacy_path)
                legacy_rows = list(csv.DictReader(StringIO(legacy_path.read_text(encoding='utf-8-sig'))))
                assert all(row['staking'] == 'flat' for row in legacy_rows)
                legacy_total = next(row for row in legacy_rows if row['section'] == 'summary')
                assert float(legacy_total['settled_stake_units']) == 20
                assert float(legacy_total['roi_percent']) == 15
                page.locator('#best-performers').click()
                expect(page.locator('#performers-footnotes')).to_contain_text(re.compile(r'1\s*u|one unit|flat', re.I))
                print('PASS older reports fall back to labeled flat staking without fake Kelly zeros or incorrect CSV labels')

                assert not errors, errors
                context.close()
                browser.close()
                print('PASS no browser JavaScript errors; all data and exports remained local fixtures')
                if kept_output:
                    print(f'Visual review screenshots: {directory}')
        finally:
            server.shutdown()
            server.server_close()
            os.chdir(previous_directory)


if __name__ == '__main__':
    main()
