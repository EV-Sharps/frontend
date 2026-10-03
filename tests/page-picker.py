"""Offline page picker checks: python tests/page-picker.py (requires Playwright)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def mock_page(page):
    page.set_default_timeout(10000)
    page.add_init_script('window.EventSource = undefined;')
    page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
    page.route('**/auth.js', lambda route: route.fulfill(
        body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace(
            'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
        content_type='application/javascript'))
    page.route('**/api/**', lambda route: route.fulfill(json={
        'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))


def check_real_page(browser, origin, width):
    page = browser.new_page(viewport={'width': width, 'height': 844})
    mock_page(page)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'{origin}/atgs.html')
    trigger = page.locator('#page-picker-btn')
    panel = page.locator('#page-picker-panel')
    trigger.click()
    assert panel.is_visible()
    assert trigger.get_attribute('aria-expanded') == 'true'
    assert panel.get_attribute('role') == 'dialog'
    assert panel.get_attribute('aria-modal') != 'true'
    bounds = panel.bounding_box()
    assert bounds['x'] >= 0 and bounds['y'] >= 0, bounds
    assert bounds['x'] + bounds['width'] <= width + 1, bounds
    assert bounds['y'] + bounds['height'] <= 845, bounds
    assert panel.evaluate("el => el.querySelector('.pp-search-row').previousElementSibling.matches('.pp-footer')")
    assert search_is_below_grid(panel)
    current = panel.locator('.pp-page-btn.current-page .pp-page-link')
    assert current.get_attribute('data-page') == 'atgs'
    assert current.get_attribute('aria-current') == 'page'
    assert panel.locator('.pp-page-btn').evaluate_all(
        "rows => rows.every(row => row.tagName === 'DIV' && row.querySelector('a.pp-page-link') && row.querySelector('button.pp-star'))")

    # Sport labels participate in a search across the entire catalog.
    search = page.locator('#page-picker-search')
    search.fill('NHL live')
    assert panel.locator('.pp-page-link').count() == 1
    assert panel.locator('.pp-page-link').get_attribute('data-page') == 'live?sport=nhl'
    search.fill('touchdown')
    assert panel.locator('.pp-page-link[data-page="tds"]').count() == 1
    search.fill('there-is-no-such-page')
    assert panel.locator('.pp-page-link').count() == 0
    page.locator('.pp-search-clear').click()
    assert search.input_value() == ''

    for section, destination in [('mlb', 'dingers'), ('nba', 'nba'), ('nfl', 'tds'), ('nhl', 'atgs'), ('account', 'profile')]:
        panel.locator(f'.pp-tab[data-key="{section}"]').click()
        assert panel.locator(f'.pp-tab[data-key="{section}"]').get_attribute('aria-pressed') == 'true'
        assert panel.locator(f'.pp-page-link[data-page="{destination}"]').count() == 1
        assert not panel.locator('.pp-reorder-toggle').is_visible()

    panel.locator('.pp-tab[data-key="nhl"]').click()
    original_url = page.url
    star = panel.locator('button.pp-star[data-val="atgs"]')
    star.focus()
    page.keyboard.press('Space')
    assert page.url == original_url and panel.is_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('page_favorites'))") == ['atgs']
    assert star.get_attribute('aria-pressed') == 'true'
    panel.locator('.pp-tab[data-key="favorites"]').click()
    assert panel.locator('.pp-page-link').count() == 1
    assert panel.locator('.pp-page-link').get_attribute('data-page') == 'atgs'
    assert not panel.locator('.pp-reorder-toggle').is_visible()
    page.reload()
    trigger.click()
    assert panel.locator('.pp-tab[data-key="favorites"]').get_attribute('aria-pressed') == 'true'
    assert panel.locator('button.pp-star[data-val="atgs"]').get_attribute('aria-pressed') == 'true'

    # Native controls are separately reachable by keyboard, including the star.
    link = panel.locator('.pp-page-link[data-page="atgs"]')
    link.focus()
    page.keyboard.press('Tab')
    assert page.evaluate("document.activeElement.matches('button.pp-star[data-val=atgs]')")
    page.keyboard.press('Space')
    assert page.url == original_url
    assert page.evaluate("JSON.parse(localStorage.getItem('page_favorites'))") == []
    assert not panel.locator('.pp-reorder-toggle').is_visible()
    page.keyboard.press('Escape')
    assert not panel.is_visible()
    assert trigger.get_attribute('aria-expanded') == 'false'
    assert trigger.evaluate('el => document.activeElement === el')
    trigger.click()
    page.mouse.click(width - 3, 842)
    assert not panel.is_visible()
    assert trigger.get_attribute('aria-expanded') == 'false'

    trigger.click()
    panel.locator('.pp-tab[data-key="nhl"]').click()
    assert panel.locator('.pp-page-link[data-page="nfl_tracker?sport=nhl"]').get_attribute('href').endswith('nfl_tracker.html?sport=nhl')
    page.evaluate("window.pickerDestination = null; changePage = value => { window.pickerDestination = value; };")
    panel.locator('.pp-page-link[data-page="atgs2"]').focus()
    page.keyboard.press('Enter')
    assert page.evaluate('window.pickerDestination') == 'atgs2'
    assert not panel.is_visible()
    trigger.click()
    page.screenshot(path=str(Path(tempfile.gettempdir()) / f'page-picker-{width}.png'))
    if width == 390:
        page.set_viewport_size({'width': width, 'height': 380})
        page.wait_for_function("document.getElementById('page-picker-panel').getBoundingClientRect().bottom <= 380")
        bounds = panel.bounding_box()
        assert bounds['x'] >= 0 and bounds['y'] >= 0, bounds
        assert bounds['x'] + bounds['width'] <= width + 1, bounds
        assert bounds['y'] + bounds['height'] <= 380, bounds
        assert search.is_visible()
        assert search_is_below_grid(panel)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'page-picker-390-compact.png'))
        panel.locator('.pp-page-link[data-page="atgs"]').click()
        assert page.evaluate('window.pickerDestination') == 'atgs'
    assert not errors, (width, errors)
    page.close()
    print(f'PASS: atgs {width}px: bounds, search, tabs, current page, favorites, keyboard and dismissal', flush=True)


def fixture_html(page_name, sport, packaged=False):
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head>
        <body><nav><div class="select-wrapper"><select id="page-select"></select></div></nav>
        <script>let CURR_USER = null;
        window.EV_APP_CONFIG = {{packaged: {json.dumps(packaged)}}};
        window.EVNative = {{navigate(value) {{window.nativeDestination = value;}}}};</script>
        <script src="/shared.js"></script>
        <script>PAGE = {json.dumps(page_name)}; SPORT = {json.dumps(sport)};</script></body></html>'''


def search_is_below_grid(panel):
    search_bounds = panel.locator('.pp-search-wrap').bounding_box()
    grid_bounds = panel.locator('#page-picker-grid').bounding_box()
    return search_bounds['y'] >= grid_bounds['y'] + grid_bounds['height'] - 1


def favorite_order(page):
    return page.locator('.pp-favorites-list > .pp-page-btn').evaluate_all(
        'rows => rows.map(row => row.dataset.favorite)')


def saved_favorites(page):
    return page.evaluate("JSON.parse(localStorage.getItem('page_favorites'))")


def displayed_favorite_order(page):
    return page.locator('.pp-favorites-list > .pp-page-btn').evaluate_all(
        '''rows => rows.sort((a, b) => {
            const first = a.getBoundingClientRect();
            const second = b.getBoundingClientRect();
            return first.top - second.top || first.left - second.left;
        }).map(row => row.dataset.favorite)''')


def assert_two_column_favorites(page):
    bounds = page.locator('.pp-favorites-list > .pp-page-btn').evaluate_all(
        'rows => rows.map(row => { const r = row.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width}; })')
    assert len(bounds) >= 4
    for index, card in enumerate(bounds):
        assert abs(card['x'] - bounds[index % 2]['x']) < 1, bounds
        if index % 2:
            previous = bounds[index - 1]
            assert abs(card['y'] - previous['y']) < 1, bounds
            assert card['x'] >= previous['x'] + previous['width'], bounds
        elif index:
            assert card['y'] > bounds[index - 2]['y'], bounds


def assert_stable_favorite_preview(page, expected, repeat_move):
    assert displayed_favorite_order(page) == expected
    # Repeated events at the held position must not swap the placeholder back.
    for _ in range(6):
        repeat_move()
        page.wait_for_timeout(40)
        assert displayed_favorite_order(page) == expected


def favorite_point(page, value, vertical=0.5):
    bounds = page.locator(f'.pp-favorites-list > .pp-page-btn[data-favorite="{value}"] .pp-page-link').bounding_box()
    return bounds['x'] + min(80, bounds['width'] / 2), bounds['y'] + bounds['height'] * vertical


def begin_mouse_drag(page, value):
    page.mouse.move(*favorite_point(page, value))
    page.mouse.down()
    assert page.locator('#page-picker-grid.pp-dragging').count() == 1
    assert page.locator('.pp-drag-ghost').count() == 1


def assert_reorder_mode(page, active):
    panel = page.locator('#page-picker-panel')
    toggle = panel.locator('.pp-reorder-toggle')
    assert panel.evaluate("el => el.classList.contains('pp-reordering')") == active
    assert toggle.get_attribute('aria-pressed') == str(active).lower()
    assert toggle.inner_text().strip() == ('Done' if active else 'Reorder')


def check_favorite_drag(browser, origin):
    page = browser.new_page(viewport={'width': 1280, 'height': 844})
    mock_page(page)
    url = f'{origin}/__favorite-drag.html'
    page.route(url, lambda route: route.fulfill(body=fixture_html('atgs', 'nhl'), content_type='text/html'))
    page.goto(url)
    original = ['atgs', 'nba', 'tds', 'dingers']
    page.evaluate('values => localStorage.setItem("page_favorites", JSON.stringify(values))', original)
    page.evaluate('() => { window.pickerDestinations = []; changePage = value => window.pickerDestinations.push(value); }')
    page.locator('#page-picker-btn').click()
    page.locator('.pp-tab[data-key="favorites"]').click()
    assert favorite_order(page) == original
    assert_two_column_favorites(page)
    assert page.locator('.pp-favorites-list .pp-page-sport').all_text_contents() == ['NHL', 'NBA', 'NFL', 'MLB']
    toggle = page.locator('.pp-reorder-toggle')
    assert toggle.is_visible()
    assert_reorder_mode(page, False)

    # Reordering requires the explicit mode, for both mouse and keyboard.
    page.locator('.pp-favorites-list .pp-page-link[data-page="atgs"]').focus()
    page.keyboard.press('Alt+ArrowDown')
    assert favorite_order(page) == original
    assert saved_favorites(page) == original
    page.mouse.move(*favorite_point(page, 'atgs'))
    page.mouse.down()
    page.wait_for_timeout(500)
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert saved_favorites(page) == original
    page.mouse.up()
    assert page.evaluate('window.pickerDestinations') == ['atgs']
    assert not page.locator('#page-picker-panel').is_visible()
    page.locator('#page-picker-btn').click()
    page.evaluate('window.pickerDestinations = []')
    toggle.click()
    assert_reorder_mode(page, True)

    # Mouse clicks and keyboard activation cannot navigate while arranging cards.
    page.locator('.pp-favorites-list .pp-page-link[data-page="nba"]').focus()
    page.keyboard.press('Enter')
    page.locator('.pp-favorites-list .pp-page-link[data-page="nba"]').click()
    assert page.evaluate('window.pickerDestinations') == []
    assert page.locator('#page-picker-panel').is_visible()
    assert favorite_order(page) == original

    first_slot = favorite_point(page, 'atgs')
    second_slot = favorite_point(page, 'nba')
    begin_mouse_drag(page, 'atgs')
    assert displayed_favorite_order(page) == original, 'Holding without moving must preserve the order'
    page.mouse.move(*second_slot, steps=8)
    assert_stable_favorite_preview(page, ['nba', 'atgs', 'tds', 'dingers'], lambda: page.mouse.move(*second_slot))
    page.mouse.move(*first_slot, steps=8)
    assert_stable_favorite_preview(page, original, lambda: page.mouse.move(*first_slot))
    last_slot = favorite_point(page, 'dingers', 0.8)
    page.mouse.move(*last_slot, steps=8)
    reordered = ['nba', 'tds', 'dingers', 'atgs']
    assert_stable_favorite_preview(page, reordered, lambda: page.mouse.move(*last_slot))
    assert saved_favorites(page) == original, 'Dragging should save only on drop'
    page.screenshot(path=str(Path(tempfile.gettempdir()) / 'page-picker-favorites-drag.png'))
    page.mouse.up()
    assert saved_favorites(page) == reordered
    assert page.evaluate('window.pickerDestinations') == []
    assert page.url == url
    assert page.locator('#page-picker-panel').is_visible()
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert_reorder_mode(page, True)

    page.reload()
    page.evaluate('() => { window.pickerDestinations = []; changePage = value => window.pickerDestinations.push(value); }')
    page.locator('#page-picker-btn').click()
    assert favorite_order(page) == reordered
    assert_two_column_favorites(page)
    assert_reorder_mode(page, False)
    toggle.click()
    begin_mouse_drag(page, 'atgs')
    page.mouse.move(*favorite_point(page, 'nba', 0.2), steps=8)
    assert displayed_favorite_order(page) != reordered
    page.keyboard.press('Escape')
    page.mouse.up()
    assert page.locator('#page-picker-panel').is_visible()
    assert_reorder_mode(page, True)
    assert favorite_order(page) == reordered
    assert saved_favorites(page) == reordered
    assert page.evaluate('window.pickerDestinations') == []
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0

    # Signed-in users must receive the same saved order through the profile hook.
    page.evaluate('''values => {
        CURR_USER = {metadata: {page_favorites: values}};
        window.favoriteSaves = [];
        window.savePageFavorites = values => window.favoriteSaves.push([...values]);
    }''', reordered)
    begin_mouse_drag(page, 'atgs')
    page.mouse.move(*favorite_point(page, 'nba', 0.2), steps=8)
    page.mouse.up()
    assert favorite_order(page) == original
    assert saved_favorites(page) == original
    assert page.evaluate('CURR_USER.metadata.page_favorites') == original
    assert page.evaluate('window.favoriteSaves') == [original]

    # Done restores normal click navigation and leaves the dropped order saved.
    toggle.click()
    assert_reorder_mode(page, False)
    page.locator('.pp-favorites-list .pp-page-link[data-page="nba"]').click()
    assert page.evaluate('window.pickerDestinations') == ['nba']
    assert not page.locator('#page-picker-panel').is_visible()
    assert saved_favorites(page) == original
    page.locator('#page-picker-btn').click()
    assert_reorder_mode(page, False)
    page.locator('.pp-favorites-list .pp-page-link[data-page="atgs"]').focus()
    page.keyboard.press('Alt+ArrowDown')
    assert favorite_order(page) == original
    toggle.click()
    page.locator('.pp-favorites-list .pp-page-link[data-page="atgs"]').focus()
    page.keyboard.press('Alt+ArrowDown')
    keyboard_order = ['nba', 'atgs', 'tds', 'dingers']
    assert favorite_order(page) == keyboard_order
    assert saved_favorites(page) == keyboard_order
    assert page.evaluate('window.favoriteSaves') == [original, keyboard_order]
    assert page.evaluate('window.pickerDestinations') == ['nba']

    # Escape without a drag exits Reorder first; the next Escape closes the picker.
    page.keyboard.press('Escape')
    assert_reorder_mode(page, False)
    assert page.locator('#page-picker-panel').is_visible()
    page.keyboard.press('Escape')
    assert not page.locator('#page-picker-panel').is_visible()
    page.locator('#page-picker-btn').click()
    assert_reorder_mode(page, False)

    # Leaving Favorites, searching, and closing all clear the editing state.
    toggle.click()
    page.locator('.pp-tab[data-key="nhl"]').click()
    assert_reorder_mode(page, False)
    assert not toggle.is_visible()
    page.locator('.pp-tab[data-key="favorites"]').click()
    assert toggle.is_visible()
    assert_reorder_mode(page, False)
    toggle.click()
    page.locator('#page-picker-search').fill('NBA')
    assert_reorder_mode(page, False)
    assert not toggle.is_visible()
    page.locator('.pp-search-clear').click()
    assert toggle.is_visible()
    assert_reorder_mode(page, False)
    toggle.click()
    page.mouse.click(1277, 842)
    assert not page.locator('#page-picker-panel').is_visible()
    page.locator('#page-picker-btn').click()
    assert_reorder_mode(page, False)
    assert favorite_order(page) == keyboard_order
    assert saved_favorites(page) == keyboard_order
    page.close()
    print('PASS: explicit Reorder mode, immediate two-column mouse drag, stable previews, persistence, mode resets, navigation and keyboard gating', flush=True)


def check_touch_favorite_drag(browser, origin):
    context = browser.new_context(viewport={'width': 390, 'height': 660}, is_mobile=True, has_touch=True)
    page = context.new_page()
    mock_page(page)
    url = f'{origin}/__touch-favorite-drag.html'
    page.route(url, lambda route: route.fulfill(body=fixture_html('atgs', 'nhl'), content_type='text/html'))
    page.goto(url)
    original = ['atgs', 'nba', 'tds', 'dingers', 'atgs2', 'fgs', 'nhl', 'live?sport=nhl',
                'tracker', 'profile', 'mlb', 'strikeouts', 'threes', 'pts', 'nfl', 'nfl_futures']
    page.evaluate('values => localStorage.setItem("page_favorites", JSON.stringify(values))', original)
    page.evaluate('() => { window.pickerDestinations = []; changePage = value => window.pickerDestinations.push(value); }')
    page.locator('#page-picker-btn').tap()
    page.locator('.pp-tab[data-key="favorites"]').tap()
    assert favorite_order(page) == original
    assert_two_column_favorites(page)
    assert_reorder_mode(page, False)
    grid = page.locator('#page-picker-grid')
    assert grid.evaluate('el => el.scrollHeight > el.clientHeight')
    cdp = context.new_cdp_session(page)

    def touch(kind, point=None):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if point is None else [
            {'x': point[0], 'y': point[1], 'id': 1, 'radiusX': 4, 'radiusY': 4, 'force': 1}]})

    def swipe_grid():
        # Native Chromium dispatch lets the browser choose scrolling/pointercancel.
        bounds = grid.bounding_box()
        visible_values = page.locator('.pp-favorites-list > .pp-page-btn').evaluate_all('''rows => {
            const grid = document.getElementById('page-picker-grid').getBoundingClientRect();
            return rows.filter(row => {
                const rect = row.getBoundingClientRect();
                return rect.top >= grid.top && rect.bottom <= grid.bottom;
            }).map(row => row.dataset.favorite);
        }''')
        x, start_y = favorite_point(page, visible_values[-1])
        end_y = bounds['y'] + 35
        touch('touchStart', (x, start_y))
        for step in range(1, 9):
            touch('touchMove', (x, start_y + (end_y - start_y) * step / 8))
            page.wait_for_timeout(20)
        touch('touchEnd')
        page.wait_for_function("document.getElementById('page-picker-grid').scrollTop > 0")

    swipe_grid()
    assert favorite_order(page) == original
    assert saved_favorites(page) == original
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert page.evaluate('window.pickerDestinations') == []

    # A fresh tab isolates Reorder mode from Chromium's inertial swipe scrolling.
    page.close()
    page = context.new_page()
    mock_page(page)
    page.route(url, lambda route: route.fulfill(body=fixture_html('atgs', 'nhl'), content_type='text/html'))
    page.goto(url)
    cdp = context.new_cdp_session(page)
    page.evaluate('() => { window.pickerDestinations = []; changePage = value => window.pickerDestinations.push(value); }')
    page.locator('#page-picker-btn').tap()
    grid = page.locator('#page-picker-grid')
    page.wait_for_function("document.getElementById('page-picker-grid').scrollTop === 0")
    page.locator('.pp-reorder-toggle').tap()
    assert_reorder_mode(page, True)
    page.screenshot(path=str(Path(tempfile.gettempdir()) / 'page-picker-favorites-touch.png'))
    start = favorite_point(page, 'atgs')
    end = favorite_point(page, 'nba', 0.8)
    touch('touchStart', start)
    assert page.locator('#page-picker-grid.pp-dragging').count() == 1
    assert displayed_favorite_order(page) == original
    for step in range(1, 7):
        touch('touchMove', (start[0] + (end[0] - start[0]) * step / 6,
                            start[1] + (end[1] - start[1]) * step / 6))
        page.wait_for_timeout(20)
    expected = ['nba', 'atgs', *original[2:]]
    assert_stable_favorite_preview(page, expected, lambda: touch('touchMove', end))
    assert saved_favorites(page) == original
    touch('touchEnd')
    assert favorite_order(page) == expected
    assert saved_favorites(page) == expected
    assert page.evaluate('window.pickerDestinations') == []
    assert page.locator('#page-picker-panel').is_visible()
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert_reorder_mode(page, True)

    # Move the right-hand card to the next row, preserving row-major order.
    start = favorite_point(page, 'atgs')
    end = favorite_point(page, 'dingers', 0.8)
    touch('touchStart', start)
    assert page.locator('#page-picker-grid.pp-dragging').count() == 1
    for step in range(1, 7):
        touch('touchMove', (start[0] + (end[0] - start[0]) * step / 6,
                            start[1] + (end[1] - start[1]) * step / 6))
        page.wait_for_timeout(20)
    expected = ['nba', 'tds', 'dingers', 'atgs', *original[4:]]
    assert_stable_favorite_preview(page, expected, lambda: touch('touchMove', end))
    touch('touchEnd')
    assert favorite_order(page) == expected
    assert saved_favorites(page) == expected

    touch('touchStart', favorite_point(page, 'nba'))
    assert page.locator('#page-picker-grid.pp-dragging').count() == 1
    touch('touchMove', favorite_point(page, 'atgs', 0.8))
    assert displayed_favorite_order(page) != expected
    touch('touchCancel')
    assert favorite_order(page) == expected
    assert saved_favorites(page) == expected
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert_reorder_mode(page, True)
    page.locator('.pp-favorites-list .pp-page-link[data-page="atgs"]').tap()
    assert page.evaluate('window.pickerDestinations') == []
    assert page.locator('#page-picker-panel').is_visible()
    page.locator('.pp-reorder-toggle').tap()
    assert_reorder_mode(page, False)
    page.locator('.pp-favorites-list .pp-page-link[data-page="atgs"]').tap()
    assert page.evaluate('window.pickerDestinations') == ['atgs']
    assert not page.locator('#page-picker-panel').is_visible()
    page.locator('#page-picker-btn').tap()
    assert_reorder_mode(page, False)
    swipe_grid()
    assert favorite_order(page) == expected
    assert saved_favorites(page) == expected
    assert page.locator('.pp-drag-ghost, .pp-drag-source, .pp-dragging').count() == 0
    assert page.evaluate('window.pickerDestinations') == ['atgs']
    context.close()
    print('PASS: immediate two-column touch drag, stable previews, touch cancel, blocked navigation and restored taps/swipes after Done', flush=True)


def check_routes(browser, origin):
    page = browser.new_page()
    page.set_default_timeout(10000)
    cases = [
        ('bets.html', 'bets', 'mlb', 'bets?sport=mlb'),
        ('main.html', 'main', 'mlb', 'main?sport=mlb'),
        ('live.html?sport=nhl', 'live', 'nhl', 'live?sport=nhl'),
        ('parlays.html?market=atgs', 'parlays', 'nhl', 'parlays?market=atgs'),
        ('parlays.html?market=attd', 'parlays', 'nfl', 'parlays?market=attd'),
        ('nfl_tracker.html?sport=nhl', 'nfl_tracker', 'nhl', 'nfl_tracker?sport=nhl'),
        ('nfl_tracker.html?sport=ncaaf', 'nfl_tracker', 'ncaaf', 'nfl_tracker?sport=ncaaf'),
        ('nfl_futures.html', 'futures', 'nfl', 'nfl_futures'),
        ('tracker.html', 'tracker', 'nhl', 'tracker'),
    ]
    for path, page_name, sport, expected in cases:
        url = f'{origin}/{path}'
        page.route(url, lambda route, _request, name=page_name, league=sport: route.fulfill(
            body=fixture_html(name, league), content_type='text/html'))
        page.goto(url)
        page.locator('#page-picker-btn').click()
        section = page.evaluate('value => PAGE_SECTIONS.find(section => section.pages.some(item => item.value === value)).key', expected)
        page.locator(f'.pp-tab[data-key="{section}"]').click()
        current = page.locator('.pp-page-btn.current-page .pp-page-link')
        assert current.count() == 1, (path, current.count())
        assert current.get_attribute('data-page') == expected, path
        if path == 'parlays.html?market=atgs':
            # The parlay market switches in place; reopening must refresh context.
            page.keyboard.press('Escape')
            page.evaluate("SPORT = 'nfl'; history.replaceState(null, '', '?market=attd')")
            page.locator('#page-picker-btn').click()
            page.locator('.pp-tab[data-key="nfl"]').click()
            assert current.get_attribute('data-page') == 'parlays?market=attd'
        page.unroute(url)

    # Verify defaults and aliases at the shared URL boundary, before navigation.
    expected_routes = {
        'nfl_tracker?sport=nhl': './nfl_tracker.html?sport=nhl',
        'main': './main.html?sport=mlb',
        'live': './live.html?sport=attd',
        'parlays?market=atgs': './parlays.html?market=atgs',
        'historical': './historical.html?historical=z',
        'kambi': './dingers.html?kambi=true',
    }
    for value, expected in expected_routes.items():
        assert page.evaluate('value => getPageUrl(value)', value) == expected

    destination = f'{origin}/nfl_tracker.html?sport=nhl'
    page.route(destination, lambda route: route.fulfill(body='<p>Tracker destination</p>', content_type='text/html'))
    with page.expect_navigation():
        page.evaluate("changePage('nfl_tracker?sport=nhl')")
    assert page.url == destination
    native_url = f'{origin}/__native-picker.html'
    page.route(native_url, lambda route: route.fulfill(
        body=fixture_html('atgs', 'nhl', packaged=True), content_type='text/html'))
    page.goto(native_url)
    page.evaluate("changePage('nfl_tracker?sport=nhl')")
    assert page.evaluate('window.nativeDestination') == 'nfl_tracker?sport=nhl'
    assert page.url == native_url
    page.close()
    print('PASS: current-page variants, route query order, defaults, aliases and native navigation', flush=True)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            origin = f'http://localhost:{server.server_port}'
            for width in [1280, 390]:
                check_real_page(browser, origin, width)
            check_routes(browser, origin)
            check_favorite_drag(browser, origin)
            check_touch_favorite_drag(browser, origin)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
