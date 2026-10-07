"""Offline card bookmaker ordering checks: python -B tests/card-book-order.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
INITIAL_ORDER = ['bookOdds_dk', 'bookOdds_fd', 'bookOdds_pn']
CARD_BOOKS = ['dk', 'fd', 'pn']


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


def mock_page(page, name):
    profile = {'id': 'fixture', 'tier': 'sharp', 'metadata': {f'{name}-order': INITIAL_ORDER}}
    page.add_init_script(f"""window.EventSource = undefined;
        localStorage.setItem('cached_profile', {json.dumps(json.dumps(profile))});""")
    page.set_default_timeout(10000)
    page.route('https://**/*', lambda route: route.fulfill(body='', content_type='application/javascript'))
    page.route('**/auth.js', lambda route: route.fulfill(
        body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace(
            'let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'),
        content_type='application/javascript'))
    page.route(re.compile(r'/record(?:_[a-z]+)*\.js(?:\?.*)?$'), lambda route: route.fulfill(
        body="var RECORD_UPD = ''; var RECORD = {worst: {best: {}}, mult: {best: {}}};",
        content_type='application/javascript'))
    page.route('**/api/**', lambda route: route.fulfill(json={
        'data': [], 'games': [], 'props': [], 'updated': {}, 'record': {}, 'times': {}}))


def expect_books(page, order, selector='#card-container .data-card'):
    page.wait_for_function("""({selector, order}) => {
        const cards = [...document.querySelectorAll(selector)];
        return cards.length && cards.every(card => JSON.stringify(
            [...card.querySelectorAll('.all-books-row .book-logo-small')].map(img => img.alt)
        ) === JSON.stringify(order));
    }""", arg={'selector': selector, 'order': order})


def snapshot_cards(page):
    page.evaluate("""() => {
        window.preservedCard = document.querySelector('#card-container .data-card');
        window.preservedBody = preservedCard.querySelector('.card-body-collapsed');
        window.preservedIndex = CURRENT_CARD_INDEX;
        window.preservedCount = document.querySelectorAll('#card-container .data-card').length;
        window.preservedScroll = document.querySelector('#table-container').scrollTop;
    }""")


def assert_preserved(page):
    assert page.evaluate("""() => {
        const card = document.querySelector('#card-container .data-card');
        return card === preservedCard && card.querySelector('.card-body-collapsed') === preservedBody
            && card.classList.contains('expanded') && preservedBody.classList.contains('visible')
            && CURRENT_CARD_INDEX === preservedIndex
            && document.querySelectorAll('#card-container .data-card').length === preservedCount
            && Math.abs(document.querySelector('#table-container').scrollTop - preservedScroll) < 2
            && JSON.stringify(fixtureRows) === fixtureBefore;
    }"""), 'Book reordering replaced card content, lost state, or mutated source rows'


def setup_cards(page):
    page.evaluate("""async () => {
        await tableReady;
        RES = null;
        DEVIG = 'pn'; WEIGHT = '1'; DEVIG_EXCLUDED = [];
        window.fixtureRows = Array.from({length: 45}, (_, i) => ({
            player: `fixture scorer ${i}`, prop: 'atgs', handicap: .5, under: false, ouIdx: 0,
            team: 'tor', opp: 'bos', game: 'tor @ bos', sport: 'nhl', pos: 'C',
            book: 'fd', line: 300, fairVal: 250, implied: 28.57, ev: 12 - i / 100, kelly: .3,
            bookOdds: {fd: '300/-400', pn: '250/-310', dk: '275/-350'},
            links: {}, liquidity: {fd: [100, 200]}, logs: [], hitRates: {}
        }));
        window.fixtureBefore = JSON.stringify(fixtureRows);
        TABLE.clearFilter(true);
        TABLE.clearSort();
        await TABLE.setData(JSON.parse(fixtureBefore));
        initializeCards(fixtureRows);
        CURRENT_VIEW = 'mobile';
        applyOddsTableView();
        CURR_SESSION = {user: {id: 'fixture'}};
        window.reorderWrites = [];
        SB = {from(table) { return {update(value) { return {eq(key, id) {
            reorderWrites.push({table, key, id, value: JSON.parse(JSON.stringify(value))});
            return Promise.resolve({error: null});
        }}; }}; }};
    }""")


def check_page(browser, origin, name, width):
    page = browser.new_page(viewport={'width': width, 'height': 844}, has_touch=width < 600)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    mock_page(page, name)
    page.goto(f'{origin}/{name}.html?view=mobile')
    page.wait_for_function("document.getElementById('data-status')?.hidden === true")
    setup_cards(page)

    # Cached metadata must be honored on the first card render, including desktop card view.
    expect_books(page, CARD_BOOKS)
    first = page.locator('#card-container .data-card').first
    assert first.locator('.book-odd-item.is-best-book .book-logo-small').get_attribute('alt') == 'fd'
    assert first.locator('.book-odd-item.is-devig-book .book-logo-small').get_attribute('alt') == 'pn'
    assert first.locator('.book-odd-liq').inner_text() == '$100/$200'
    first.locator('.card-arrow-container').click()
    page.evaluate("document.querySelector('#table-container').scrollTop = 180")
    snapshot_cards(page)

    # An unsaved table drag should immediately update existing cards and an open modal card.
    page.evaluate("showCardModal(fixtureRows[0])")
    page.evaluate("window.preservedModal = document.querySelector('#card-modal-inner .data-card')")
    page.evaluate("TABLE.moveColumn('bookOdds.pn', 'bookOdds.dk', false)")
    expect_books(page, ['pn', 'dk', 'fd'])
    expect_books(page, ['pn', 'dk', 'fd'], '#card-modal-inner .data-card')
    assert page.evaluate("document.querySelector('#card-modal-inner .data-card') === preservedModal")
    assert page.evaluate("preservedModal.classList.contains('expanded')")
    assert_preserved(page)
    page.evaluate("closeCardModal()")
    assert page.evaluate(f"CURR_USER.metadata['{name}-order']") == INITIAL_ORDER

    # Real Customize/Reorder Save rebuilds columns while cards remain active.
    page.evaluate("""() => {
        ENABLE_AUTH = true;
        for (const book of ['fd', 'dk', 'pn']) TABLE.showColumn(`bookOdds.${book}`);
        document.querySelectorAll('#overlay .loggedOut').forEach(el => el.style.display = 'none');
    }""")
    page.locator('#customize').click()
    page.locator('.cx-reorder').click()
    page.wait_for_function("document.querySelector('#col-reorder-modal').style.display === 'flex'")
    page.evaluate("""() => {
        const list = document.querySelector('#col-reorder-list');
        const fd = list.querySelector('[data-key="bookOdds_fd"]');
        const pn = list.querySelector('[data-key="bookOdds_pn"]');
        const dk = list.querySelector('[data-key="bookOdds_dk"]');
        list.prepend(fd, dk, pn);
    }""")
    snapshot_cards(page)
    page.locator('#col-reorder-modal button[onclick="saveColReorder()"]').click()
    page.wait_for_function('reorderWrites.length === 1')
    expect_books(page, ['fd', 'dk', 'pn'])
    assert_preserved(page)
    assert page.evaluate(f"CURR_USER.metadata['{name}-order'].filter(k => ['bookOdds_fd', 'bookOdds_dk', 'bookOdds_pn'].includes(k))") == [
        'bookOdds_fd', 'bookOdds_dk', 'bookOdds_pn']
    assert page.evaluate(f"JSON.parse(localStorage.getItem('cached_profile')).metadata['{name}-order']") == page.evaluate(
        f"CURR_USER.metadata['{name}-order']")
    page.keyboard.press('Escape')

    # Later profile order takes priority over an earlier unsaved move on the same table.
    page.evaluate("TABLE.moveColumn('bookOdds.pn', 'bookOdds.fd', false)")
    expect_books(page, ['pn', 'fd', 'dk'])
    page.evaluate("""() => {
        CURR_USER.metadata[`${PAGE}-order`] = ['bookOdds_dk', 'bookOdds_pn', 'bookOdds_fd'];
        RES = {data: JSON.parse(fixtureBefore)};
        REQUIRED = []; updateRequiredDropdown(); setBookSelection('');
        document.querySelectorAll('#exclude-options input').forEach(input => input.checked = false);
        document.getElementById('ou-select').value = 'o';
        document.getElementById('boost-select').value = '0';
        document.getElementById('min-odds').value = '';
        document.getElementById('max-odds').value = '';
        for (const [id, value] of [['game-options', 'tor @ bos'], ['prop-options', 'atgs']]) {
            const options = document.getElementById(id);
            options.replaceChildren(); createOption(value, options);
        }
        hydrateAfterProfileLoad();
    }""")
    expect_books(page, ['dk', 'pn', 'fd'])
    assert page.evaluate('JSON.stringify(fixtureRows) === fixtureBefore')

    # The renderer keeps unfamiliar books and underscore IDs; absent prices and duplicate
    # preference keys must not produce extra tiles. Both saved field conventions are supported.
    extra = page.evaluate("""() => {
        CURR_USER.metadata[`${PAGE}-order`] = ['ev', 'bookOdds_hr_oh', 'bookOdds.dk',
            'bookOdds_missing', 'bookOdds_hr_oh', 'bookOdds_fd'];
        const odds = {pn: '250', fd: null, hr_oh: '280', dk: '275', new_book: '290', mgm: ''};
        const before = JSON.stringify(odds);
        const holder = document.createElement('div');
        holder.innerHTML = renderAllBooks(odds, 'dk', {}, {});
        return {books: [...holder.querySelectorAll('.book-logo-small')].map(img => img.alt),
            untouched: before === JSON.stringify(odds)};
    }""")
    assert extra == {'books': ['hr_oh', 'dk', 'pn', 'new_book'], 'untouched': True}, extra
    assert not errors, errors
    page.close()
    print(f'{name} {width}px: saved, live, modal, reorder-save, late-profile, and fallback book order passed.', flush=True)


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width in [('atgs', 1280), ('nhl', 390)]:
            check_page(browser, f'http://localhost:{server.server_port}', name, width)
        browser.close()
finally:
    server.shutdown()
