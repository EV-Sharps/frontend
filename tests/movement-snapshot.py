"""Offline checks for the screenshot-friendly movement slate; no production calls.

python tests/movement-snapshot.py [--frontend PATH]
"""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import mkdtemp
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


NOW = datetime(2026, 10, 2, 19, tzinfo=timezone.utc)


def stamp(minutes=0):
    return (NOW + timedelta(minutes=minutes)).isoformat()


def selection(index, player, **values):
    row = dict(id=f'{index:024x}', player=player, game='nyr @ det', prop='atgs',
               handicap='0.5', side=0, side_labels=['Over', 'Under'], start=stamp(180),
               first_at=stamp(-390), last_at=stamp(), point_count=14,
               first_fair=400, current_fair=326, first_probability=.2, current_probability=.235,
               first_fair_at=stamp(-390), current_fair_at=stamp(),
               first_reference_books=['pn', 'circa'], current_reference_books=['pn', 'circa'],
               reference_books=['pn', 'circa'], fair_comparable=True, change_pp=3.5, status='ok',
               current_prices={'pn': 350, 'circa': 375, 'fd': 450})
    row.update(values)
    return row


def sample():
    rows = [
        selection(1, 'matched skater', first_fair_carried=True),
        selection(2, 'drifting skater', first_fair=300, first_probability=.25, change_pp=-1.5),
        selection(3, 'unmatched skater', first_reference_books=['pn'], current_reference_books=['circa'],
                  reference_books=[], fair_comparable=False, change_pp=77),
        selection(4, 'single capture', first_fair_at=stamp(), first_fair=326,
                  first_probability=.235, change_pp=77),
        selection(5, 'stale skater', last_at=stamp(-61), current_fair_at=stamp(-61), change_pp=77),
        selection(6, 'started skater', start=stamp(-1), change_pp=77),
        selection(7, 'missing endpoint', current_fair=None, current_probability=None,
                  current_fair_at=None, change_pp=77),
        selection(8, 'unpaired skater', first_fair=None, current_fair=None,
                  first_probability=None, current_probability=None, first_fair_at=None,
                  current_fair_at=None, change_pp=77, status='insufficient_fair_data'),
        selection(9, '<img src=x onerror=alert(1)>', game='<svg onload=alert(1)> @ det'),
        selection(10, 'starting soon', start=stamp(.5)),
    ]
    rows.extend(selection(index, f'fixture skater {index}') for index in range(11, 24))
    rows.append(selection(24, 'alternate goals', handicap='1.5'))
    return dict(sport='nhl', day='2026-10-02', updated=stamp(), interval_minutes=30,
                max_age_minutes=60, props=['atgs', 'sog'], books=['pn', 'circa', 'fd'],
                rows=rows, total=250, offset=0, limit=100, status='ok')


def row_ids(page, selector):
    return page.locator(selector).evaluate_all('(rows) => rows.map(row => row.dataset.id)')


