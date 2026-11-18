"""Offline browser checks for public reports, chunks, and optional account state."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = json.loads((ROOT / 'tests/fixtures/devig-chunks-python.json').read_text(encoding='utf-8'))
ORIGIN = 'https://public-preview.test'


def sport_report(sport):
    data = deepcopy(CHUNKS['original'])
    data['sport'] = sport
    for source in [data, data.get('opening_report')]:
        if not source:
            continue
        source['sport'] = sport
        for row in source['cells'] + source['best_cells']:
            row['prop'] = {'nfl': 'attd', 'nba': 'pts'}.get(sport, 'atgs')
    return data


def main():
    state = dict(auth='anonymous', chunked=False, requests=[])
    errors = []
    with TemporaryDirectory(prefix='devig-public-browser-') as output, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True,
            args=['--disable-logging', f'--log-file={Path(output) / "chromium.log"}'])
        page = browser.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("""
          window.EventSource = undefined;
          const RealDate = Date;
          window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : ['2026-10-14T12:00:00Z'])); }
            static now() { return RealDate.parse('2026-10-14T12:00:00Z'); }
          };
        """)

        def intercept(route):
            parsed = urlparse(route.request.url)
            if parsed.path == '/api/devig-results':
                query = parse_qs(parsed.query)
                sport = query.get('sport', ['nhl'])[0]
                part = query.get('part', [None])[0]
                state['requests'].append(dict(sport=sport, part=part,
                    auth=route.request.headers.get('authorization')))
                payload = CHUNKS['parts'][part] if part else (
                    CHUNKS['manifest'] if state['chunked'] and sport == 'nhl' else sport_report(sport))
                route.fulfill(json=payload)
            elif parsed.hostname == 'cdn.jsdelivr.net':
                mode = state['auth']
                if mode == 'missing':
                    script = ''
                else:
                    session = {
                        'anonymous': 'Promise.resolve({data: {session: null}})',
                        'signed-in': "Promise.resolve({data: {session: {access_token: 'fixture-token'}}})",
                        'pending': 'new Promise(() => {})',
                        'rejected': "Promise.reject(new Error('Auth unavailable'))",
                    }[mode]
                    script = """window.supabase = {createClient: () => ({auth: {
                      getSession: () => SESSION,
                      onAuthStateChange: fn => {window.authChanged = fn; return {};}
                    }})};""".replace('SESSION', session)
                route.fulfill(content_type='application/javascript', body=script)
            elif parsed.hostname == 'public-preview.test':
                relative = parsed.path.lstrip('/')
                path = ROOT / relative
                if '..' not in relative and path.is_file():
                    route.fulfill(path=str(path))
                else:
                    route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        for mode in ('anonymous', 'missing', 'pending', 'rejected', 'signed-in'):
            state.update(auth=mode, chunked=False, requests=[])
            page.goto(f'{ORIGIN}/devig-results.html')
            expect(page.locator('#report-content')).to_be_visible()
            expect(page.locator('#summary-profit')).to_have_text('+8.70u')
            expect(page.locator('#export')).to_be_enabled()
            assert page.locator('#access-panel').count() == 0
            assert state['requests'] == [dict(sport='nhl', part=None, auth=None)]

        state.update(auth='pending', chunked=True, requests=[])
        page.goto(f'{ORIGIN}/devig-results.html')
        expect(page.locator('#summary-profit')).to_have_text('+8.70u')
        assert len(state['requests']) == 1 + len(CHUNKS['parts'])
        assert {request['part'] for request in state['requests'][1:]} == set(CHUNKS['parts'])
        assert all(request['auth'] is None for request in state['requests'])
        page.select_option('#price-source', 'opening')
        expect(page.locator('#price-source')).to_have_value('opening')
        expect(page.locator('#summary-profit')).to_have_text('+8.70u')
        page.select_option('#date-preset', 'published')
        before = len(state['requests'])
        page.evaluate("window.authChanged('SIGNED_OUT', null)")
        expect(page.locator('#account-link')).to_have_text('Sign in')
        expect(page.locator('#report-content')).to_be_visible()
        expect(page.locator('#price-source')).to_have_value('opening')
        expect(page.locator('#export')).to_be_enabled()
        assert len(state['requests']) == before
        page.evaluate("window.authChanged('SIGNED_IN', {access_token:'fixture-token'})")
        expect(page.locator('#account-link')).to_have_text('My account')
        assert len(state['requests']) == before

        for sport in ('nfl', 'nba', 'nhl'):
            page.select_option('#sport-filter', sport)
            expect(page.locator('#page-title')).to_have_text(f'{sport.upper()} devig results')
            expect(page.locator('#summary-profit')).to_have_text('+8.70u')
            expect(page.locator('#refresh')).to_be_enabled()
            assert state['requests'][-1]['sport'] == sport
        assert all(request['auth'] is None for request in state['requests'])
        assert not errors, errors
        browser.close()
    print('PASS: anonymous reports and chunks; all sports; opening/date controls; missing, pending and rejected auth; optional sign-in/sign-out; no Authorization headers or page errors.')


if __name__ == '__main__':
    main()
