"""Exercise real football mobile cards with legacy trends and weekly usage feeds."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'nfl-mobile-cards')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name in ('nfl', 'tds', 'tds2'):
            page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript'))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
            page.goto(f'http://localhost:{server.server_port}/{name}.html?view=mobile')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate('''async () => {
                RES = null;
                TABLE.clearFilter(true); TABLE.clearSort();
                window.mobileFixture = {player:'sam darnold',pos:'QB',opp:'ari',team:'sea',game:'sea @ ari',
                    prop:PAGE === 'nfl' ? 'pass_td' : 'attd',handicap:PAGE === 'nfl' ? 1.5 : .5,
                    under:true,book:'fd',line:150,ev:7,fairVal:140,implied:40,kelly:.3,
                    oppRank:{'opp-pass-td':{rank:11},'opp-rz-scoring-pct':{rank:18}},
                    bookOdds:{fd:'150/150',dk:'140/140',circa:'130/130'},
                    hitRate:0,hitRateLYR:67,logs:[0],snaps:['10%','0%',null],
                    usage:{year:2026,weeks:[1,2,3],latest_week:2,
                        snaps:{tot:[5,0,null],pct:['10%','0%',null]}}};
                await TABLE.setData([mobileFixture]);
                initializeCards([mobileFixture]);
                CURRENT_VIEW = 'mobile'; applyOddsTableView();
            }''')
            card = page.locator('#card-container .data-card')
            assert card.count() == 1 and card.is_visible()
            card.locator('.card-arrow-container').tap()
            assert 'expanded' in card.get_attribute('class')
            assert card.locator('.card-body-collapsed').is_visible()

            def trends():
                return card.locator('.trend-pill').evaluate_all('''pills => Object.fromEntries(pills.map(pill => [
                    pill.querySelector('.trend-label')?.textContent.trim(), {
                        sample:pill.querySelector('.trend-frac')?.textContent.trim() || '',
                        percent:pill.querySelector('.trend-pct')?.textContent.trim() || ''
                    }]))''')

            def snap(value, week=None):
                pill = card.locator('.snap-share-pill')
                assert pill.locator('strong').inner_text() == value, pill.inner_text()
                if week is not None:
                    assert pill.locator('.nfl-usage-summary small').inner_text() == f'W{week}', pill.inner_text()
                    assert 'Last game' not in pill.inner_text()

            def assert_trends_fit():
                bounds = card.bounding_box()
                assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= page.viewport_size['width'] + 1, bounds
                for pill in card.locator('.trend-pill').all():
                    pill_bounds = pill.bounding_box()
                    assert pill_bounds['x'] >= bounds['x'], pill_bounds
                    assert pill_bounds['x'] + pill_bounds['width'] <= bounds['x'] + bounds['width'] + 1, pill_bounds
                    assert pill.evaluate('element => element.scrollWidth <= element.clientWidth + 1'), pill.inner_text()

            def refresh(changes, remove=()):
                same_play = page.evaluate('''({changes, remove}) => {
                    const previousKey = cardStateKey(mobileFixture);
                    Object.assign(mobileFixture, changes);
                    remove.forEach(key => delete mobileFixture[key]);
                    updateExistingCard(document.querySelector('#card-container .data-card'), mobileFixture);
                    return previousKey === cardStateKey(mobileFixture);
                }''', {'changes': changes, 'remove': list(remove)})
                if same_play:
                    assert 'expanded' in card.get_attribute('class'), 'A price/data refresh must retain the expanded card'
                elif 'expanded' not in card.get_attribute('class'):
                    card.locator('.card-arrow-container').tap()

            # Live NFL snapshots have scalar rates, no hitRates, and a future empty snap slot.
            # The legacy under scalar can be zero even when every log is below the line.
            displayed = trends()
            assert displayed['Year'] == {'sample': '1/1', 'percent': '100%'}, displayed
            assert displayed['L5'] == {'sample': '1/1', 'percent': '100%'}, displayed
            assert displayed['Last Yr']['percent'] == '67%', displayed
            assert displayed['Last Yr']['sample'] == '', 'A percentage alone cannot supply win/game counts'
            snap('0%', 2)
            assert_trends_fit()
            page.screenshot(path=str(args.output / f'{name}-expanded.png'))

            # Once the latest team week changes, do not silently show an older player's value.
            refresh({'usage': {'year': 2026, 'weeks': [1, 2, 3], 'latest_week': 3,
                               'snaps': {'tot': [5, 0, None], 'pct': ['10%', '0%', None]}}})
            snap('-', 3)
            refresh({'usage': {'year': 2026, 'weeks': [1, 2, 3], 'latest_week': 3,
                               'snaps': {'tot': [5, 0, 46], 'pct': ['10%', '0%', '76%']}}})
            snap('76%', 3)

            # Recent windows use the newest logs, preserving zero and rejecting invalid entries.
            refresh({'handicap': 1.5, 'under': False, 'logs': [0] * 15 + [2] * 5,
                     'hitRate': 25, 'hitRateLYR': 67})
            displayed = trends()
            assert displayed['Year'] == {'sample': '5/20', 'percent': '25%'}, displayed
            assert displayed['L5'] == {'sample': '5/5', 'percent': '100%'}, displayed
            assert displayed['L10'] == {'sample': '5/10', 'percent': '50%'}, displayed
            assert displayed['L20'] == {'sample': '5/20', 'percent': '25%'}, displayed
            refresh({'under': True, 'logs': [None, '', 'bad', 0, '2']})
            displayed = trends()
            assert displayed['Year'] == {'sample': '1/2', 'percent': '50%'}, displayed

            # Rich feed statistics take precedence over any legacy logs or scalar fields.
            refresh({'hitRates': {'szn': {'w': 3, 't': 4, 'p': 75},
                                  'lyr': {'w': 8, 't': 10, 'p': 80},
                                  'L5': {'w': 4, 't': 5, 'p': 80}}})
            displayed = trends()
            assert displayed['Year'] == {'sample': '3/4', 'percent': '75%'}, displayed
            assert displayed['Last Yr'] == {'sample': '8/10', 'percent': '80%'}, displayed
            assert displayed['L5'] == {'sample': '4/5', 'percent': '80%'}, displayed

            # Older snapshots without weekly usage retain their game-based snap display.
            refresh({'snaps': ['61%', '76%']}, remove=('usage',))
            snap('76%')
            assert 'Last game' in card.locator('.snap-share-pill').inner_text()
            assert not card.locator('.nfl-usage-summary small').count()

            # Test the actual narrow layout, not only the returned formatter HTML.
            page.set_viewport_size({'width': 320, 'height': 844})
            assert_trends_fit()
            assert not errors, errors
            print(f'{name}: mobile trends, under/zero/missing data, latest-week refresh, legacy fallbacks and 320px layout passed.', flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
