"""Exercise both real pages offline: columns, sorting, details, mobile and preferences."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import tempfile
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--overlay', type=Path)
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'nfl-defense-browser')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *values):
        pass

    def translate_path(self, path):
        relative = unquote(urlparse(path).path).lstrip('/')
        for directory in (args.overlay, args.root):
            if directory:
                target = (directory / relative).resolve()
                if target.is_relative_to(directory.resolve()) and target.is_file():
                    return str(target)
        return str(args.root / '_missing')


server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name in ('tds', 'nfl'):
            page = browser.new_page(viewport={'width': 1440, 'height': 900}, has_touch=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('window.EventSource = undefined;')
            page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
            page.route('**/auth.js', lambda route: route.fulfill(
                body=(args.root / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
                content_type='application/javascript'))
            page.route('**/api/**', lambda route: route.fulfill(json={
                'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))
            page.goto(f'http://localhost:{server.server_port}/{name}.html?view=table')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
            assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            assert not page.evaluate("TABLE.getColumn('dvpGames').isVisible()")
            page.evaluate('''async () => {
                RES = null;
                TABLE.clearFilter(true); TABLE.clearSort();
                const base = {player:'dalton kincaid',pos:'TE',opp:'lac',team:'buf',game:'lac @ buf',
                    prop:PAGE === 'tds' ? 'attd' : 'rec_yd',handicap:0.5,under:false,book:'fd',
                    line:150,ev:7,fairVal:140,implied:40,kelly:.3,hitRate:50,
                    bookOdds:{fd:'150/-180',dk:'140/-170',circa:'130/-160'},logs:[0,1,0],snaps:[],
                    dvpRank:27,dvpAllowed:PAGE==='tds'?.5:64.5,dvpGames:2};
                window.defenseRows = [{...base,id:1},
                    {...base,id:2,player:'zero sample player',dvpRank:1,dvpAllowed:0},
                    {...base,id:3,player:'unsupported prop',prop:'longest_rec',dvpRank:undefined,dvpAllowed:undefined,dvpGames:undefined},
                    {...base,id:4,player:'td context player',prop:'ftd',dvpRank:20,dvpAllowed:.667,dvpContext:true},
                    {...base,id:5,player:'locked player',blurred:true}];
                NflDefense.setFeed({defenseVsPosition:{as_of:'2026-09-26',partial:false,
                    prop_metrics:{rec_yd:'rec_yd',attd:'attd'},context_metrics:{ftd:'attd'},
                    data:{lac:{TE:{games:2,ranked_teams:32}}}}});
                await TABLE.setData(defenseRows);
                // Keep the actual page formatters and table settings, focus the screenshot.
                const fields=['player','prop','opp','dvpRank','dvpAllowed','bookOdds.fd'];
                TABLE.getColumns().forEach(c => fields.includes(c.getField()) ? c.show() : c.hide());
            }''')
            for key in ('dvpRank', 'dvpAllowed'):
                assert page.evaluate('key => TABLE.getColumn(key).isVisible()', key)
            assert not page.evaluate("TABLE.getColumn('dvpGames').isVisible()")
            rank = page.evaluate("TABLE.getRow(1).getCell('dvpRank').getElement().textContent")
            assert rank == '27th', rank
            assert page.evaluate("TABLE.getRow(1).getCell('dvpRank').getElement().querySelector('small')") is None
            for row_id, ordinal, color in ((1, '27th', 'rgb(0, 255, 102)'), (2, '1st', 'rgb(255, 0, 0)')):
                assert page.evaluate("id => TABLE.getRow(id).getCell('dvpRank').getElement().textContent", row_id) == ordinal
                assert page.evaluate("id => getComputedStyle(TABLE.getRow(id).getCell('dvpRank').getElement().querySelector('strong')).color", row_id) == color
            assert page.evaluate("TABLE.getRow(2).getCell('dvpAllowed').getElement().querySelector('strong').textContent") == '0'
            assert page.evaluate("TABLE.getRow(3).getCell('dvpAllowed').getElement().textContent") == '-'
            assert page.evaluate("TABLE.getRow(5).getCell('dvpAllowed').getElement().querySelector('button')") is None
            assert 'TD context' in page.evaluate("TABLE.getRow(4).getCell('dvpAllowed').getElement().textContent")
            for direction, expected in [('asc', [2, 4, 1, 3, 5]), ('desc', [1, 4, 2, 3, 5])]:
                page.evaluate('direction => TABLE.setSort("dvpRank", direction)', direction)
                assert page.evaluate("TABLE.getData('active').map(row=>row.id)") == expected
            page.screenshot(path=str(args.output / f'{name}-desktop.png'), full_page=True)
            print(f'{name}: desktop rendering and sorting passed', flush=True)

            # Details are keyboard accessible and explain scope rather than implying a projection.
            page.evaluate("TABLE.getRow(1).getCell('dvpRank').getElement().querySelector('button').focus()")
            page.keyboard.press('Enter')
            dialog = page.locator('#nfl-defense-dialog')
            assert dialog.is_visible()
            assert '1 means fewest allowed' in dialog.inner_text()
            assert 'Small sample' in dialog.inner_text()
            page.keyboard.press('Escape')
            assert not dialog.is_visible()
            for width in (390, 320):
                page.set_viewport_size({'width': width, 'height': 844})
                page.evaluate("() => { TABLE.getRow(4).getCell('dvpAllowed').getElement().scrollIntoView({block:'nearest',inline:'end'}); }")
                button = page.locator('.tabulator-cell[tabulator-field="dvpAllowed"] .nfl-defense-context')
                button.tap()
                assert dialog.is_visible()
                assert 'not a FTD hit rate' in dialog.inner_text()
                bounds = dialog.bounding_box()
                assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1
                page.screenshot(path=str(args.output / f'{name}-{width}-details.png'))
                dialog.get_by_role('button', name='Close').click()
                assert not dialog.is_visible()

            page.set_viewport_size({'width': 1440, 'height': 900})
            page.evaluate('''() => {
                ENABLE_AUTH = true;
                CURR_USER = {metadata:{[PAGE]:['ev','player','opp'],[`${PAGE}-order`]:['player','opp','ev']}};
                CURR_SESSION = {user:{id:'fixture'}};
                SB = {from:()=>({update:payload=>({eq:async()=>{window.savedProfile=payload.metadata;return {error:null};}})})};
                NflDefense.migrateProfile(CURR_USER,PAGE);
                const saved=CURR_USER.metadata[`${PAGE}-order`];
                TABLE.setColumns(PAGE==='nfl' ? buildNflColumns(getNflColumnOrder(saved)) : buildTdsColumns(getTdsColumnOrder(saved)));
                showHideUserTable(true); openOverlay();
            }''')
            assert page.locator('#custom_dvpRank').is_checked()
            assert not page.locator('#custom_dvpAllowed').is_checked()
            assert not page.locator('#custom_dvpGames').is_checked()
            order = page.evaluate("TABLE.getColumns().map(c=>c.getField())")
            assert order.index('dvpRank') == order.index('opp') + 1
            page.locator('#custom_dvpAllowed').check()
            assert page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            page.evaluate('saveTableSettings()')
            page.wait_for_function('window.savedProfile?.[PAGE]?.includes("dvpAllowed")')
            page.evaluate('''() => {
                CURR_USER={metadata:JSON.parse(JSON.stringify(savedProfile))};
                NflDefense.migrateProfile(CURR_USER,PAGE);
                showHideUserTable(true); openOverlay();
            }''')
            assert page.locator('#custom_dvpAllowed').is_checked()
            assert page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            page.locator('#custom_dvpAllowed').uncheck()
            page.locator('#custom_dvpGames').check()
            assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            assert page.evaluate("TABLE.getColumn('dvpGames').isVisible()")
            page.evaluate('saveTableSettings()')
            page.wait_for_function('window.savedProfile && !savedProfile[PAGE].includes("dvpAllowed")')
            assert page.evaluate('savedProfile[`${PAGE}-defense-columns-version`]') == 1
            assert not page.evaluate("savedProfile[PAGE].includes('dvpAllowed')")
            page.evaluate('''() => {
                CURR_USER={metadata:JSON.parse(JSON.stringify(savedProfile))};
                NflDefense.migrateProfile(CURR_USER,PAGE);
                showHideUserTable(true); openColReorder();
            }''')
            labels = page.locator('#col-reorder-list').inner_text()
            assert 'Opponent vs position rank' in labels and 'Defense sample games' in labels
            assert 'Allowed per game vs position' not in labels
            page.evaluate('closeColReorder(); closeOverlay(); changeView("compact")')
            assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            if name == 'tds':
                for preset in ('pretty_', 'implied'):
                    page.evaluate(f'{preset}()')
                    assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
                    assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
            page.evaluate('''() => {
                TABLE.getColumns().forEach(c => ['player','opp','dvpRank','dvpGames'].includes(c.getField()) ? c.show() : c.hide());
                TABLE.getRows().forEach(row=>row.normalizeHeight());
            }''')
            compact_size = page.evaluate('''() => ({height:TABLE.getRow(1).getElement().getBoundingClientRect().height,
                cells:TABLE.getRow(1).getCells().filter(c=>c.getColumn().isVisible()).map(c=>({field:c.getField(),
                height:c.getElement().getBoundingClientRect().height,html:c.getElement().innerHTML}))})''')
            assert compact_size['height'] <= 25, compact_size

            # A refreshed feed drops old ranked-team metadata from the tooltip.
            page.evaluate('''async () => {
                NflDefense.setFeed({data:[]});
                await TABLE.replaceData(defenseRows);
            }''')
            assert 'of 32' not in page.evaluate("TABLE.getRow(1).getCell('dvpRank').getElement().querySelector('button').title")
            assert not errors, errors
            print(f'{name}: actual columns, sorting, zero/missing/locked rows, mobile/keyboard details, saved preferences and refresh passed.', flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
