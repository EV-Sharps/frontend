"""Offline browser integration of main-market depth on the real main page."""
import argparse
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import mkdtemp
from threading import Thread
from urllib.parse import parse_qs, urlsplit
import re

from playwright.sync_api import sync_playwright, expect

NOW = datetime(2026, 10, 28, 18, tzinfo=timezone.utc)
START = '2026-10-28T23:00:00Z'
UPDATED = '2026-10-28T17:59:00Z'
EXPIRES = '2026-10-28T18:04:00Z'


def fixture():
    rows = []
    for under, team, opp, handicap in [(False, 'tor', 'bos', -1.5), (True, 'bos', 'tor', 1.5)]:
        rows.append(dict(sport='nhl', prop='spread', game='tor @ bos', team=team, opp=opp,
                         handicap=handicap, under=under, dt='2026-10-28', book='nv', line=120, ev=5,
                         fairVal=110, implied=47, kelly=.2, logs=[], bookOdds={b: '120/-140' for b in ['nv', 'kal', 'px']},
                         liquidity={}, links={}))
    return dict(data=rows, games=['tor @ bos'], props=['spread'], updated={b: UPDATED for b in ['nv', 'kal', 'px']},
                times={'tor @ bos': START}, mainDepthAvailable={'tor @ bos': {'spread': {'-1.5': {
                    b: dict(updated=UPDATED, expires_at=EXPIRES) for b in ['nv', 'kal', 'px']}}}})


