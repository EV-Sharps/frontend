const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const weights = fs.readFileSync(path.join(__dirname, '../weights.js'), 'utf8');
function load(selection = '') {
    const context = vm.createContext({
        PAGE: 'nfl', SPORT: 'nfl', DEVIG: '', DEVIG_EXCLUDED: [], REQUIRED: [],
        METHOD: 'mult', WEIGHT: '', RES: undefined,
        document: { getElementById: () => ({ value: selection }) },
        getExcludedBooks: () => [],
    });
    vm.runInContext(source.slice(source.indexOf('function getImpliedProbabilityFromOddsString('), source.indexOf('function rowClick(')), context);
    return context;
}

test('best price is chosen only among selected books, independently for over and under', () => {
    const context = load();
    const prices = Object.freeze({ fd: '300/-140', dk: '400/-160', b365: '900/120' });
    assert.equal(context.highestOver(prices, [], 0, 'fd,dk', false).book, 'dk');
    assert.equal(context.highestOver(prices, [], 0, 'fd,dk', true).book, 'fd');
    assert.equal(context.highestOver(prices, [], 0, 'fd', false).value, 300);
    assert.equal(context.highestOver(prices, [], 0, '', false).book, 'b365');
    assert.equal(context.highestOver(prices, ['dk'], 0, 'fd,dk', false).book, 'fd');
});

test('missing selections and None never fall back to an unselected book', () => {
    const context = load();
    const prices = { fd: '300', b365: '900/120' };
    assert.equal(context.highestOver(prices, [], 0, 'fd,dk', false).book, 'fd');
    for (const selection of ['none', 'dk,px']) {
        assert.equal(context.highestOver(prices, [], 0, selection, false).book, null);
    }
    assert.equal(context.highestOver(prices, [], 0, 'fd,dk', true).book, null);
});

test('multi-book comparison retains exchange fees and boosts without mutating raw quotes', () => {
    const context = load();
    const prices = Object.freeze({ kal: '456/-567', dk: '440/-600', fd: '800/-950' });
    const row = { prop: 'rec', sport: 'nfl' };
    assert.equal(context.highestOver(prices, [], 0, 'kal,dk', false, row).book, 'dk');
    assert.equal(context.highestOver(prices, [], 20, 'kal,dk', false, row).value, 528);
    assert.equal(prices.kal, '456/-567');
});

test('outlier comparisons constrain betting candidates while preserving all reference prices', () => {
    const context = load('fd,dk');
    const row = { prop: 'rec', under: false, bookOdds: { fd: '300/-140', dk: '400/-160', b365: '900/120', pn: '100/-120' } };
    assert.equal(context.computeOutlierFromBookOdds(row).book, 'dk');
    context.DEVIG = 'pn';
    assert.equal(context.computeOutlierFromBookOdds(row).book, 'dk');
    assert.equal(load('none').computeOutlierFromBookOdds(row).book, null);
});

test('devig suggestions use each selected book record, keeping their identities', () => {
    const context = vm.createContext({
        METHOD: 'mult', DEV_WINDOW: 'All', PAGE: 'atgs',
        RECORD: { mult: Object.fromEntries(['fd', 'dk', 'b365'].map((book, i) => [book, {
            'atgs-vs-pn': { All: { roi: 10 + i, wins: 2, losses: 1 } },
        }])) },
    });
    vm.runInContext(weights.slice(weights.indexOf('function getTopDevigs('), weights.indexOf('// wire up the Preloads')), context);
    assert.equal(context.getTopDevigs('fd,dk').map(row => row.book).join(','), 'dk,fd');
    assert.equal(context.getTopDevigs('fd')[0].book, 'fd');
    assert.equal(context.getTopDevigs('none').length, 0);
});
