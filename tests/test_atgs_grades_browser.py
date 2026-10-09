"""Fixture-only ATGS grade dashboard checks; no live network or credentials."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import gettempdir
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
SITE = HERE.parent if HERE.name == 'tests' and (HERE.parent / 'shared.js').is_file() else HERE.parent.parent / 'frontend'
STAGED = HERE if (HERE / 'atgs-grades.html').is_file() else SITE
OUTPUT = HERE if STAGED == HERE else Path(gettempdir()) / 'evsharp-atgs-grades-browser'
OUTPUT.mkdir(exist_ok=True)
ACTUAL_REPORT = SITE.parent / 'odds' / 'static' / 'analysis' / 'atgs_grades' / 'report.json'
state = {'status': 200, 'code': 'unavailable', 'age': 0, 'ref_age': 0, 'started': False,
         'historical': True, 'hold': False, 'held': None, 'requests': [], 'actual': False}


def fixture():
    if state['actual']:
        return json.loads(ACTUAL_REPORT.read_text(encoding='utf-8'))
    now = datetime.now(timezone.utc)
    stamp = (now - timedelta(minutes=state['age'])).isoformat()
    ref_stamp = (now - timedelta(minutes=state['ref_age'])).isoformat()
    start = (now + timedelta(hours=-1 if state['started'] else 2)).isoformat()
    offers = []
    for index, grade in enumerate(['A', 'B', 'C', 'D', 'U']):
        for book in ['dk', 'fd']:
            # fd has a higher price but a weaker grade: grade precedes payout.
            row_grade = 'B' if index == 0 and book == 'fd' else grade
            ev = {'A': 6, 'B': 3, 'C': 1, 'D': -2, 'U': None}[row_grade]
            offers.append(dict(
                book=book, odds=400 if book == 'dk' else 500, grade=row_grade,
                score=ev, sharp_ev=ev, market_ev=ev, reference_floor_ev=ev,
                net_decimal=5 if book == 'dk' else 6, player='<script>alert(1)</script>' if index == 4 else ['connor mcdavid', 'auston matthews', 'jack hughes', 'sidney crosby'][index],
                game='edm @ tor', date=now.date().isoformat(), start=start,
                quote_updated=stamp, liquidity=None, link='https://username:secret@example.test/odds' if index == 1 else 'javascript:alert(1)',
                sharp_references=[] if grade == 'U' else [dict(book='circa', ev=ev, probability=.23, inferred=True, quote_updated=ref_stamp)],
                market_references=[] if grade == 'U' else [dict(book='kal', ev=ev, probability=.23, liquidity=[120, 350], quote_updated=ref_stamp)],
                reasons=['No verified prediction market depth'] if grade == 'U' else [],
            ))
    records = []
    for scope in ['best', 'dk', 'fd']:
        for split in ['all', 'development', 'evaluation']:
            for grade in ['A', 'B', 'C', 'D', 'U']:
                records.append(dict(scope=scope, split=split, grade=grade, selected=25, settled=20,
                                    wins=5, losses=15, pushes=0, pending=4, ungraded=1,
                                    profit_units=10, roi_pct=50 if split == 'evaluation' else 20,
                                    avg_odds=500, avg_ev=6, days=15, games=20,
                                    roi_interval=[-30, 110] if scope == 'best' else None))
    return dict(version=1, generated_at=now.isoformat(),
                policy=dict(version='atgs-sharp-liquid-markets-v1', policy_id='fixture-v1', stake=100,
                            min_reference_liquidity=100, method='worst'),
                current=dict(generated_at=stamp, offers=offers, coverage=dict(atgs_rows=10, rated_rows=8)),
                historical=dict(window=dict(start='2025-10-01', end='2026-10-07'),
                                split=dict(evaluation_start='2026-02-01', development_dates=70, evaluation_dates=30),
                                records=records, coverage=dict(archive_quote_times_verified=False, unrated_rows=20),
                                notes=['Archived liquidity is required, never inferred.']) if state['historical'] else None,
                prospective=dict(records=[dict(scope='best', split='all', grade=grade, selected=0,
                                               settled=0, wins=0, losses=0, pushes=0, pending=0,
                                               ungraded=0, profit_units=0, roi_pct=None, days=0,
                                               games=0, roi_interval=None) for grade in ['A', 'B', 'C', 'D', 'U']],
                                 coverage=dict(selected=0)), notes=['Fixture report'])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1440, height=1180))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('window.EventSource = undefined;')

    def intercept(route):
        url = route.request.url
        if '/api/atgs-grades' in url:
            state['requests'].append(route.request.headers.get('authorization'))
            if state['hold']:
                state['held'] = route
                return
            route.fulfill(status=state['status'], json=fixture() if state['status'] == 200 else {'code': state['code'], 'error': 'Fixture failure'})
        elif 'cdn.jsdelivr.net' in url:
            route.fulfill(content_type='application/javascript', body='''window.supabase = {createClient: () => ({auth: {
              getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
              onAuthStateChange: fn => {window.authChanged = fn; return {};}
            }})};''')
        elif 'grades-preview.test' in url:
            name = urlparse(url).path.strip('/')
            path = STAGED / name if (STAGED / name).is_file() else SITE / name
            if '..' not in name and path.is_file():
                route.fulfill(path=str(path))
            else:
                route.fulfill(status=404, body='')
        else:
            route.fulfill(status=404, body='')

    page.route('**/*', intercept)
    page.goto('https://grades-preview.test/atgs-grades.html')
    expect(page.locator('#current-count')).to_have_text('5')
    expect(page.locator('#a-count')).to_have_text('1')
    expect(page.locator('#graded-count')).to_have_text('4')
    expect(page.locator('.ag-model-status')).to_have_text('Initial rules / not yet validated')
    expect(page.locator('#offers tr')).to_have_count(5)
    expect(page.locator('#records tr')).to_have_count(5)
    expect(page.locator('#offers tr').first).to_have_attribute('data-book', 'dk')
    expect(page.locator('#record-context')).to_contain_text('Later chronological evaluation from 2026-02-01')
    expect(page.locator('#records tr').first).to_contain_text('+50.0%')
    assert state['requests'][-1] == 'Bearer fixture-token'
    assert page.locator('#offers script').count() == 0
    assert page.locator('#offers a[href^="javascript:"]').count() == 0
    assert page.locator('#offers a').count() == 0  # Userinfo links are rejected too.
    page.locator('#offers details').first.locator('summary').click()
    expect(page.locator('#offers details').first).to_contain_text('$120 Yes / $350 No')
    expect(page.locator('#offers details').first).to_contain_text('estimated at 7% vig')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'atgs-grades-desktop.png'), full_page=True)

    page.select_option('#grade-filter', 'A')
    expect(page.locator('#offers tr')).to_have_count(1)
    expect(page.locator('#records tr')).to_have_count(1)
    assert 'grade=A' in page.url
    page.select_option('#book-filter', 'fd')
    expect(page.locator('#offers-empty')).to_be_visible()
    expect(page.locator('#records tr')).to_have_count(1)
    expect(page.locator('#scope-note')).to_contain_text('FanDuel only')
    expect(page.locator('#records')).to_contain_text('Best-available scope only')
    page.select_option('#grade-filter', 'all')
    expect(page.locator('#offers tr')).to_have_count(5)
    page.select_option('#split-filter', 'development')
    expect(page.locator('#record-context')).to_contain_text('Earlier chronological period')
    expect(page.locator('#records tr').first).to_contain_text('+20.0%')
    page.select_option('#record-source', 'prospective')
    expect(page.locator('#split-label')).to_be_hidden()
    expect(page.locator('#records-empty')).to_be_visible()
    expect(page.locator('#records-empty-message')).to_contain_text('Forward tracking starts')
    page.select_option('#record-source', 'historical')
    page.select_option('#book-filter', 'best')

    state['age'] = 11
    page.locator('#refresh').click()
    expect(page.locator('#offers-empty')).to_be_visible()
    expect(page.locator('#current-count')).to_have_text('0')
    expect(page.locator('#records tr')).to_have_count(5)
    expect(page.locator('#freshness-status')).to_contain_text('10 saved offers hidden')
    state['age'] = 0
    state['ref_age'] = 11
    page.locator('#refresh').click()
    expect(page.locator('#current-count')).to_have_text('1')  # Fresh unrated offer has no references.
    expect(page.locator('#offers tr')).to_have_count(1)
    expect(page.locator('#offers tr')).to_have_attribute('data-grade', 'U')
    state['ref_age'] = 0
    state['started'] = True
    page.locator('#refresh').click()
    expect(page.locator('#current-count')).to_have_text('0')
    state['started'] = False
    state['historical'] = False
    page.locator('#refresh').click()
    expect(page.locator('#records-empty-message')).to_contain_text('historical backtest has not been built')
    state['historical'] = True

    state['status'] = 503
    state['code'] = 'not_published'
    page.locator('#refresh').click()
    expect(page.locator('#unpublished-panel')).to_be_visible()
    expect(page.locator('#report-content')).to_be_hidden()
    assert page.locator('#unpublished-panel code').count() == 0
    state['code'] = 'unavailable'
    page.locator('#refresh').click()
    expect(page.locator('#request-status')).to_contain_text('temporarily unavailable')
    expect(page.locator('#unpublished-panel')).to_be_hidden()
    state['status'] = 403
    page.locator('#refresh').click()
    expect(page.locator('#access-panel')).to_be_visible()
    expect(page.locator('#access-title')).to_contain_text('Analyst and Sharp')
    state['status'] = 200
    page.locator('#refresh').click()
    expect(page.locator('#report-content')).to_be_visible()

    state['hold'] = True
    page.locator('#refresh').click()
    page.wait_for_timeout(100)
    assert state['held'] is not None
    page.evaluate("window.authChanged('SIGNED_OUT', null)")
    expect(page.locator('#access-title')).to_contain_text('Sign in')
    expect(page.locator('#refresh')).to_be_enabled()
    state['held'].fulfill(json=fixture())
    expect(page.locator('#report-content')).to_be_hidden()
    state['hold'] = False
    page.evaluate("window.authChanged('SIGNED_IN', {access_token: 'replacement-token'})")
    expect(page.locator('#report-content')).to_be_visible()
    assert state['requests'][-1] == 'Bearer replacement-token'

    page.set_viewport_size(dict(width=390, height=844))
    page.select_option('#split-filter', 'evaluation')
    expect(page.locator('#offers tr')).to_have_count(5)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert page.locator('.ag-records-wrap').evaluate('el => el.scrollWidth > el.clientWidth')
    page.screenshot(path=str(OUTPUT / 'atgs-grades-mobile.png'), full_page=True)
    page.set_viewport_size(dict(width=360, height=800))
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    if ACTUAL_REPORT.is_file():
        state['actual'] = True
        actual = fixture()
        evaluation = [row for row in actual.get('historical', {}).get('records', [])
                      if row['scope'] == 'best' and row['split'] == 'evaluation']
        page.set_viewport_size(dict(width=1440, height=1180))
        page.goto('https://grades-preview.test/atgs-grades.html')
        expect(page.locator('#report-content')).to_be_visible()
        expect(page.locator('#records tr')).to_have_count(len(evaluation))
        a_settled = sum(row['settled'] for row in evaluation if row['grade'] == 'A')
        rated = sum(row['settled'] for row in evaluation if row['grade'] != 'U')
        expect(page.locator('#record-context')).to_contain_text(f'{rated:,} rated settled selections')
        expect(page.locator('#record-context')).to_contain_text(f'{a_settled:,} in A')
        for row in evaluation:
            if row['settled']:
                expect(page.locator(f'#records tr[data-grade="{row["grade"]}"]')).to_contain_text(f'{row["wins"]:,}–{row["losses"]:,}')
        if not actual['current']['offers']:
            expect(page.locator('#current-count')).to_have_text('0')
            expect(page.locator('#offers-empty')).to_be_visible()
        page.screenshot(path=str(OUTPUT / 'atgs-grades-actual-desktop.png'), full_page=True)
        page.set_viewport_size(dict(width=360, height=800))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUTPUT / 'atgs-grades-actual-mobile.png'), full_page=True)
        page.select_option('#record-source', 'prospective')
        expect(page.locator('#record-context')).to_contain_text('first fully rateable A–D selection successfully published')
        if actual.get('prospective', {}).get('generated_at'):
            expect(page.locator('#record-window')).to_contain_text('results updated')
        print(f'Actual saved report verified: {rated} rated settled evaluation selections; {a_settled} in A.')
    assert not errors, errors
    browser.close()
print('ATGS grades browser checks passed: grades/book scopes, records, stale/started quotes, auth/races, safe content, and desktop/mobile.')
