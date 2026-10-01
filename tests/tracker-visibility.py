"""Deterministic tracker visibility, polling, live events and stale-response races."""
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def snapshot(sport, version, updated):
    hockey = sport == 'nhl'
    score = {'id': f'score-{version}', 'text': f'Scorer version {version}', 'period': 1, 'clock': '12:00',
             'team_id': 'away', 'scoring_type': 'goal' if hockey else 'touchdown', 'scoring_play': True,
             'type': 'Goal' if hockey else 'Rushing Touchdown', 'away_score': version, 'home_score': 0}
    player = {'id': 'player', 'name': f'Player version {version}', 'team_id': 'away',
              'categories': {'forwards' if hockey else 'receiving': {'G' if hockey else 'REC': str(version)}}}
    game = {'id': 'live', 'game': 'away @ home', 'start': updated,
            'away': {'id': 'away', 'key': 'away', 'abbreviation': 'AWY', 'name': 'Away Team', 'score': version},
            'home': {'id': 'home', 'key': 'home', 'abbreviation': 'HME', 'name': 'Home Team', 'score': 0},
            'status': {'state': 'in', 'name': 'STATUS_IN_PROGRESS', 'detail': '12:00 - 1st Period' if hockey else '12:00 - 1st Quarter'},
            'situation': {}, 'last_play': score,
            'details': {'scoring_plays': [score], 'players': [player], 'plays': []},
            'freshness': {'scoreboard_updated': updated, 'summary_updated': updated, 'summary_stale': False}}
    return {'schema_version': 1, 'sport': sport, 'date': updated[:10], 'updated': updated,
            'scoreboard_updated': updated, 'summary_interval_seconds': 30, 'data': [game]}


INIT = r"""(() => {
    window.fixtureVisible = false;
    Object.defineProperty(document, 'visibilityState', {get: () => fixtureVisible ? 'visible' : 'hidden'});
    Object.defineProperty(document, 'hidden', {get: () => !fixtureVisible});
    window.fixtureVisibility = visible => {
        window.fixtureVisible = visible;
        document.dispatchEvent(new Event('visibilitychange'));
    };
    window.fixtureSources = [];
    window.EventSource = class {
        constructor(url) { this.url = url; this.closed = false; this.closeCount = 0; this.handlers = {}; fixtureSources.push(this); }
        addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
        close() { this.closed = true; this.closeCount++; }
        emit(name, data) { for (const callback of this.handlers[name] || []) callback({data:JSON.stringify(data)}); }
    };
    const originalFetch = window.fetch.bind(window);
    window.fixtureTransport = {requests:[], mode:'auto', payload:PAYLOAD};
    window.fetch = (url, options = {}) => {
        if (!/\/api\/(nfl|ncaaf|nhl)-tracker(?:\?|$)/.test(String(url))) return originalFetch(url, options);
        const entry = {url:String(url), aborted:false, bodyPending:false};
        fixtureTransport.requests.push(entry);
        options.signal?.addEventListener('abort', () => { entry.aborted = true; });
        const captured = structuredClone(fixtureTransport.payload);
        const mode = fixtureTransport.mode;
        return Promise.resolve({ok:true, json:() => {
            if (mode === 'auto') return Promise.resolve(captured);
            // Deliberately uncancellable body work exercises the generation guard too.
            entry.bodyPending = true;
            return new Promise((resolve, reject) => {
                entry.resolve = payload => { entry.bodyPending = false; resolve(structuredClone(payload)); };
                entry.reject = () => { entry.bodyPending = false; reject(new Error('late fixture error')); };
            });
        }});
    };
    window.fixtureDOM = () => ['games','feed-age','connection','touchdown-content','touchdown-feed-status',
        'stats-content','stats-feed-status','request-status'].map(id => document.getElementById(id)?.outerHTML).join('\n');
})();"""


def request_count(page):
    return page.evaluate('fixtureTransport.requests.length')


def set_snapshot(page, sport, version):
    payload = snapshot(sport, version, page.evaluate('new Date().toISOString()'))
    page.evaluate('payload => { fixtureTransport.payload = payload; fixtureTransport.mode = "auto"; }', payload)
    return payload


def visible(page, state):
    page.evaluate('fixtureVisibility', state)
    page.clock.run_for(1)


def freeze_hidden(page):
    page.evaluate("""() => {
        window.fixtureMutationCount = 0;
        window.fixtureObserver?.disconnect();
        window.fixtureObserver = new MutationObserver(records => { fixtureMutationCount += records.length; });
        for (const id of ['games','feed-age','connection','touchdown-content','touchdown-feed-status','stats-content','stats-feed-status','request-status']) {
            fixtureObserver.observe(document.getElementById(id), {subtree:true, childList:true, attributes:true, characterData:true});
        }
    }""")
    return page.evaluate('fixtureDOM()'), request_count(page)


