"""Tracker fetches saved markets across sports after a profile arrives."""
from copy import deepcopy
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TODAY = datetime.now(timezone.utc).date().isoformat()


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def saved(player, sport, source, prop, line, game, under=False):
    return {
        'player': player, 'sport': sport, 'page': source, 'prop': prop, 'dt': TODAY,
        'quote': {'book': 'fd', 'odds': 225, 'handicap': line, 'under': under, 'game': game},
    }


watchlist = [
    saved('mlb hitter', 'mlb', 'dingers', 'hr', 0.5, 'bal @ kc'),
    saved('hockey skater', 'nhl', 'atgs', 'atgs', 0.5, 'wsh @ pit'),
    saved('hockey skater', 'nhl', 'nhl', 'sog', 2.5, 'wsh @ pit', True),
    saved('football passer', 'nfl', 'nfl', 'pass_yds', 249.5, 'kc @ bal'),
    saved('basketball scorer', 'nba', 'nba', 'pts', 25.5, 'bos @ ny'),
    saved('absent hockey player', 'nhl', 'nhl', 'sog', 3.5, 'ana @ col', True),
]
bets = [{**{key: value for key, value in entry.items() if key != 'quote'}, **entry['quote']}
        for entry in watchlist]
profile = {'id': 'fixture', 'metadata': {
    # NBA exists only in bets, so source discovery must inspect both collections.
    'watchlist': [entry for entry in watchlist if entry['sport'] != 'nba'], 'bets': bets,
}}


def live(entry, odds):
    # Actual page feeds frequently omit sport. The source page must supply it.
    return {'player': entry['player'], 'prop': entry['prop'], 'team': 'wsh',
            'game': entry['quote']['game'], 'handicap': entry['quote']['handicap'],
            'under': entry['quote']['under'], 'book': 'fd', 'line': odds,
            'bookOdds': {'fd': f'+{odds}/-180', 'pn': '+150/-175'}, 'ev': 10, 'fairVal': 160}


