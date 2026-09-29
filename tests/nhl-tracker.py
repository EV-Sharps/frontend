"""NHL tracker: hockey state, scorers, on-ice snapshots and responsive stats."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import sys
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc).isoformat()


def on_ice():
    return {
        'source': 'espn', 'game_id': '401803100', 'updated': NOW,
        'available': True, 'stale': False, 'reason': None,
        'period': 2, 'clock': '02:58', 'in_intermission': False,
        'away': {
            'forwards': [{'id': '97', 'name': 'Connor McDavid', 'number': '97', 'position': 'C'},
                         {'id': '29', 'name': 'Leon Draisaitl', 'number': '29', 'position': 'C'}],
            'defensemen': [{'id': '2', 'name': 'Evan Bouchard', 'number': '2', 'position': 'D'}],
            'goalies': [{'id': '74', 'name': 'Stuart Skinner', 'number': '74', 'position': 'G'}],
            'penalty_box': [{'id': '25', 'name': 'Darnell Nurse', 'number': '25', 'position': 'D'}],
        },
        'home': {
            'forwards': [{'id': '16', 'name': 'Aleksander Barkov', 'number': '16', 'position': 'C'}],
            'defensemen': [{'id': '42', 'name': 'Gustav Forsling', 'number': '42', 'position': 'D'}],
            'goalies': [{'id': '72', 'name': 'Sergei Bobrovsky', 'number': '72', 'position': 'G'}],
            'penalty_box': [],
        },
    }


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
        'on_ice': on_ice(),
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
        page.clock.install(time=datetime.fromisoformat(NOW))
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
        feed = {'mode': 'ok', 'successful': 0, 'held': []}

        def serve_snapshot(route):
            if feed['mode'] == 'fail':
                route.fulfill(status=503, body='Fixture feed unavailable')
            elif feed['mode'] == 'hold':
                feed['held'].append(route)
            else:
                feed['successful'] += 1
                route.fulfill(json=snapshot)

        page.route('**/api/nhl-tracker', serve_snapshot)
        page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport=nhl')
        expect(page.locator('.gt-game')).to_have_count(3)
        page.clock.pause_at(datetime.fromisoformat(NOW) + timedelta(seconds=5))
        page.clock.set_system_time(datetime.fromisoformat(NOW))
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('[data-league="nhl"]')).to_have_attribute('aria-current', 'page')
        expect(page.locator('#league-name')).to_have_text('NHL')
        expect(page.locator('#football-legend')).not_to_be_visible()
        expect(page.locator('.gt-field')).to_have_count(0)
        expect(page.locator('.gt-football')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="away"]')).to_contain_text('21 SOG')
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="away"]')).to_contain_text('POWER PLAY')
        live_card = page.locator('.gt-game[data-game-id="live"]')
        expect(live_card).to_have_class(re.compile(r'\bis-power-play\b'))
        expect(live_card.locator('.gt-power-play')).to_have_text('EDM PP')
        expect(live_card.locator('[data-team="away"] .gt-team-pp')).to_have_count(1)
        expect(live_card.locator('[data-team="home"] .gt-team-pp')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="live"] [data-team="home"]')).to_contain_text('EMPTY NET')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-situation')).to_contain_text('P2 / 7:10')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-last-play')).to_contain_text('P2 12:50 elapsed')
        expect(page.locator('.gt-game[data-game-id="pre"]')).to_contain_text('Puck drop')
        expect(page.locator('.gt-game[data-game-id="pre"]')).not_to_contain_text('SOG')
        expect(page.locator('.gt-game[data-game-id="final"] .gt-possession')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="final"] .gt-power-play')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="pre"] .gt-power-play')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="pre"] .gt-on-ice')).to_have_count(0)
        expect(page.locator('.gt-game[data-game-id="final"] .gt-on-ice')).to_have_count(0)
        ice = page.locator('.gt-game[data-game-id="live"] .gt-on-ice')
        expect(ice).to_have_count(1)
        expect(ice.locator('.gt-on-ice-status')).to_contain_text(
            'Latest reported · ESPN P2 / 02:58 · Fetched 0s ago')
        expect(ice).not_to_have_class(re.compile(r'\bis-stale\b'))
        for side in ('away', 'home'):
            team = ice.locator(f'[data-on-ice-team="{side}"]')
            expect(team).to_have_count(1)
            for group in ('forwards', 'defensemen', 'goalies'):
                row = team.locator(f'[data-on-ice-group="{group}"]')
                expect(row).to_have_count(1)
                for player in live['on_ice'][side][group]:
                    expect(row).to_contain_text(player['name'])
                    expect(row).to_contain_text(f'#{player["number"]}')
        away_ice = ice.locator('[data-on-ice-team="away"]')
        expect(away_ice.locator('.gt-on-ice-penalty')).to_contain_text('Darnell Nurse')
        expect(away_ice.locator('.gt-on-ice-penalty')).to_contain_text('#25')
        expect(away_ice.locator('[data-on-ice-group="defensemen"]')).not_to_contain_text('Darnell Nurse')
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
        expect(live_card.locator('.gt-power-play')).to_have_text('PP')
        live['situation'] = {'home_power_play': True, 'away_power_play': False}
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-power-play')).to_have_text('FLA PP')
        expect(live_card.locator('[data-team="home"] .gt-team-pp')).to_have_count(1)
        expect(live_card.locator('[data-team="away"] .gt-team-pp')).to_have_count(0)
        live['situation']['power_play_updated'] = (datetime.fromisoformat(NOW) - timedelta(seconds=46)).isoformat()
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-power-play')).to_have_count(0)
        expect(live_card).not_to_have_class(re.compile(r'\bis-power-play\b'))
        live['situation']['power_play_updated'] = NOW
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-power-play')).to_have_text('FLA PP')
        feed['mode'] = 'fail'
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-power-play')).to_have_count(0)
        feed['mode'] = 'ok'
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-power-play')).to_have_text('FLA PP')
        live['situation'] = {}
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('.gt-game[data-game-id="live"]')).not_to_contain_text('Power play')
        expect(live_card.locator('.gt-power-play')).to_have_count(0)
        expect(live_card).not_to_have_class(re.compile(r'\bis-power-play\b'))
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
        # A new report replaces each position group; penalty-box players stay separate.
        malicious_name = '<img src=x onerror="window.onIceInjected=true"> & Test Player'
        live['on_ice'].update(period=3, clock='11:22')
        live['on_ice']['away']['forwards'] = [
            {'id': '18', 'name': malicious_name, 'number': '18', 'position': 'LW'}]
        live['on_ice']['away']['defensemen'] = [
            {'id': '14', 'name': 'Mattias Ekholm', 'number': '14', 'position': 'D'}]
        live['on_ice']['away']['goalies'] = [
            {'id': '30', 'name': 'Calvin Pickard', 'number': '30', 'position': 'G'}]
        live['on_ice']['away']['penalty_box'] = [
            {'id': '90', 'name': 'Corey Perry', 'number': '90', 'position': 'RW'}]
        live['on_ice']['away']['forwards'].append(
            deepcopy(live['on_ice']['away']['penalty_box'][0]))
        live['on_ice']['home']['goalies'] = []
        page.evaluate('window.refreshNFLTracker()')
        expect(ice.locator('.gt-on-ice-status')).to_contain_text('ESPN P3 / 11:22')
        expect(page.locator('.gt-game[data-game-id="live"] .gt-situation')).to_contain_text('P2 / 7:10')
        for group, name, jersey in (
                ('forwards', malicious_name, '#18'),
                ('defensemen', 'Mattias Ekholm', '#14'),
                ('goalies', 'Calvin Pickard', '#30')):
            row = away_ice.locator(f'[data-on-ice-group="{group}"]')
            expect(row).to_contain_text(name)
            expect(row).to_contain_text(jersey)
        expect(away_ice).not_to_contain_text('Connor McDavid')
        expect(away_ice).not_to_contain_text('Evan Bouchard')
        expect(away_ice).not_to_contain_text('Stuart Skinner')
        expect(away_ice).not_to_contain_text('Darnell Nurse')
        expect(away_ice.locator('.gt-on-ice-penalty')).to_contain_text('Corey Perry')
        expect(away_ice.locator('.gt-on-ice-penalty')).to_contain_text('#90')
        expect(away_ice.locator('[data-on-ice-group="forwards"]')).not_to_contain_text('Corey Perry')
        expect(ice.locator('img, script')).to_have_count(0)
        assert page.evaluate('window.onIceInjected === undefined')
        expect(ice.locator('[data-on-ice-team="home"] [data-on-ice-group="goalies"]')).to_contain_text('Not reported')
        expect(ice).not_to_contain_text(re.compile('empty net', re.I))

        # Each stale cause preserves the last reported players and labels their age.
        def expect_stale():
            expect(ice).to_have_class(re.compile(r'\bis-stale\b'))
            expect(ice.locator('.gt-on-ice-status')).to_contain_text('Stale')
            expect(ice).to_contain_text('Mattias Ekholm')

        live['on_ice']['stale'] = True
        page.evaluate('window.refreshNFLTracker()')
        expect_stale()
        live['on_ice']['stale'] = False
        for timestamp in ((datetime.fromisoformat(NOW) - timedelta(seconds=46)).isoformat(),
                          None, 'invalid-timestamp'):
            live['on_ice']['updated'] = timestamp
            page.evaluate('window.refreshNFLTracker()')
            expect_stale()
            expect(ice.locator('.gt-on-ice-status')).not_to_contain_text('NaN')
        live['on_ice']['updated'] = NOW
        page.evaluate('window.refreshNFLTracker()')
        expect(ice).not_to_have_class(re.compile(r'\bis-stale\b'))
        feed['mode'] = 'fail'
        page.evaluate('window.refreshNFLTracker()')
        expect_stale()
        expect(page.locator('#connection')).to_contain_text('Updates interrupted')
        feed['mode'] = 'ok'
        page.evaluate('window.refreshNFLTracker()')
        expect(ice).not_to_have_class(re.compile(r'\bis-stale\b'))

        # Let only the freshness timer update while a poll has no response.
        feed['mode'] = 'hold'
        successful_before = feed['successful']
        page.clock.fast_forward(50_000)
        expect_stale()
        assert feed['successful'] == successful_before
        assert feed['held'], 'The timer-driven poll should be waiting for its response.'
        expect(page.locator('#connection')).not_to_contain_text('Updates interrupted')
        live['on_ice']['updated'] = page.evaluate('new Date().toISOString()')
        feed['mode'] = 'ok'
        for route in feed['held']:
            route.fulfill(json=snapshot)
        feed['held'].clear()
        expect(ice).not_to_have_class(re.compile(r'\bis-stale\b'))

        live['on_ice']['in_intermission'] = True
        page.evaluate('window.refreshNFLTracker()')
        expect(ice.locator('.gt-on-ice-status')).to_contain_text('Intermission · Last reported')
        expect(ice.locator('.gt-on-ice-status')).not_to_contain_text(re.compile(r'\b(live|current)\b', re.I))
        expect(ice).to_contain_text('Mattias Ekholm')
        live['on_ice']['in_intermission'] = False

        # Long names fit within both the section and the page at phone widths.
        live['on_ice']['away']['forwards'][0]['name'] = 'ExtraordinarilyLongUnbrokenPlayerSurname' * 4
        page.evaluate('window.refreshNFLTracker()')
        page.set_viewport_size({'width': 320, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert ice.evaluate('(e) => e.scrollWidth <= e.clientWidth')
        for team in ice.locator('.gt-on-ice-team').all():
            assert team.evaluate('(e) => e.scrollWidth <= e.clientWidth')
        page.set_viewport_size({'width': 390, 'height': 844})
        live['on_ice']['away']['forwards'][0]['name'] = 'Zach Hyman'
        page.evaluate('window.refreshNFLTracker()')
        page.locator('.gt-game[data-game-id="live"]').screenshot(
            path=str(Path(tempfile.gettempdir()) / 'nhl-tracker-onice-mobile.png'))

        live['on_ice']['available'] = False
        live['on_ice']['reason'] = 'incomplete_players'
        page.evaluate('window.refreshNFLTracker()')
        expect(ice.locator('.gt-on-ice-empty')).to_contain_text('On-ice data unavailable from ESPN.')
        expect(ice.locator('.gt-on-ice-team')).to_have_count(0)
        del live['on_ice']
        page.evaluate('window.refreshNFLTracker()')
        expect(ice.locator('.gt-on-ice-empty')).to_contain_text('On-ice data unavailable from ESPN.')
        expect(ice.locator('.gt-on-ice-team')).to_have_count(0)

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
        for sport in ('nfl', 'ncaaf'):
            other_snapshot = {'schema_version': 1, 'sport': sport, 'date': NOW[:10],
                              'updated': NOW, 'scoreboard_updated': NOW, 'data': [game()]}
            page.route(f'**/api/{sport}-tracker', lambda route, _request, data=other_snapshot: route.fulfill(json=data))
            page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport={sport}')
            expect(page.locator('.gt-game')).to_have_count(1)
            expect(page.locator('.gt-on-ice')).to_have_count(0)
            expect(page.locator('.gt-power-play')).to_have_count(0)
            expect(page.locator('.gt-game.is-power-play')).to_have_count(0)
        assert not errors, errors
        browser.close()
        print('NHL tracker: scores, shots, goals, on-ice groups, safe names, stale/recovery states, intermission, unavailable data, football isolation, stats and mobile checks passed.')
finally:
    server.shutdown()
    server.server_close()
