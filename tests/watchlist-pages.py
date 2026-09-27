"""Verify prop/page stars and saved-price snapshots in tables, cards and the tracker."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "watchlist-pages.log"}',
        ])
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(error.stack))
        page.add_init_script('window.EventSource = undefined;')
        page.route('https://**/*', lambda route: route.fulfill(
            body='window.supabase={createClient:()=>({rpc:async()=>({data:[]})})};' if 'supabase-js' in route.request.url else '',
            content_type='application/javascript',
        ))
        page.route('**/auth.js', lambda route: route.fulfill(
            body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
            content_type='application/javascript',
        ))
        page.route('**/api/**', lambda route: route.fulfill(json={
            'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {},
        }))

        def setup_profile(profile):
            page.evaluate('''profile => {
                CURR_USER = profile;
                CURR_SESSION = {user:{id:'fixture'}};
                window.savedProfiles = [];
                window.failProfileSave = false;
                SB = {from:()=>({update:({metadata})=>({eq:async()=>{
                    if (window.failProfileSave) return {error:new Error('Fixture save failure')};
                    window.savedProfiles.push(JSON.parse(JSON.stringify(metadata)));
                    return {error:null};
                }})}),rpc:async()=>({data:[]})};
            }''', profile)

        def visit(name, profile, props=('hr',), overrides=None):
            page.goto(f'http://localhost:{server.server_port}/{name}.html')
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            setup_profile(profile)
            page.evaluate('''async ({props, overrides}) => {
                RES = null;
                TABLE.clearFilter(true); TABLE.clearSort();
                TABLE.setColumns([watchlistColumn(),{title:'Player',field:'player',width:200},
                    {title:'Best Book',field:'book',formatter:bestBookFormatter}]);
                const row = {player:'test player',team:'bal',sport:'mlb',game:'bal @ kc',
                    prop:'hr',handicap:0.5,under:false,book:'fd',line:500,ev:10,fairVal:450,
                    bookOdds:{fd:'+500/-700',pn:'+450/-650'},logs:[0,1,0],hitRates:{}};
                const rows = props.map(prop => ({...row, prop, ...(overrides[prop] || {})}));
                await TABLE.setData(rows);
                initializeCards(rows);
                CURRENT_VIEW = 'table'; applyOddsTableView();
            }''', {'props': list(props), 'overrides': overrides or {}})

        def toggle(selector, watched):
            star = page.locator(selector)
            star.click()
            page.wait_for_function('''({selector, watched}) => {
                const star = document.querySelector(selector);
                return !star.disabled && star.getAttribute('aria-pressed') === String(watched);
            }''', arg={'selector': selector, 'watched': watched})

        table_star = '#table .watchlist-star'
        card_star = '#card-container .watchlist-star'
        visit('dingers', {'metadata': {}})
        toggle(table_star, True)
        assert page.locator(card_star).get_attribute('aria-pressed') == 'true'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, False)
        page.evaluate("CURRENT_VIEW='table'; applyOddsTableView()")
        assert page.locator(table_star).get_attribute('aria-pressed') == 'false'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, True)
        profile = page.evaluate('CURR_USER')
        assert profile['metadata']['watchlist'][0]['page'] == 'dingers'
        assert profile['metadata']['watchlist'][0]['quote'] == {
            'book': 'fd', 'odds': 500, 'handicap': 0.5, 'under': False, 'game': 'bal @ kc',
        }, 'Card outerHTML must preserve the displayed price and line when starred'

        visit('mlb', profile)
        assert page.locator(table_star).get_attribute('aria-pressed') == 'false'
        assert page.locator(card_star).get_attribute('aria-pressed') == 'false'
        toggle(table_star, True)
        profile = page.evaluate('CURR_USER')
        assert {entry['page'] for entry in profile['metadata']['watchlist']} == {'dingers', 'mlb'}
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, False)
        assert page.evaluate("CURR_USER.metadata.watchlist.map(entry => entry.page)") == ['dingers']
        toggle(card_star, True)
        profile = page.evaluate('CURR_USER')
        visit('dingers', profile)
        assert page.locator(table_star).get_attribute('aria-pressed') == 'true'

        # Doubles can be starred without starring singles or total bases.
        visit('mlb', profile, ('double', 'single', 'tb', 'hr'))
        double_table = table_star + '[data-prop="double"]'
        single_table = table_star + '[data-prop="single"]'
        double_card = card_star + '[data-prop="double"]'
        single_card = card_star + '[data-prop="single"]'
        toggle(double_table, True)
        assert page.locator(single_table).get_attribute('aria-pressed') == 'false'
        assert page.locator(table_star + '[data-prop="tb"]').get_attribute('aria-pressed') == 'false'
        assert page.locator(double_card).get_attribute('aria-pressed') == 'true'
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(single_card, True)
        toggle(double_card, False)
        assert page.locator(single_card).get_attribute('aria-pressed') == 'true'
        toggle(double_card, True)
        profile = page.evaluate('CURR_USER')
        assert len(profile['metadata']['watchlist']) == 4
        visit('mlb', profile, ('double', 'single', 'tb', 'hr'))
        assert page.locator(double_table).get_attribute('aria-pressed') == 'true'
        assert page.locator(single_table).get_attribute('aria-pressed') == 'true'
        assert page.locator(table_star + '[data-prop="tb"]').get_attribute('aria-pressed') == 'false'

        # Tracker matches odds by prop and removes only the selected favorite.
        page.goto(f'http://localhost:{server.server_port}/tracker.html')
        page.wait_for_function("typeof WATCHLIST_TABLE !== 'undefined' && WATCHLIST_TABLE !== null")
        setup_profile(profile)
        page.evaluate('''() => {
            ALL_ROWS = [{player:'test player',sport:'mlb',team:'bal',prop:'hr',
                game:'bal @ kc',handicap:0.5,bookOdds:{fd:'+500/-700'}}];
            refreshWatchlist();
        }''')
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 4")
        assert page.evaluate("WATCHLIST_TABLE.getData().map(row => row.prop).sort()") == ['double', 'hr', 'hr', 'single']
        assert page.evaluate("WATCHLIST_TABLE.getData().filter(row => row.bookOdds).every(row => row.prop === 'hr')")
        assert page.locator('#watchlist-table [tabulator-field="watchlistPage"]').count() >= 5
        double_row = page.locator('#watchlist-table .tabulator-row').filter(
            has=page.locator('[tabulator-field="prop"]', has_text='2B'))
        double_row.locator('.wl-remove').click()
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 3")
        assert page.evaluate("isWatchlisted('test player','mlb','mlb','single')")
        assert not page.evaluate("isWatchlisted('test player','mlb','mlb','double')")
        page.evaluate("removeFromWatchlist('test player','mlb','mlb','hr')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 2")
        assert page.evaluate("isWatchlisted('test player','mlb','dingers','hr')")
        page.evaluate("toggleWatchlistTracker('test player')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 1")
        assert page.evaluate("isWatchlisted('test player','mlb','mlb','single')")
        page.evaluate("removeFromWatchlist('test player','mlb','mlb','single')")
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 0")

        # Fee-adjusted table quotes and raw card quotes must each match the price actually shown.
        visit('mlb', {'metadata': {}}, overrides={
            'hr': {'book': 'kal', 'line': 200, 'bookOdds': {'kal': '+200/-200'}},
        })
        displayed_table_price = int(page.locator('#table .evbook-odds').inner_text())
        toggle(table_star, True)
        assert page.evaluate('CURR_USER.metadata.watchlist[0].quote.odds') == displayed_table_price
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star, False)
        displayed_card_price = int(page.locator('#card-container .evbook-odds-large').inner_text())
        assert displayed_card_price != displayed_table_price, 'Fixture must exercise a fee-adjusted display'
        toggle(card_star, True)
        assert page.evaluate('CURR_USER.metadata.watchlist[0].quote.odds') == displayed_card_price

        # Quotes use the displayed side and selected book, retaining independent snapshots per prop.
        original_bet = {'player': 'already tracked', 'sport': 'mlb', 'book': 'dk', 'odds': 240,
                        'game': 'nyy @ bos', 'prop': 'hr', 'handicap': 0.5, 'under': False}
        visit('mlb', {'metadata': {'bets': [original_bet]}}, ('hr', 'single'), {
            'single': {'handicap': 1.5, 'under': True, 'line': -130,
                       'bookOdds': {'fd': '+110/-130', 'dk': '+120/-140'}},
        })
        toggle(table_star + '[data-prop="hr"]', True)
        page.evaluate("CURRENT_VIEW='mobile'; applyOddsTableView()")
        toggle(card_star + '[data-prop="single"]', True)
        profile = page.evaluate('CURR_USER')
        assert profile['metadata']['bets'] == [original_bet]
        hr_quote = {'book': 'fd', 'odds': 500, 'handicap': 0.5, 'under': False, 'game': 'bal @ kc'}
        under_quote = {'book': 'fd', 'odds': -130, 'handicap': 1.5, 'under': True, 'game': 'bal @ kc'}
        assert {entry['prop']: entry['quote'] for entry in profile['metadata']['watchlist']} == {
            'hr': hr_quote, 'single': under_quote,
        }

        page.goto(f'http://localhost:{server.server_port}/tracker.html')
        page.wait_for_function("typeof WATCHLIST_TABLE !== 'undefined' && WATCHLIST_TABLE !== null")
        setup_profile(profile)
        page.evaluate('''() => {
            BETS = structuredClone(CURR_USER.metadata.bets);
            ALL_ROWS = [{player:'test player',sport:'mlb',team:'bal',prop:'hr',
                game:'bal @ kc',handicap:1.5,under:true,line:-180,book:'dk',bookOdds:{dk:'+160/-180'}}];
            refreshWatchlist();
        }''')
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 2")
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'hr')._watchlistQuote") == hr_quote
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'single')._watchlistQuote") == under_quote
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'hr').line") == 500
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'hr').handicap") == 0.5
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'single').line") == -130

        # Opening either action never creates a bet; the saved quote fills Add Bet automatically.
        page.evaluate("openAddBet(WATCHLIST_TABLE.getData().find(row => row.prop === 'single'))")
        assert page.locator('#abt-manual-book').input_value() == 'fd'
        assert page.locator('#abt-manual-odds').input_value() == '-130'
        assert page.locator('#abt-line').input_value() == '1.5'
        assert page.locator('#abt-side').input_value() == 'under'
        assert page.evaluate('CURR_USER.metadata.bets') == [original_bet]
        assert page.evaluate('BETS') == [original_bet]
        assert page.evaluate('savedProfiles.length') == 0
        page.evaluate('closeAddBet()')

        # Editing watchlist prices changes the snapshot only, and survives navigation without live odds.
        page.evaluate("openWatchlistEdit(WATCHLIST_TABLE.getData().find(row => row.prop === 'single'))")
        assert page.locator('#abt-manual-odds').input_value() == '-130'
        page.locator('#abt-manual-odds').fill('50')
        page.locator('#add-bet-modal').get_by_role('button', name='Save Watchlist', exact=True).click()
        assert page.locator('#abt-error').is_visible()
        assert page.evaluate("CURR_USER.metadata.watchlist.find(entry => entry.prop === 'single').quote") == under_quote
        assert page.evaluate('savedProfiles.length') == 0
        page.locator('#abt-manual-book').select_option('dk')
        page.locator('#abt-manual-odds').fill('145')
        page.locator('#abt-line').fill('2.5')
        page.locator('#abt-side').select_option('over')
        page.evaluate('window.failProfileSave = true')
        page.locator('#add-bet-modal').get_by_role('button', name='Save Watchlist', exact=True).click()
        page.wait_for_function("!document.getElementById('add-bet-save').disabled && !document.getElementById('abt-error').hidden")
        assert page.evaluate("CURR_USER.metadata.watchlist.find(entry => entry.prop === 'single').quote") == under_quote
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'single')._watchlistQuote") == under_quote
        assert page.evaluate('savedProfiles.length') == 0
        page.evaluate('window.failProfileSave = false')
        page.locator('#add-bet-modal').get_by_role('button', name='Save Watchlist', exact=True).click()
        page.wait_for_function("!document.getElementById('add-bet-backdrop').classList.contains('open')")
        edited_quote = {'book': 'dk', 'odds': 145, 'handicap': 2.5, 'under': False, 'game': 'bal @ kc'}
        assert page.evaluate("CURR_USER.metadata.watchlist.find(entry => entry.prop === 'single').quote") == edited_quote
        assert page.evaluate('CURR_USER.metadata.bets') == [original_bet]
        assert page.evaluate('BETS') == [original_bet]
        assert page.evaluate("savedProfiles.at(-1).watchlist.find(entry => entry.prop === 'single').quote") == edited_quote
        profile = page.evaluate('CURR_USER')
        page.reload()
        page.wait_for_function("typeof WATCHLIST_TABLE !== 'undefined' && WATCHLIST_TABLE !== null")
        setup_profile(profile)
        page.evaluate('ALL_ROWS=[]; refreshWatchlist()')
        page.wait_for_function("WATCHLIST_TABLE.getData().length === 2")
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'single')._watchlistQuote") == edited_quote
        assert page.evaluate("WATCHLIST_TABLE.getData().find(row => row.prop === 'hr')._watchlistQuote") == hr_quote

        # An existing wager takes precedence over both the favorite snapshot and new live odds.
        matching_bet = {'player': 'test player', 'sport': 'mlb', 'page': 'mlb', 'prop': 'hr',
                        'book': 'fd', 'odds': 650, 'handicap': 0.5, 'under': False, 'game': 'bal @ kc'}
        page.evaluate('''bets => {
            BETS = structuredClone(bets); CURR_USER.metadata.bets = structuredClone(bets);
            ALL_ROWS = [{player:'test player',sport:'mlb',team:'bal',prop:'hr',
                game:'bal @ kc',handicap:0.5,under:false,line:700,book:'dk',bookOdds:{fd:'+550/-700',dk:'+700/-850'}}];
            refreshWatchlist();
        }''', [original_bet, matching_bet])
        hr_row = page.locator('#watchlist-table .tabulator-row').filter(
            has=page.locator('[tabulator-field="prop"]', has_text='HR'))
        hr_row.locator('.wl-add-bet').click()
        assert page.locator('#abt-manual-odds').input_value() == '650'
        assert page.locator('#abt-manual-book').input_value() == 'fd'
        assert page.locator('#abt-line').input_value() == '0.5'
        assert page.evaluate('BETS') == [original_bet, matching_bet]
        assert page.evaluate('savedProfiles.length') == 0
        page.evaluate('closeAddBet()')

        # Saving + Bet for a prop absent from live rows persists the complete saved quote.
        single_row = page.locator('#watchlist-table .tabulator-row').filter(
            has=page.locator('[tabulator-field="prop"]', has_text='1B'))
        single_row.locator('.wl-add-bet').click()
        assert page.locator('#abt-manual-odds').input_value() == '145'
        assert page.locator('#abt-manual-book').input_value() == 'dk'
        assert page.locator('#abt-line').input_value() == '2.5'
        page.locator('#add-bet-modal').get_by_role('button', name='Save Bet', exact=True).click()
        page.wait_for_function("!document.getElementById('add-bet-backdrop').classList.contains('open')")
        added_bet = page.evaluate("BETS.find(bet => bet.player === 'test player' && bet.prop === 'single')")
        assert all(added_bet[key] == value for key, value in edited_quote.items())
        assert added_bet['sport'] == 'mlb' and added_bet['page'] == 'mlb'
        assert len(page.evaluate('BETS')) == 3
        assert page.evaluate('CURR_USER.metadata.bets') == page.evaluate('BETS')
        page.wait_for_function("Array.from(document.querySelectorAll('#watchlist-table .wl-edit img')).every(img => img.complete && img.naturalWidth > 0)")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'watchlist-saved-quotes-desktop.png'))
        single_row.locator('.wl-add-bet').click()
        assert page.locator('#abt-manual-odds').input_value() == '145'
        assert page.locator('#abt-line').input_value() == '2.5'
        page.evaluate('closeAddBet()')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate("openWatchlistEdit(WATCHLIST_TABLE.getData().find(row => row.prop === 'single'))")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'watchlist-saved-quote-editor-mobile.png'))
        assert not errors, errors
        print('Quote capture, over/under snapshots, manual edits, unmatched/live refresh, bet isolation, table/card stars and prop/page removal passed.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