mlb_row = live(watchlist[0], 410)
atgs_row = live(watchlist[1], 320)
nhl_row = live(watchlist[2], 135)
atgs_row['bookOdds'].update({'kal': '+330/-190', 'px': '+340/-200', 'poly': '+350/-210'})
nhl_row['bookOdds'].update({'kal': '+140/-195', 'px': '+145/-205', 'poly': '+150/-215'})
nfl_row = live(watchlist[3], 120)
nba_row = live(watchlist[4], 115)
nhl_decoys = [
    {**nhl_row, 'prop': 'pts', 'bookOdds': {'fd': '+901/-901'}},
    {**nhl_row, 'handicap': 3.5, 'bookOdds': {'fd': '+902/-902'}},
    {**nhl_row, 'under': False, 'bookOdds': {'fd': '+903/-903'}},
    {**nhl_row, 'game': 'wsh @ bos', 'bookOdds': {'fd': '+904/-904'}},
]
feeds = {
    'tracker': {'data': [mlb_row], 'updated': {}},
    'dingers': {'data': [mlb_row], 'updated': {}},
    'atgs': {'data': [atgs_row], 'updated': {}},
    # Cover both arrays and dictionary-shaped API data.
    'nhl': {'data': {str(index): row for index, row in enumerate([*nhl_decoys, nhl_row])}, 'updated': {}},
    'nfl': {'data': [nfl_row], 'updated': {}},
    'nba': {'data': [nba_row], 'updated': {}},
}

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "watchlist-sports.log"}',
        ])
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        requests = []
        failing = set()
        page.on('pageerror', lambda error: errors.append(error.stack))
        page.add_init_script('window.EventSource = undefined;')
        page.route('https://**/*', lambda route: route.fulfill(
            body='window.supabase={createClient:()=>({rpc:async()=>({data:[]})})};'
                 if 'supabase-js' in route.request.url else '',
            content_type='application/javascript',
        ))
        page.route('**/auth.js', lambda route: route.fulfill(
            body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace(
                'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
            content_type='application/javascript',
        ))

        def api(route):
            source = urlsplit(route.request.url).path.rsplit('/', 1)[-1]
            requests.append((source, route.request.headers.get('authorization')))
            if source in failing:
                route.fulfill(status=503, json={'error': 'Fixture source unavailable'})
            else:
                route.fulfill(json=deepcopy(feeds.get(source, {'data': [], 'updated': {}})))

        page.route('**/api/**', api)
        page.goto(f'http://localhost:{server.server_port}/tracker.html')
        page.wait_for_function('WATCHLIST_TABLE !== null && trackerFetchPending === null')
        assert requests[0][0] == 'tracker'
        before_url = page.url
        requests.clear()
        page.evaluate('''profile => {
            ACCESS_TOKEN = 'multisport-token';
            CURR_SESSION = {user:{id:'fixture'}};
            CURR_USER = structuredClone(profile);
            window.savedProfiles = [];
            SB = {
                from:()=>({update:({metadata})=>({eq:async()=>{
                    savedProfiles.push(structuredClone(metadata)); return {error:null};
                }})}),
                rpc:async()=>({data:[]})
            };
            hydrateAfterProfileLoad();
        }''', profile)
        page.wait_for_function('''() => WATCHLIST_TABLE.getData().length === 5
            && WATCHLIST_TABLE.getData().filter(row => row.bookOdds).length === 4
            && trackerFetchPending === null''', timeout=8000)

        assert page.url == before_url, 'A late sign-in/profile must populate prices without navigating'
        sources = {source for source, _ in requests}
        assert {'atgs', 'nhl', 'nfl', 'nba'} <= sources, requests
        assert all(auth == 'Bearer multisport-token' for _, auth in requests), requests
        assert len([source for source, _ in requests if source == 'nhl']) == 1, requests
        expected_prices = {
            ('mlb', 'hr'): '+410/-180', ('nhl', 'atgs'): '+320/-180',
            ('nhl', 'sog'): '+135/-180', ('nfl', 'pass_yds'): '+120/-180',
            ('nba', 'pts'): '+115/-180',
        }
        rows = page.evaluate('WATCHLIST_TABLE.getData()')
        bet_rows = page.evaluate('TABLE.getData()')
        assert len(bet_rows) == len(bets)
        for table_rows in (rows, bet_rows):
            for row in table_rows:
                if row['player'] == 'absent hockey player':
                    assert not row.get('bookOdds'), row
                else:
                    assert row['bookOdds']['fd'] == expected_prices[(row['sport'], row['prop'])], row
        for row in rows:
            entry = next(entry for entry in watchlist
                         if entry['player'] == row['watchlistPlayer'] and entry['prop'] == row['prop'])
            assert row['_watchlistQuote'] == entry['quote'], row
            assert row['line'] == entry['quote']['odds'], row
        for table in ('WATCHLIST_TABLE', 'TABLE'):
            fields = page.evaluate(f'{table}.getColumns().map(column => column.getField())')
            for book in ('kal', 'px', 'poly'):
                field = f'bookOdds.{book}'
                assert field in fields, f'{table} must show returned {book} odds'
                assert page.evaluate('''({table, field}) => {
                    const target = table === 'TABLE' ? TABLE : WATCHLIST_TABLE;
                    const row = target.getRows().find(row => row.getData().prop === 'atgs');
                    return row.getCell(field).getElement().textContent.trim();
                }''', {'table': table, 'field': field}), f'{table} rendered an empty {book} price'
        assert page.evaluate('CURR_USER.metadata') == profile['metadata']
        assert page.evaluate('savedProfiles') == [], 'Loading prices must not rewrite saved entries'
        print('Late profile, authenticated per-sport feeds, odds matching and saved quotes passed.')

        # One failed feed and one empty feed must leave every saved row in place;
        # independently successful sports must still receive their new prices.
        failing.add('nhl')
        feeds['nba'] = {'data': [], 'updated': {}}
        feeds['tracker']['data'][0]['bookOdds']['fd'] = '+450/-200'
        feeds['dingers']['data'][0]['bookOdds']['fd'] = '+450/-200'
        feeds['nfl']['data'][0]['bookOdds']['fd'] = '+130/-185'
        requests.clear()
        page.evaluate('fetchTrackerData()')
        page.wait_for_function('trackerFetchPending === null')
        rows = page.evaluate('WATCHLIST_TABLE.getData()')
        bet_rows = page.evaluate('TABLE.getData()')
        assert len(rows) == len(profile['metadata']['watchlist']) and len(bet_rows) == len(bets)
        for table_rows in (rows, bet_rows):
            assert next(row for row in table_rows if row['sport'] == 'mlb')['bookOdds']['fd'] == '+450/-200'
            assert next(row for row in table_rows if row['sport'] == 'nfl')['bookOdds']['fd'] == '+130/-185'
            assert next(row for row in table_rows if row['prop'] == 'atgs')['bookOdds']['fd'] == '+320/-180'
        assert page.evaluate('CURR_USER.metadata') == profile['metadata']
        assert page.evaluate('savedProfiles') == []
        print('Failed/empty feeds preserve saved rows and do not block other sports. Passed.')

        # A profile can arrive while the initial market request is still pending.
        # A newly saved sport must be fetched even if that earlier run used defaults.
        late_profile = deepcopy(profile)
        late_entry = saved('basketball guard', 'wnba', 'wnba', 'pts', 18.5, 'ny @ lv')
        late_profile['metadata']['bets'].append({
            **{key: value for key, value in late_entry.items() if key != 'quote'},
            **late_entry['quote'],
        })
        feeds['wnba'] = {'data': [live(late_entry, 125)], 'updated': {}}
        failing.clear()
        requests.clear()
        page.evaluate('''() => {
            CURR_USER = {id:'fixture', metadata:{watchlist:[], bets:[]}};
            BETS = [];
            const originalFetch = window.fetch;
            let held = false;
            window.resumeTracker = null;
            window.fetch = (url, options) => {
                if (!held && String(url).endsWith('/api/tracker')) {
                    held = true;
                    return new Promise(resolve => {
                        window.resumeTracker = () => resolve(originalFetch(url, options));
                    });
                }
                return originalFetch(url, options);
            };
            window.initialTrackerRun = fetchTrackerData();
        }''')
        page.wait_for_function("typeof resumeTracker === 'function'")
        page.evaluate('''profile => {
            CURR_USER = structuredClone(profile);
            hydrateAfterProfileLoad();
            resumeTracker();
        }''', late_profile)
        page.wait_for_function('''() => trackerFetchPending === null && TABLE.getData().length === 7
            && TABLE.getData().find(row => row.sport === 'wnba')?.bookOdds?.fd === '+125/-180' ''')
        assert 'wnba' in {source for source, _ in requests}, requests
        assert sum(source == 'tracker' for source, _ in requests) >= 2, requests
        assert page.evaluate('CURR_USER.metadata') == late_profile['metadata']
        assert not errors, errors
        print('Profile hydration during a pending request loads newly saved sports. Passed.')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