def entry(book):
    return dict(schema_version=1, market_id=f'{book}-spread', prop='spread', line='-1.5', updated=UPDATED,
                expires_at=EXPIRES, starts_at=START, sides=[
                    dict(side=side, label=side, outcome_id=f'{book}-{side}', truncated=False, orders=[dict(
                        probability=p, odds=odds, stake_usd=stake, opposite_stake_usd=other,
                        payout_usd=100, opposite_odds=-odds)])
                    for side, p, odds, stake, other in [('away', .3, 233, 30, 70), ('home', .6, -150, 60, 40)]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--overlay', type=Path)
    args = parser.parse_args()
    root, overlay = args.frontend.resolve(), args.overlay.resolve() if args.overlay else None
    artifacts = Path(mkdtemp(prefix='main-depth-browser-'))

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def translate_path(self, path):
            original = Path(super().translate_path(path))
            if overlay:
                staged = overlay / original.relative_to(root)
                if staged.is_file():
                    return str(staged)
            return str(original)

        def handle(self):
            try:
                super().handle()
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            page.set_default_timeout(10000)
            page.clock.set_fixed_time(NOW)
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(body=(root/'auth.js').read_text(encoding='utf-8').replace(
                'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'), content_type='application/javascript'))
            page.route(re.compile(r'/record(?:_[a-z]+)*\.js(?:\?.*)?$'), lambda route: route.fulfill(
                body="var RECORD_UPD='';var RECORD={worst:{best:{}},mult:{best:{}}};", content_type='application/javascript'))

            def api(route):
                url = urlsplit(route.request.url)
                if url.path == '/api/main-depth':
                    query = {key: values[0] for key, values in parse_qs(url.query).items()}
                    assert query['line'] == '-1.5'
                    assert query['game'] == 'tor @ bos'
                    requests.append(query['book'])
                    route.fulfill(json=dict(schemaVersion=1, **query, entry=entry(query['book'])))
                else:
                    route.fulfill(json=dict(data=[], games=[], props=[], updated={}, times={}, record={}))

            page.route('**/api/**', api)
            page.goto(f'http://localhost:{server.server_port}/main.html?sport=nhl&view=table')
            page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && document.getElementById('data-status')?.hidden === true")
            auto = page.locator('.table-refresh-auto input')
            if auto.count():
                auto.uncheck()
            page.evaluate("""async payload => {
                RES = payload; UPDATED[PAGE] = payload.updated;
                TABLE.clearFilter(true); TABLE.clearSort();
                window.mainDepthColumns = TABLE.getColumnDefinitions();
                const column = TABLE.getColumn('bookOdds.nv').getDefinition();
                TABLE.setColumns([{title:'Team',field:'team',width:120}, {...column,visible:true}]);
                await TABLE.setData(payload.data);
                window.mainDepthBefore = JSON.stringify(RES);
            }""", fixture())
            assert not requests
            icons = page.locator('#table .nv-depth-trigger[data-depth-book="nv"]')
            expect(icons).to_have_count(2)
            expect(icons.first.locator('svg')).to_have_count(1)
            icons.first.hover()
            preview = page.locator('#orderbook-preview')
            expect(preview).to_be_visible()
            expect(preview.locator('.nv-depth-preview-side')).to_have_count(2)
            assert requests == ['nv']
            assert 'TOR -1.5' in preview.inner_text()
            assert 'BOS +1.5' in preview.inner_text()
            icons.last.click()
            dialog = page.locator('#novig-depth-dialog')
            expect(dialog).to_be_visible()
            expect(preview).not_to_be_visible()
            expect(dialog.locator('.nv-depth-book')).to_have_count(2)
            assert 'TOR -1.5' in dialog.locator('.nv-depth-book').first.inner_text()
            assert 'BOS +1.5' in dialog.locator('.nv-depth-book').last.inner_text()
            expect(dialog.locator('.nv-depth-chart-amount').first).to_have_text('$40')
            assert requests == ['nv']
            assert not dialog.locator('select').count()
            dialog.locator('[data-depth-mode="resting"]').click()
            expect(dialog.locator('[data-depth-side="under"]')).to_have_attribute('aria-pressed', 'true')
            expect(dialog.locator('.nv-depth-table tbody tr').first.locator('td').nth(1)).to_have_text('$60')
            dialog.locator('[data-depth-side="over"]').click()
            expect(dialog.locator('.nv-depth-table tbody tr').first.locator('td').nth(1)).to_have_text('$30')
            assert 'not completed bets' in dialog.inner_text()
            dialog.locator('[data-depth-mode="available"]').click()
            for width in [1280, 390, 320]:
                page.set_viewport_size({'width': width, 'height': 900})
                for selector in ['#novig-depth-dialog', '.nv-depth-books', '.nv-depth-book']:
                    for element in page.locator(selector).all():
                        assert element.evaluate('el => el.scrollWidth <= el.clientWidth + 1'), (selector, width)
                page.screenshot(path=str(artifacts/f'main-depth-{width}.png'))
            dialog.locator('.nv-depth-close').click()
            page.evaluate('TABLE.setColumns(window.mainDepthColumns); showCardModal(RES.data[0])')
            card_buttons = page.locator('#card-modal-inner .nv-depth-trigger')
            expect(card_buttons).to_have_count(3)
            for book, name in [('nv', 'NOVIG'), ('kal', 'KALSHI'), ('px', 'PROPHETX')]:
                page.locator(f'#card-modal-inner .nv-depth-trigger[data-depth-book="{book}"]').click()
                expect(dialog.locator('.nv-depth-chart-row')).to_have_count(2)
                expect(dialog.locator('.nv-depth-eyebrow')).to_contain_text(name)
                expect(dialog.locator('.nv-depth-chart-amount').first).to_have_text('$40')
                if book != 'px':
                    dialog.locator('.nv-depth-close').click()
            assert sorted(requests) == ['kal', 'nv', 'px']
            assert len(requests) == 3
            assert page.evaluate('JSON.stringify(RES) === mainDepthBefore')
            page.evaluate("RES.data.forEach(row => row.blurred = true); window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nv-depth-chart-row')).to_have_count(0)
            page.evaluate("RES.data.forEach(row => row.blurred = false); window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nv-depth-chart-row')).to_have_count(2)
            page.clock.set_fixed_time(NOW + timedelta(minutes=6))
            page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nv-depth-chart-row')).to_have_count(0)
            assert len(requests) == 3
            page.clock.set_fixed_time(NOW)
            page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nv-depth-chart-row')).to_have_count(2)
            page.evaluate("ACCESS_TOKEN='new-account'; window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog).not_to_be_visible()
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Main page: shared hover/table/card UI, all venues, home spread identity, available/resting stakes, privacy, expiry and 320px layout passed')
    print(f'Screenshots: {artifacts}')


if __name__ == '__main__':
    main()
