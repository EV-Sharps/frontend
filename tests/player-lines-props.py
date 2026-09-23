"""Exercise player-click prop switching on the three comparison pages with local fixtures."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(tempfile.gettempdir()) / 'player-lines-props'
ARTIFACTS.mkdir(exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={ARTIFACTS / "chromium.log"}',
        ])
        for sport, initial, alternate, empty in [
            ('mlb', 'k', 'bb', 'outs'),
            ('nfl', 'rec_yd', 'rec', 'rush_yd'),
            ('nhl', 'sog', 'pts', 'atgs'),
        ]:
            page = browser.new_page(viewport={'width': 1280, 'height': 800})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript',
            ))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {},
            }))
            page.goto(f'http://localhost:{server.server_port}/{sport}.html')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            page.evaluate('''async ({sport, initial, alternate, empty}) => {
                const selected = {player:'test player', sport, prop:initial, game:'away @ home',
                    gameId:'game-1',date:'2026-09-23',handicap:4.5,bookOdds:{fd:'-110/-115'}};
                const rows = [selected, {...selected,handicap:3.5}, {...selected,handicap:5.5},
                    {...selected,prop:alternate,bookOdds:{kal:'+120/-140',px:'/-125'},liquidity:{kal:[1200,2500],px:[900,300]}},
                    {...selected,prop:alternate,handicap:5.5,bookOdds:{kal:'+200/-250'}},
                    {...selected,prop:alternate,under:true,bookOdds:{kal:'+120/-140'}},
                    {...selected,prop:empty,bookOdds:{}},
                    {...selected,player:'other player',prop:'other'},
                    {...selected,gameId:'game-2',prop:'other'},
                    {...selected,date:'2026-09-24',prop:'other'},
                    {...selected,blurred:true,prop:'locked'}];
                window.fixtureSelected = selected;
                window.fixtureRows = rows;
                // Only the clicked prop is on the page; the comparison uses the full feed.
                RES = null;
                TABLE.clearFilter(true);
                TABLE.clearSort();
                TABLE.setColumns([{title:'Player',field:'player',width:240,formatter:basePlayerFormatter,
                    formatterParams:{sport,noProp:true,fullName:true}}]);
                await TABLE.setData([selected]);
                RES = {data:rows};
            }''', {'sport': sport, 'initial': initial, 'alternate': alternate, 'empty': empty})
            page.locator('#table .player-lines-trigger').click()
            selector = page.locator('#player-lines-prop')
            assert selector.input_value() == initial
            assert sorted(selector.locator('option').evaluate_all('(els) => els.map(el => el.value)')) == sorted([initial, alternate, empty])
            assert selector.locator('option:checked').inner_text() == initial.upper()
            assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['3.5', '4.5', '5.5']
            assert page.locator('#player-lines-dialog tr.is-selected th').inner_text() == '4.5'

            selector.focus()
            selector.select_option(alternate)
            assert page.evaluate('document.activeElement.id') == 'player-lines-prop'
            assert page.locator('#player-lines-dialog thead th').all_text_contents() == ['Line', 'KAL', 'PX']
            assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['4.5', '5.5']
            assert page.locator('#player-lines-dialog tr.is-selected').count() == 0
            first = page.locator('#player-lines-dialog tbody tr').first
            assert first.locator('td').first.locator('.player-lines-liquidity').all_text_contents() == ['($1,200)', '($2,500)']
            assert first.locator('td').nth(1).locator('.player-lines-price').all_text_contents() == ['', '-125($300)']
            assert page.locator('#player-lines-count').inner_text() == '2 lines'
            assert page.evaluate('TABLE.getData()[0].prop') == initial
            page.wait_for_function('Array.from(document.querySelectorAll("#player-lines-dialog img")).every(img => img.complete && img.naturalWidth > 0)')
            page.screenshot(path=str(ARTIFACTS / f'{sport}-desktop.png'))

            selector.select_option(empty)
            assert page.locator('.player-lines-empty').is_visible()
            assert page.locator('#player-lines-count').inner_text() == '0 lines'
            selector.select_option(initial)
            assert page.locator('#player-lines-dialog tr.is-selected th').inner_text() == '4.5'

            for width in (390, 320):
                page.set_viewport_size({'width': width, 'height': 844})
                selector.select_option(alternate)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert selector.is_visible()
                selector.select_option(initial)
                page.screenshot(path=str(ARTIFACTS / f'{sport}-{width}.png'))

            if sport == 'nfl':
                # The extra content wrapper must still constrain and scroll a large comparison.
                page.evaluate('''() => {
                    const books = ['pn','kal','nv','px','poly','fd','dk','b365','mgm','cz'];
                    RES.data = [...fixtureRows, ...Array.from({length:40}, (_,i) => ({...fixtureSelected,
                        handicap:i+10.5,bookOdds:Object.fromEntries(books.map(book => [book,'+120/-140']))}))];
                    openPlayerLines(fixtureSelected);
                }''')
                scroll = page.locator('.player-lines-scroll')
                assert scroll.evaluate('(el) => el.scrollHeight > el.clientHeight && el.scrollWidth > el.clientWidth')
                line_x = page.locator('#player-lines-dialog tbody th').first.bounding_box()['x']
                scroll.evaluate('(el) => {el.scrollTop=el.scrollHeight; el.scrollLeft=el.scrollWidth;}')
                assert abs(page.locator('#player-lines-dialog tbody th').first.bounding_box()['x'] - line_x) < 1
                assert selector.is_visible()
                assert page.locator('#player-lines-dialog').bounding_box()['height'] <= 844 * .92 + 1
                selector.select_option(alternate)
                assert page.locator('.player-lines-scroll').evaluate('(el) => el.scrollLeft === 0 && el.scrollTop === 0')

            page.keyboard.press('Escape')
            assert not page.locator('#player-lines-dialog').is_visible()

            page.evaluate("openPlayerLines({...fixtureSelected,player:'other player',prop:'other'})")
            assert selector.locator('option').count() == 1
            assert selector.input_value() == 'other'
            assert page.locator('#player-lines-title').inner_text() == 'Other Player'
            assert not errors, errors
            print(f'{sport}: player click, prop choices, switching, liquidity, empty state, focus and mobile passed.')
            page.close()
        browser.close()
finally:
    server.shutdown()
