"""Exercise main-market line comparisons with an offline, complete game feed."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(tempfile.gettempdir()) / 'main-lines'
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
        page.goto(f'http://localhost:{server.server_port}/main.html?sport=nfl')
        page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        page.evaluate('''async () => {
            const selected = {sport:'nfl', prop:'spread', game:'sea @ sf', gameId:'game-1',
                date:'2026-10-05', dt:'2026-10-05T20:00:00Z', team:'sf', opp:'sea',
                handicap:-3.5, under:true, book:'fd', line:-105, ev:2, fairVal:-100,
                implied:50, kelly:0.5, logs:[], circa_blurred:true,
                bookOdds:{kal:'+115/-125', fd:'/-105', circa:'+200/-220'},
                liquidity:{kal:[1200,2500]}};
            const away = {...selected, team:'sea', opp:'sf', under:false};
            const total = {...away, prop:'total', handicap:45.5,
                bookOdds:{kal:'+110/-130',px:'/-125'},liquidity:{kal:[900,300],px:[80,450]}};
            const rows = [selected,
                {...away, handicap:3.5, bookOdds:{fd:'-110/-105',kal:'+115/-125'}},
                {...away, handicap:2.5, bookOdds:{fd:'-120/+100'}},
                {...selected, handicap:-4.5, bookOdds:{fd:'+130/-150'}},
                total, {...total, handicap:46.5, bookOdds:{kal:'+120/-140'}},
                {...away, prop:'ml', handicap:0, bookOdds:{fd:'+160/-185',kal:'+170/-195'}},
                {...selected, prop:'ml', handicap:null, bookOdds:{fd:'+160/-185'}},
                {...total, prop:'away_total', handicap:23.5, bookOdds:{fd:'-115/-105'}},
                {...total, prop:'home_total', handicap:24.5, bookOdds:{fd:'-110/-110'}},
                {...away, prop:'spread', handicap:88.5, blurred:true},
                {...away, prop:'locked', blurred:true},
                {...total, handicap:90.5, game:'sea @ la'},
                {...total, handicap:91.5, gameId:'game-2'},
                {...total, handicap:92.5, date:'2026-10-06'},
                {...total, handicap:93.5, dt:'2026-10-05T23:00:00Z'},
                {...total, handicap:94.5, sport:'nba'}];
            window.fixtureSelected = selected;
            window.fixtureRows = rows;
            RES = null;
            TABLE.clearFilter(true);
            TABLE.clearSort();
            // Preserve the actual main formatters and click bindings, exposing its hidden Line column.
            TABLE.setColumns(getMainColumnItems().filter(item => ['prop','handicap'].includes(item.key))
                .flatMap(item => item.cols.map(column => ({...column, visible:true}))));
            await TABLE.setData([selected]);
            RES = {data:rows};
            window.rawQuotesBefore = JSON.stringify(rows.map(row => [row.bookOdds,row.liquidity,row.handicap]));
        }''')

        trigger = page.locator('#table [tabulator-field="prop"] .player-lines-trigger')
        trigger.focus()
        page.keyboard.press('Enter')
        dialog = page.locator('#player-lines-dialog')
        selector = page.locator('#player-lines-prop')
        assert dialog.is_visible()
        assert page.locator('#player-lines-title').inner_text() == 'SEA @ SF'
        assert selector.input_value() == 'spread'
        assert sorted(selector.locator('option').evaluate_all('(els) => els.map(el => el.value)')) == [
            'away_total', 'home_total', 'ml', 'spread', 'total',
        ]
        assert page.locator('#player-lines-count').inner_text() == '3 lines'
        assert page.locator('#player-lines-dialog tbody th').evaluate_all(
            '(els) => els.map(el => el.innerText.replace(/\\s+/g," ").trim())'
        ) == ['+2.5 -2.5', '+3.5 -3.5', '+4.5 -4.5']
        selected_row = page.locator('#player-lines-dialog tr.is-selected')
        assert selected_row.count() == 1
        assert selected_row.locator('th').inner_text().split() == ['+3.5', '-3.5']
        assert page.locator('#player-lines-dialog thead th').all_text_contents() == ['Line', 'KAL', 'FD']
        assert selected_row.locator('td').first.locator('.player-lines-price').all_text_contents() == [
            '+115($1,200)', '-125($2,500)',
        ]
        assert selected_row.locator('td').nth(1).locator('.player-lines-price').all_text_contents() == ['-110', '-105']
        assert selected_row.locator('td').first.locator('.is-best').count() == 1
        assert selected_row.locator('td').nth(1).locator('.is-best').count() == 1
        legend = page.locator('#player-lines-legend').inner_text().lower()
        assert 'sea' in legend and 'sf' in legend
        page.screenshot(path=str(ARTIFACTS / 'main-desktop.png'))

        selector.focus()
        selector.select_option('ml')
        assert page.evaluate('document.activeElement.id') == 'player-lines-prop'
        assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['ML']
        assert page.locator('#player-lines-dialog tr.is-selected').count() == 0
        selector.select_option('total')
        assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['45.5', '46.5']
        assert page.locator('#player-lines-dialog thead th').all_text_contents() == ['Line', 'KAL', 'PX']
        assert 'over above / under below' in page.locator('#player-lines-legend').inner_text().lower()
        assert page.locator('#player-lines-dialog tbody tr').first.locator('td').nth(1).locator(
            '.player-lines-price').all_text_contents() == ['', '-125($450)']
        selector.select_option('away_total')
        assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['23.5']
        selector.select_option('home_total')
        assert page.locator('#player-lines-dialog tbody th').all_text_contents() == ['24.5']
        selector.select_option('spread')
        assert page.locator('#player-lines-dialog tr.is-selected').count() == 1
        assert page.evaluate('TABLE.getData().length === 1 && TABLE.getData()[0].prop === "spread"')

        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert selector.is_visible()
            box = dialog.bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width + 1
            page.screenshot(path=str(ARTIFACTS / f'main-{width}.png'))
        page.keyboard.press('Escape')
        assert not dialog.is_visible()
        assert trigger.evaluate('(el) => document.activeElement === el')

        # Both table entry points work, while modifier clicks preserve the existing card view.
        page.set_viewport_size({'width': 1280, 'height': 800})
        line_trigger = page.locator('#table [tabulator-field="handicap"] .player-lines-trigger')
        line_trigger.click()
        assert dialog.is_visible()
        page.keyboard.press('Escape')
        for modifier in ('Shift', 'Control'):
            trigger.click(modifiers=[modifier])
            assert not dialog.is_visible()
            assert page.locator('#card-modal-overlay').evaluate('(el) => el.classList.contains("open")')
            page.locator('#card-modal-close').click()

        # The market in an ordinary card opens the same comparison without expanding the card.
        page.evaluate('''() => {
            const container = document.getElementById('card-container');
            container.style.display = 'block';
            container.appendChild(createNewCard(fixtureSelected, 'main-comparison-fixture'));
        }''')
        card = page.locator('[data-unique-id="main-comparison-fixture"]')
        card.locator('.player-lines-trigger').click()
        assert dialog.is_visible()
        assert page.locator('#player-lines-title').inner_text() == 'SEA @ SF'
        assert not card.evaluate('(el) => el.classList.contains("expanded")')
        page.keyboard.press('Escape')
        assert card.locator('.player-lines-trigger').evaluate('(el) => document.activeElement === el')

        # Locked feed rows never become entry points or leak their quotes through the full feed.
        assert page.evaluate('''() => {
            const locked = {...fixtureSelected,blurred:true};
            openPlayerLines(locked);
            return !document.getElementById('player-lines-dialog').open
                && !playerLinesName(locked, 'Locked').includes('player-lines-trigger')
                && JSON.stringify(RES.data.map(row => [row.bookOdds,row.liquidity,row.handicap])) === rawQuotesBefore;
        }''')
        assert not errors, errors
        print('main: table/card entry points, market switching, spread normalization, liquidity, access restrictions, keyboard and mobile passed.')
        page.close()
        browser.close()
finally:
    server.shutdown()
