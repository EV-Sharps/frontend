"""Offline NBA Devig Results controls, source/staking persistence and share export."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
ROOT = next((parent for parent in STAGED.parents if (parent / 'devig_results.py').is_file()), STAGED.parent / 'odds')
SITE = ROOT.parent / 'frontend'
OUTPUT = ROOT / 'out_devig_nba_web'
OUTPUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--report', type=Path, help='Optional local compact NBA report for an additional smoke check')
args = parser.parse_args()


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = unquote(urlparse(path).path).lstrip('/')
        for directory in (STAGED, SITE):
            target = (directory / name).resolve()
            if target.is_relative_to(directory.resolve()) and target.is_file():
                return str(target)
        return str(SITE / '_missing')

    def log_message(self, *args):
        pass


def source_report(sport, source):
    props = {'nba': ['pts', 'reb', '3ptm', 'pts+reb+ast', 'dd', 'spread', 'home_total', '1h_total', '1q_ml'],
             'nfl': ['attd', 'pass_yd', '1h_total'], 'nhl': ['atgs', 'sog', 'spread']}[sport]
    if source == 'opening' and sport == 'nba':
        props = ['pts', '1h_total', '1q_ml']
    cells = []
    for prop in props:
        for method in ('worst', 'probit'):
            profit = 3 if source == 'opening' else 5
            hit = dict(player='' if prop in ('spread', 'home_total', '1h_total', '1q_ml') else 'example player',
                       date='2026-10-21', game='ny @ bos', prop=prop,
                       line=.5 if prop == '1q_ml' else 110.5 if 'total' in prop else 23.5,
                       under=False, book='fd', odds=150, profit_units=1.5)
            cells.append(dict(date='2026-10-21', book='fd', prop=prop, reference='pn;1', method=method,
                              odds_band='+100 to +199', share_odds_bucket='short',
                              selected=15, wins=6, losses=4, pushes=2, pending=1, ungraded=2,
                              profit_units=profit, ev_sum=40, kelly_stake_units=2,
                              kelly_profit_units=profit / 2, best_hit=hit))
    return dict(version=1, sport=sport, generated_at='2026-10-22T12:00:00Z', price_source=source,
                kelly_version=1, share_odds_version=1, best_hit_version=1,
                window=dict(start='2026-10-15', end='2026-10-21', days=7),
                references=[dict(id='pn;1', name='Pinnacle', books=['pn'])],
                methods=[dict(id='worst', name='Worst-case'), dict(id='probit', name='Probit')],
                config=dict(min_ev=0, max_ev=None, min_liquidity=50, one_sided='site'),
                coverage=dict(event_dates=['2026-10-21'], files=[dict(date='2026-10-21', feed=sport, rows=len(cells))]),
                cells=cells, best_cells=[], notes=[])


def compact(report):
    dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket']
    metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
               'kelly_stake_units', 'kelly_profit_units']
    dictionaries = {key: list(dict.fromkeys(cell[key] for cell in report['cells'])) for key in dimensions}
    return dict(report, version=2, cell_encoding='indexed-v1',
                cell_fields=dimensions + metrics + ['best_hit', 'highest_odds_hit', 'lowest_odds_hit'],
                cell_dictionaries=dictionaries, hit_table=[cell['best_hit'] for cell in report['cells']],
                cells=[[dictionaries[key].index(cell[key]) for key in dimensions] +
                       [cell[key] for key in metrics] + [index] for index, cell in enumerate(report['cells'])])


def fixture(sport):
    result = compact(source_report(sport, 'archive'))
    result['opening_report'] = compact(source_report(sport, 'opening'))
    return result


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(SITE)))
Thread(target=server.serve_forever, daemon=True).start()
state = dict(requests=[], wrong_sport=False, payload=None)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1440, height=1050))
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('''window.EventSource = undefined;
          const RealDate = Date;
          window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : ['2026-10-22T12:00:00Z'])); }
            static now() { return RealDate.parse('2026-10-22T12:00:00Z'); }
          };''')

        def intercept(route):
            url = route.request.url
            if '/api/devig-results' in url:
                query = parse_qs(urlparse(url).query)
                sport = query.get('sport', ['nhl'])[0]
                state['requests'].append(dict(sport=sport, auth=route.request.headers.get('authorization')))
                route.fulfill(json=state['payload'] or fixture('nhl' if state['wrong_sport'] else sport))
            elif 'cdn.jsdelivr.net' in url:
                route.fulfill(content_type='application/javascript', body='''
                  window.supabase = {createClient: () => ({auth: {
                    getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                    onAuthStateChange: fn => {window.authChanged = fn; return {};}
                  }})};''')
            elif url.startswith(f'http://127.0.0.1:{server.server_port}/'):
                route.continue_()
            elif urlparse(url).hostname == 'public-preview.test':
                name = unquote(urlparse(url).path).lstrip('/')
                for directory in (STAGED, SITE):
                    target = (directory / name).resolve()
                    if target.is_relative_to(directory.resolve()) and target.is_file():
                        route.fulfill(path=str(target))
                        return
                route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        url = 'http://public-preview.test/devig-results.html?sport=nba&preview=1'
        page.goto(url)
        expect(page.locator('#page-title')).to_have_text('NBA devig results')
        expect(page.locator('#sport-filter')).to_have_value('nba')
        expect(page.locator('#date-preset')).to_have_value('l7')
        expect(page.locator('#summary-profit')).to_have_text('+45.00u')
        expect(page.locator('#summary-settled')).to_have_text('108')
        expect(page.locator('#nba-markets-note')).to_be_visible()
        expect(page.locator('#nfl-markets-note')).to_be_hidden()
        expect(page.locator('#goal-lines-note')).to_be_hidden()
        assert state['requests'][-1] == dict(sport='nba', auth='Bearer fixture-token')
        assert page.title() == 'NBA devig results | +EV Sharps'
        expected = {'pts': 'Points', 'reb': 'Rebounds', '3ptm': 'Made threes', 'dd': 'Double-double',
                    'pts+reb+ast': 'Points + rebounds + assists', 'spread': 'Point spread',
                    'home_total': 'Home team total', '1h_total': '1st half · Game total',
                    '1q_ml': '1st quarter · Moneyline'}
        for prop, label in expected.items():
            expect(page.locator(f'#market-filter option[value="{prop}"]')).to_have_text(label)
            expect(page.locator(f'#book-rows .dv-prop-group[data-prop="{prop}"]')).to_contain_text(label)
        assert page.locator('#market-filter option[value="fb"]').count() == 0
        assert 'Puck line' not in page.locator('#report-content').inner_text()
        page.screenshot(path=str(OUTPUT / 'nba-devig-desktop.png'))

        # Refresh retains the exact selected market, book and minimum sample.
        page.select_option('#market-filter', 'reb')
        page.select_option('#book-filter', 'fd')
        page.locator('#min-settled').fill('3')
        page.locator('#min-settled').press('Tab')
        page.locator('#refresh').click()
        expect(page.locator('#summary-profit')).to_have_text('+5.00u')
        expect(page.locator('#market-filter')).to_have_value('reb')
        expect(page.locator('#book-filter')).to_have_value('fd')
        expect(page.locator('#min-settled')).to_have_value('3')

        # A saved opening source must not silently substitute archived-only props.
        page.select_option('#price-source', 'opening')
        expect(page.locator('#market-filter')).to_have_value('reb')
        expect(page.locator('#market-filter option[value="reb"]')).to_have_text('Rebounds (no offers)')
        expect(page.locator('#summary-settled')).to_have_text('0')
        expect(page.locator('#summary-roi')).to_have_text('-')
        page.select_option('#market-filter', '1q_ml')
        page.locator('#staking-kelly').click()
        expect(page.locator('#summary-profit')).to_have_text('+1.50u')
        expect(page.locator('#summary-roi')).to_have_text('+75.00%')
        page.reload()
        expect(page.locator('#price-source')).to_have_value('opening')
        expect(page.locator('#staking-kelly')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('#summary-profit')).to_have_text('+4.50u')
        page.select_option('#market-filter', '1q_ml')

        # The unchanged share renderer receives NBA labels and correct period-ML detail.
        page.evaluate('''() => {const originalDraw = DevigResultsShare.drawCard;
          DevigResultsShare.drawCard = model => {window.lastShareModel = structuredClone(model); return originalDraw(model);};}''')
        page.locator('#best-performers').click()
        expect(page.locator('#performers-subtitle')).to_contain_text('NBA · 1st quarter · Moneyline')
        hit = page.locator('#performers-rows .dv-share-hit')
        expect(hit).to_have_attribute('title', '1st quarter · Moneyline · Oct 21')
        with page.expect_download() as download_info:
            page.locator('#performers-download').click()
        download = download_info.value
        assert download.suggested_filename == 'nba-devigs-probit-all-2026-10-15-2026-10-21-opening-quarter-kelly-books-1-devigs-1.png'
        image_path = OUTPUT / 'nba-devig-share.png'
        download.save_as(image_path)
        assert image_path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
        model = page.evaluate('window.lastShareModel')
        assert model['sport'] == 'nba' and model['priceSource'] == 'opening' and model['staking'] == 'quarter-kelly'
        assert model['rows'][0]['cells'][0]['entry']['profit_units'] == 1.5
        assert 'o0.5' not in model['rows'][0]['cells'][0]['entry']['hitDetail']
        page.locator('#performers-close').click()

        for width in (390, 320):
            page.set_viewport_size(dict(width=width, height=844))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Page overflow at {width}px'
            if width == 390:
                page.screenshot(path=str(OUTPUT / 'nba-devig-mobile.png'))
        page.set_viewport_size(dict(width=1440, height=1050))

        # Sport switches and back/forward-style routing keep source/staking preferences.
        page.select_option('#sport-filter', 'nfl')
        expect(page.locator('#page-title')).to_have_text('NFL devig results')
        expect(page.locator('#market-filter option[value="attd"]')).to_have_text('ATTD (Anytime touchdown)')
        expect(page.locator('#nfl-markets-note')).to_be_visible()
        expect(page.locator('#nba-markets-note')).to_be_hidden()
        expect(page.locator('#price-source')).to_have_value('opening')
        expect(page.locator('#staking-kelly')).to_have_attribute('aria-pressed', 'true')
        assert parse_qs(urlparse(page.url).query)['sport'] == ['nfl']
        page.select_option('#sport-filter', 'nhl')
        expect(page.locator('#market-filter option[value="spread"]')).to_have_text('Puck line')
        expect(page.locator('#goal-lines-note')).to_be_visible()
        expect(page.locator('#nfl-markets-note')).to_be_hidden()
        page.evaluate("history.pushState(null, '', '?sport=nba&preview=1'); dispatchEvent(new PopStateEvent('popstate'));")
        expect(page.locator('#page-title')).to_have_text('NBA devig results')
        expect(page.locator('#summary-profit')).to_have_text('+4.50u')
        assert state['requests'][-1]['sport'] == 'nba'

        # A mismatched API response never replaces NBA results with another sport.
        state['wrong_sport'] = True
        page.locator('#refresh').click()
        expect(page.locator('#request-status')).to_contain_text('Showing the previously loaded report.')
        expect(page.locator('#request-status')).to_contain_text('different sport')
        expect(page.locator('#summary-profit')).to_have_text('+4.50u')
        if args.report:
            actual = json.loads(args.report.read_text(encoding='utf-8'))
            assert actual['sport'] == 'nba' and actual['version'] == 2
            state.update(payload=actual, wrong_sport=False)
            page.evaluate("localStorage.removeItem('devig_results_staking'); localStorage.removeItem('devig_results_price_source');")
            page.reload()
            expect(page.locator('#report-content')).to_be_visible()
            expect(page.locator('#request-status')).to_be_hidden()
            expect(page.locator('#page-title')).to_have_text('NBA devig results')
            page.select_option('#date-preset', 'published')
            props = page.locator('#market-filter option').evaluate_all('options => options.map(option => option.value).filter(Boolean)')
            assert set(props) == set(actual['cell_dictionaries']['prop'])
            fields = actual['cell_fields']
            selected = [cell for cell in actual['cells']
                        if actual['cell_dictionaries']['book'][cell[fields.index('book')]] != 'best'
                        and actual['cell_dictionaries']['reference'][cell[fields.index('reference')]] == 'pn;1'
                        and actual['cell_dictionaries']['method'][cell[fields.index('method')]] == 'worst']
            settled = sum(cell[fields.index(key)] for cell in selected for key in ('wins', 'losses', 'pushes'))
            expect(page.locator('#summary-settled')).to_have_text(f'{settled:,}')
            page.screenshot(path=str(OUTPUT / 'nba-devig-actual-report.png'))
            print(f'Actual NBA report: {len(actual["cells"])} compact cells, {len(props)} market groups, {settled} settled offers')
        assert errors == [], errors
        browser.close()
        print('NBA browser: routing, labels, grouping, refresh, saved preferences, PNG share, mobile and cross-sport regression passed')
finally:
    server.shutdown()
    server.server_close()
