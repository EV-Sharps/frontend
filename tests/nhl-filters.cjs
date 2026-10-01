const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('let FB_CONFIG = {};'), source.indexOf('function getSavedFilterBuilders()')), context);
vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = config; };', context);
const rate = (field, value, cmp = 'gte') => ({ field, value, cmp });
const rates = (...rows) => ({ hitRate: { enabled: true, rows } });
function matches(config, row) {
    context.setConfig(config);
    return context.passesFilterBuilder(row);
}

test('hit-rate rules follow the selected period and row side, and all rules must match', () => {
    const over = { under: false, hitRates: { szn: { p: 40, w: 4, t: 10 }, L10: { p: 20, w: 2, t: 10 } } };
    const under = { under: true, hitRates: { szn: { p: 60, w: 6, t: 10 }, L10: { p: 80, w: 8, t: 10 } } };
    const config = rates(rate('szn', '50'), rate('L10', '80'));
    assert.equal(matches(config, over), false);
    assert.equal(matches(config, under), true, 'Structured under probabilities are already side-adjusted');
    assert.equal(matches(rates(rate('L10', '20', 'lte')), over), true);
    assert.equal(matches(rates(rate('L10', '20', 'lte')), under), false);
    assert.equal(matches(rates(rate('lyr', 50)), under), false, 'Do not substitute a different period');
});

test('valid zero rates match, while empty history and invalid percentages never become zero', () => {
    const config = rates(rate('L5', 0, 'lte'));
    assert.equal(matches(config, { hitRates: { L5: { p: 0, w: 0, t: 5 } } }), true);
    for (const value of [undefined, null, {}, { p: 0, t: 0 }, { p: '' }, { p: 'bad' }, { p: Infinity }, { p: -1 }, { p: 101 }]) {
        assert.equal(matches(config, { hitRates: { L5: value } }), false, JSON.stringify(value));
    }
    assert.equal(matches(rates(rate('L20', 75)), { hitRates: { L20: { w: '3', t: '4' } } }), true);
    assert.equal(matches(rates(rate('szn', 0)), { hitRate: '', logs: [0, 1, 0] }), false, 'Recent logs may contain last year');
    assert.equal(matches(rates(rate('szn', 0)), { hitRate: 0 }), true);
    assert.equal(matches(rates(rate('lyr', 50)), { hitRateLYR: '50%' }), true);
    assert.equal(matches(rates(rate('lyr', 50)), { hitRates: { lyr: { t: 0 } }, hitRateLYR: 80 }), false);
});

test('legacy career rates adjust only the under side; structured career rates are already adjusted', () => {
    const config = rates(rate('career', 70));
    assert.equal(matches(config, { hitRateCareer: 20, under: false }), false);
    assert.equal(matches(config, { hitRateCareer: 20, under: true }), true);
    assert.equal(matches(config, { hitRates: { career: { p: 80, t: 10 } }, under: true }), true);
    assert.equal(matches(config, { hitRateCareer: '', under: true }), false);
});

test('position filters support individual positions, wings, forwards and missing positions', () => {
    const rows = ['C', 'LW', 'RW', 'D', 'G', '', 'L', 'r', 'LW/RW'];
    const selected = value => rows.filter(pos => matches({ position: { enabled: true, value } }, { pos }));
    assert.deepEqual(selected('C'), ['C']);
    assert.deepEqual(selected('LW'), ['LW', 'L', 'LW/RW']);
    assert.deepEqual(selected('W'), ['LW', 'RW', 'L', 'r', 'LW/RW']);
    assert.deepEqual(selected('F'), ['C', 'LW', 'RW', 'L', 'r', 'LW/RW']);
    assert.deepEqual(selected('D'), ['D']);
    assert.deepEqual(selected('G'), ['G']);
    assert.equal(matches({ position: { enabled: false, value: 'C' } }, { pos: 'D' }), true);
});

test('NHL criteria combine with existing liquidity rules and disabled filters have no effect', () => {
    const config = { ...rates(rate('L10', 50)), position: { enabled: true, value: 'D' },
        liquidityEV: { enabled: true, book: 'px', amount: 50 } };
    const row = { pos: 'D', under: true, hitRates: { L10: { p: 60, t: 10 } }, liquidity: { px: [10, 50] } };
    assert.equal(matches(config, row), true);
    assert.equal(matches(config, { ...row, pos: 'LW' }), false);
    assert.equal(matches(config, { ...row, hitRates: {} }), false);
    assert.equal(matches(config, { ...row, liquidity: { px: [50, 10] } }), false);
    assert.equal(matches({ hitRate: { enabled: false, rows: [rate('L10', 50)] } }, {}), true);
    assert.equal(matches({}, {}), true);
});
