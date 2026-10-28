"""Offline scorer-depth UI integration against real MLB/NFL pages.

python -B tests/scorer-depth.py [--frontend PATH] [--overlay PATH]
An optional overlay serves staged assets above the unchanged frontend tree.
"""
import argparse
from copy import deepcopy
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


def fixture(sport, prop, game):
    row = dict(sport=sport, prop=prop, game=game, player='depth scorer', playerId='fixture',
               dt='2026-10-28', team=game.split(' @ ')[0], opp=game.split(' @ ')[1],
               handicap='0.5', under=False, pos='C', book='nv', line=400, ev=5,
               fairVal=350, implied=20, kelly=0.2, teamTotal=4, logs=[], hitRates={},
               bookOdds={book: '400/-500' for book in ('nv', 'kal', 'px')}, liquidity={}, links={})
    return dict(data=[row], games=[game], props=[prop], times={game: START},
                updated={book: UPDATED for book in ('nv', 'kal', 'px')},
                depthAvailable={game: {row['player']: {
                    book: dict(updated=UPDATED, expires_at=EXPIRES) for book in ('nv', 'kal', 'px')}}})


def entry(book):
    sides = []
    for side, p, odds, maker, opposite_odds, taker in [
        ('over', '0.2', 400, '20', -400, '80'),
        ('under', '0.9', -900, '90', 900, '10'),
    ]:
        order = dict(probability=p, odds=odds, stake_usd=maker, opposite_odds=opposite_odds,
                     opposite_stake_usd=taker, payout_usd='100')
        if book != 'px':
            order['contracts'] = 10000 if book == 'nv' else 100
        sides.append(dict(side=side, label=side, outcome_id=f'{book}-{side}', orders=[order], truncated=False))
    return dict(schema_version=1, market_id=f'{book}-market', event_id='fixture',
                updated=UPDATED, expires_at=EXPIRES, starts_at=START, sides=sides)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--overlay', type=Path)
    args = parser.parse_args()
    root, overlay = args.frontend.resolve(), args.overlay.resolve() if args.overlay else None
    artifacts = Path(mkdtemp(prefix='scorer-depth-browser-'))

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
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
            base = f'http://localhost:{server.server_port}'
            for name, sport, prop, game, endpoint, label in [
                ('dingers', 'mlb', 'hr', 'nyy-gm2 @ bos-gm2', '/api/homers-depth', 'Home run'),
                ('tds', 'nfl', 'attd', 'buf @ nyj', '/api/attd-depth', 'Touchdown'),
            ]:
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                page.set_default_timeout(10000)
                page.clock.set_fixed_time(NOW)
                errors, requests = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script('window.EventSource = undefined;')
                page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
                page.route('**/auth.js', lambda route: route.fulfill(
                    body=(root / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                    content_type='application/javascript'))
                page.route(re.compile(r'/record(?:_[a-z]+)*\.js(?:\?.*)?$'), lambda route: route.fulfill(
                    body="var RECORD_UPD='';var RECORD={worst:{best:{}},mult:{best:{}}};", content_type='application/javascript'))

                def api(route):
                    url = urlsplit(route.request.url)
                    if url.path.endswith('-depth'):
                        assert url.path == endpoint, (url.path, endpoint)
                        query = {key: values[0] for key, values in parse_qs(url.query).items()}
                        assert query['game'] == game
                        requests.append(query['book'])
                        route.fulfill(json=dict(schemaVersion=1, sport=sport, **query, entry=entry(query['book'])))
                    else:
                        route.fulfill(json=dict(data=[], games=[], props=[], updated={}, times={}, record={}))

                page.route('**/api/**', api)
                page.goto(f'{base}/{name}.html?view=table')
                page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && document.getElementById('data-status')?.hidden === true")
                auto = page.locator('.table-refresh-auto input')
                if auto.count():
                    auto.uncheck()
                payload = fixture(sport, prop, game)
                page.evaluate("""async payload => {
                    RES = payload; UPDATED[PAGE] = payload.updated;
                    TABLE.clearFilter(true); TABLE.clearSort();
                    const column = TABLE.getColumn('bookOdds.nv').getDefinition();
                    TABLE.setColumns([{title:'Player',field:'player',width:220}, {...column,visible:true}]);
                    await TABLE.setData(payload.data);
                    window.scorerDepthBefore = JSON.stringify(RES);
                }""", payload)
                assert not requests, 'Main table inspection must not fetch depth'
                icon = page.locator('#table .nv-depth-trigger[data-depth-book="nv"]').first
                expect(icon).to_be_visible()
                icon.click()
                dialog = page.locator('#novig-depth-dialog')
                expect(dialog).to_be_visible()
                expect(dialog.locator('.nv-depth-book-header span').first).to_have_text(label)
                expect(dialog.locator('.nv-depth-book-header span').last).to_have_text(f'No {label.lower()}')
                assert requests == ['nv'], requests
                dialog.locator('[data-depth-mode="resting"]').click()
                expect(dialog.locator('[data-depth-side="over"]')).to_contain_text(label)
                assert 'No goal' not in dialog.inner_text()
                dialog.locator('.nv-depth-close').click()
                expect(dialog).not_to_be_visible()
                if not page.evaluate("typeof PlayerLines !== 'undefined'"):
                    page.add_script_tag(url=f'{base}/player-lines.js')
                page.evaluate("""() => {
                    const host = document.createElement('section'); host.id = 'scorer-depth-test';
                    host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#172027;overflow:auto;padding:8px;box-sizing:border-box';
                    document.body.append(host);
                    window.scorerDepthMount = PlayerLines.mountDepth(host, RES.data[0]);
                }""")
                expect(page.locator('#scorer-depth-test .prediction-depth-odds').first).to_be_visible()
                page.wait_for_function("document.querySelectorAll('#scorer-depth-test .prediction-depth-source[data-book=px]').length === 2")
                assert sorted(requests) == ['kal', 'nv', 'px'], requests
                expect(page.locator('#scorer-depth-test [data-depth-side="over"] .prediction-depth-book-header span')).to_have_text(label)
                for width in (1280, 390, 320):
                    page.set_viewport_size({'width': width, 'height': 900})
                    for selector in ['.prediction-depth', '.prediction-depth-books', '.prediction-depth-levels']:
                        for element in page.locator(f'#scorer-depth-test {selector}').all():
                            assert element.evaluate('el=>el.scrollWidth<=el.clientWidth+1'), (name, width, selector)
                    page.screenshot(path=str(artifacts / f'{name}-{width}.png'))
                assert page.evaluate('JSON.stringify(RES) === scorerDepthBefore')
                page.evaluate("RES.data[0].blurred = true; window.dispatchEvent(new Event('odds-rendered'))")
                expect(page.locator('#scorer-depth-test .prediction-depth-level')).to_have_count(0)
                assert len(requests) == 3
                page.evaluate("RES.data[0].blurred = false; window.dispatchEvent(new Event('odds-rendered'))")
                expect(page.locator('#scorer-depth-test .prediction-depth-level')).to_have_count(2)
                page.clock.set_fixed_time(NOW + timedelta(minutes=6))
                page.evaluate("window.dispatchEvent(new Event('odds-rendered'))")
                expect(page.locator('#scorer-depth-test .prediction-depth-level')).to_have_count(0)
                assert len(requests) == 3
                page.evaluate('scorerDepthMount.destroy()')
                assert not errors, errors
                page.close()
                print(f'{name}: actual page icon, lazy endpoint, labels, combined books, doubleheader identity, privacy, expiry and mobile layout passed', flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f'Screenshots: {artifacts}')


if __name__ == '__main__':
    main()
