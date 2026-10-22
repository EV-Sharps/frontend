"""NBA tracker and KOTC: actual whole-slate PRA, freshness, accessibility and mobile."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = '2026-10-22T00:30:00+00:00'  # Oct 21 in Eastern time, intentionally not UTC date.
SLATE = '2026-10-21'


def player(id, name, pts, reb, ast, **extra):
    return dict(id=id, name=name, team='bos', team_id='away', position='G', jersey='0',
                stats={'pts': pts, 'reb': reb, 'ast': ast, 'pra': 999},
                categories={'basketball': {'MIN': '22', 'FG': '7-12', '3PT': '2-5',
                                          'FT': '4-4', 'REB': str(reb), 'AST': str(ast),
                                          'PTS': str(pts), '+/-': '+8'}}, **extra)


def game(id='live', state='in'):
    return {
        'id': id, 'game': 'bos @ ny', 'date': SLATE, 'start': '2026-10-21T23:00:00+00:00',
        'away': {'id': 'away', 'key': 'bos', 'abbreviation': 'BOS', 'name': 'Boston Celtics', 'score': 75},
        'home': {'id': 'home', 'key': 'ny', 'abbreviation': 'NY', 'name': 'New York Knicks', 'score': 70},
        'status': {'state': state, 'name': 'STATUS_IN_PROGRESS', 'detail': '7:10 - 3rd Quarter',
                   'clock': '7:10', 'period': 3},
        'situation': {'possession_team_id': 'away', 'down': 1, 'distance': 10, 'red_zone': True},
        'last_play': {'id': 'shot', 'text': 'Alpha Guard makes a three-point jumper',
                      'period': 3, 'clock': '7:12', 'clock_type': 'remaining'},
        'freshness': {'scoreboard_updated': NOW, 'summary_updated': NOW, 'summary_stale': False},
        'details': {'scoring_plays': [], 'players': []},
    }


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "nba-tracker.log"}',
        ])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.clock.install(time=datetime.fromisoformat(NOW))
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.fulfill(
            body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}})};"
            if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
        live = game()
        alpha = player('alpha', 'Alpha Guard', 20, 5, 5)
        live['details']['players'] = [alpha, player('third', 'Gamma Center', 10, 5, 2),
                                      player('zero', 'Zero Starter', 0, 0, 0),
                                      player('missing', 'Missing Rebounds', 5, None, 0),
                                      player('dnp', 'DNP Player', 100, 100, 100, did_not_play=True,
                                             did_not_play_reason='Coach decision')]
        final = game('final', 'post')
        final.pop('date')  # UTC Oct 22 still belongs to Eastern Oct 21.
        final['start'] = '2026-10-22T00:10:00+00:00'
        final['status'].update(name='STATUS_FINAL', detail='Final', clock='0:00', period=4)
        beta = player('beta', 'Beta Forward', 15, 10, 5)
        final['details']['players'] = [beta]
        upcoming = game('upcoming', 'pre')
        upcoming['details']['players'] = [player('prezero', 'Pregame Placeholder', 0, 0, 0)]
        upcoming['status'].update(name='STATUS_SCHEDULED', detail='Scheduled', clock='0:00', period=0)
        upcoming['last_play'] = None
        missing = game('missing-box')
        missing['home'].update(key='chi', abbreviation='CHI', name='Chicago Bulls')
        missing['details'] = None
        carryover = game('prior-day')
        carryover.update(date='2026-10-20', start='2026-10-21T00:00:00+00:00')
        carryover['details']['players'] = [player('old', 'Yesterday Leader', 90, 90, 90)]
        snapshot = {'schema_version': 1, 'sport': 'nba', 'date': SLATE, 'updated': NOW,
                    'scoreboard_updated': NOW, 'summary_interval_seconds': 30,
                    'data': [live, final, upcoming, missing, carryover]}
        feed = {'mode': 'ok', 'successful': 0, 'held': []}

        def serve_snapshot(route):
            if feed['mode'] == 'fail':
                route.fulfill(status=503, body='Fixture feed unavailable')
            elif feed['mode'] == 'hold':
                feed['held'].append(route)
            else:
                feed['successful'] += 1
                route.fulfill(json=snapshot)

        page.route('**/api/nba-tracker', serve_snapshot)
        page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport=nba')
        expect(page.locator('.gt-game')).to_have_count(5)
        page.clock.pause_at(datetime.fromisoformat(NOW) + timedelta(seconds=5))
        page.clock.set_system_time(datetime.fromisoformat(NOW))
        page.evaluate('window.refreshNFLTracker()')
        expect(page).to_have_title('NBA Game Tracker | +EV Sharps')
        expect(page.locator('[data-league="nba"]')).to_have_attribute('aria-current', 'page')
        expect(page.locator('#league-name')).to_have_text('NBA')
        expect(page.locator('#page-picker-panel [data-page="nfl_tracker?sport=nba"]')).to_have_attribute('aria-current', 'page')
        expect(page.locator('#kotc')).to_have_text('KOTC')
        expect(page.locator('#football-legend')).not_to_be_visible()
        expect(page.locator('#all-scorers')).not_to_be_visible()
        expect(page.locator('.gt-field, .gt-football, .gt-on-ice, .gt-power-play, [data-touchdowns]')).to_have_count(0)
        live_card = page.locator('.gt-game[data-game-id="live"]')
        expect(live_card.locator('.gt-situation')).to_have_text('Q3 / 7:10')
        expect(live_card.locator('.gt-last-play')).to_contain_text('Q3 7:12')
        expect(live_card.locator('.gt-last-play')).not_to_contain_text('elapsed')
        expect(live_card.locator('[data-team="away"] .gt-score')).to_have_text('75')
        expect(page.locator('.gt-game[data-game-id="upcoming"]')).to_contain_text('Tipoff')
        expect(live_card).not_to_have_class(re.compile(r'\bis-red-zone\b'))

        # Quarter, halftime and successive overtime clocks all use the feed.
        live['status'].update(period=2, clock='0:00', name='STATUS_HALFTIME', detail='Halftime')
        page.evaluate('window.refreshNFLTracker()')
        expect(live_card.locator('.gt-situation')).to_have_text('Halftime')
        for period, label in ((5, 'OT'), (6, '2OT')):
            live['status'].update(period=period, clock='2:22', name='STATUS_IN_PROGRESS', detail=f'2:22 - {label}')
            page.evaluate('window.refreshNFLTracker()')
            expect(live_card.locator('.gt-situation')).to_have_text(f'{label} / 2:22')

        page.locator('[data-stats="live"]').click()
        expect(page.locator('#stats-content')).to_contain_text('Alpha Guard')
        expect(page.locator('#stats-content')).to_contain_text('DNP (Coach decision)')
        for label in ('MIN', 'FG', '3PT', 'PTS', 'REB', 'AST'):
            expect(page.locator('#stats-content thead th').get_by_text(label, exact=True)).to_have_count(1)
        page.keyboard.press('Escape')
        expect(page.locator('[data-stats="live"]')).to_be_focused()

        # Neither the live-only filter nor selecting no games may narrow KOTC.
        page.locator('[data-filter="in"]').click()
        page.locator('#game-picker summary').click()
        page.locator('#games-select-none').click()
        page.locator('#game-picker summary').click()
        expect(page.locator('.gt-game:visible')).to_have_count(0)
        page.locator('#kotc').click()
        dialog = page.locator('#kotc-dialog')
        expect(dialog).to_be_visible()
        expect(page.locator('#kotc-close')).to_be_focused()
        expect(page.locator('#kotc-slate-status')).to_contain_text('Oct 21')
        expect(page.locator('#kotc-slate-status')).to_contain_text('4 players ranked')
        rows = page.locator('[data-kotc-player]')
        assert rows.evaluate_all('rows => rows.map(row => row.dataset.kotcPlayer)') == ['alpha', 'beta', 'third', 'zero']
        assert page.locator('.gt-kotc-rank').all_text_contents() == ['1', '1', '3', '4']
        assert page.locator('.gt-kotc-pra').all_text_contents() == ['30', '30', '17', '0']
        expect(page.locator('[data-kotc-player="beta"]')).to_contain_text('Final')
        expect(page.locator('[data-kotc-player="alpha"]')).to_contain_text('BOS')
        expect(page.locator('[data-kotc-player="alpha"]')).to_contain_text('2:22 - 2OT')
        expect(page.locator('#kotc-content')).not_to_contain_text('Yesterday Leader')
        expect(page.locator('#kotc-content')).not_to_contain_text('Pregame Placeholder')
        expect(page.locator('#kotc-content')).not_to_contain_text('DNP Player')
        expect(page.locator('#kotc-feed-status')).to_contain_text('PRA stats pending: BOS at CHI')
        expect(page.locator('#kotc-feed-status')).to_contain_text('2 player rows with missing stats or DNP excluded')
        expect(page.locator('#kotc-feed-status')).to_contain_text('1 game outside this slate date')
        expect(page.locator('#kotc-feed-status')).to_contain_text('Game filters do not limit this view')
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('document.getElementById("kotc-dialog").contains(document.activeElement)')

        # Polling updates totals and ordering in the already-open dialog.
        alpha['stats']['pts'] = 40
        live['details']['players'].append(deepcopy(alpha))  # Repeated feed rows are one player.
        successful = feed['successful']
        page.clock.fast_forward(15_000)
        expect(page.locator('[data-kotc-player="alpha"] .gt-kotc-pra')).to_have_text('50')
        assert feed['successful'] > successful
        expect(rows).to_have_count(4)
        assert page.locator('.gt-kotc-rank').all_text_contents() == ['1', '2', '3', '4']
        live['details']['players'].pop()
        final['freshness']['summary_stale'] = True
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('[data-kotc-player="beta"]')).to_contain_text('Box score delayed')
        expect(page.locator('#kotc-feed-status')).to_contain_text('Box scores delayed')
        # The final game's prior stats remain ranked and explicitly labeled stale.
        expect(page.locator('[data-kotc-player="beta"] .gt-kotc-pra')).to_have_text('30')
        final['freshness']['summary_stale'] = False
        final['freshness']['summary_updated'] = None
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('[data-kotc-player="beta"]')).to_contain_text('freshness unknown')
        final['freshness']['summary_updated'] = NOW
        feed['mode'] = 'fail'
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('#kotc-feed-status')).to_contain_text('Updates interrupted')
        expect(rows).to_have_count(4)
        feed['mode'] = 'ok'
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('#kotc-feed-status')).not_to_contain_text('Updates interrupted')

        # Untrusted names are text, and row changes preserve scroll-region focus.
        beta['name'] = '<img src=x onerror="window.kotcInjected=true"> & Test Player'
        page.locator('.gt-kotc-table-wrap').focus()
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('[data-kotc-player="beta"]')).to_contain_text(beta['name'])
        expect(page.locator('#kotc-content img, #kotc-content script')).to_have_count(0)
        assert page.evaluate('window.kotcInjected === undefined')
        expect(page.locator('.gt-kotc-table-wrap')).to_be_focused()
        beta['name'] = 'Beta Forward'
        page.evaluate('window.refreshNFLTracker()')
        page.screenshot(path=str(ROOT.parent / 'nba-kotc-desktop.png'))
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert dialog.evaluate('(e) => e.scrollWidth <= e.clientWidth')
            assert page.locator('.gt-kotc-table-wrap').evaluate('e => e.querySelector(".gt-kotc-pra").getBoundingClientRect().right <= e.getBoundingClientRect().right'), 'PRA total should be visible without a horizontal swipe.'
        page.locator('.gt-kotc-table-wrap').evaluate('(e) => e.scrollLeft = 100')
        alpha['stats']['ast'] = 6
        page.evaluate('window.refreshNFLTracker()')
        assert page.locator('.gt-kotc-table-wrap').evaluate('(e) => e.scrollLeft') == 100
        expect(page.locator('.gt-kotc-table-wrap')).to_be_focused()
        page.locator('.gt-kotc-table-wrap').evaluate('(e) => e.scrollLeft = 0')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(ROOT.parent / 'nba-kotc-mobile.png'))
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        expect(page.locator('#kotc')).to_be_focused()
        assert not page.evaluate('document.documentElement.classList.contains("gt-dialog-open")')

        # Missing component updates remove a previously ranked player; true zero remains.
        alpha['stats']['ast'] = None
        page.locator('#kotc').click()
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('[data-kotc-player="alpha"]')).to_have_count(0)
        expect(page.locator('[data-kotc-player="zero"] .gt-kotc-pra')).to_have_text('0')
        # A new date must not silently keep the previous date's leaders.
        snapshot['date'] = '2026-10-22'
        page.evaluate('window.refreshNFLTracker()')
        expect(rows).to_have_count(0)
        expect(page.locator('#kotc-content')).to_contain_text('No NBA games scheduled for this date')
        snapshot['date'] = SLATE
        snapshot['data'] = [upcoming]
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('#kotc-content')).to_contain_text('PRA leaders will appear after tipoff')
        snapshot['data'] = []
        page.evaluate('window.refreshNFLTracker()')
        expect(page.locator('#kotc-content')).to_contain_text('No NBA games scheduled')
        page.locator('#kotc-close').click()
        expect(page.locator('#kotc')).to_be_focused()
        assert not errors, errors
        browser.close()
        print('NBA tracker: basketball cards, box scores, DNP, whole-date PRA ranks, ties, finals, zero/missing stats, polling, stale/recovery, safe names, modal focus and mobile checks passed.')
finally:
    server.shutdown()
    server.server_close()
