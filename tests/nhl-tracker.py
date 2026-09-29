"""NHL tracker: hockey state, scorers, elapsed play clocks and responsive stats."""
from copy import deepcopy
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import sys
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc).isoformat()


def goal(id, clock, period=1, **extra):
    return dict(id=id, text=f'Player {id} scores a goal', period=period, clock=clock,
                clock_type='elapsed', type='Goal', scoring_type='goal', scoring_play=True,
                team_id='away', away_score=1, home_score=0, **extra)


def game(id='live', state='in'):
    return {
        'id': id, 'game': 'edm @ fla', 'start': NOW,
        'away': {'id': 'away', 'key': 'edm', 'abbreviation': 'EDM', 'name': 'Edmonton Oilers',
                 'score': 2, 'shots_on_goal': 21, 'shots_source': 'summary'},
        'home': {'id': 'home', 'key': 'fla', 'abbreviation': 'FLA', 'name': 'Florida Panthers',
                 'score': 1, 'shots_on_goal': 17, 'shots_source': 'scoreboard'},
        'status': {'state': state, 'name': 'STATUS_IN_PROGRESS', 'detail': '7:10 - 2nd Period',
                   'clock': '7:10', 'period': 2},
        'situation': {'away_power_play': True, 'home_goalie_pulled': True},
        'last_play': goal('latest', '12:50', 2),
        'freshness': {'scoreboard_updated': NOW, 'summary_updated': NOW, 'summary_stale': False},
        'details': {'scoring_plays': [goal('second', '15:01'), goal('first', '4:36'),
                                     goal('ot', '1:32', 4)], 'plays': [],
                    'players': [
                        {'id': 'player', 'name': 'Connor McDavid', 'team_id': 'away', 'position': 'C',
                         'categories': {'forwards': {'G': '1', 'A': '2', 'S': '4', 'SOG': '0', 'TOI': '23:01'}}},
                        {'id': 'goalie', 'name': 'Sergei Bobrovsky', 'team_id': 'home', 'position': 'G',
                         'categories': {'goalies': {'SV': '19', 'SV%': '.905', 'GA': '2'}}},
                    ]},
    }


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "nhl-tracker.log"}',
        ])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.fulfill(
            body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}})};"
            if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
        live = game()
        disallowed = goal('shootout', '0:00', 5)
        disallowed.update(type='Shootout Goal', period_type='Shootout')
        overturned = goal('overturned', '2:00')
        overturned['scoring_play'] = False
        live['details']['scoring_plays'] += [disallowed, overturned, deepcopy(live['details']['scoring_plays'][0])]
        pending = game('pre', 'pre')
        pending.update(details=None, last_play=None, situation={})
        final = game('final', 'post')
        final['details']['scoring_plays'] = []
        snapshot = {'schema_version': 1, 'sport': 'nhl', 'date': NOW[:10], 'updated': NOW,
                    'scoreboard_updated': NOW, 'summary_interval_seconds': 30,
                    'data': [live, pending, final]}
        page.route('**/api/nhl-tracker', lambda route: route.fulfill(json=snapshot))
        page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport=nhl')
        expect(page.locator('.gt-game')).to_have_count(3)
        expect(page.locator('[data-league="nhl"]')).to_have_attribute('aria-current', 'page')
        expect(page.locator('#league-name')).to_have_text('NHL')
        expect(page.locator('#football-legend')).not_to_be_visible()
        expect(page.locator('.gt-field')).to_have_count(0)
        expect(page.locator('.gt-football')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="away"]')).to_contain_text('21 SOG')
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="away"]')).to_contain_text('POWER PLAY')
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="home"]')).to_contain_text('EMPTY NET')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-situation')).to_contain_text('P2 / 7:10')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-last-play')).to_contain_text('P2 12:50 elapsed')
        expect(page.locator('.gt-game[data-game-id="pre"]')).to_contain_text('Puck drop')
        expect(page.locator('.gt-game[data-game-id="pre"]')).not_to_contain_text('SOG')
        expect(page.locator('.gt-game[data-game-id="final"] .gt-possession')).to_have_count(0)
        expect(page.locator('[data-touchdowns="live"]')).to_contain_text('Goals 3')
        page.locator('[data-touchdowns="live"]').click()
        expect(page.locator('#scoring-label')).to_have_text('GOALS')
        expect(page.locator('.gt-td-play')).to_have_count(3)
        assert page.locator('.gt-td-play').evaluate_all('rows => rows.map(row => row.dataset.playId)') == ['first', 'second', 'ot']
        expect(page.locator('.gt-td-play').first).to_contain_text('P1 / 4:36 elapsed')
        expect(page.locator('.gt-td-play').last).to_contain_text('OT / 1:32 elapsed')
        live['details']['scoring_plays'].append(goal('new', '5:00', 4))
        live['freshness']['summary_stale'] = True
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('.gt-td-play')).to_have_count(4)
        expect(page.locator('#touchdown-feed-status')).to_contain_text('Scoring summary delayed')
        page.keyboard.press('Escape')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-game-age')).to_contain_text('Details delayed')
        live['situation'] = {'power_play': True, 'empty_net': True}
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-situation')).to_contain_text('Power play / Empty net')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-possession')).to_have_count(0)
        live['situation'] = {}
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('.gt-game[data-game-id="live"]')).not_to_contain_text('Power play')
        page.locator('[data-stats="live"]').click()
        expect(page.locator('#stats-content')).to_contain_text('Connor McDavid')
        expect(page.locator('#stats-content')).to_contain_text('Sergei Bobrovsky')
        expect(page.locator('#stats-content')).to_contain_text('Goalies')
        expect(page.locator('#stats-content')).to_contain_text('23:01')
        expect(page.locator('#stats-content th').filter(has_text='SO Goals')).to_have_count(1)
        expect(page.locator('#stats-content th').filter(has_text='SOG')).to_have_count(1)
        expect(page.locator('#stats-content .gt-stat-td')).to_contain_text('1')
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('#stats-dialog').evaluate('(e) => e.scrollWidth <= e.clientWidth')
        page.keyboard.press('Escape')
        page.locator('#all-scorers').click()
        expect(page.locator('#touchdown-game-status')).to_contain_text('4 goals reported in 1 game')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nhl-tracker-goals-mobile.png'))
        page.keyboard.press('Escape')
        page.locator('[data-touchdowns="pre"]').click()
        expect(page.locator('#touchdown-content')).to_contain_text('after puck drop')
        page.keyboard.press('Escape')
        snapshot['data'] = []
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('#empty-state')).to_contain_text('No NHL games')
        if len(sys.argv) > 1:
            real = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
            real['updated'] = datetime.now(timezone.utc).isoformat()
            snapshot.update(real)
            page.evaluate('window.refreshNFLTracker()')
            expect(page.locator('.gt-game')).to_have_count(len(real['data']))
            first = real['data'][0]
            card = page.locator(f'.gt-game[data-game-id="{first["id"]}"]')
            for side in ('away', 'home'):
                expect(card.locator(f'[data-team="{side}"]')).to_contain_text(f'{first[side]["shots_on_goal"]} SOG')
            card.locator('[data-touchdowns]').click()
            expect(page.locator('.gt-td-play')).to_have_count(6)
            expect(page.locator('#touchdown-content')).to_contain_text('elapsed')
            page.keyboard.press('Escape')
            card.locator('[data-stats]').click()
            expect(page.locator('#stats-content')).to_contain_text('Connor McDavid')
            expect(page.locator('#stats-content')).to_contain_text('Sergei Bobrovsky')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        browser.close()
        print('NHL tracker: scores, shots, explicit PP/empty net, elapsed goals, shootout exclusion, live updates, stats and mobile checks passed.')
finally:
    server.shutdown()
    server.server_close()
