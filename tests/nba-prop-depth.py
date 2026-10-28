"""Offline browser integration of NBA prop depth on the real NBA page."""
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
    for under in [False, True]:
        rows.append(dict(sport='nba', player='jayson tatum', prop='pts', game='bos @ ny', team='bos', opp='ny',
                         handicap=24.5, under=under, dt='2026-10-28', book='nv', line=120, ev=5,
                         fairVal=110, implied=47, kelly=.2, logs=[], bookOdds={b:'120/-140' for b in ['nv','kal','px']},
                         liquidity={}, links={}))
    return dict(data=rows,games=['bos @ ny'],props=['pts'],updated={b:UPDATED for b in ['nv','kal','px']},
                times={'bos @ ny':START},propDepthAvailable={'bos @ ny':{'pts':{'jayson tatum':{'24.5':{
                    b:dict(updated=UPDATED,expires_at=EXPIRES) for b in ['nv','kal','px']}}}}})


def entry(book):
    return dict(schema_version=1,market_id=f'{book}-pts',player='jayson tatum',prop='pts',line='24.5',updated=UPDATED,
                expires_at=EXPIRES, starts_at=START,sides=[
                    dict(side=side,label=side,outcome_id=f'{book}-{side}',truncated=False,orders=[dict(
                        probability=p,odds=odds,stake_usd=stake,opposite_stake_usd=other,
                        payout_usd=100,opposite_odds=-odds)])
                    for side,p,odds,stake,other in [('over',.3,233,30,70),('under',.6,-150,60,40)]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--overlay', type=Path)
    parser.add_argument('--page', choices=['nba', 'pts', 'threes'], default='nba')
    args = parser.parse_args()
    root, overlay = args.frontend.resolve(), args.overlay.resolve() if args.overlay else None
    artifacts = Path(mkdtemp(prefix='nba-prop-depth-browser-'))

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
                if url.path == '/api/nba-prop-depth':
                    query = {key: values[0] for key, values in parse_qs(url.query).items()}
                    assert query['line'] == '24.5'
                    assert query['player'] == 'jayson tatum'
                    assert query['game'] == 'bos @ ny'
                    requests.append(query['book'])
                    route.fulfill(json=dict(schemaVersion=1, sport='nba', **query, entry=entry(query['book'])))
                else:
                    route.fulfill(json=dict(data=[], games=[], props=[], updated={}, times={}, record={}))

            page.route('**/api/**', api)
            page.goto(f'http://localhost:{server.server_port}/{args.page}.html?view=table')
            page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && document.getElementById('data-status')?.hidden === true")
            auto = page.locator('.table-refresh-auto input')
            if auto.count():
                auto.uncheck()
            page.evaluate("""async payload => {
                RES = payload; UPDATED[PAGE] = payload.updated;
                TABLE.clearFilter(true); TABLE.clearSort();
                window.nbaDepthColumns = TABLE.getColumnDefinitions();
                const column = TABLE.getColumn('bookOdds.nv').getDefinition();
                TABLE.setColumns([{title:'Player',field:'player',width:120}, {...column,visible:true}]);
                await TABLE.setData(payload.data);
                window.nbaPropDepthBefore = JSON.stringify(RES);
            }""", fixture())
            assert not requests
            icons = page.locator('#table .nba-prop-depth-trigger')
            expect(icons).to_have_count(2)
            icons.last.click()
            dialog = page.locator('#nba-prop-depth-dialog')
            expect(dialog).to_be_visible()
            expect(dialog.locator('.nba-prop-depth-side h3').first).to_have_text('Over 24.5')
            expect(dialog.locator('.nba-prop-depth-side h3').last).to_have_text('Under 24.5')
            expect(dialog.locator('.nba-prop-depth-size').first).to_have_text('$40')
            assert requests == ['nv']
            dialog.locator('.nba-prop-depth-book').select_option('all')
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(6)
            assert sorted(requests) == ['kal', 'nv', 'px']
            dialog.locator('[data-prop-mode="resting"]').click()
            expect(dialog.locator('.nba-prop-depth-size').first).to_have_text('$30')
            assert 'not completed bets' in dialog.inner_text()
            for width in [1280, 390, 320]:
                page.set_viewport_size({'width': width, 'height': 900})
                for selector in ['#nba-prop-depth-dialog', '.nba-prop-depth-panels', '.nba-prop-depth-side']:
                    for element in page.locator(selector).all():
                        assert element.evaluate('el => el.scrollWidth <= el.clientWidth + 1'), (selector, width)
                page.screenshot(path=str(artifacts/f'nba-prop-depth-{width}.png'))
            dialog.locator('.nba-prop-depth-close').click()
            page.evaluate('TABLE.setColumns(window.nbaDepthColumns); showCardModal(RES.data[0])')
            card_button = page.locator('#card-modal-inner .nba-prop-depth-trigger')
            expect(card_button).to_be_visible()
            card_button.click()
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(6)
            assert len(requests) == 3
            assert page.evaluate('JSON.stringify(RES) === nbaPropDepthBefore')
            page.evaluate("RES.data.forEach(row => row.blurred = true); window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(0)
            page.evaluate("RES.data.forEach(row => row.blurred = false); window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(6)
            page.clock.set_fixed_time(NOW + timedelta(minutes=6))
            page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(0)
            assert len(requests) == 3
            page.clock.set_fixed_time(NOW)
            page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog.locator('.nba-prop-depth-side li')).to_have_count(6)
            page.evaluate("ACCESS_TOKEN='new-account'; window.dispatchEvent(new Event('odds-rendered'))")
            expect(dialog).not_to_be_visible()
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('NBA page: lazy table/card triggers, player identity, combined and resting books, privacy, expiry and 320px layout passed')
    print(f'Screenshots: {artifacts}')


if __name__ == '__main__':
    main()
