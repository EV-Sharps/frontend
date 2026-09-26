"""Exercise NFL/college touchdown and player-stat popouts with tracker snapshots."""
from copy import deepcopy
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc).isoformat()


def play(id, text, period=1, clock='12:00', team='away', kind='touchdown', **extra):
    return dict(id=id, text=text, period=period, clock=clock, team_id=team,
                scoring_type=kind, scoring_play=True, type='Pass Reception',
                away_score=7, home_score=0, **extra)


SCORES = [
    play('2', 'Home Runner 2-yard run (kick good)', clock='4:12', team='home'),
    play('1', 'Away Receiver 19-yard pass from Away Quarterback (kick good)', clock='11:26'),
    play('fg', 'Home kicker 42-yard field goal', kind='field-goal'),
    play('pat', 'Extra point after the touchdown', kind='extra-point'),
    play('two', 'Two-point conversion after touchdown', kind='two-point-conversion'),
    play('safety', 'Safety', kind='safety'),
    play('3', 'Away Defender 75-yard interception return', period=2, clock='3:10'),
    play('4', 'Away Returner 94-yard kickoff return', period=3, clock='14:48'),
    play('5', 'Home Punt Returner 60-yard punt return', period=4, clock='6:02', team='home'),
    play('6', 'Home Winner 1-yard touchdown run', period=5, clock='0:00', team='home'),
    play('void', 'Touchdown overturned; no play'),
]
SCORES[0].update(type='Rushing Touchdown', away_score=7, home_score=7)
SCORES[6].update(type='Interception Return Touchdown')
SCORES[7].update(type='Kickoff')
SCORES[8].update(type='Punt Return Touchdown')
SCORES[9].update(type='Rushing Touchdown')
SCORES[10]['scoring_play'] = False
SCORES.append(deepcopy(SCORES[1]))  # Same play in two feed entries is one touchdown.

PLAYERS = [
    {'id': 'qb', 'name': 'Away Quarterback', 'team_id': 'away', 'position': 'QB', 'jersey': '8',
     'categories': {'passing': {'C/ATT': '12/18', 'YDS': '145', 'AVG': '8.1', 'TD': '2', 'INT': '0'},
                    'rushing': {'CAR': '3', 'YDS': '-2', 'TD': '0', 'LONG': '3'}}},
    {'id': 'rb', 'name': 'Home Runner', 'team_id': 'home',
     'categories': {'rushing': {'CAR': '9', 'YDS': '56', 'TD': '1', 'LONG': '22'},
                    'receiving': {'REC': '0', 'YDS': '0', 'TD': '0', 'LONG': None}}},
    {'id': 'wr', 'name': 'Away Receiver', 'team_id': 'away',
     'categories': {'receiving': {'REC': '6', 'YDS': '80', 'TD': '1', 'LONG': '29', 'TGTS': '8'}}},
    {'id': 'def', 'name': 'Home Defender', 'team_id': 'home',
     'categories': {'defensive': {'TOT': '6', 'SOLO': '4', 'SACKS': '0.5', 'TD': '0'}}},
    {'id': 'kicker', 'name': 'Away Kicker', 'team_id': 'away',
     'categories': {'kicking': {'FG': '2/2', 'XP': '3/3', 'LONG': '45', 'PTS': '9'}}},
]


