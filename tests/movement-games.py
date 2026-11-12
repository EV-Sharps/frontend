"""Offline browser regression for Movement's paginated game filter."""
import importlib.util
from copy import deepcopy
from pathlib import Path
from tempfile import mkdtemp
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('snapshot', ROOT / 'tests/movement-snapshot.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    artifacts = Path(mkdtemp(prefix='movement-games-'))
    rows = [fixture.selection(i, f'skater {i}') for i in range(1, 102)]
    rows += [fixture.selection(102, 'late game player', game='bos @ tor'),
             fixture.selection(103, 'tomorrow player', game='pit @ phi', start=fixture.stamp(1440))]
    games = {'nyr @ det': fixture.stamp(180), 'bos @ tor': fixture.stamp(240),
             'pit @ phi': fixture.stamp(1440)}
    errors, requests = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1440, height=900))
        page.set_default_timeout(7000)
        page.clock.install(time=fixture.NOW)
        page.on('pageerror', lambda error: errors.append(str(error)))

        def intercept(route):
            url = urlsplit(route.request.url)
            if url.path == '/api/line-movement':
                query = {k: v[0] for k, v in parse_qs(url.query, keep_blank_values=True).items()}
                requests.append(query)
                data = fixture.sample()
                data.update(sport=query.get('sport', 'nhl'), games=list(games), times=games,
                            window=query.get('window', '6h'), window_start=fixture.stamp(-360),
                            window_end=fixture.stamp())
                if 'id' in query:
                    data.pop('rows')
                    data['selection'] = deepcopy(next(row for row in rows if row['id'] == query['id']))
                    data['points'] = []
                else:
                    filtered = [row for row in rows if 'games' not in query or row['game'] in query['games'].split(',')]
                    filtered = [row for row in filtered if query.get('query', '') in row['player']]
                    offset, limit = int(query.get('offset', 0)), int(query.get('limit', 100))
                    data.update(rows=filtered[offset:offset + limit], total=len(filtered), offset=offset, limit=limit)
                route.fulfill(json=data)
            elif url.hostname == 'cdn.jsdelivr.net':
                route.fulfill(content_type='application/javascript', body='''
                    window.supabase = {createClient: () => ({auth: {
                        getSession: async () => ({data: {session: {access_token:'fixture-token'}}}),
                        onAuthStateChange: fn => { window.authChanged = fn; return {}; }
                    }})};
                ''')
            elif url.hostname == 'ev-sharps.test':
                asset = ROOT / url.path.lstrip('/')
                route.fulfill(path=asset) if asset.is_file() else route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        page.goto('https://ev-sharps.test/movement.html?sport=nhl')
        count = page.locator('#catalog-count')
        button, menu = page.locator('#game-dd-button'), page.locator('#game-options')
        checks = page.locator('#game-choices input')
        expect(count).to_have_text('103 selections')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(100)
        button.click()
        expect(checks).to_have_count(3)
        expect(page.locator('#game-choices input:checked')).to_have_count(3)
        page.locator('[data-games="none"]').click()
        expect(count).to_have_text('0 selections')
        expect(button).to_have_text('No Games')
        assert parse_qs(urlsplit(page.url).query, keep_blank_values=True)['games'] == ['']
        later = page.locator('#game-choices input[value="bos @ tor"]')
        later.check()
        expect(count).to_have_text('1 selections')
        expect(button).to_have_text('BOS @ TOR')
        expect(later).to_be_focused()
        expect(page.locator('#catalog-rows')).to_contain_text('Late Game Player')
        page.evaluate('refreshMovement()')
        expect(later).to_be_checked()
        expect(checks).to_have_count(3)
        page.locator('#game-choices input[value="nyr @ det"]').check()
        expect(count).to_have_text('102 selections')
        expect(button).to_have_text('2 Games')
        page.keyboard.press('Escape')
        expect(menu).to_be_hidden()
        expect(button).to_be_focused()
        page.locator('#next-page').click()
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(2)
        assert 'games' in next(q for q in reversed(requests) if 'id' not in q)
        button.click()
        page.locator('[data-games="today"]').click()
        expect(count).to_have_text('102 selections')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(100)
        expect(page.locator('#game-choices input[value="pit @ phi"]')).not_to_be_checked()
        page.locator('[data-games="all"]').click()
        expect(count).to_have_text('103 selections')
        assert 'games' not in parse_qs(urlsplit(page.url).query)
        page.locator('#player-search').click()
        page.locator('#player-search').fill('tomorrow')
        page.clock.run_for(300)
        expect(count).to_have_text('1 selections')
        expect(menu).to_be_hidden()
        button.click()
        expect(checks).to_have_count(3)
        page.locator('[data-games="none"]').click()
        expect(count).to_have_text('0 selections')
        page.locator('#game-choices input[value="pit @ phi"]').check()
        expect(count).to_have_text('1 selections')
        page.reload()
        expect(count).to_have_text('1 selections')
        expect(button).to_have_text('PIT @ PHI')
        page.locator('#open-slate-snapshot').click()
        expect(page.locator('#slate-snapshot-filter-context')).to_contain_text('PIT @ PHI')
        page.locator('#slate-snapshot-close').click()

        for width in [1440, 1150, 850, 390, 320]:
            page.set_viewport_size(dict(width=width, height=844))
            button.scroll_into_view_if_needed()
            if not menu.is_visible():
                button.click()
            box = menu.bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width + 1, box
            assert box['y'] >= 0 and box['y'] + box['height'] <= 845, box
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert page.locator('#sport-select').evaluate('el => el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right + 1')
            page.screenshot(path=str(artifacts / f'games-{width}.png'))
            page.keyboard.press('Escape')
        page.select_option('#sport-select', 'nba')
        expect(button).to_have_text('All Games')
        assert 'games' not in parse_qs(urlsplit(page.url).query)
        assert not errors, errors
        browser.close()
    print('PASS Movement game filter: full catalog, pagination, multi-select, All/Today/None, refresh, URL restore, search, snapshot, sport reset and mobile bounds.')
    print(f'Screenshots: {artifacts}')


if __name__ == '__main__':
    main()