def assert_frozen(page, before):
    assert page.evaluate('fixtureDOM()') == before[0], 'Hidden page changed tracker DOM'
    assert request_count(page) == before[1], 'Hidden page fetched another snapshot'
    assert page.evaluate('fixtureMutationCount') == 0, 'Hidden freshness timer touched the DOM'
    page.evaluate('fixtureObserver.disconnect()')


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for sport in ('nfl', 'ncaaf', 'nhl'):
            page = browser.new_page(viewport={'width': 1200, 'height': 900})
            page.set_default_timeout(5000)
            page.clock.install(time=NOW)
            page.add_init_script(INIT.replace('PAYLOAD', json.dumps(snapshot(sport, 1, NOW.isoformat()))))
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('https://**/*', lambda route: route.fulfill(
                body="window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}})};"
                if 'supabase-js' in route.request.url else '', content_type='application/javascript'))
            page.goto(f'http://localhost:{server.server_port}/nfl_tracker.html?sport={sport}')
            page.clock.pause_at(NOW + timedelta(seconds=1))
            before = freeze_hidden(page)
            page.clock.fast_forward(60000)
            page.evaluate('refreshNFLTracker()')
            page.evaluate('refreshNFLTracker.requestLatest()')
            assert_frozen(page, before)
            assert request_count(page) == 0
            assert page.evaluate('fixtureSources.length') == 0

            set_snapshot(page, sport, 1)
            visible(page, True)
            expect(page.locator('.gt-game')).to_have_count(1)
            assert page.evaluate('fixtureSources.filter(source => !source.closed).length') == 1
            assert page.evaluate('fixtureSources.at(-1).url').endswith(f'datasets={sport}_tracker')
            assert page.evaluate('fixtureTransport.requests.every(request => request.url.endsWith("/api/" + SPORT + "-tracker"))')
            before_age = page.locator('#feed-age').inner_text()
            count = request_count(page)
            page.clock.run_for(5000)
            assert page.locator('#feed-age').inner_text() != before_age
            assert request_count(page) == count
            page.clock.run_for(10000)
            assert request_count(page) > count, 'Visible tracker stopped polling'

            page.locator('#all-scorers').click()
            expect(page.locator('#touchdown-content')).to_contain_text('Scorer version 1')
            visible(page, False)
            assert page.evaluate('fixtureSources.every(source => source.closed)')
            before = freeze_hidden(page)
            page.evaluate('fixtureSources.at(-1).emit("odds-update", {dataset:SPORT + "_tracker"})')
            page.evaluate('refreshNFLTracker()')
            page.clock.fast_forward(120000)
            assert_frozen(page, before)
            set_snapshot(page, sport, 2)
            visible(page, True)
            expect(page.locator('#touchdown-content')).to_contain_text('Scorer version 2')
            expect(page.locator('#touchdown-dialog')).to_be_visible()
            assert page.evaluate('fixtureSources.filter(source => !source.closed).length') == 1
            page.locator('#touchdown-close').click()
            page.locator('#all-stats').click()
            expect(page.locator('#stats-content')).to_contain_text('Player version 2')

            # Resolving an aborted request while hidden must not repaint or show an error.
            page.evaluate('fixtureTransport.mode = "hold"; void refreshNFLTracker()')
            page.wait_for_function('fixtureTransport.requests.at(-1).bodyPending')
            held = request_count(page) - 1
            visible(page, False)
            assert page.evaluate('index => fixtureTransport.requests[index].aborted', held)
            before = freeze_hidden(page)
            page.evaluate('index => fixtureTransport.requests[index].resolve(fixtureTransport.payload)', held)
            page.clock.run_for(20000)
            assert_frozen(page, before)
            set_snapshot(page, sport, 3)
            visible(page, True)
            expect(page.locator('#stats-content')).to_contain_text('Player version 3')
            expect(page.locator('#stats-dialog')).to_be_visible()

            # Resume cannot wait on uncancellable body work, or let it overwrite fresh data.
            for version, completion in ((4, 'resolve'), (5, 'reject')):
                page.evaluate('fixtureTransport.mode = "hold"; void refreshNFLTracker()')
                page.wait_for_function('fixtureTransport.requests.at(-1).bodyPending')
                held = request_count(page) - 1
                visible(page, False)
                assert page.evaluate('index => fixtureTransport.requests[index].aborted', held)
                set_snapshot(page, sport, version)
                visible(page, True)
                expect(page.locator('#stats-content')).to_contain_text(f'Player version {version}')
                stale = snapshot(sport, 99, page.evaluate('new Date(Date.now() + 1000).toISOString()'))
                page.evaluate('args => fixtureTransport.requests[args.index][args.method](args.payload)',
                              {'index': held, 'method': completion, 'payload': stale})
                page.clock.run_for(1)
                expect(page.locator('#stats-content')).to_contain_text(f'Player version {version}')
                assert '99' not in page.locator('#stats-content').inner_text()
                expect(page.locator('#request-status')).to_be_hidden()
                assert page.locator('#connection').inner_text() == 'Auto-refresh on'

            set_snapshot(page, sport, 6)
            page.evaluate('fixtureSources.at(-1).emit("odds-update", {dataset:SPORT + "_tracker"})')
            page.clock.run_for(150)
            expect(page.locator('#stats-content')).to_contain_text('Player version 6')

            # Page cache/navigation lifecycle pauses even when visibility still says visible.
            page.evaluate('dispatchEvent(new PageTransitionEvent("pagehide", {persisted:true}))')
            assert page.evaluate('fixtureSources.every(source => source.closed)')
            before = freeze_hidden(page)
            page.evaluate('refreshNFLTracker()')
            page.clock.fast_forward(60000)
            assert_frozen(page, before)
            set_snapshot(page, sport, 7)
            page.evaluate('dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))')
            page.clock.run_for(1)
            expect(page.locator('#stats-content')).to_contain_text('Player version 7')
            assert page.evaluate('fixtureSources.filter(source => !source.closed).length') == 1
            count = request_count(page)
            page.clock.run_for(15000)
            assert request_count(page) > count, 'Polling did not resume after pageshow'
            assert not errors, errors
            print(f'{sport}: hidden startup/pause, abort/stale response guards, live reconnect, popout refresh and page lifecycle passed')
            page.close()
        browser.close()
finally:
    server.shutdown()