def assert_bounds(page, width):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
    selectors = ['#slate-snapshot-dialog', '.slate-snapshot-scroll']
    if width >= 900:
        selectors.append('#slate-snapshot-card')
    for selector in selectors:
        box = page.locator(selector).bounding_box()
        assert box and box['x'] >= -1 and box['x'] + box['width'] <= width + 1, (selector, box)
    if width < 700:
        assert page.locator('#slate-snapshot-rows').evaluate('''rows => {
            let node = rows.parentElement;
            while (node && node.id !== 'slate-snapshot-dialog') {
                const style = getComputedStyle(node);
                if (['auto', 'scroll'].includes(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
                node = node.parentElement;
            }
            return false;
        }'''), 'The wide compact table must scroll inside the dialog on phones'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.frontend.resolve()
    artifacts = Path(mkdtemp(prefix='movement-snapshot-'))
    state = dict(payload=sample(), status=200, requests=[])
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={artifacts / "chromium.log"}'])
        page = browser.new_page(viewport=dict(width=1440, height=1050))
        page.set_default_timeout(7000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=NOW)

        def intercept(route):
            url = urlsplit(route.request.url)
            if url.path == '/api/line-movement':
                query = {key: values[0] for key, values in parse_qs(url.query).items()}
                state['requests'].append(query)
                assert route.request.headers.get('authorization') == 'Bearer fixture-token'
                if state['status'] != 200:
                    route.fulfill(status=state['status'], json={'error': 'Fixture access required'})
                    return
                data = deepcopy(state['payload'])
                data['sport'] = query.get('sport', 'nhl')
                data['window'] = query.get('window', '6h')
                hours = 24 if data['window'] == 'today' else int(data['window'][:-1])
                data['window_start'] = stamp(-60 * hours)
                data['window_end'] = stamp()
                if query.get('id'):
                    selected = next(row for row in data.pop('rows') if row['id'] == query['id'])
                    data['selection'] = selected
                    data['points'] = [dict(ts=stamp(minutes), prices={'fd': price},
                                           fair=fair, probability=probability)
                                      for minutes, price, fair, probability in [
                                          (-30, 475, 400, .2), (0, 450, 326, .235)]]
                else:
                    if query.get('query'):
                        search = query['query'].lower()
                        data['rows'] = [row for row in data['rows'] if search in row['player'].lower()]
                        data['total'] = len(data['rows'])
                    if query.get('direction') in ['shortening', 'drifting']:
                        sign = 1 if query['direction'] == 'shortening' else -1
                        data['rows'] = [row for row in data['rows'] if (row.get('change_pp') or 0) * sign > 0]
                        data['total'] = len(data['rows'])
                    data['offset'] = int(query.get('offset', '0'))
                route.fulfill(json=data)
            elif url.hostname == 'cdn.jsdelivr.net':
                route.fulfill(content_type='application/javascript', body='''
                    window.supabase = {createClient: () => ({auth: {
                        getSession: async () => ({data: {session: {access_token:'fixture-token'}}}),
                        onAuthStateChange: fn => { window.authChanged = fn; return {}; }
                    }})};
                ''')
            elif url.hostname == 'ev-sharps.test':
                asset = root / url.path.lstrip('/')
                route.fulfill(path=asset) if asset.is_file() else route.fulfill(status=404, body='')
            else:
                route.fulfill(status=404, body='')

        page.route('**/*', intercept)
        page.goto('https://ev-sharps.test/movement.html?sport=nhl')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        expect(page.locator('#chart-title')).to_have_text('Matched Skater')
        page.wait_for_function('!document.getElementById("refresh").disabled')
        trigger = page.locator('#open-slate-snapshot')
        dialog = page.locator('#slate-snapshot-dialog')
        rows = page.locator('#slate-snapshot-rows tr[data-id]')
        request_count = len(state['requests'])
        trigger.focus()
        trigger.press('Enter')
        expect(dialog).to_be_visible()
        expect(page.locator('#slate-snapshot-limit')).to_have_value('10')
        expect(rows).to_have_count(10)
        assert row_ids(page, '#slate-snapshot-rows tr[data-id]') == row_ids(page, '#catalog-rows .movement-play')[:10]
        snapshot = page.locator('#slate-snapshot-card').inner_text()
        for text in ['NHL', 'Last 6 hours', 'Sportsbook consensus', 'Oct 2, 2026', '250']:
            assert text in snapshot, (text, snapshot)
        assert 'loaded' in snapshot.lower(), snapshot
        first = rows.first
        for text in ['Matched Skater', 'Anytime goalscorer', 'Yes', 'NYR @ DET', '+450', '+400', '+326',
                     '20.00%', '23.50%', '+3.50 pp', '8:30 AM', '3:00 PM']:
            assert text in first.inner_text(), (text, first.inner_text())
        assert 'carried' in first.inner_text().lower(), first.inner_text()
        assert first.locator('img[src*="fd.png"]').count() == 1
        for index, status in [(3, 'No matched comparison'), (4, 'Awaiting next fair capture'),
                              (5, 'Capture out of date'), (6, 'Game started'),
                              (7, 'Fair comparison unavailable'), (8, 'Paired quotes unavailable')]:
            item = page.locator(f'#slate-snapshot-rows tr[data-id="{index:024x}"]')
            assert status in item.inner_text(), item.inner_text()
            expect(item.locator('.snapshot-move strong')).to_have_text('-')
            if index in [5, 6]:
                assert 'No current quote' in item.inner_text()
        assert page.locator('#slate-snapshot-rows img[src="x"], #slate-snapshot-rows svg[onload]').count() == 0
        assert '<img src=x onerror=alert(1)>' in rows.nth(8).inner_text().lower()
        assert len(state['requests']) == request_count, 'Opening a snapshot must reuse the loaded slate'

        # The default capture fits its full explanation/range in a typical desktop screenshot.
        page.set_viewport_size(dict(width=1440, height=900))
        assert_bounds(page, 1440)
        scroll = page.locator('.slate-snapshot-scroll')
        assert scroll.evaluate('el => el.scrollHeight <= el.clientHeight + 1'), 'Default ten rows should fit without vertical scrolling at 900px'
        footer = page.locator('.slate-snapshot-card-footer').bounding_box()
        viewport = scroll.bounding_box()
        assert footer['y'] >= viewport['y'] and footer['y'] + footer['height'] <= viewport['y'] + viewport['height'] + 1
        page.screenshot(path=str(artifacts / 'snapshot-desktop-default.png'))
        page.locator('#slate-snapshot-card').screenshot(path=str(artifacts / 'snapshot-card-default.png'))
        page.set_viewport_size(dict(width=1440, height=1050))
        page.select_option('#slate-snapshot-limit', '15')
        expect(rows).to_have_count(15)

        page.locator('#slate-snapshot-next').click()
        expect(rows).to_have_count(8)
        assert row_ids(page, '#slate-snapshot-rows tr[data-id]') == row_ids(page, '#catalog-rows .movement-play')[15:]
        expect(page.locator('#slate-snapshot-next')).to_be_disabled()
        page.locator('#slate-snapshot-prev').click()
        expect(rows).to_have_count(15)
        page.select_option('#slate-snapshot-limit', 'all')
        expect(rows).to_have_count(23)
        expect(page.locator('#slate-snapshot-prev')).to_be_disabled()
        expect(page.locator('#slate-snapshot-next')).to_be_disabled()
        page.select_option('#slate-snapshot-limit', '10')
        expect(rows).to_have_count(10)
        page.locator('#slate-snapshot-next').click()
        page.locator('#slate-snapshot-next').click()
        expect(rows).to_have_count(3)
        assert len(state['requests']) == request_count, 'Local pagination/count controls must not fetch history'

        # Live refresh keeps the dialog open, replaces stale rows and clamps a now-invalid page.
        state['payload']['rows'] = state['payload']['rows'][:5]
        state['payload']['rows'][0]['current_fair'] = 300
        state['payload']['rows'][0]['current_probability'] = .25
        state['payload']['rows'][0]['change_pp'] = 5
        state['payload']['updated'] = stamp(.1)
        page.evaluate('refreshMovement()')
        expect(rows).to_have_count(5)
        expect(dialog).to_be_visible()
        expect(page.locator('#slate-snapshot-prev')).to_be_disabled()
        assert '+300' in rows.first.inner_text() and '+5.00 pp' in rows.first.inner_text()
        page.keyboard.press('Escape')
        expect(dialog).to_be_hidden()
        expect(trigger).to_be_focused()

        state['payload'] = sample()
        page.evaluate('refreshMovement()')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        page.wait_for_function('!document.getElementById("refresh").disabled')
        trigger.click()
        page.select_option('#slate-snapshot-limit', '15')
        for width in [1440, 390, 320]:
            page.set_viewport_size(dict(width=width, height=1050 if width == 1440 else 844))
            assert_bounds(page, width)
            page.screenshot(path=str(artifacts / f'snapshot-{width}.png'), full_page=True)
        page.locator('#slate-snapshot-close').click()
        expect(dialog).to_be_hidden()
        expect(trigger).to_be_focused()
        page.set_viewport_size(dict(width=1440, height=1050))

        # Filters clear the old screenshot immediately; a newly opened view inherits the applied filters.
        trigger.click()
        page.locator('#player-search').evaluate("el => {el.value='drifting';el.dispatchEvent(new Event('input',{bubbles:true}));}")
        expect(dialog).to_be_hidden()
        expect(page.locator('#slate-snapshot-rows')).to_be_empty()
        page.clock.run_for(300)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(1)
        trigger.click()
        expect(rows).to_have_count(1)
        assert 'drifting' in page.locator('#slate-snapshot-card').inner_text().lower()
        assert '-1.50 pp' in rows.first.inner_text()
        page.locator('#slate-snapshot-close').click()
        page.locator('#player-search').fill('')
        page.clock.run_for(300)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        page.select_option('#reference-select', 'pn')
        page.clock.run_for(20)
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        trigger.click()
        assert 'Pinnacle' in page.locator('#slate-snapshot-card').inner_text()

        # A started game cannot retain the pregame move in an already-open capture view.
        page.clock.run_for(60001)
        soon = page.locator('#slate-snapshot-rows tr[data-id="00000000000000000000000a"]')
        expect(soon).to_contain_text('Game started')
        assert '+3.50 pp' not in soon.inner_text()

        # An empty refreshed slate produces no stale private rows or impossible pagination.
        state['payload']['rows'] = []
        state['payload']['total'] = 0
        page.evaluate('refreshMovement()')
        expect(rows).to_have_count(0)
        expect(dialog).to_be_visible()
        expect(page.locator('#slate-snapshot-prev')).to_be_disabled()
        expect(page.locator('#slate-snapshot-next')).to_be_disabled()
        assert 'Matched Skater' not in page.locator('#slate-snapshot-card').inner_text()
        expect(trigger).to_be_disabled()

        state['payload'] = sample()
        page.evaluate('refreshMovement()')
        expect(rows).to_have_count(15)
        # Both rejected API access and signing out must remove the snapshot's private content.
        state['status'] = 401
        page.evaluate('refreshMovement()')
        expect(dialog).to_be_hidden()
        expect(page.locator('#slate-snapshot-rows')).to_be_empty()
        expect(page.locator('#access-panel')).to_be_visible()
        assert 'Matched Skater' not in page.locator('#slate-snapshot-card').text_content()
        state['status'] = 200
        page.evaluate('refreshMovement()')
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        trigger.click()
        expect(rows).to_have_count(15)
        page.evaluate("window.authChanged('SIGNED_OUT',null)")
        expect(dialog).to_be_hidden()
        expect(page.locator('#slate-snapshot-rows')).to_be_empty()
        expect(page.locator('#access-panel')).to_be_visible()

        # A midnight Eastern reset closes screenshots from the previous day.
        page.evaluate("window.authChanged('SIGNED_IN',{access_token:'fixture-token'})")
        expect(page.locator('#catalog-rows .movement-play')).to_have_count(23)
        trigger.click()
        expect(dialog).to_be_visible()
        page.clock.set_fixed_time(NOW + timedelta(hours=10))
        page.clock.run_for(60001)
        expect(dialog).to_be_hidden()
        expect(page.locator('#slate-snapshot-rows')).to_be_empty()
        assert 'Matched Skater' not in page.locator('#slate-snapshot-card').text_content()
        assert not errors, errors
        browser.close()
    print('PASS Movement screenshot view: compact fair endpoints/moves, local pagination, live refresh/status, filters, escape/focus, XSS/privacy and responsive bounds.')
    print(f'Screenshots: {artifacts}')


if __name__ == '__main__':
    main()
