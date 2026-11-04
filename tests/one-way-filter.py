"""Offline over-only filter coverage for tables, cards, presets and new visits."""
from copy import deepcopy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import runpy
import tempfile
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HARNESS = runpy.run_path(str(ROOT / 'tests/filter-window.py'))


def payload(sport):
    base = dict(sport=sport, prop='pts', handicap=20.5, game='duke @ unc',
                gameId='duke @ unc', team='duke', opp='unc', player='paired player',
                dt='2099-11-04', under=False, logs=[], hitRate=50, hitRateLYR=50,
                hitRates={}, pos='G', bookOdds={'fd':'200/-250', 'dk':'190/-230', 'pn':'170/-200'})
    rows = [base, dict(deepcopy(base), player='over only player',
                      bookOdds={'fd':'200', 'dk':'190/', 'pn':'170'}),
            dict(deepcopy(base), player='mixed player', bookOdds={'fd':'200', 'dk':'190', 'pn':'170/-200'})]
    return dict(data=rows, games=['duke @ unc'], props=['pts'], updated={},
                times={'duke @ unc':'2099-11-04T23:00:00Z'})


def names(page):
    return page.evaluate("""() => (CURRENT_VIEW === 'mobile'
        ? [...document.querySelectorAll('#card-container .data-card')].map(card => card.playerLinesData.player)
        : TABLE.getData('active').map(row => row.player)).sort()""")


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(HARNESS['QuietHandler'], directory=str(ROOT)))
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--disable-logging', f'--log-file={Path(tempfile.gettempdir()) / "one-way-filter.log"}'])
        for sport, width, view in [('ncaab', 1440, 'table'), ('nba', 390, 'mobile')]:
            page = browser.new_page(viewport={'width':width, 'height':844})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            HARNESS['mock_page'](page)
            page.route(f'**/api/{sport}*', lambda route: route.fulfill(json=payload(sport)))
            url = f'http://localhost:{server.server_port}/{sport}.html?view={view}&devig=pn&weight=1'
            page.goto(url)
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            expected = ['mixed player', 'over only player', 'paired player']
            assert names(page) == expected, names(page)
            HARNESS['setup_profile'](page)
            HARNESS['open_window'](page)
            toggle = page.locator('#fb-hide-one-way-enabled')
            expect(toggle).not_to_be_checked()
            toggle.check()
            assert names(page) == expected, 'checkbox applied before Apply'
            expect(page.locator('#fb-draft-status')).to_have_text('Changes not applied')
            HARNESS['action'](page, 'applyFilterBuilder')
            assert names(page) == ['mixed player', 'paired player'], names(page)
            assert page.evaluate('FB_CONFIG.hideOneWay.enabled') is True
            expect(page.locator('#filterbuilder-dd-button')).to_contain_text('1')
            HARNESS['open_window'](page)
            HARNESS['check_layout'](page, width)
            HARNESS['check_presets'](page)
            assert names(page) == ['mixed player', 'paired player'], 'preset did not reapply'
            HARNESS['action'](page, 'clearFilterBuilder')
            assert names(page) == expected, 'Clear did not restore over-only rows'
            toggle.check()
            HARNESS['action'](page, 'applyFilterBuilder')
            page.goto(url)
            page.wait_for_function("document.getElementById('data-status')?.hidden === true")
            expect(page.locator('#fb-hide-one-way-enabled')).not_to_be_checked()
            assert names(page) == expected, 'active filter persisted across new visits'
            assert errors == [], errors
            page.close()
            print(f'{sport} {view}: over-only rows, mixed books, Apply, Clear, presets, reload reset and layout passed.', flush=True)
        # Older pages receive the shared Filter window even without static filter markup.
        page = browser.new_page()
        HARNESS['mock_page'](page)
        page.goto(f'http://localhost:{server.server_port}/wnba.html')
        page.wait_for_function("document.getElementById('filterbuilder-dd')?.dataset.filterBuilderInit === '1'")
        expect(page.locator('#fb-hide-one-way-enabled')).to_have_count(1)
        expect(page.locator('#fb-hide-one-way-enabled')).not_to_be_checked()
        page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
    thread.join()
