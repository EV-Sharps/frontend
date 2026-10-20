/* Offline regression checks using the production Outliers callback and renderers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = process.env.OUTLIERS_TEST_SHARED_ROOT || path.resolve(__dirname, '..');
const changedRoot = process.env.OUTLIERS_TEST_SOURCE_ROOT || path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(changedRoot, 'outliers.html'), 'utf8');
const cards = fs.readFileSync(path.join(changedRoot, 'card.js'), 'utf8');
const shared = fs.readFileSync(path.join(frontend, 'shared.js'), 'utf8');
const filters = fs.readFileSync(path.join(frontend, 'filter.js'), 'utf8');
const performance = fs.readFileSync(path.join(frontend, 'page-performance.js'), 'utf8');
function between(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert(from >= 0 && to > from, `Missing production source region: ${start}`);
    return source.slice(from, to);
}

class Element {
    constructor(id = '') {
        this.id = id;
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.value = '';
        this.innerText = '';
    }
    set innerHTML(value) { this.html = value; this.children = []; this.value = ''; }
    get innerHTML() { return this.html || ''; }
    querySelectorAll(selector) {
        return this.children.filter(child => selector.includes(':checked') ? child.checked : true);
    }
    addEventListener() {}
}
const elements = new Map();
for (const id of ['game-options', 'prop-options', 'game-dd-button', 'prop-dd-button', 'card-container',
    'table-container', 'table', 'player-search', 'handicap-filter']) elements.set(id, new Element(id));
const document = {
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) { return elements.get(selector.replace(/^#/, '')); },
    querySelectorAll(selector) {
        const match = selector.match(/^#([^ ]+) (.+)$/);
        return match ? elements.get(match[1]).querySelectorAll(match[2]) : [];
    }
};
const bookHeader = new Element();
const headerColumn = {
    getField: () => 'bookOdds.fd',
    getElement: () => ({ querySelector: () => bookHeader })
};
const handlers = {};
const shownColumns = [];
const table = {
    options: {},
    rows: [],
    getColumns: () => [headerColumn],
    replaceData(data) { this.rows = data; return Promise.resolve(); },
    redraw() {},
    on(event, callback) { handlers[event] = callback; },
    showColumn(field) { shownColumns.push(field); },
};
let refresh;
let columns;
const gameCalls = [];
const seenTimestamps = [];
let filterCalls = 0;
const context = vm.createContext({
    console, document,
    window: { addEventListener() {}, innerWidth: 1200 },
    PAGE: 'outliers', SPORT: 'nba', RES: null, UPDATED: {},
    TABLE: table, MOBILE: false, MARK: undefined, PROP: undefined, GAME: undefined,
    PRETTY: undefined, IMP: undefined, DUE: undefined, CSV: undefined, CSV_DOWNLOADED: false,
    CURRENT_VIEW: 'desktop', CURR_USER: { metadata: {} }, API_BASE: 'https://fixture.invalid',
    parseURLParams() {}, wireChkddMenu() {}, initKellyToggle() {},
    createDataRefresh(url, apply, unchanged) { refresh = { url, apply, unchanged }; return apply; },
    timeAgo(value) { seenTimestamps.push(value); return '2m ago'; },
    populateGameOptions(games, times, menu) {
        gameCalls.push({ games, times });
        menu.children.push(...games.map(value => ({ value, checked: true })));
    },
    createOption(value, menu) { menu.children.push({ value, checked: true }); },
    async changeFilter() { filterCalls++; if (context.RES) await table.replaceData(context.RES.data); },
    changeView() {},
    showHideUserTable() {},
    loadMoreCards() {}, handleScroll() {}, liveNflMainMarket: () => null,
    computeOutlierFromBookOdds: row => ({ book: row.book, value: row.line, pct: 3 }),
    Tabulator: function (_selector, options) { columns = options.columns; table.options = options; return table; },
});
for (const name of ['evFormatter', 'bestBookFormatter', 'playerFormatter', 'plusMinusFormatter',
    'impliedFormatter', 'oppFormatter', 'rankingFormatter', 'evOddsFormatter', 'chartFormatter',
    'homerLogFormatter']) context[name] = () => '';
context.BOOK = '';
vm.runInContext('const CHKDD_STATE = {}; let MASTER_DATA = []; let ALL_CARD_DATA = []; let PREVIOUS_DATA = []; let CURRENT_CARD_INDEX = 0;', context);
vm.runInContext(between(filters, 'function restoreChkddState(', 'function wireChkddMenu('), context);
vm.runInContext(between(filters, 'function updateGameLabel(', 'const createGameOption ='), context);
vm.runInContext(between(filters, 'function updateHeaders(', 'function updateWeightHeader('), context);
vm.runInContext(between(shared, 'function hitRatePercent(', 'function getPropHitRateColumnItems('), context);
vm.runInContext(between(cards, 'function initializeCards(', 'const debouncedApplyFilters ='), context);
vm.runInContext(cards.slice(cards.indexOf('function renderCards(')), context);
vm.runInContext(between(cards, 'function cardHitRates(', 'function renderDue('), context);
vm.runInContext(between(performance, 'function refreshDataTimestamps(', '// One connection'), context);
const inline = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(script => script.includes('PAGE = "outliers"'));
assert(inline, 'Outliers initialization script exists');
new vm.Script(inline); // Syntax-check the actual complete page script.
new vm.Script(cards);
vm.runInContext(inline, context);
vm.runInContext('renderTable([])', context);
const columnFor = field => columns.find(column => column.field === field);
const rateCell = (rate, blurred = false) => ({ getValue: () => rate, getRow: () => ({ getData: () => ({ blurred }) }) });

(async () => {
    for (const key of ['szn', 'lyr', 'L5', 'L10', 'L20', 'career', 'bvt']) {
        const column = columnFor(`hitRates.${key}`);
        assert(column, `Desktop ${key} column is present`);
        assert.equal(column.formatter(rateCell({ w: 0, t: 5, p: 0 })), '0%', `${key} preserves 0%`);
        assert.equal(column.formatter(rateCell({ w: 0, t: 0, p: 0 })), '', `${key} hides absent samples`);
        assert.equal(column.formatter(rateCell(undefined)), '');
        assert.match(column.formatter(rateCell({ w: 0, t: 5, p: 0 }, true)), /class="blurred">0%/);
        assert.equal(column.sorter({ p: 0, t: 5 }, { p: 60, t: 5 }, null, null, null, 'desc'), -60);
        assert(page.includes(`id="custom_hitRates_${key}"`), `${key} can be customized`);
    }

    // Existing scalar-column layouts retain their corresponding selected columns.
    context.CURR_USER = { metadata: { outliers: ['player', 'hitRate', 'hitRateCareer'] } };
    handlers.dataLoaded([]);
    assert(shownColumns.includes('hitRates.szn'));
    assert(shownColumns.includes('hitRates.career'));
    assert(!shownColumns.includes('hitRates.lyr'));
    context.CURR_USER = { metadata: {} };

    for (const [sport, game, prop] of [['nba', 'bos @ ny', 'pts'], ['nhl', 'tor @ bos', 'atgs'], ['mlb', 'nyy @ bos', 'hr']]) {
        context.SPORT = sport;
        const payload = {
            games: [game], times: { [game]: '2026-10-20T23:00:00Z' }, props: [prop],
            updated: { fd: '2026-10-20T18:00:00Z' },
            data: [{ sport, game, prop, player: 'fixture player', book: 'fd', line: 120, handicap: 0.5,
                hitRates: { szn: { w: 0, t: 5, p: 0 }, lyr: { w: 2, t: 5, p: 40 } } }],
        };
        assert(refresh.url().endsWith(`/api/outliers?sport=${sport}`));
        await refresh.apply(payload);
        assert.equal(elements.get('game-options').children.length, 1, 'Game options replace previous sport');
        assert.equal(elements.get('game-options').children[0].value, game);
        assert.equal(elements.get('prop-options').children.length, 1);
        assert.equal(elements.get('prop-options').children[0].value, prop);
        assert.equal(elements.get('game-dd-button').innerText, 'All Games');
        assert.equal(elements.get('prop-dd-button').innerText, 'All Props');
        assert.strictEqual(gameCalls.at(-1).times, payload.times, 'Start times reach the game dropdown');
        assert.equal(table.rows[0].sport, sport);
        assert.match(bookHeader.innerHTML, /time-hdrs.*2m/);
        assert.equal(seenTimestamps.at(-1), payload.updated.fd);
    }

    // A refresh restores selection from the current options and updates the label.
    vm.runInContext('CHKDD_STATE["game-options"] = ["bos @ ny"];', context);
    await refresh.apply({ games: ['bos @ ny', 'lal @ gs'], times: {}, props: ['pts'], updated: {}, data: [{ player: 'fixture' }] });
    assert.equal(elements.get('game-options').children[1].checked, false);
    assert.equal(elements.get('game-dd-button').innerText, 'BOS @ NY');

    // Empty refreshes clear all reusable card state, both dropdowns, and stale labels.
    elements.get('card-container').innerHTML = '<div class="data-card">stale</div>';
    vm.runInContext('MASTER_DATA = ALL_CARD_DATA = PREVIOUS_DATA = [{ player: "stale" }]; CURRENT_CARD_INDEX = 20;', context);
    context.CURRENT_VIEW = 'mobile';
    await refresh.apply({ games: [], times: {}, props: [], updated: {}, data: [] });
    assert.equal(table.rows.length, 0);
    assert.equal(elements.get('card-container').innerHTML, '');
    assert.equal(vm.runInContext('MASTER_DATA.length + ALL_CARD_DATA.length + PREVIOUS_DATA.length + CURRENT_CARD_INDEX', context), 0);
    assert.equal(elements.get('game-options').children.length, 0);
    assert.equal(elements.get('prop-options').children.length, 0);
    assert.equal(elements.get('game-dd-button').innerText, 'No Games');
    assert.equal(elements.get('prop-dd-button').innerText, 'No Props');
    assert(!bookHeader.innerHTML.includes('time-hdrs'), 'An empty timestamp map removes stale book ages');

    // Metadata-only refreshes update the existing headers without re-rendering rows.
    const before = filterCalls;
    refresh.unchanged({ updated: { fd: '2026-10-20T19:00:00Z' } });
    assert.equal(filterCalls, before);
    assert.equal(context.RES.updated.fd, '2026-10-20T19:00:00Z');
    assert.equal(seenTimestamps.at(-1), '2026-10-20T19:00:00Z');

    // Evaluate the real card callsite, including its history option, with real renderers.
    const trendCall = cards.match(/\$\{(renderTrends\(cardHitRates\(rowData\)[^\r\n]+)\}/)?.[1];
    assert(trendCall, 'Production card trend callsite exists');
    context.pre = 'o';
    for (const sport of ['nba', 'nhl', 'mlb']) {
        context.SPORT = sport;
        context.rowData = { sport, prop: 'pts', handicap: 0.5, hitRates: Object.fromEntries(
            ['szn', 'lyr', 'L5', 'L10', 'L20', 'career', 'bvt'].map(key => [key, { w: 0, t: 5, p: 0 }])) };
        const html = vm.runInContext(trendCall, context);
        for (const label of ['Year', 'Last Yr', 'L5', 'L10', 'L20', 'Career', 'vs Opp']) assert(html.includes(`>${label}</div>`));
        assert.equal((html.match(/>0%<\/div>/g) || []).length, 7);
        context.rowData.hitRates.career = { w: 0, t: 0, p: 0 };
        delete context.rowData.hitRates.bvt;
        const absent = vm.runInContext(trendCall, context);
        assert(!absent.includes('>Career</div>'));
        assert(!absent.includes('>vs Opp</div>'));
    }
    console.log('PASS: Outliers games/times, refresh cleanup, book timestamps, all hit-rate windows, zero/missing rates, saved columns, and NBA/NHL/MLB cards.');
})().catch(error => { console.error(error); process.exitCode = 1; });
