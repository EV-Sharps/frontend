"""Offline shared-card logs: --root FRONTEND --overlay STAGED_FRONTEND."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Thread
from time import monotonic
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--overlay', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--screenshots', type=Path)
args = parser.parse_args()


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def translate_path(self, path):
        relative = unquote(urlparse(path).path).lstrip('/')
        for directory in (args.overlay, args.root):
            target = (directory / relative).resolve()
            if target.is_relative_to(directory.resolve()) and target.is_file():
                return str(target)
        return str(args.root / '_missing')


def key(number):
    return f'{number:064x}'


def row(player, **changes):
    return dict(dict(player=player, prop='pts', dt='2099-10-23', sport='nba',
                     team='ny', opp='bos', game='ny @ bos', pos='PG', avgMin=30,
                     handicap=5, under=False, ouIdx=0, book='fd', line=150,
                     ev=10, fairVal=140, implied=40, kelly=.3,
                     bookOdds={'fd': '150/-175', 'pn': '130/-155', 'circa': '135/-160'},
                     liquidity={}, hitRates={}, logs=[0, 5, 10]), **changes)


def history(number, **changes):
    return dict(dict(key=key(number), playerId='42', prop='pts', before='2099-10-23', opp='bos',
                     careerLogs=[0, 5, 10, 15], bvtLogs=[0, 10], awayLogs=[20], homeLogs=[]), **changes)


class Scenario:
    def __init__(self, browser, server, name='nba', width=1440):
        self.page = browser.new_page(viewport={'width': width, 'height': 900})
        self.page.set_default_timeout(8000)
        self.name, self.width = name, width
        self.errors, self.calls, self.held = [], [], {}
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script("""window.EventSource=undefined;
          window.Plotly={newPlot:async(el,data,layout)=>{el.data=data;el.layout=layout;},
            purge:el=>{el.data=[];},Plots:{resize:()=>{}}};""")
        self.page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
        self.page.route('**/auth.js', lambda route: route.fulfill(
            body=(args.root / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
            content_type='application/javascript'))
        self.page.route(re.compile(r'/record(?:_[a-z]+)*\.js(?:\?.*)?$'), lambda route: route.fulfill(
            body="var RECORD_UPD=''; var RECORD={worst:{best:{}},mult:{best:{}}};", content_type='application/javascript'))
        self.page.route('**/api/**', self.api)
        self.page.goto(f'http://localhost:{server.server_port}/{name}.html?view=mobile&devig=pn-circa&weight=1-1&ou=ou')
        self.page.wait_for_function("document.getElementById('data-status')?.hidden === true")
        self.page.evaluate("ACCESS_TOKEN='card-fixture'")

    def api(self, route):
        url = urlparse(route.request.url)
        if url.path == '/api/nba-history':
            value = parse_qs(url.query)['key'][0]
            self.calls.append((value, route.request.headers.get('authorization')))
            self.held.setdefault(value, []).append(route)
        else:
            route.fulfill(json={'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}})

    def install(self, rows):
        self.page.evaluate("""async rows=>{
            RES=null; TABLE.clearFilter(true); TABLE.clearSort();
            window.cardFixtureRows=rows;
            await TABLE.setData(rows);
            initializeCards(rows); changeView('mobile');
        }""", rows)
        self.tag_cards()

    def tag_cards(self):
        self.page.evaluate("""document.querySelectorAll('#card-container .data-card').forEach(card=>{
            card.dataset.fixturePlayer=card.playerLinesData.player;
        })""")

    def card(self, player):
        return self.page.locator(f'#card-container .data-card[data-fixture-player={json.dumps(player)}]')

    def expand(self, player):
        card = self.card(player)
        if 'expanded' not in (card.get_attribute('class') or '').split():
            card.locator('.card-header').click(position={'x': 4, 'y': 4})
        self.page.wait_for_function("""player=>[...document.querySelectorAll('#card-container .data-card')]
            .find(card=>card.playerLinesData.player===player)?.classList.contains('expanded')""", arg=player)
        return self.card(player)

    def refresh(self, player, **changes):
        self.page.evaluate("""({player,changes})=>{
            cardFixtureRows=cardFixtureRows.map(row=>row.player===player?{...row,...changes}:row);
            renderCards(cardFixtureRows);
        }""", {'player': player, 'changes': changes})
        self.tag_cards()

    def request(self, number):
        deadline = monotonic() + 5
        while not self.held.get(key(number)) and monotonic() < deadline:
            self.page.wait_for_timeout(20)
        assert self.held.get(key(number)), (self.name, self.width, number, self.calls, self.errors)
        return self.held[key(number)].pop(0)

    def values(self, card, expected):
        locator = card.locator('.game-log-bar')
        deadline = monotonic() + 5
        actual = []
        while monotonic() < deadline:
            actual = locator.evaluate_all("els=>els.map(el=>Number(el.dataset.value))")
            if actual == expected:
                return
            self.page.wait_for_timeout(20)
        raise AssertionError((self.name, self.width, 'bar values', actual, expected, card.inner_text(), self.errors))

    def close(self):
        assert not self.errors, self.errors
        self.page.close()


def inline_checks(s):
    inline = row('inline zero', homeLogs=[], bvtLogs=[0, 5, 10], careerLogs=list(range(125)))
    s.install([inline, row('under player', under=True, ouIdx=1),
               row('empty player', logs=[]), row('no logs', logs=None),
               row('hidden player', blurred=True, historyKey=key(90), careerLogs=[987654])])
    assert not s.calls
    assert s.page.locator('.card-log-chart').count() == 0, 'Collapsed cards must not render charts'
    card = s.expand('inline zero')
    s.values(card, [0, 5, 10])
    assert card.locator('.game-log-bar.miss').get_attribute('data-value') == '0'
    assert card.locator('.game-log-bar.push').get_attribute('data-value') == '5'
    assert card.locator('.game-log-bar.hit').get_attribute('data-value') == '10'
    assert float(card.locator('.game-log-bar[data-value="0"]').get_attribute('height')) > 0
    summary = card.locator('.card-log-summary').inner_text()
    assert all(text in summary for text in ('Over 5', '33% (1/3)', 'Average', 'Median', 'Pushes')), summary
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
        card.screenshot(path=str(args.screenshots / f'card-game-logs-{s.width}.png'))
    assert card.locator('.card-log-view option[value="away"]').get_attribute('disabled') is not None
    assert card.locator('.card-log-view option[value="home"]').get_attribute('disabled') is None
    card.locator('.card-log-view').select_option('home')
    assert 'No home game logs' in card.locator('.card-log-empty').inner_text()
    assert card.locator('.card-log-summary').inner_text() == ''
    card.locator('.card-log-view').select_option('bvt')
    s.values(card, [0, 5, 10])
    assert 'BOS' in card.locator('.card-log-note').inner_text()
    card.locator('.card-log-view').select_option('career')
    card.locator('.card-log-range').select_option('10')
    s.values(card, list(range(115, 125)))
    card.locator('.card-log-range').select_option('20')
    s.values(card, list(range(105, 125)))
    card.locator('.card-log-range').select_option('all')
    s.values(card, list(range(25, 125)))
    assert 'summary: all 125' in card.locator('.card-log-note').inner_text()
    assert '(119/125)' in card.locator('.card-log-summary').inner_text()
    assert card.locator('.card-log-summary').inner_text().count('62') >= 2
    assert 'expanded' in card.get_attribute('class'), 'Changing controls must not collapse the card'

    # Repricing/rebuilding cards preserves split/range and recalculates using the new line.
    s.refresh('inline zero', line=175, handicap=100, ev=15)
    card = s.expand('inline zero')
    assert card.locator('.card-log-view').input_value() == 'career'
    assert card.locator('.card-log-range').input_value() == 'all'
    s.values(card, list(range(25, 125)))
    assert 'Over 100' in card.locator('.card-log-summary').inner_text()
    assert '(24/125)' in card.locator('.card-log-summary').inner_text()

    under = s.expand('under player')
    s.values(under, [0, 5, 10])
    assert under.locator('.game-log-bar.hit').get_attribute('data-value') == '0'
    assert under.locator('.game-log-bar.push').get_attribute('data-value') == '5'
    assert under.locator('.game-log-bar.miss').get_attribute('data-value') == '10'
    assert 'Under 5' in under.locator('.card-log-summary').inner_text()
    empty = s.expand('empty player')
    assert 'No recent game logs' in empty.locator('.card-log-empty').inner_text()
    assert empty.locator('.card-log-chart').count() == 0
    assert s.expand('no logs').locator('.card-game-logs').count() == 0
    hidden = s.expand('hidden player')
    assert hidden.locator('.card-game-logs').count() == 0
    assert '987654' not in hidden.inner_text()
    assert not s.calls, 'Inline, missing, empty and blurred histories must never fetch'

    # A main market and a first-basket row never expose the prop-history graph.
    s.page.evaluate("window.cardFixturePage=PAGE; PAGE='main'")
    s.install([row('main market', prop='total')])
    assert s.expand('main market').locator('.card-game-logs').count() == 0
    s.page.evaluate("PAGE=cardFixturePage")
    s.install([row('first basket', prop='fb'), row('other first basket', prop='1st pts')])
    for player in ('first basket', 'other first basket'):
        assert s.expand(player).locator('.card-game-logs').count() == 0


def lazy_checks(s):
    s.install([row('lazy alpha', playerId='42', historyKey=key(1))])
    card = s.expand('lazy alpha')
    s.values(card, [0, 5, 10])
    assert not s.calls, 'Expanding recent inline logs must not fetch long histories'
    card.locator('.card-log-view').select_option('career')
    card.locator('.card-log-range').select_option('all')
    pending = s.request(1)
    assert 'Loading player history' in card.locator('.card-log-empty').inner_text()
    assert card.locator('.card-log-summary').inner_text() == ''
    assert s.calls == [(key(1), 'Bearer card-fixture')]

    # The card modal and the older history modal share one in-flight history request.
    s.page.evaluate("showCardModal(cardFixtureRows[0])")
    modal = s.page.locator('#card-modal-inner .data-card')
    assert 'expanded' in modal.get_attribute('class')
    modal.locator('.card-log-view').select_option('career')
    s.page.evaluate("NbaHistory.open(cardFixtureRows[0])")
    history_dialog = s.page.locator('#nba-history-dialog')
    history_dialog.locator('[data-history-view="career"]').click()
    assert len(s.calls) == 1
    pending.fulfill(json=history(1))
    s.values(card, [0, 5, 10, 15])
    s.values(modal, [0, 5, 10, 15])
    s.page.wait_for_function("JSON.stringify(document.getElementById('nba-history-chart')?.data?.[0]?.y)==='[0,5,10,15]'")
    assert len(s.calls) == 1
    assert s.page.evaluate("""['careerLogs','bvtLogs','awayLogs','homeLogs'].every(field=>
        !Object.hasOwn(cardFixtureRows[0],field)&&!Object.hasOwn(TABLE.getData()[0],field))""")
    s.page.evaluate("NbaHistory.close(); document.getElementById('card-modal-overlay').classList.remove('open')")
    s.refresh('lazy alpha', line=190, ev=20)
    card = s.expand('lazy alpha')
    assert card.locator('.card-log-view').input_value() == 'career'
    assert card.locator('.card-log-range').input_value() == 'all'
    s.values(card, [0, 5, 10, 15])
    assert len(s.calls) == 1, 'A reprice must reuse the cached content key'

    # Responses to superseded/remounted cards cannot redraw a newer selected row.
    s.refresh('lazy alpha', historyKey=key(2))
    old = s.request(2)
    s.refresh('lazy alpha', historyKey=key(3), line=210)
    current = s.request(3)
    current.fulfill(json=history(3, careerLogs=[3, 3, 3]))
    card = s.expand('lazy alpha')
    s.values(card, [3, 3, 3])
    old.fulfill(json=history(2, careerLogs=[999]))
    s.page.wait_for_timeout(40)
    s.values(card, [3, 3, 3])
    s.refresh('lazy alpha', historyKey=key(4))
    removed = s.request(4)
    s.page.evaluate("renderCards([])")
    removed.fulfill(json=history(4, careerLogs=[444]))
    s.page.wait_for_timeout(40)
    assert s.page.locator('#card-container .data-card').count() == 0

    # Failed and expired keys report errors, retry, and never report zero games while pending.
    s.install([row('lazy retry', historyKey=key(5))])
    card = s.expand('lazy retry')
    card.locator('.card-log-view').select_option('home')
    failed = s.request(5)
    failed.fulfill(status=503, json={'error': 'unavailable'})
    card.locator('[data-card-log-retry]').wait_for()
    assert 'Unable to load player history' in card.locator('.card-log-empty').inner_text()
    assert card.locator('.card-log-summary').inner_text() == ''
    card.locator('.card-log-view').select_option('logs')
    s.values(card, [0, 5, 10])
    card.locator('.card-log-view').select_option('home')
    card.locator('[data-card-log-retry]').click()
    retry = s.request(5)
    assert 'Loading player history' in card.locator('.card-log-empty').inner_text()
    retry.fulfill(json=history(5))
    s.page.wait_for_function("document.querySelector('#card-container .card-log-empty')?.textContent.startsWith('No home game logs')")
    assert sum(value == key(5) for value, _ in s.calls) == 2
    s.refresh('lazy retry', historyKey=key(6))
    expired = s.request(6)
    expired.fulfill(status=404, json={'error': 'not_found'})
    card = s.expand('lazy retry')
    card.locator('[data-card-log-retry]').wait_for()
    assert 'Refresh the page' in card.locator('.card-log-empty').inner_text()
    assert card.locator('.card-log-summary').inner_text() == ''

    # An auth change invalidates pending work/cache even when the history key is the same.
    s.refresh('lazy retry', historyKey=key(7))
    prior_auth = s.request(7)
    s.page.evaluate("ACCESS_TOKEN='card-second-user'")
    s.refresh('lazy retry', line=225)
    next_auth = s.request(7)
    assert s.calls[-2:] == [(key(7), 'Bearer card-fixture'), (key(7), 'Bearer card-second-user')]
    prior_auth.fulfill(json=history(7, homeLogs=[777]))
    card = s.expand('lazy retry')
    s.page.wait_for_timeout(40)
    assert card.locator('.game-log-bar').count() == 0
    assert 'Loading player history' in card.locator('.card-log-empty').inner_text()
    next_auth.fulfill(json=history(7, homeLogs=[0, 7]))
    s.values(card, [0, 7])
    s.refresh('lazy retry', historyKey=key(8))
    hidden_response = s.request(8)
    s.refresh('lazy retry', blurred=True)
    hidden = s.expand('lazy retry')
    assert hidden.locator('.card-game-logs').count() == 0
    count = len(s.calls)
    hidden_response.fulfill(json=history(8, homeLogs=[987654]))
    s.page.wait_for_timeout(40)
    assert hidden.locator('.card-game-logs').count() == 0
    assert '987654' not in hidden.inner_text()
    assert len(s.calls) == count


def narrow_and_sport_checks(s, sport='nba', prop='pts'):
    game = {'nba': 'ny @ bos', 'nhl': 'nyr @ bos', 'nfl': 'buf @ mia'}[sport]
    team, opp = game.split(' @ ')
    s.install([row('mobile history', sport=sport, prop=prop, team=team, opp=opp, game=game,
                   logs=list(range(25)), bvtLogs=[0, 1, 2], handicap=1)])
    card = s.expand('mobile history')
    card.locator('.card-log-range').select_option('all')
    s.values(card, list(range(25)))
    assert not s.calls
    result = card.locator('.card-game-logs').evaluate("""host=>{
        const parent=host.closest('.data-card').getBoundingClientRect(), bounds=host.getBoundingClientRect();
        const scroll=host.querySelector('.card-log-scroll');
        return {left:bounds.left,right:bounds.right,parentLeft:parent.left,parentRight:parent.right,
            width:innerWidth,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,
            controls:[...host.querySelectorAll('select')].map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))};
    }""")
    assert result['left'] >= result['parentLeft'] - 1, result
    assert result['right'] <= min(result['parentRight'], result['width']) + 1, result
    assert all(control['left'] >= result['left'] - 1 and control['right'] <= result['right'] + 1
               for control in result['controls']), result
    assert result['scrollWidth'] > result['clientWidth'], 'Long SVG charts should scroll inside their host'
    card.locator('.card-log-view').select_option('bvt')
    s.values(card, [0, 1, 2])
    assert card.locator('.game-log-bar.push').get_attribute('data-value') == '1'
    assert not s.calls, f'{sport} inline histories must not request NBA history'


server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width in (1440, 320):
            scenario = Scenario(browser, server, width=width)
            inline_checks(scenario)
            lazy_checks(scenario)
            scenario.close()
            print(f'NBA {width}px: inline outcomes, ranges, lazy dedup, refresh/removal/auth, retry and privacy passed', flush=True)
        for name, sport, prop in (('nba', 'nba', 'pts'), ('nhl', 'nhl', 'sog'), ('tds', 'nfl', 'attd')):
            scenario = Scenario(browser, server, name=name, width=320)
            narrow_and_sport_checks(scenario, sport, prop)
            scenario.close()
            print(f'{name} 320px: inline chart, zero/push and contained horizontal scrolling passed', flush=True)
        browser.close()
finally:
    server.shutdown()
    server.server_close()