def game(id, state='in', details=True):
    return {'id': id, 'game': 'away @ home', 'start': NOW,
            'away': {'id': 'away', 'key': 'away', 'abbreviation': 'AWY', 'name': 'Away Team', 'score': 28},
            'home': {'id': 'home', 'key': 'home', 'abbreviation': 'HME', 'name': 'Home Team', 'score': 21},
            'status': {'state': state, 'name': 'STATUS_IN_PROGRESS', 'detail': '3:10 - 2nd Quarter'},
            'situation': {}, 'last_play': None,
            'details': {'scoring_plays': deepcopy(SCORES), 'plays': []} if details else None,
            'freshness': {'scoreboard_updated': NOW, 'summary_updated': NOW, 'summary_stale': False}}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "tracker-popout.log"}',
        ])
        for sport in ('nfl', 'ncaaf'):
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('https://**/*', lambda route: route.fulfill(
                body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}})};"
                if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
            snapshot = {'schema_version': 1, 'sport': sport, 'date': NOW[:10], 'updated': NOW,
                        'scoreboard_updated': NOW, 'summary_interval_seconds': 30,
                        'data': [game('live'), game('pre', 'pre', False), game('missing', details=False), game('empty', 'post')]}
            snapshot['data'][3]['details']['scoring_plays'] = []
            page.route(f'**/api/{sport}-tracker', lambda route: route.fulfill(json=snapshot))
            page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport={sport}')
            expect(page.locator('.gt-game')).to_have_count(4)
            dialog = page.locator('#touchdown-dialog')
            trigger = page.locator('[data-touchdowns="live"]')
            expect(trigger).to_contain_text('Touchdowns 6')
            trigger.click()
            expect(dialog).to_be_visible()
            expect(page.locator('#touchdown-close')).to_be_focused()
            items = page.locator('.gt-td-play')
            assert items.evaluate_all("rows => rows.map(row => row.dataset.playId)") == ['1', '2', '3', '4', '5', '6']
            assert 'Away Receiver' in items.first.inner_text()
            assert 'Q1 / 11:26' in items.first.inner_text()
            assert 'AWY 7' in items.first.inner_text()
            assert 'Interception return TD' in items.nth(2).inner_text()
            assert items.nth(2).locator('.gt-td-play-heading strong').inner_text().startswith('AWY')
            assert 'Kick return TD' in items.nth(3).inner_text()
            assert 'OT / 0:00' in items.last.inner_text()
            assert not page.locator('.gt-td-content').get_by_text('Extra point after the touchdown').count()

            # The popup stays open, maintains scroll/focus, and reflects additions/corrections.
            page.evaluate("document.getElementById('touchdown-content').scrollTop=60")
            scroll = page.locator('#touchdown-content').evaluate('(element) => element.scrollTop')
            snapshot['data'][0]['details']['scoring_plays'].append(play('7', 'New touchdown <img src=x onerror=alert(1)>', period=6, clock='0:00'))
            snapshot['data'][0]['freshness']['summary_stale'] = True
            page.evaluate('window.refreshNFLTracker()')
            expect(items).to_have_count(7)
            expect(dialog).to_be_visible()
            expect(page.locator('#touchdown-close')).to_be_focused()
            assert page.locator('#touchdown-content').evaluate('(element) => element.scrollTop') == scroll
            assert page.locator('[data-play-id="7"] img').count() == 0
            assert '<img' in page.locator('[data-play-id="7"]').inner_text()
            assert 'Scoring summary delayed' in page.locator('#touchdown-feed-status').inner_text()
            snapshot['data'][0]['details']['scoring_plays'] = [play for play in snapshot['data'][0]['details']['scoring_plays'] if play['id'] != '7']
            page.evaluate('window.refreshNFLTracker()')
            expect(items).to_have_count(6)
            page.keyboard.press('Escape')
            expect(dialog).not_to_be_visible()
            expect(trigger).to_be_focused()

            for id, message in [('pre', 'after kickoff'), ('missing', 'not available yet'), ('empty', 'No touchdowns reported')]:
                page.locator(f'[data-touchdowns="{id}"]').click()
                expect(dialog).to_be_visible()
                expect(page.locator('#touchdown-content')).to_contain_text(message)
                page.locator('#touchdown-close').click()

            # An explicit empty scoring list takes priority over obsolete play-by-play.
            snapshot['data'][3]['details']['plays'] = [play('old', 'Old overturned touchdown')]
            page.evaluate('window.refreshNFLTracker()')
            page.locator('[data-touchdowns="empty"]').click()
            expect(items).to_have_count(0)
            page.locator('#touchdown-close').click()
            del snapshot['data'][3]['details']['scoring_plays']
            snapshot['data'][3]['details']['plays'] = [play('fallback', 'Fallback touchdown', kind=None, score_value=6)]
            page.evaluate('window.refreshNFLTracker()')
            page.locator('[data-touchdowns="empty"]').click()
            expect(items).to_have_count(1)
            page.mouse.click(2, 2)
            expect(dialog).not_to_be_visible()

            page.set_viewport_size({'width': 390, 'height': 844})
            trigger.click()
            expect(dialog).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert dialog.evaluate('(element) => element.scrollWidth <= element.clientWidth')
            page.screenshot(path=str(Path(tempfile.gettempdir()) / f'{sport}-touchdowns-mobile.png'), full_page=True)
            snapshot['data'] = [row for row in snapshot['data'] if row['id'] != 'live']
            page.evaluate('window.refreshNFLTracker()')
            expect(dialog).not_to_be_visible()
            page.wait_for_function("!document.documentElement.classList.contains('gt-dialog-open')")

            # All scorers includes hidden games and keeps identical play IDs from different games.
            snapshot['data'] = [game('live'), game('final', 'post'), game('missing', details=False), game('pre', 'pre', False)]
            other = snapshot['data'][1]
            other['away']['abbreviation'] = 'VIS'
            other['home']['abbreviation'] = 'HOST'
            other['details']['scoring_plays'] = [play('1', 'Other Game Receiver 10-yard touchdown catch')]
            page.evaluate('window.refreshNFLTracker()')
            page.locator('[data-filter="in"]').click()
            expect(page.locator('.gt-game:not([hidden])')).to_have_count(2)
            all_scorers = page.locator('#all-scorers')
            all_scorers.click()
            expect(dialog).to_be_visible()
            expect(page.locator('#touchdown-title')).to_have_text('All scorers')
            expect(page.locator('#touchdown-close')).to_be_focused()
            groups = page.locator('.gt-td-group')
            expect(groups).to_have_count(2)
            expect(items).to_have_count(7)
            expect(page.locator('[data-play-id="1"]')).to_have_count(2)
            expect(page.locator('[data-scoring-game="final"]')).to_contain_text('VIS at HOST')
            expect(page.locator('[data-scoring-game="final"]')).to_contain_text('Other Game Receiver')
            expect(page.locator('#touchdown-game-status')).to_contain_text('7 touchdowns reported in 2 games')
            expect(page.locator('#touchdown-feed-status')).to_contain_text('Waiting for scoring details from 1 game.')
            page.evaluate("document.getElementById('touchdown-content').scrollTop=70")
            scroll = page.locator('#touchdown-content').evaluate('(element) => element.scrollTop')
            other['details']['scoring_plays'].append(play('2', 'Another Scorer touchdown', period=3))
            snapshot['data'][0]['freshness']['summary_stale'] = True
            page.evaluate('window.refreshNFLTracker()')
            expect(items).to_have_count(8)
            expect(page.locator('#touchdown-close')).to_be_focused()
            assert page.locator('#touchdown-content').evaluate('(element) => element.scrollTop') == scroll
            expect(page.locator('#touchdown-feed-status')).to_contain_text('1 game summary is delayed.')
            other['details']['scoring_plays'] = []
            page.evaluate('window.refreshNFLTracker()')
            expect(groups).to_have_count(1)
            expect(items).to_have_count(6)
            expect(dialog).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert dialog.evaluate('(element) => element.scrollWidth <= element.clientWidth')
            page.screenshot(path=str(Path(tempfile.gettempdir()) / f'{sport}-all-scorers-mobile.png'), full_page=True)

            # Empty slates, pregame, and no scores stay open and recover on the next feed.
            snapshot['data'] = []
            page.evaluate('window.refreshNFLTracker()')
            expect(dialog).to_be_visible()
            expect(groups).to_have_count(0)
            expect(page.locator('#touchdown-content')).to_contain_text('No games scheduled')
            snapshot['data'] = [game('pre', 'pre', False)]
            page.evaluate('window.refreshNFLTracker()')
            expect(page.locator('#touchdown-content')).to_contain_text('after kickoff')
            snapshot['data'] = [other]
            page.evaluate('window.refreshNFLTracker()')
            expect(page.locator('#touchdown-content')).to_contain_text('No touchdowns reported yet')
            other['details']['scoring_plays'] = [play('new', 'Newly reported scorer')]
            page.evaluate('window.refreshNFLTracker()')
            expect(items).to_have_count(1)
            expect(page.locator('#touchdown-game-status')).to_contain_text('1 touchdown reported in 1 game')
            page.keyboard.press('Escape')
            expect(dialog).not_to_be_visible()
            expect(all_scorers).to_be_focused()
            page.wait_for_function("!document.documentElement.classList.contains('gt-dialog-open')")

            # Player box scores include every game and preserve the feed's labeled values.
            page.set_viewport_size({'width': 1440, 'height': 1000})
            snapshot['data'] = [game('live'), game('final', 'post'), game('missing', details=False), game('pre', 'pre', False)]
            snapshot['data'][0]['details']['players'] = deepcopy(PLAYERS)
            snapshot['data'][1]['details']['players'] = [deepcopy(PLAYERS[0])]
            snapshot['data'][1]['details']['players'][0]['name'] = 'Final Game Quarterback'
            page.evaluate('window.refreshNFLTracker()')
            stats_trigger = page.locator('#all-stats')
            stats_dialog = page.locator('#stats-dialog')
            stats_trigger.click()
            expect(stats_dialog).to_be_visible()
            expect(page.locator('#stats-close')).to_be_focused()
            expect(page.locator('.gt-stats-group')).to_have_count(2)
            expect(page.locator('#stats-slate-status')).to_contain_text('Stats available for 2 of 4 games')
            expect(page.locator('#stats-feed-status')).to_contain_text('Player stats pending for 1 game.')
            expect(page.locator('[data-stats-game="final"]')).to_contain_text('Final Game Quarterback')
            live_stats = page.locator('[data-stats-game="live"]')
            passing = live_stats.locator('.gt-stat-table').filter(has=page.locator('caption', has_text='Passing'))
            expect(passing.locator('tbody td')).to_have_text(['AWY', '12/18', '145', '8.1', '2', '0'])
            expect(passing.locator('.gt-stat-td')).to_have_text('2')
            receiving = live_stats.locator('.gt-stat-table').filter(has=page.locator('caption', has_text='Receiving'))
            expect(receiving.locator('[data-player-id="rb"] td')).to_have_text(['HME', '0', '0', '0', '-', '-'])
            expect(receiving.locator('[data-player-id="wr"] td')).to_have_text(['AWY', '6', '80', '1', '29', '8'])
            expect(live_stats.locator('caption', has_text='Defense')).to_have_count(1)
            expect(live_stats.locator('[data-player-id="def"]')).to_contain_text('0.5')
            expect(live_stats.locator('[data-player-id="kicker"]')).to_contain_text('2/2')
            page.screenshot(path=str(Path(tempfile.gettempdir()) / f'{sport}-all-stats-desktop.png'))

            page.locator('#stats-game').select_option('live')
            page.locator('#stats-category').select_option('receiving')
            expect(page.locator('.gt-stats-group')).to_have_count(1)
            expect(page.locator('.gt-stat-table')).to_have_count(1)
            page.locator('#stats-category').focus()
            snapshot['data'][0]['details']['players'][2]['categories']['receiving']['REC'] = '7'
            snapshot['data'][0]['details']['players'][2]['name'] = 'Receiver <img src=x onerror=alert(1)>'
            snapshot['data'][0]['freshness']['summary_stale'] = True
            page.evaluate('window.refreshNFLTracker()')
            expect(page.locator('#stats-game')).to_have_value('live')
            expect(page.locator('#stats-category')).to_have_value('receiving')
            expect(page.locator('#stats-category')).to_be_focused()
            expect(receiving.locator('[data-player-id="wr"] td').nth(1)).to_have_text('7')
            assert receiving.locator('[data-player-id="wr"] img').count() == 0
            expect(page.locator('#stats-feed-status')).to_contain_text('1 game summary is delayed.')

            # Mobile tables scroll sideways; polling keeps both scroll positions and focus.
            page.locator('#stats-category').select_option('')
            page.set_viewport_size({'width': 390, 'height': 844})
            table_wrap = page.locator('.gt-stat-table-wrap').first
            table_wrap.focus()
            table_wrap.evaluate('(element) => element.scrollLeft=65')
            horizontal = table_wrap.evaluate('(element) => element.scrollLeft')
            assert horizontal > 0
            page.locator('#stats-content').evaluate('(element) => element.scrollTop=55')
            snapshot['data'][0]['details']['players'][0]['categories']['passing']['TD'] = '3'
            page.evaluate('window.refreshNFLTracker()')
            expect(passing.locator('.gt-stat-td')).to_have_text('3')
            assert table_wrap.evaluate('(element) => element.scrollLeft') == horizontal
            assert page.locator('#stats-content').evaluate('(element) => element.scrollTop') == 55
            expect(table_wrap).to_be_focused()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert stats_dialog.evaluate('(element) => element.scrollWidth <= element.clientWidth')
            page.locator('#stats-content').evaluate('(element) => element.scrollTop=0')
            table_wrap.evaluate('(element) => element.scrollLeft=0')
            page.screenshot(path=str(Path(tempfile.gettempdir()) / f'{sport}-all-stats-mobile.png'))

            page.locator('#stats-game').select_option('pre')
            expect(page.locator('#stats-content')).to_contain_text('after kickoff')
            page.locator('#stats-game').select_option('missing')
            expect(page.locator('#stats-content')).to_contain_text('No player stats reported yet')
            snapshot['data'] = []
            page.evaluate('window.refreshNFLTracker()')
            expect(stats_dialog).to_be_visible()
            expect(page.locator('#stats-game')).to_have_value('')
            expect(page.locator('#stats-content')).to_contain_text('No games scheduled')
            page.keyboard.press('Escape')
            expect(stats_dialog).not_to_be_visible()
            expect(stats_trigger).to_be_focused()
            page.wait_for_function("!document.documentElement.classList.contains('gt-dialog-open')")
            stats_trigger.click()
            page.mouse.click(2, 2)
            expect(stats_dialog).not_to_be_visible()
            expect(stats_trigger).to_be_focused()
            assert not errors, errors
            page.close()
        browser.close()
        print('NFL/college touchdown and all-stats popouts: labeled stats, live updates, filters, scroll/focus, empty states, escaping and mobile checks passed.')
finally:
    server.shutdown()
    server.server_close()
