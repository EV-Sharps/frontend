"""Offline preset source/staking checks. All external requests are intercepted."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import sys
import tempfile

from playwright.sync_api import sync_playwright, expect

STAGED = Path(__file__).resolve().parents[1]
WORKSPACE = next((p for p in STAGED.parents if (p / 'record_codec.py').is_file()), STAGED.parent / 'odds')
SITE = WORKSPACE.parent / 'frontend'
sys.path.insert(0, str(WORKSPACE))
from record_codec import pack_records

helpers = {'__name__': 'preset_browser_helpers', '__file__': str(STAGED / 'tests' / 'dev-picker.py')}
exec(compile((SITE / 'tests' / 'dev-picker.py').read_text(encoding='utf-8'), helpers['__file__'], 'exec'), helpers)


def records(source, *, legacy=False):
    # Legacy returns and absolute profit favor the first reference; actual stake
    # ROI favors the second, so the UI cannot pass by reusing either old metric.
    values = [('pn', 40, 90, 9, 90), ('circa', 30, 5, 5, 10)] if source == 'closing' else [('fd', 50, 90, 9, 90), ('dk', 10, 5, 5, 20)]
    return {'worst': {book: {f'atgs-vs-{ref}': {
        window: dict(roi=roi, kelly_roi=legacy_roi, wins=12, losses=8, profit=roi / 5, kelly=kelly,
                     **({} if legacy else {'kelly_stake_units': stake}))
        for window in ['All', 'SZN', 'L7']}
        for ref, roi, legacy_roi, kelly, stake in values} for book in ['best', 'fd']}}


def payload(feed='nhl', *, available=True, kelly_available=True, legacy=False):
    return dict(schema_version=1, feed=feed, price_source='opening', available=available,
                kelly_available=kelly_available, kelly_metric='units_per_100_settled',
                updated='2026-10-14T12:00:00Z', source_updated='2026-10-13T12:00:00Z',
                window=dict(start='2026-07-01', end='2026-10-13'), records=pack_records(records('opening', legacy=legacy)))


def first(page):
    return page.locator('#dev-picker .dev-chip').first


def check_modes(browser, origin, width):
    page = browser.new_page(viewport=dict(width=width, height=950))
    errors, requests, held = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    helpers['mock_page'](page, ['atgs'])
    state = {'payload': payload(), 'hold': False, 'status': 200}

    def opening(route):
        requests.append(route.request.url)
        if state['hold']:
            held.append(route)
        else:
            route.fulfill(status=state['status'], json=state['payload'])

    page.route('**/presets/*_opening.json*', opening)
    page.goto(f'{origin}/atgs.html?devig=pn&weight=1&required=pn')
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    page.evaluate('''async record => {
        RECORD = record; RECORD_UPD = '2026-10-13T10:00:00Z';
        METHOD = ''; DEV_WINDOW = 'L7'; DEVIG = 'pn'; WEIGHT = '1'; REQUIRED = ['pn'];
        setBookSelection(''); setOptions('prop-options', ['atgs']);
        await initDevPicker(getTopDevigs('best'));
    }''', records('closing'))
    assert requests == [], 'Opening must not load until requested'
    expect(page.locator('#dev-preset-prices')).to_have_value('closing')
    expect(page.locator('#dev-preset-staking')).to_have_value('flat')
    expect(first(page)).to_have_attribute('data-value', 'pn')
    expect(first(page).locator('.dev-roi')).to_have_text('+40% ROI')
    assert page.locator('#dev-picker .dev-profit').count() == 0
    unchanged = page.evaluate('({BOOK, DEVIG, WEIGHT, REQUIRED, METHOD, MIN, MAX, liveKelly:getKellyFraction()})')

    page.select_option('#dev-preset-staking', 'quarter-kelly')
    expect(first(page)).to_have_attribute('data-value', 'circa')
    expect(first(page).locator('.dev-roi')).to_have_text('+50% ROI')
    expect(first(page).locator('.dev-profit')).to_have_text('+5u')
    expect(first(page).locator('.dev-profit')).to_have_attribute('title', '¼ Kelly: +5u net profit on 10u settled stake. Fixed 100u bankroll; no compounding.')
    expect(page.locator('#dev-preset-note')).to_contain_text('ROI = net profit / settled stake')
    expect(page.locator('#dev-preset-note')).to_contain_text('Fixed 100u bankroll')
    page.select_option('#dev-preset-prices', 'opening')
    expect(first(page)).to_have_attribute('data-value', 'dk')
    expect(first(page).locator('.dev-roi')).to_have_text('+25% ROI')
    expect(first(page).locator('.dev-profit')).to_have_text('+5u')
    expect(page.locator('#dev-preset-note')).to_contain_text('2026-07-01')
    expect(page.locator('#dev-preset-note')).to_contain_text('Records updated 2026-10-13')
    page.select_option('#dev-preset-staking', 'flat')
    expect(first(page)).to_have_attribute('data-value', 'fd')
    expect(first(page).locator('.dev-roi')).to_have_text('+50% ROI')
    assert page.locator('#dev-picker .dev-profit').count() == 0
    assert page.evaluate('({BOOK, DEVIG, WEIGHT, REQUIRED, METHOD, MIN, MAX, liveKelly:getKellyFraction()})') == unchanged
    assert len(requests) == 1 and '/nhl_opening.json' in requests[0]
    assert page.evaluate('RECORD') == records('closing')
    page.select_option('#dev-window-select', 'SZN')
    expect(page.locator('#dev-preset-prices')).to_have_value('opening')
    expect(first(page).locator('.dev-roi')).to_have_text('+50% ROI')

    # The modal and chip controls agree and retain the modal's separate scope.
    page.evaluate('openPreloadsWindow()')
    expect(page.locator('#preload-preset-prices')).to_have_value('opening')
    page.select_option('#preload-book-select', 'fd')
    page.select_option('#preload-prop-select', 'atgs')
    page.select_option('#min-bets', '10')
    page.select_option('#preload-preset-staking', 'quarter-kelly')
    expect(page.locator('#dev-preset-staking')).to_have_value('quarter-kelly')
    expect(page.locator('#preload-book-select')).to_have_value('fd')
    expect(page.locator('#preload-prop-select')).to_have_value('atgs')
    expect(page.locator('#min-bets')).to_have_value('10')
    expect(page.locator('.preload-row').first).to_have_attribute('data-devig', 'dk')
    expect(page.locator('.preload-row').first).to_contain_text('+25% ROI')
    expect(page.locator('.preload-row').first.locator('.dev-profit')).to_have_text('+5u')
    page.select_option('#preload-preset-prices', 'closing')
    expect(page.locator('#dev-preset-prices')).to_have_value('closing')
    expect(page.locator('#preload-book-select')).to_have_value('fd')
    expect(page.locator('#min-bets')).to_have_value('10')
    expect(page.locator('.preload-row').first).to_have_attribute('data-devig', 'circa')
    expect(page.locator('.preload-row').first).to_contain_text('+50% ROI')
    expect(page.locator('.preload-row').first.locator('.dev-profit')).to_have_text('+5u')
    page.locator('.preload-row').first.get_by_role('button', name='Apply').click()
    applied = page.evaluate('({BOOK, DEVIG, WEIGHT, REQUIRED, props:[...document.querySelectorAll("#prop-options input:checked")].map(input=>input.value), liveKelly:getKellyFraction()})')
    assert applied == {'BOOK': 'fd', 'DEVIG': 'circa', 'WEIGHT': '1', 'REQUIRED': ['circa'], 'props': ['atgs'], 'liveKelly': unchanged['liveKelly']}, applied

    # Missing Kelly is never replaced with flat ROI, even if the source has flat winners.
    state['payload'] = payload(kelly_available=False)
    page.evaluate("OPENING_PRESET_CACHE.delete('nhl')")
    page.select_option('#dev-preset-prices', 'opening')
    expect(page.locator('#dev-picker .dev-no-record').first).to_contain_text('Kelly data')
    assert page.locator('#dev-picker .dev-roi').count() == 0
    assert page.locator('#dev-picker .dev-profit').count() == 0
    expect(page.locator('#dev-preset-note')).to_contain_text('results are unavailable')
    page.select_option('#dev-preset-staking', 'flat')
    expect(first(page).locator('.dev-roi')).to_have_text('+50% ROI')

    # Older packed histories remain valid for flat stakes but cannot imply a
    # Kelly ROI from the old profit-per-100-bets field alone.
    page.select_option('#dev-preset-prices', 'closing')
    state['payload'] = payload(legacy=True)
    page.evaluate("OPENING_PRESET_CACHE.delete('nhl')")
    page.select_option('#dev-preset-prices', 'opening')
    expect(first(page).locator('.dev-roi')).to_have_text('+50% ROI')
    page.select_option('#dev-preset-staking', 'quarter-kelly')
    expect(page.locator('#dev-picker .dev-no-record').first).to_contain_text('Kelly data')
    assert page.locator('#dev-picker .dev-roi, #dev-picker .dev-profit').count() == 0
    page.evaluate('openPreloadsWindow()')
    page.select_option('#min-bets', '0')
    expect(page.locator('.preload-row').first).to_contain_text('Kelly data')
    assert page.locator('.preload-row .dev-profit').count() == 0
    assert '% ROI' not in page.locator('#preloads-list-container').inner_text()
    page.select_option('#min-bets', '10')
    page.locator('#close-preloads-modal').click()
    page.locator('#close-devig-modal').click()

    # Closing legacy data has the same availability rules. Measured zero and
    # negative profit remain real returns; a zero stake is unavailable.
    page.select_option('#dev-preset-prices', 'closing')
    page.evaluate('record => { RECORD = record; refreshPresetViews(); }', records('closing', legacy=True))
    expect(page.locator('#dev-picker .dev-no-record').first).to_contain_text('Kelly data')
    assert page.locator('#dev-picker .dev-roi, #dev-picker .dev-profit').count() == 0
    page.select_option('#dev-preset-staking', 'flat')
    expect(first(page).locator('.dev-roi')).to_have_text('+40% ROI')
    page.evaluate('''record => {
        RECORD = record;
        for (const book of Object.values(RECORD.worst)) {
            for (const stats of Object.values(book['atgs-vs-pn'])) stats.kelly = 0;
            for (const stats of Object.values(book['atgs-vs-circa'])) stats.kelly = -2;
        }
        refreshPresetViews();
    }''', records('closing'))
    page.select_option('#dev-preset-staking', 'quarter-kelly')
    expect(first(page)).to_have_attribute('data-value', 'pn')
    expect(first(page).locator('.dev-roi')).to_have_text('0% ROI')
    expect(first(page).locator('.dev-profit')).to_have_text('0u')
    losing = page.locator('#dev-picker .dev-chip[data-value="circa"]')
    expect(losing.locator('.dev-roi')).to_have_text('-20% ROI')
    expect(losing.locator('.dev-profit')).to_have_text('-2u')
    page.evaluate('''() => {
        for (const book of Object.values(RECORD.worst)) {
            for (const record of Object.values(book)) {
                for (const stats of Object.values(record)) stats.kelly_stake_units = 0;
            }
        }
        refreshPresetViews();
    }''')
    expect(page.locator('#dev-picker .dev-no-record').first).to_contain_text('Kelly data')
    assert page.locator('#dev-picker .dev-roi, #dev-picker .dev-profit').count() == 0
    page.evaluate('record => { RECORD = record; refreshPresetViews(); }', records('closing'))
    page.select_option('#dev-preset-staking', 'flat')

    # A failed response leaves usable source controls and an explicit retry.
    page.select_option('#dev-preset-prices', 'closing')
    state['status'] = 503
    page.evaluate("OPENING_PRESET_CACHE.delete('nhl')")
    page.select_option('#dev-preset-prices', 'opening')
    expect(page.locator('#dev-picker-row [data-preset-retry]')).to_be_visible()
    assert page.locator('#dev-picker .dev-chip').count() == 0
    page.evaluate('openPreloadsWindow()')
    expect(page.locator('#preload-preset-prices')).to_be_visible()
    expect(page.locator('#preloads-list-container [data-preset-retry]')).to_be_visible()
    state.update(status=200, payload=payload())
    page.locator('#preloads-list-container [data-preset-retry]').click()
    expect(page.locator('.preload-row').first).to_have_attribute('data-devig', 'fd')
    expect(page.locator('#preload-book-select')).to_have_value('fd')
    expect(page.locator('#min-bets')).to_have_value('10')
    page.locator('#close-preloads-modal').click()
    page.locator('#close-devig-modal').click()

    # A delayed old response cannot move the selected source back to Opening.
    page.select_option('#dev-preset-prices', 'closing')
    page.evaluate("OPENING_PRESET_CACHE.delete('nhl')")
    state['hold'] = True
    page.select_option('#dev-preset-prices', 'opening')
    expect(page.locator('.dev-picker-empty')).to_have_text('Loading opening presets…')
    page.select_option('#dev-preset-prices', 'closing')
    expect(first(page)).to_have_attribute('data-value', 'pn')
    assert len(held) == 1
    held.pop().fulfill(json=payload())
    page.wait_for_function("OPENING_PRESET_CACHE.get('nhl').status === 'ready'")
    expect(page.locator('#dev-preset-prices')).to_have_value('closing')
    expect(first(page)).to_have_attribute('data-value', 'pn')
    state['hold'] = False

    # Shared apply behavior maps both full-game and period team totals to real options.
    page.evaluate('''() => {
        PAGE='main'; SPORT='nfl'; DEV_STAKING='flat'; DEV_WINDOW='All'; setBookSelection('');
        const menu = document.getElementById('prop-options'); menu.replaceChildren();
        ['1h_away_total','1h_home_total','ml'].forEach(prop=>createOption(prop,menu));
        setOptions('prop-options',['1h_away_total','1h_home_total']);
        RECORD={worst:{best:{'1h_team_total-vs-pn':{All:{roi:10,wins:12,losses:8}}}}};
        initDevPicker(getTopDevigs('best'));
    }''')
    first(page).click()
    assert page.evaluate('getOptions("prop-options")') == ['1h_away_total', '1h_home_total']
    page.evaluate('openPreloadsWindow()')
    page.select_option('#preload-prop-select', '1h_team_total')
    page.select_option('#preload-book-select', 'best')
    page.locator('.preload-row').first.get_by_role('button', name='Apply').click()
    assert page.evaluate('getOptions("prop-options")') == ['1h_away_total', '1h_home_total']

    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Page must fit mobile viewport'
    for selector in ['#dev-preset-prices', '#dev-preset-staking', '#dev-window-select']:
        bounds = page.locator(selector).bounding_box()
        assert bounds and bounds['x'] >= -1 and bounds['x'] + bounds['width'] <= width + 1, (selector, bounds)
    artifacts = WORKSPACE / 'out_preset_modes'
    artifacts.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts / f'presets-{width}.png'))
    assert not errors, errors
    page.close()
    print(f'PASS: {width}px actual stake ROI/profit, four modes, reversed legacy ranking, modal synchronization/apply, legacy/zero-stake data, retry, stale response, main periods, live settings unchanged.', flush=True)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(helpers['QuietHandler'], directory=str(SITE)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=['--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "preset-modes-chromium.log"}'])
            for width in [1280, 320]:
                check_modes(browser, f'http://localhost:{server.server_port}', width)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
