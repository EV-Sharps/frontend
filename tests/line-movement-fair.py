"""Offline browser regression for NHL 0.5 lines and fair capture coverage."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 2, 19, 0, tzinfo=timezone.utc)
stamp = lambda minutes=0: (NOW + timedelta(minutes=minutes)).isoformat()

def row(index, player, handicap='0.5', **values):
    result = dict(id=f'{index:024x}', player=player, game='nyr @ det', prop='atgs',
                  handicap=handicap, side=0, side_labels=['Over', 'Under'], start=stamp(180),
                  first_at=stamp(-30), last_at=stamp(), point_count=3,
                  first_fair=400, current_fair=326, first_probability=.2, current_probability=.235,
                  first_fair_at=stamp(-15), current_fair_at=stamp(),
                  first_reference_books=['pn', 'circa'], current_reference_books=['pn', 'circa'],
                  reference_books=['pn', 'circa'], fair_comparable=True, change_pp=3.5, status='ok')
    result.update(values)
    return result

ROWS = [row(5, 'alternate only', '1.5'), row(6, 'alternate only', '2.5'),
        row(1, 'matched skater'),
        row(2, 'independent skater', first_reference_books=['pn'], current_reference_books=['circa'],
            reference_books=[], fair_comparable=False, change_pp=None,
            note='Independent endpoint fair values; fewer than two matched sportsbooks. No comparable consensus move.'),
        row(3, 'missing latest skater', current_fair=None, current_probability=None, current_fair_at=None,
            first_reference_books=['pn'], current_reference_books=[], reference_books=['pn'],
            fair_comparable=False, change_pp=None,
            note='Pinnacle has paired prices at the first fair capture, but not the latest capture.'),
        row(4, 'one sided skater', first_fair=None, current_fair=None, first_probability=None,
            current_probability=None, first_fair_at=None, current_fair_at=None, point_count=1,
            first_reference_books=[], current_reference_books=[], reference_books=[],
            fair_comparable=False, change_pp=None, status='insufficient_fair_data',
            note='Actual paired prices are missing; no opposite-side prices are estimated.')]
state = dict(requests=[], payload=dict(sport='nhl', day='2026-10-02', updated=stamp(),
             interval_minutes=30, max_age_minutes=60, props=['atgs'], books=['pn', 'circa', 'fd'],
             rows=ROWS, total=len(ROWS), offset=0, limit=100, status='ok'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1050})
    page.clock.install(time=NOW)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def intercept(route):
        request_url = route.request.url
        if '/api/line-movement?' in request_url:
            query = {key: values[0] for key, values in parse_qs(urlsplit(request_url).query).items()}
            state['requests'].append(query)
            data = deepcopy(state['payload'])
            if 'id' in query and query['id'] in state.get('details', {}):
                data = deepcopy(state['details'][query['id']])
            elif 'id' in query:
                selected = next(item for item in data.pop('rows') if item['id'] == query['id'])
                data['selection'] = selected
                data['points'] = []
                for index, ts in enumerate([stamp(-30), stamp(-15), stamp()]):
                    probability = [None, .2, .235][index] if selected['id'] == f'{1:024x}' else None
                    if selected['id'] == f'{3:024x}' and query.get('reference') == 'pn':
                        probability = .2 if index == 1 else None
                    data['points'].append(dict(ts=ts, prices={'fd': 450-index*50, 'pn': 400-index*25, 'circa': 410-index*30},
                                              fair=400 if probability == .2 else 326 if probability else None,
                                              probability=probability))
            route.fulfill(json=data)
        elif 'cdn.jsdelivr.net' in request_url:
            route.fulfill(content_type='application/javascript', body="""window.supabase = {createClient: () => ({auth: {
                getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                onAuthStateChange: fn => {window.authChanged = fn; return {};}
            }})};""")
        elif request_url.startswith('https://ev-sharps.test/'):
            asset = ROOT / request_url.split('/', 3)[3].split('?', 1)[0]
            route.fulfill(path=asset) if asset.is_file() else route.fulfill(status=404, body='')
        else:
            route.fulfill(status=404, body='')

    page.route('**/*', intercept)
    page.goto('https://ev-sharps.test/movement.html?sport=nhl')
    expect(page.locator('#catalog-rows tr')).to_have_count(4)
    expect(page.locator('#catalog-count')).to_have_text('4 selections')
    expect(page.locator('#chart-title')).to_have_text('Matched Skater')
    assert not any(item.get('id') in [f'{5:024x}', f'{6:024x}'] for item in state['requests'])
    expect(page.locator('#chart-subtitle')).to_contain_text('Anytime goalscorer (1+)')
    expect(page.locator('#chart-subtitle')).to_contain_text('0.5')
    expect(page.locator('#selection-metrics')).to_contain_text('2:45 PM')
    assert '2:30 PM' not in page.locator('#selection-metrics').inner_text()
    expect(page.locator('#selection-metrics')).to_contain_text('2 books')
    assert '2:45 PM' in page.locator('#catalog-rows tr').first.locator('td').nth(4).inner_text()
    page.wait_for_function("document.getElementById('movement-chart').data?.some(t => t.meta?.fair)")
    assert page.evaluate("document.getElementById('movement-chart').data.find(t => t.meta?.fair).y") == [None, 20, 23.5]
    assert page.evaluate("document.getElementById('movement-chart').data.find(t => t.meta?.fair).connectgaps") is False
    assert 'only 0.5' in page.locator('#capture-methodology').text_content()

    # Endpoint values remain visible even without a comparable consensus series.
    page.locator('#catalog-rows tr').nth(1).locator('button').click()
    expect(page.locator('#chart-title')).to_have_text('Independent Skater')
    expect(page.locator('#selection-metrics')).to_contain_text('Single book · Pinnacle')
    expect(page.locator('#selection-metrics')).to_contain_text('Single book · Circa')
    expect(page.locator('#chart-status')).to_contain_text('Independent endpoint fair values')
    expect(page.locator('#selection-metrics')).to_contain_text('No matched comparison')
    assert page.locator('#selection-metrics > div').nth(2).locator('strong').inner_text() == '—'
    assert page.evaluate("document.getElementById('movement-chart').data.every(t => !t.meta?.fair)")
    expect(page.locator('#chart-footnote')).to_contain_text('not connected')
    output = Path(tempfile.mkdtemp(prefix='movement-fair-'))
    page.screenshot(path=str(output/'independent-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.clock.run_for(400)
    page.wait_for_function("document.getElementById('movement-chart')._fullLayout.width <= 390")
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(output/'independent-mobile.png'), full_page=True)

    # No usable pair is not described as merely waiting for a second raw capture.
    page.locator('#catalog-rows tr').nth(3).locator('button').click()
    expect(page.locator('#selection-metrics')).to_contain_text('Paired quotes unavailable')
    expect(page.locator('#chart-status')).to_contain_text('no opposite-side prices are estimated')
    assert 'Awaiting next capture' not in page.locator('#selection-metrics').inner_text()

    # Explicit reference retains the known first fair and a gap at missing latest.
    page.select_option('#reference-select', 'pn')
    page.clock.run_for(20)
    page.locator('#catalog-rows tr').nth(2).locator('button').click()
    expect(page.locator('#chart-title')).to_have_text('Missing Latest Skater')
    expect(page.locator('#chart-status')).to_contain_text('not the latest capture')
    cards = page.locator('#selection-metrics > div')
    expect(cards.nth(0).locator('strong')).to_have_text('+400')
    expect(cards.nth(1).locator('strong')).to_have_text('—')
    expect(cards.nth(1)).to_contain_text('No paired quotes')
    page.wait_for_function("document.getElementById('movement-chart').data?.some(t => t.meta?.fair)")
    assert page.evaluate("document.getElementById('movement-chart').data.find(t => t.meta?.fair).y") == [None, 20, None]

    # Several raw snapshots with just one usable fair point are still pending.
    first = state['payload']['rows'][2]
    first.update(first_fair_at=first['current_fair_at'], first_probability=first['current_probability'],
                 first_fair=first['current_fair'], change_pp=0)
    page.select_option('#reference-select', 'consensus')
    page.clock.run_for(20)
    page.locator('#catalog-rows tr').first.locator('button').click()
    expect(page.locator('#selection-metrics')).to_contain_text('Awaiting next fair capture')
    expect(page.locator('#chart-status')).to_contain_text('First usable fair capture')
    assert page.locator('#selection-metrics > div').nth(2).locator('strong').inner_text() == '—'

    # Client filtering of an old paginated response keeps the server's offsets.
    state['payload']['total'] = 200
    page.locator('#refresh').click()
    expect(page.locator('#next-page')).to_be_enabled()
    page.locator('#next-page').click()
    expect(page.locator('#previous-page')).to_be_enabled()
    assert any(item.get('offset') == '100' for item in state['requests'])

    # Exercise the real collector -> API shapes too, when review fixtures exist.
    fixture_dir = ROOT.parent / 'odds' / 'out_line_movement_review'
    real_paths = [fixture_dir / f'nhl_detail_{kind}.json' for kind in ['matched', 'single', 'raw']]
    if all(path.is_file() for path in real_paths):
        details = [json.loads(path.read_text(encoding='utf-8')) for path in real_paths]
        state['details'] = {data['selection']['id']: data for data in details}
        state['payload'] = json.loads((fixture_dir / 'nhl_response.json').read_text(encoding='utf-8'))
        state['payload']['rows'] = [data['selection'] for data in details]
        state['payload']['total'] = len(details)
        page.clock.set_fixed_time(datetime.fromisoformat(state['payload']['updated'].replace('Z', '+00:00')))
        page.goto('https://ev-sharps.test/movement.html?sport=nhl')
        expect(page.locator('#catalog-rows tr')).to_have_count(3)
        for index, data in enumerate(details):
            selected = data['selection']
            page.locator('#catalog-rows tr').nth(index).locator('button').click()
            expect(page.locator('#chart-title')).to_have_text(selected['player'].title())
            if selected['fair_comparable']:
                page.wait_for_function("document.getElementById('movement-chart').data?.some(t => t.meta?.fair)")
                expected = [point['probability'] * 100 if point['probability'] is not None else None for point in data['points']]
                assert page.evaluate("document.getElementById('movement-chart').data.find(t => t.meta?.fair).y") == expected
            else:
                assert page.evaluate("document.getElementById('movement-chart').data.every(t => !t.meta?.fair)")
                if selected['current_reference_books']:
                    expect(page.locator('#selection-metrics')).to_contain_text('Single book')
            if selected.get('note'):
                expect(page.locator('#chart-status')).to_have_text(selected['note'])
    assert not errors, errors
    browser.close()
    print(f'Line movement fair coverage checks passed. Screenshots: {output}')
