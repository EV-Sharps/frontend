"""Fixture-only browser checks; intercept every external request."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import gettempdir
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
SITE = HERE.parent if HERE.name == 'tests' and (HERE.parent / 'shared.js').is_file() else HERE.parent.parent / 'frontend'
STAGED = HERE if (HERE / 'hedge.html').is_file() else SITE
OUTPUT = HERE if STAGED == HERE else Path(gettempdir()) / 'evsharp-hedge-browser'
OUTPUT.mkdir(exist_ok=True)
state = dict(status=200, requests=[], empty=False, hold=None, held=None)


def fixture(query):
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    amount = float(query.get('amount', ['100'])[0])
    limit = int(query.get('limit', ['10'])[0])
    market = query.get('market', ['all'])[0]
    available = ['hr', 'atgs', 'attd', 'nba', 'nba_main', 'fb'] if market == 'all' else (
        ['nba', 'nba_main', 'fb'] if market == 'nba_all' else [market])
    books = {'dk': 'DraftKings', 'fd': 'FanDuel'}
    hedge_books = {'kal': 'Kalshi', 'nv': 'Novig'}
    chosen_books = query.get('books', [','.join(books)])[0].split(',')
    verified = query.get('liquidity', ['verified'])[0] == 'verified'
    groups = []
    for book in chosen_books:
        plays = []
        for index in range(min(limit, 2)):
            play_market = ['nba', 'nba_main'][index] if market == 'nba_all' else (
                market if market != 'all' else ['hr', 'atgs'][index])
            play = dict(
                id=f'{book}-{index}', player='aaron judge' if index == 0 else '<script>unsafe</script>',
                game='nyy @ bos' if play_market == 'hr' else 'nyr @ bos', sport='mlb' if play_market == 'hr' else 'nhl',
                market=play_market, label='1+ HR' if play_market == 'hr' else 'Anytime goalscorer',
                start=(now + timedelta(hours=2)).isoformat(), bonus_book=book, bonus_odds=600,
                bonus_amount=amount, bonus_link='https://example.test/bonus', bonus_updated_at=stamp,
                hedge_book='kal', hedge_odds=-500, hedge_link='javascript:alert(1)', hedge_updated_at=stamp,
                hedge_order_stake=amount * 5, hedge_fee=amount * .015, hedge_cash=amount * 5.015,
                hedge_liquidity=1000 if verified else None, liquidity_status='verified' if verified else 'unknown',
                max_bonus_amount=200 if verified else None, cash_if_yes=amount * .985,
                cash_if_no=amount * .983, retained_cash=amount * .983, conversion_pct=98.3,
                hedge_contracts=600, fee_note='Estimated taker fee included.',
            )
            if play_market in ('nba', 'nba_main', 'fb'):
                play.update(sport='nba', game='bos @ det', player='jayson tatum',
                    bonus_side='Under 25.5 points', hedge_side='Over 25.5 points', label='Player points',
                    cash_if_bonus_wins=amount * .985, cash_if_hedge_wins=amount * .983,
                    # New outcome names take precedence over legacy YES/NO fields.
                    cash_if_yes=1, cash_if_no=2, push_possible=False)
                if play_market == 'nba_main':
                    play.update(player='BOS', label='1st half spread',
                        bonus_side='BOS -1.5', hedge_side='DET +1.5',
                        hedge_link='https://example.test/main-market?side=other')
                elif play_market == 'fb':
                    play.update(label='First basket (including free throws)',
                                bonus_side='Jayson Tatum first basket', hedge_side='Jayson Tatum not first basket')
                if index == 1 and market in ('nba', 'nba_main'):
                    play.update(label='Player rebounds' if market == 'nba' else 'Full game total',
                        bonus_side='Over 6 rebounds' if market == 'nba' else 'Over 220 points',
                        hedge_side='Under 6 rebounds' if market == 'nba' else 'Under 220 points',
                        cash_if_push=0, push_possible=True, retained_cash=0, conversion_pct=0,
                        push_note='Cash stakes returned; bonus treatment depends on the book.')
            plays.append(play)
        groups.append(dict(book=book, total=12, plays=plays))
    if state['empty']:
        groups = []
    return dict(generated_at=stamp, max_age_minutes=10,
                options=dict(amount=amount, limit=limit, market=market, liquidity='verified' if verified else 'any'),
                books=books, hedge_books=hedge_books,
                coverage=[dict(market=item, sport={'hr': 'mlb', 'atgs': 'nhl', 'attd': 'nfl'}.get(item, 'nba'),
                               status='unavailable' if item == 'attd' else 'available', updated_at=stamp, version=1)
                          for item in available],
                summary=dict(markets=len(available), qualified=24 if groups else 0,
                             excluded=dict(liquidity=17, cash=3, conversion=0,
                                           settlement=4 if market in ('nba_all', 'nba', 'nba_main', 'fb') else 0)), groups=groups)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport=dict(width=1440, height=1200))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('window.EventSource = undefined;')

    def intercept(route):
        url = route.request.url
        if '/api/hedge?' in url:
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
        elif 'hedge-preview.test' in url:
            name = urlparse(url).path.strip('/')
            path = STAGED / name if (STAGED / name).is_file() else SITE / name
            if '..' not in name and path.is_file():
                route.fulfill(path=str(path))
            else:
                route.fulfill(status=404, body='')
        else:
            route.fulfill(status=404, body='')

    page.route('**/*', intercept)
    page.goto('https://hedge-preview.test/hedge.html')
    expect(page.locator('#summary-amount')).to_have_text('$100.00')
    expect(page.locator('.hedge-group')).to_have_count(2)
    expect(page.locator('.hedge-table tbody tr')).to_have_count(4)
    expect(page.locator('#coverage-status')).to_contain_text('NFL touchdowns')
    assert state['requests'][-1][1] == 'Bearer fixture-token'
    expect(page.locator('.conversion strong').first).to_have_text('98.30%')
    expect(page.locator('.payouts').first).to_contain_text('Bonus wins: $98.50')
    expect(page.locator('.payouts').first).to_contain_text('Hedge wins: $98.30')
    expect(page.locator('.cash-cell > strong').first).to_have_text('$501.50')
    expect(page.locator('.cash-cell').first).to_contain_text('600 contracts')
    page.locator('#page-picker-btn').click()
    expect(page.locator('#page-picker-grid')).to_contain_text('Bonus Bet Hedges')
    page.keyboard.press('Escape')
    assert page.locator('#book-groups script').count() == 0
    assert page.locator('#book-groups a[href^="javascript:"]').count() == 0
    assert page.locator('.hedge-cell a').count() == 0
    assert page.locator('.hedge-player-cell').first.evaluate("el => getComputedStyle(el).display") == 'table-cell'
    assert page.locator('#bonus-picker').evaluate("el => getComputedStyle(el).overflowX") == 'visible'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'hedge-desktop.png'), full_page=True)

    # Restoring any NBA URL must select the same market before the first API call.
    expect(page.locator('#market-filter option')).to_have_count(8)
    for nba_market in ('nba_all', 'nba', 'nba_main', 'fb'):
        page.goto(f'https://hedge-preview.test/hedge.html?market={nba_market}&books=dk&limit=2')
        expect(page.locator('#hedge-results')).to_be_visible()
        expect(page.locator('#market-filter')).to_have_value(nba_market)
        assert state['requests'][-1][0]['market'] == [nba_market]
        assert f'market={nba_market}' in page.url
        expect(page.locator('.hedge-group')).to_have_count(1)
        expect(page.locator('#excluded-note')).to_contain_text('4 incompatible or unknown settlement')
        expect(page.locator('.payouts').first).to_contain_text('Bonus wins: $98.50')
        expect(page.locator('.payouts').first).to_contain_text('Hedge wins: $98.30')
        assert 'If YES' not in page.locator('#book-groups').inner_text()
        assert 'If NO' not in page.locator('#book-groups').inner_text()
        if nba_market in ('nba_all', 'nba'):
            expect(page.locator('.bonus-cell .side-label').first).to_have_text('Under 25.5 points')
            expect(page.locator('.hedge-cell .side-label').first).to_have_text('Over 25.5 points')
        if nba_market == 'nba_all':
            expect(page.locator('#coverage-detail')).to_contain_text('NBA player props')
            expect(page.locator('#coverage-detail')).to_contain_text('NBA game / period lines')
            expect(page.locator('#coverage-detail')).to_contain_text('NBA first basket')
        if nba_market == 'nba_main':
            expect(page.locator('.market-label').first).to_contain_text('1st half spread')
            expect(page.locator('.bonus-cell .side-label').first).to_have_text('BOS -1.5')
            expect(page.locator('.hedge-cell .side-label').first).to_have_text('DET +1.5')
            expect(page.locator('.hedge-cell a').first).to_have_attribute('href', 'https://example.test/main-market?side=other')
        if nba_market in ('nba', 'nba_main'):
            push = page.locator('.hedge-table tbody tr').nth(1)
            expect(push.locator('.conversion strong')).to_have_text('0.00%')
            expect(push.locator('.conversion')).to_contain_text('$0.00 worst-case cash retained')
            expect(push.locator('.push-payout')).to_have_text('Push/tie: $0.00')
            expect(push.locator('.push-note')).to_contain_text('Cash stakes returned; bonus treatment depends on the book.')
            expect(page.locator('.hedge-table tbody tr').first.locator('.push-payout')).to_have_count(0)
        if nba_market == 'fb':
            expect(page.locator('.bonus-cell .side-label').first).to_have_text('Jayson Tatum first basket')
            expect(page.locator('.hedge-cell .side-label').first).to_have_text('Jayson Tatum not first basket')
    page.select_option('#market-filter', 'nba_main')
    expect(page.locator('.bonus-cell .side-label').first).to_have_text('BOS -1.5')
    assert state['requests'][-1][0]['market'] == ['nba_main']
    page.goto('https://hedge-preview.test/hedge.html')
    expect(page.locator('#summary-amount')).to_have_text('$100.00')

    page.locator('#bonus-amount').fill('250')
    expect(page.locator('#hedge-results')).to_be_hidden()
    expect(page.locator('#summary-amount')).to_have_text('$250.00')
    assert state['requests'][-1][0]['amount'] == ['250']
    assert 'amount=250' in page.url
    page.locator('#top-limit').fill('1')
    expect(page.locator('.hedge-table tbody tr')).to_have_count(2)
    page.select_option('#market-filter', 'atgs')
    expect(page.locator('#coverage-status')).to_be_hidden()
    expect(page.locator('.market-label').first).to_contain_text('Anytime goalscorer')
    page.locator('#bonus-picker summary').click()
    page.locator('#bonus-book-options input[value="dk"]').check()
    expect(page.locator('.hedge-group')).to_have_count(1)
    expect(page.locator('#bonus-summary')).to_have_text('DraftKings')
    assert state['requests'][-1][0]['books'] == ['dk']
    page.locator('#all-bonus-books').click()
    expect(page.locator('.hedge-group')).to_have_count(2)
    page.locator('#bonus-picker summary').click()
    page.locator('#hedge-picker summary').click()
    page.locator('#hedge-book-options input[value="kal"]').check()
    expect(page.locator('#hedge-summary')).to_have_text('Kalshi')
    page.wait_for_function("document.querySelector('#hedge-results').hidden === false")
    assert state['requests'][-1][0]['hedge_books'] == ['kal']
    page.keyboard.press('Escape')
    page.select_option('#liquidity-filter', 'any')
    expect(page.locator('#unknown-warning')).to_be_visible()
    expect(page.locator('.liquidity-badge').first).to_have_text('Limit unverified')
    assert page.locator('.liquidity-cell').first.inner_text().find('$1,000') == -1
    page.locator('#max-cash').fill('-1')
    expect(page.locator('#hedge-results')).to_be_hidden()
    expect(page.locator('#request-status')).to_contain_text('Enter a positive')
    page.locator('#max-cash').fill('5000')
    expect(page.locator('#hedge-results')).to_be_visible()
    assert state['requests'][-1][0]['max_cash'] == ['5000']

    state['hold'] = '222'
    page.locator('#bonus-amount').fill('222')
    page.wait_for_timeout(450)
    assert state['held'] is not None
    page.locator('#bonus-amount').fill('223')
    expect(page.locator('#summary-amount')).to_have_text('$223.00')
    route, query = state['held']
    route.fulfill(json=fixture(query))
    expect(page.locator('#summary-amount')).to_have_text('$223.00')
    state['hold'] = None

    state['empty'] = True
    page.locator('#refresh').click()
    expect(page.locator('#empty-results')).to_be_visible()
    expect(page.locator('.hedge-table tbody tr')).to_have_count(0)
    state['empty'] = False
    state['status'] = 503
    page.locator('#refresh').click()
    expect(page.locator('#hedge-results')).to_be_hidden()
    expect(page.locator('#request-status')).to_contain_text('unavailable')
    state['status'] = 200
    page.locator('#refresh').click()
    expect(page.locator('#hedge-results')).to_be_visible()
    state['status'] = 403
    page.locator('#refresh').click()
    expect(page.locator('#access-panel')).to_be_visible()
    expect(page.locator('#hedge-results')).to_be_hidden()
    expect(page.locator('#access-title')).to_contain_text('Analyst and Sharp')
    state['status'] = 200
    page.evaluate("window.authChanged('SIGNED_OUT', null)")
    expect(page.locator('#access-title')).to_contain_text('Sign in')
    page.evaluate("window.authChanged('SIGNED_IN', {access_token: 'new-fixture-token'})")
    expect(page.locator('#hedge-results')).to_be_visible()
    assert state['requests'][-1][1] == 'Bearer new-fixture-token'

    page.set_viewport_size(dict(width=390, height=844))
    page.locator('#bonus-amount').fill('100')
    expect(page.locator('#summary-amount')).to_have_text('$100.00')
    page.locator('#top-limit').fill('10')
    expect(page.locator('.hedge-table tbody tr')).to_have_count(4)
    page.select_option('#market-filter', 'all')
    expect(page.locator('#coverage-status')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'hedge-mobile.png'), full_page=True)
    page.set_viewport_size(dict(width=360, height=800))
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.select_option('#market-filter', 'nba_main')
    expect(page.locator('.push-payout').first).to_have_text('Push/tie: $0.00')
    expect(page.locator('.bonus-cell .side-label').first).to_have_text('BOS -1.5')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT / 'hedge-nba-mobile.png'), full_page=True)
    page.select_option('#market-filter', 'fb')
    expect(page.locator('.bonus-cell .side-label').first).to_have_text('Jayson Tatum first basket')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    browser.close()
print('Hedge browser checks passed: NBA URL filters, exact sides, push payouts, desktop/mobile, auth, errors, races, and safe links.')
