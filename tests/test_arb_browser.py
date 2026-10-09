"""Fixture-only browser checks; intercept all network traffic, never publish or bet."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import gettempdir
from urllib.parse import parse_qs, urlparse
import json
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
SITE = HERE.parent if HERE.name == 'tests' and (HERE.parent / 'shared.js').is_file() else HERE.parent.parent / 'frontend'
STAGED = HERE if (HERE / 'arb.html').is_file() else SITE
OUTPUT = HERE if STAGED == HERE else Path(gettempdir()) / 'evsharp-arb-browser'
OUTPUT.mkdir(exist_ok=True)
state = dict(status=200, requests=[], manual_requests=[], empty=False, hold=None, held=None, expired=False, started=False)


API = STAGED if (STAGED / 'arb.mjs').is_file() else SITE.parent / 'api'
NODE = shutil.which('node') or str(Path(sys.executable).parent / 'Lib/site-packages/playwright/driver/node.exe')
ENGINE = r"""
import { arbResponse, arbQuery, calculateArb } from './arb.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (request.body) { process.stdout.write(JSON.stringify(calculateArb(request.body))); }
else {
  const options = arbQuery(request.query), now = Date.now(), stamp = new Date(now).toISOString();
  const sport = options.sport === 'all' ? 'nfl' : options.sport;
  const isMiddle = options.type !== 'arb';
  const fallback = {nfl: isMiddle ? 'rec_yd' : 'pass_td', ncaaf: 'pass_td', nhl: 'pts', nba: 'pts', wnba: 'pts', mlb: 'tb'};
  const prop = options.prop === 'all' ? fallback[sport] : options.prop;
  const start = new Date(now + 2 * 3600000).toISOString();
  const rows = [];
  for (let index = 0; index < 2; index++) {
    const base = { game: 'away @ home', player: index ? '<script>unsafe</script>' : 'cody fajardo', playerId: String(index), prop,
      links: {dk: 'https://example.test/over', nv: 'javascript:alert(1)'}, liquidity: {nv: [5000, 5000]} };
    const middle = isMiddle && (options.type === 'middle' || index > 0);
    if (middle) rows.push({...base, handicap: 40, bookOdds: {dk: '-110'}}, {...base, handicap: 45, bookOdds: {nv: '/-110'}});
    else rows.push({...base, handicap: 2.5, bookOdds: {dk: '240', nv: '/-120'}});
  }
  const feeds = {[sport]: {payload: {data: rows, times: {'away @ home': start}, updated: {dk: stamp, nv: stamp}}}};
  process.stdout.write(JSON.stringify(arbResponse(feeds, options, now)));
}
"""


def engine(query=None, body=None):
    request = dict(body=body) if body else dict(query={key: value[0] for key, value in query.items()})
    completed = subprocess.run([NODE, '--input-type=module', '--eval', ENGINE], input=json.dumps(request),
                               cwd=API, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(completed.stdout)


def fixture(query):
    result = engine(query=query)
    if state['empty']:
        result['plays'] = []
    # Mutate only freshness after real-engine evaluation to verify client guards too.
    now = datetime.now(timezone.utc)
    for play in result['plays']:
        if state['expired']:
            for leg in play['legs']:
                leg['updated_at'] = (now - timedelta(minutes=15)).isoformat()
        if state['started']:
            play['start'] = (now - timedelta(minutes=1)).isoformat()
    return result


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--disable-logging', f'--log-file={OUTPUT / "chromium.log"}'])
    page = browser.new_page(viewport=dict(width=1440, height=1120))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('window.EventSource = undefined;')

    def intercept(route):
        url = route.request.url
        if '/api/arb/calculate' in url:
            body = route.request.post_data_json
            state['manual_requests'].append(body)
            route.fulfill(json=engine(body=body))
        elif '/api/arb?' in url:
            query = parse_qs(urlparse(url).query)
            state['requests'].append((query, route.request.headers.get('authorization')))
            if query.get('amount') == [state['hold']]:
                state['held'] = (route, query)
                return
            route.fulfill(status=state['status'], json=fixture(query) if state['status'] == 200 else {'error': 'Fixture failure'})
        elif 'cdn.jsdelivr.net' in url:
            route.fulfill(content_type='application/javascript', body='''
              window.supabase = {createClient: () => ({auth: {
                getSession: async () => ({data: {session: {access_token: 'fixture-token'}}}),
                onAuthStateChange: fn => {window.authChanged = fn; return {};}
              }})};''')
        elif 'arb-preview.test' in url:
            name = urlparse(url).path.strip('/')
            path = STAGED / name if (STAGED / name).is_file() else SITE / name
            route.fulfill(path=str(path)) if '..' not in name and path.is_file() else route.fulfill(status=404, body='')
        else:
            route.fulfill(status=404, body='')

    page.route('**/*', intercept)
    page.goto('https://arb-preview.test/arb.html')
    expect(page.locator('#summary-amount')).to_have_text('$100.00')
    expect(page.locator('#plays .arb-play')).to_have_count(2)
    expect(page.locator('#plays .profit-pct').first).to_have_text('+19.10%')
    expect(page.locator('#plays .leg-cash').first).to_contain_text('$35.03')
    expect(page.locator('#coverage-status')).to_contain_text('NHL')
    assert state['requests'][-1][1] == 'Bearer fixture-token'
    assert state['requests'][-1][0]['liquidity'] == ['verified']
    assert 'books' not in state['requests'][-1][0]
    book_count = page.locator('#book-options input').count()
    assert book_count > 1
    expect(page.locator('#book-options input:checked')).to_have_count(book_count)
    assert page.locator('#plays script').count() == 0
    assert page.locator('#plays a[href^="javascript:"]').count() == 0
    expect(page.locator('#plays .liquidity-badge').first).to_have_text('Limit unverified')
    expect(page.locator('#plays .liquidity-badge').nth(1)).to_have_text('Quoted amount fits')
    assert page.locator('#book-picker').evaluate("el => getComputedStyle(el).overflowX") == 'visible'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'arb-desktop.png'), full_page=True)

    page.locator('#amount').fill('250')
    expect(page.locator('#arb-results')).to_be_hidden()
    expect(page.locator('#summary-amount')).to_have_text('$250.00')
    assert 'amount=250' in page.url
    page.select_option('#type-filter', 'middle')
    expect(page.locator('#min-profit')).to_have_value('-10')
    expect(page.locator('#plays .profit-pct').first).to_have_text('-4.55%')
    expect(page.locator('#middle-note')).to_be_visible()
    expect(page.locator('#plays .middle-reward').first).to_contain_text('41–44')
    expect(page.locator('#plays .middle-reward').first).to_contain_text('Conditional, not guaranteed')
    page.locator('#plays .outcomes summary').first.click()
    expect(page.locator('#plays .outcome-grid').first).to_contain_text('40')
    page.select_option('#prop-filter', 'rec_yd')
    page.wait_for_function("new URL(location.href).searchParams.get('prop') === 'rec_yd'")
    expect(page.locator('#arb-results')).to_be_visible()
    assert state['requests'][-1][0]['prop'] == ['rec_yd']
    page.select_option('#sport-filter', 'nhl')
    expect(page.locator('#prop-filter')).to_have_value('all')
    page.select_option('#liquidity-filter', 'any')
    expect(page.locator('#arb-results')).to_be_visible()
    assert state['requests'][-1][0]['liquidity'] == ['any']
    page.locator('#book-picker summary').click()
    page.locator('#book-options input[value="dk"]').uncheck()
    expect(page.locator('#arb-results')).to_be_visible()
    expect(page.locator('#book-options input[value="dk"]')).not_to_be_checked()
    expect(page.locator('#book-options input:checked')).to_have_count(book_count - 1)
    remaining_books = page.locator('#book-options input:checked').evaluate_all('inputs => inputs.map(input => input.value).sort()')
    assert state['requests'][-1][0]['books'] == [','.join(remaining_books)]
    page.reload()
    expect(page.locator('#arb-results')).to_be_visible()
    page.locator('#book-picker summary').click()
    expect(page.locator('#book-options input[value="dk"]')).not_to_be_checked()
    expect(page.locator('#book-options input:checked')).to_have_count(book_count - 1)
    page.locator('#book-options input[value="dk"]').check()
    expect(page.locator('#book-summary')).to_have_text('All books')
    expect(page.locator('#arb-results')).to_be_visible()
    assert 'books' not in state['requests'][-1][0]
    page.locator('#book-options input[value="dk"]').uncheck()
    expect(page.locator('#arb-results')).to_be_visible()
    page.locator('#all-books').click()
    expect(page.locator('#book-summary')).to_have_text('All books')
    expect(page.locator('#book-options input:checked')).to_have_count(book_count)
    page.keyboard.press('Escape')
    page.locator('#limit').fill('1')
    expect(page.locator('#plays .arb-play')).to_have_count(1)
    page.locator('#amount').fill('0')
    expect(page.locator('#arb-results')).to_be_hidden()
    expect(page.locator('#request-status')).to_contain_text('Enter a budget')
    page.locator('#amount').fill('100')
    expect(page.locator('#arb-results')).to_be_visible()

    state['hold'] = '222'
    page.locator('#amount').fill('222')
    page.wait_for_timeout(450)
    assert state['held'] is not None
    page.locator('#amount').fill('223')
    expect(page.locator('#summary-amount')).to_have_text('$223.00')
    route, query = state['held']
    route.fulfill(json=fixture(query))
    expect(page.locator('#summary-amount')).to_have_text('$223.00')
    state['hold'] = None

    state['expired'] = True
    page.locator('#refresh').click()
    expect(page.locator('#plays .arb-play')).to_have_count(0)
    expect(page.locator('#empty-message')).to_contain_text('expired')
    state['expired'] = False
    state['started'] = True
    page.locator('#refresh').click()
    expect(page.locator('#plays .arb-play')).to_have_count(0)
    state['started'] = False
    state['status'] = 503
    page.locator('#refresh').click()
    expect(page.locator('#arb-results')).to_be_hidden()
    expect(page.locator('#request-status')).to_contain_text('unavailable')
    state['status'] = 403
    page.locator('#refresh').click()
    expect(page.locator('#access-title')).to_contain_text('included with Sharp')
    expect(page.locator('#arb-results')).to_be_hidden()
    state['status'] = 200
    page.evaluate("window.authChanged('SIGNED_OUT', null)")
    expect(page.locator('#access-title')).to_contain_text('Sign in')

    page.locator('#manual-panel > summary').click()
    page.locator('#calculate').click()
    expect(page.locator('#manual-result')).to_be_visible()
    expect(page.locator('#manual-result .profit-pct')).to_have_text('+19.10%')
    expect(page.locator('#manual-result .leg-cash').first).to_contain_text('$35.03')
    assert state['manual_requests'][-1] == dict(amount=100, over=dict(line=2.5, odds=240), under=dict(line=2.5, odds=-120))
    page.locator('#over-odds').fill('90')
    expect(page.locator('#manual-result')).to_be_hidden()
    page.locator('#calculate').click()
    expect(page.locator('#manual-status')).to_contain_text('American odds')
    page.locator('#example-middle').click()
    page.locator('#calculate').click()
    expect(page.locator('#manual-result .profit-pct')).to_have_text('-4.55%')
    expect(page.locator('#manual-result .middle-reward')).to_contain_text('+$90.90')
    expect(page.locator('#manual-result .outcome-grid')).to_contain_text('41 to 44')
    expect(page.locator('#manual-result .outcome-grid')).to_contain_text('Over win / under win')
    expect(page.locator('#manual-result .outcome-grid')).to_contain_text('Over push / under win')
    page.evaluate("window.authChanged('SIGNED_IN', {access_token: 'new-fixture-token'})")
    expect(page.locator('#arb-results')).to_be_visible()
    assert state['requests'][-1][1] == 'Bearer new-fixture-token'

    page.set_viewport_size(dict(width=390, height=844))
    page.locator('#amount').fill('100')
    expect(page.locator('#summary-amount')).to_have_text('$100.00')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'arb-mobile.png'), full_page=True)
    page.set_viewport_size(dict(width=360, height=800))
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.goto('https://arb-preview.test/arb.html?sport=nba&prop=pts%2Breb')
    expect(page.locator('#prop-filter')).to_have_value('pts+reb')
    expect(page.locator('#arb-results')).to_be_visible()
    assert state['requests'][-1][0]['prop'] == ['pts+reb']
    page.goto('https://arb-preview.test/arb.html?books=dk')
    expect(page.locator('#arb-results')).to_be_visible()
    expect(page.locator('#book-summary')).to_have_text('DraftKings')
    expect(page.locator('#book-options input:checked')).to_have_count(1)
    page.locator('#book-picker summary').click()
    request_count = len(state['requests'])
    page.locator('#book-options input[value="dk"]').uncheck()
    expect(page.locator('#book-summary')).to_have_text('No books')
    expect(page.locator('#arb-results')).to_be_hidden()
    expect(page.locator('#request-status')).to_contain_text('Select at least one betting book')
    assert len(state['requests']) == request_count
    page.locator('#all-books').click()
    expect(page.locator('#arb-results')).to_be_visible()
    expect(page.locator('#book-options input:checked')).to_have_count(book_count)
    assert 'books' not in state['requests'][-1][0]
    assert not errors, errors
    browser.close()
print('Arb browser checks with real adapter/engine responses passed: desktop/mobile, filtering, middle outcomes, manual calculator, auth, stale/start guards, errors, races, and safe links.')
