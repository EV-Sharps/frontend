const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const shared = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const weights = fs.readFileSync(path.join(__dirname, '../weights.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const implied = price => price > 0 ? 100 / (100 + price) : -price / (100 - price);
const mult = (prices, under = false) => {
    const [over, below] = prices.split('/').map(Number).map(implied);
    return (under ? below : over) / (over + below);
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

function load(options = {}, loadWeightFunctions = true) {
    const display = {};
    const context = vm.createContext({
        DEVIG: '', DEVIG_EXCLUDED: [], WEIGHT: '', REQUIRED: [], PAGE: 'nfl', RES: undefined,
        METHOD: 'mult', BOOK: '', VIG: '', HEATMAP: {}, menuUpdates: 0, bettingExcluded: [],
        console, URL, URLSearchParams,
        window: { location: { href: 'https://example.test/nfl.html' } },
        document: {
            getElementById: id => id === 'book-select' ? { value: '' } : id === 'devig-display-text' ? display : null,
            body: { classList: { toggle() {} } },
        },
        getToday: () => '2026-10-01', getSavedOddsView: () => 'table', supportsOddsViews: () => true,
        loadHeatmapData() {}, reorderOddsColumns() {}, initDevPicker() {}, getTopDevigs() { return []; },
        parseWeightKey: value => value,
        ...options,
    });
    context.history = { pushState: (_, __, value) => { context.window.location.href = new URL(value, context.window.location.href).href; } };
    context.getExcludedBooks = () => context.bettingExcluded;
    context.updateRequiredDropdown = () => { context.menuUpdates++; };
    vm.runInContext(shared.match(/^const ALL_WEIGHTABLE_BOOKS = .*;$/m)[0], context);
    vm.runInContext(shared.slice(shared.indexOf('function getImpliedProbabilityFromOddsString('), shared.indexOf('function rowClick(')), context);
    vm.runInContext(shared.slice(shared.indexOf('function setUrlParams('), shared.indexOf('function showHideUserTable(')), context);
    vm.runInContext(shared.slice(shared.indexOf('function parseURLParams('), shared.indexOf('// ── Generic column-reorder helpers')), context);
    vm.runInContext(shared.slice(shared.indexOf('function getRowROI('), shared.indexOf('const HELP_ITEMS')), context);
    if (loadWeightFunctions) vm.runInContext(weights.slice(weights.indexOf('function getDefaultWeights('), weights.indexOf('function renderWeightSettings(')), context);
    return context;
}

test('reference options are available before weights.js loads and retain excluded choices', () => {
    const context = load({}, false);
    const defaults = plain(context.getDevigReferenceBooks());
    assert.ok(defaults.includes('fd'));
    assert.ok(!defaults.includes('bol'), 'Normal EV keeps its existing market weights');
    context.DEVIG = 'only+fd+dk+fd;1+2+1';
    context.DEVIG_EXCLUDED = ['fd'];
    assert.deepEqual(plain(context.getDevigReferenceBooks()), ['fd', 'dk']);
    context.PAGE = 'atgs2';
    context.DEVIG = '';
    context.RES = { data: [{ bookOdds: { kambi: '150/-180' } }] };
    assert.ok(context.getDevigReferenceBooks().includes('bol'), 'Raw outlier market retains its existing reference universe');
    assert.ok(context.getDevigReferenceBooks().includes('kambi'));
});

test('excluding a custom reference preserves original weight indexes and can be reversed', () => {
    const context = load({ DEVIG: 'fd+dk+pn', WEIGHT: '2+7+11', DEVIG_EXCLUDED: ['dk'] });
    assert.deepEqual(plain(context.getUserWeights()), { fd: 2, pn: 11 });
    context.DEVIG_EXCLUDED = [];
    assert.deepEqual(plain(context.getUserWeights()), { fd: 2, dk: 7, pn: 11 });
    context.DEVIG = 'only+fd+dk;2+7';
    context.WEIGHT = '';
    assert.deepEqual(plain(context.getUserWeights()), { fd: 2, dk: 7 }, 'Legacy prefixes do not consume a weight index');
    context.DEVIG = '';
    context.DEVIG_EXCLUDED = ['fd'];
    assert.equal(context.getUserWeights().fd, undefined);
    assert.equal(context.getUserWeights().dk, 1);
    assert.equal(context.getDefaultWeights().fd, 1, 'The baseline is not mutated');
});

test('over and under fair values omit excluded books even with explicitly supplied weights', () => {
    const context = load({ DEVIG: 'fd+dk+pn', WEIGHT: '2+7+11', DEVIG_EXCLUDED: ['fd'] });
    const prices = Object.freeze({ fd: '500/-800', dk: '100/-110', pn: '120/-140' });
    for (const under of [false, true]) {
        const expected = (7 * mult(prices.dk, under) + 11 * mult(prices.pn, under)) / 18;
        close(context.averageDevigs(prices, 'fd', under, context.getUserWeights()), expected);
        close(context.averageDevigs(prices, 'fd', under, { fd: 2, dk: 7, pn: 11 }), expected);
    }
    assert.equal(context.highestOver(prices, [], 0, '', false).book, 'fd', 'Reference exclusion leaves the best offered price eligible');
    assert.deepEqual(prices, { fd: '500/-800', dk: '100/-110', pn: '120/-140' });
});

test('excluding every reference produces no fair value instead of falling back to market', () => {
    const context = load({ DEVIG: 'fd+dk', WEIGHT: '1+1', DEVIG_EXCLUDED: ['fd', 'dk'] });
    assert.deepEqual(plain(context.getUserWeights()), {});
    assert.ok(Number.isNaN(context.averageDevigs({ fd: '100/-110', dk: '120/-140' }, 'fd', false, { fd: 1, dk: 1 })));
    context.DEVIG = '';
    context.DEVIG_EXCLUDED = context.getDevigReferenceBooks();
    assert.deepEqual(plain(context.getUserWeights()), {});
});

test('outlier reference removal keeps its offered quote eligible in market and custom comparisons', () => {
    const prices = Object.freeze({ fd: '500/-800', dk: '100/-110', pn: '120/-140' });
    const context = load({ DEVIG_EXCLUDED: ['fd'], PAGE: 'outliers' });
    const row = { bookOdds: prices, prop: 'rec', under: false };
    const reference = (implied(100) + implied(120)) / 2;
    for (const devig of ['', 'fd+dk+pn']) {
        context.DEVIG = devig;
        const result = context.computeOutlierFromBookOdds(row);
        assert.equal(result.book, 'fd');
        close(result.deviation, reference - implied(500));
        close(result.pct, (reference - implied(500)) / reference);
    }
    assert.deepEqual(context.bettingExcluded, [], 'Temporary sharp exclusions do not mutate the betting controls');
    context.DEVIG_EXCLUDED = [];
    context.DEVIG = '';
    close(context.computeOutlierFromBookOdds(row).deviation,
        (implied(500) + implied(100) + implied(120)) / 3 - implied(500));
});

test('required availability ignores removed references and missing/all-excluded references do not create outliers', () => {
    const context = load({ DEVIG: 'fd+dk', DEVIG_EXCLUDED: ['fd'], REQUIRED: 'fd,dk' });
    const row = { bookOdds: { dk: '100/-110', b365: '500/-800' }, prop: 'rec', under: false };
    assert.equal(context.computeOutlierFromBookOdds(row).book, 'b365');
    context.REQUIRED = ['pn'];
    assert.equal(context.computeOutlierFromBookOdds(row).book, null);
    context.REQUIRED = [];
    context.DEVIG_EXCLUDED = ['fd', 'dk'];
    assert.equal(context.computeOutlierFromBookOdds(row).book, null);
    context.DEVIG = '';
    context.DEVIG_EXCLUDED = ['dk', 'b365'];
    assert.equal(context.computeOutlierFromBookOdds(row).book, null);
    context.DEVIG = 'pn';
    context.DEVIG_EXCLUDED = [];
    assert.equal(context.computeOutlierFromBookOdds(row).book, null);
});

test('under outliers average only available under quotes from included references', () => {
    const context = load({ DEVIG: 'fd+dk+pn', DEVIG_EXCLUDED: ['fd'] });
    const result = context.computeOutlierFromBookOdds({ bookOdds: { fd: '-800/500', dk: '-110/100', pn: '-140/120' }, prop: 'rec', under: true });
    assert.equal(result.book, 'fd');
    close(result.deviation, (implied(100) + implied(120)) / 2 - implied(500));
    const missing = context.computeOutlierFromBookOdds({ bookOdds: { fd: '-800/500', dk: '100', pn: '120' }, prop: 'rec', under: true });
    assert.equal(missing.book, null);
});

test('URL parsing round-trips exclusions, and adding another URL setting preserves them', () => {
    const context = load({ window: { location: { href: 'https://example.test/nfl.html?devig=fd-dk&weight=1-2&devig_excluded=fd,%20fd,,dk&book=fd' } } });
    context.parseURLParams();
    assert.equal(context.DEVIG, 'fd+dk');
    assert.deepEqual(plain(context.DEVIG_EXCLUDED), ['fd', 'dk']);
    context.setUrlParams({ method: 'power' });
    const saved = new URL(context.window.location.href).searchParams;
    assert.equal(saved.get('book'), 'fd');
    assert.equal(saved.get('method'), 'power');
    assert.ok(saved.has('devig_excluded'));
    context.window.location.href = 'https://example.test/nfl.html';
    context.parseURLParams();
    assert.deepEqual(plain(context.DEVIG_EXCLUDED), [], 'A fresh page has no stale exclusions');
});

test('saved devig defaults update the controls without overriding an explicit market URL', () => {
    for (const query of ['?devig=&devig_excluded=fd', '?devig_excluded=fd']) {
        const context = load({ window: { location: { href: `https://example.test/nfl.html${query}` } }, CURR_USER: { metadata: { 'nfl-devig': 'pn+circa;1+2' } }, METHOD: '' });
        context.parseURLParams();
        context.loadWeights();
        assert.equal(context.DEVIG, '');
        assert.deepEqual(plain(context.DEVIG_EXCLUDED), ['fd']);
        assert.equal(context.menuUpdates, 0);
    }
    const context = load({ CURR_USER: { metadata: { 'nfl-devig': 'pn+circa;1+2' } }, METHOD: '' });
    context.loadWeights();
    assert.equal(context.DEVIG, 'pn+circa');
    assert.equal(context.WEIGHT, '1+2');
    assert.equal(context.menuUpdates, 1);
});

test('a modified reference set does not show the original preset historical ROI', () => {
    const context = load({ DEVIG: 'pn+circa', HEATMAP: {
        grid: { evMin: 0, evBins: 31, evStep: 1, oddsMin: 100, oddsBins: 30, oddsStep: 100 },
        xy: { rec: { fd: { 'pn+circa': { '1': { '0': [2, 1, 50] } } } } },
    } });
    const row = { prop: 'rec', book: 'fd', ev: 1, line: 100 };
    assert.equal(context.getRowROI(row).wins, 2);
    context.DEVIG_EXCLUDED = ['pn'];
    assert.equal(context.getRowROI(row), null);
});
