const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const shared = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const weights = fs.readFileSync(path.join(__dirname, '../weights.js'), 'utf8');
const implied = price => price > 0 ? 100 / (100 + price) : -price / (100 - price);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

function load(options = {}) {
    const context = vm.createContext({
        PAGE: 'nba', SPORT: 'nba', DEVIG: '', DEVIG_EXCLUDED: [], WEIGHT: '',
        METHOD: 'mult', VIG: '7', RES: undefined, ...options,
    });
    vm.runInContext(shared.match(/^const ALL_WEIGHTABLE_BOOKS = .*;$/m)[0], context);
    vm.runInContext(shared.slice(shared.indexOf('function getDevigReferenceBooks('), shared.indexOf('function getAverageImplied(')), context);
    vm.runInContext(weights.slice(weights.indexOf('function getDefaultWeights('), weights.indexOf('function renderWeightSettings(')), context);
    vm.runInContext(shared.slice(shared.indexOf('let FB_CONFIG = {};'), shared.indexOf('function getSavedFilterBuilders()')), context);
    vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = config; };', context);
    return context;
}

const longshot = (bookOdds = {}, extra = {}) => ({
    player: 'Example Player', prop: '3ptm', handicap: 5.5, sport: 'nba', under: false,
    book: 'fd', line: 3000,
    bookOdds: { fd: '3000/-10000', dk: '2000/-5000', b365: '1000/-3000', nv: '-153/125', ...bookOdds },
    ...extra,
});

test('the screenshot pattern is hidden by default without changing quotes or calculated values', () => {
    const context = load();
    const row = longshot({}, { ev: 350.25, fairVal: 120, kelly: 0.3 });
    Object.freeze(row.bookOdds);
    Object.freeze(row);
    const before = JSON.stringify(row);
    const result = context.getExtremeMarketDisagreement(row);
    assert.equal(result.book, 'nv');
    close(result.probability, implied(-153));
    close(result.medianProbability, implied(2000));
    assert.equal(result.peerCount, 3);
    assert.equal(context.passesFilterBuilder(row), false);
    assert.equal(JSON.stringify(row), before, 'Filtering must not rewrite prices or the devig result');
});

test('a genuine better longshot price is retained instead of being filtered for low probability', () => {
    const context = load();
    const row = longshot({ fd: '1300/-2500', dk: '680/-1000', b365: '700/-1100', nv: '710/-1000' });
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    assert.equal(context.passesFilterBuilder(row), true);
    const extraLong = longshot({ fd: '10000/-50000', dk: '1000/-2000', b365: '1100/-2200', nv: '1200/-2300' });
    assert.equal(context.getExtremeMarketDisagreement(extraLong), null, 'Low implied probability alone is not a disagreement');
});

test('both a threefold probability difference and a 15-point gap are required', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    const smallGap = longshot({ fd: '3000', dk: '3000', b365: '3000', nv: '500' });
    assert.equal(context.getExtremeMarketDisagreement(smallGap), null, 'Large ratio with a 13-point gap is insufficient');
    const smallRatio = longshot({ fd: '300', dk: '300', b365: '300', nv: '-200' });
    assert.equal(context.getExtremeMarketDisagreement(smallRatio), null, 'Large gap with less than a threefold ratio is insufficient');
    assert.equal(context.getExtremeMarketDisagreement(longshot()).book, 'nv');
});

test('selected positive finite reference weights determine eligibility', () => {
    const row = longshot();
    assert.equal(load({ DEVIG: 'nv', WEIGHT: '1' }).getExtremeMarketDisagreement(row).book, 'nv');
    assert.equal(load({ DEVIG: 'nv', WEIGHT: '0.001' }).getExtremeMarketDisagreement(row).book, 'nv');
    for (const weight of ['0', '-1', 'NaN', 'Infinity', '']) {
        assert.equal(load({ DEVIG: 'nv', WEIGHT: weight }).getExtremeMarketDisagreement(row), null, weight);
    }
    assert.equal(load({ DEVIG: 'fd+dk', WEIGHT: '1+1' }).getExtremeMarketDisagreement(row), null);
    assert.equal(load({ DEVIG: 'fd+nv', WEIGHT: '2+0' }).getExtremeMarketDisagreement(row), null);
    assert.equal(load({ DEVIG: 'fd+nv', WEIGHT: '2+1' }).getExtremeMarketDisagreement(row).book, 'nv');
    assert.equal(load({ DEVIG: 'only+fd+nv;2+1' }).getExtremeMarketDisagreement(row).book, 'nv');
});

test('reference exclusions retain the quote while removing it from disagreement eligibility', () => {
    const context = load({ DEVIG_EXCLUDED: ['nv'] });
    const row = longshot();
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    assert.equal(context.passesFilterBuilder(row), true);
    assert.equal(row.bookOdds.nv, '-153/125');
    context.DEVIG_EXCLUDED = [];
    assert.equal(context.getExtremeMarketDisagreement(row).book, 'nv');
    context.DEVIG = 'nv';
    context.WEIGHT = '1';
    context.DEVIG_EXCLUDED = ['nv'];
    assert.equal(context.getExtremeMarketDisagreement(row), null);
});

test('raw probability comparison uses all present references regardless of normal EV default weights', () => {
    const context = load({ VIG: '0' });
    const row = longshot({}, { bookOdds: { fd: '3000', dk: '2000', b365: '1000', bol: '-153' } });
    assert.equal(context.getExtremeMarketDisagreement(row).book, 'bol');
    context.VIG = '7';
    assert.equal(context.getExtremeMarketDisagreement(row), null, 'BOL is not part of the existing default EV weights');
    context.VIG = '0';
    context.DEVIG_EXCLUDED = ['bol'];
    assert.equal(context.getExtremeMarketDisagreement(row), null);
});

test('raw selected comparisons use their actual equally weighted reference set', () => {
    const context = load({ VIG: '0', DEVIG: 'fd+nv', WEIGHT: '1+0' });
    const row = longshot();
    assert.equal(context.getExtremeMarketDisagreement(row).book, 'nv', 'Raw comparisons still use zero-weight selected books');
    context.DEVIG = 'fd+dk';
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    context.DEVIG = 'nv';
    assert.equal(context.getExtremeMarketDisagreement(row).book, 'nv');
    context.DEVIG = 'fd';
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    context.DEVIG = 'nv';
    context.DEVIG_EXCLUDED = ['nv'];
    assert.equal(context.getExtremeMarketDisagreement(row), null);
});

test('displayed calculation mode, rather than page name, determines the contributing references', () => {
    const row = longshot({}, { bookOdds: { fd: '3000', dk: '2000', b365: '1000', bol: '-153' } });
    for (const PAGE of ['nba', 'outliers', 'atgs', 'atgs2', 'dingers2']) {
        assert.equal(load({ PAGE, VIG: '0' }).getExtremeMarketDisagreement(row).book, 'bol', PAGE);
        assert.equal(load({ PAGE, VIG: '7' }).getExtremeMarketDisagreement(row), null, PAGE);
    }
});

test('a sportsbook candidate is left out of its own independent comparison', () => {
    const context = load({ DEVIG: 'circa', WEIGHT: '1' });
    const insufficient = longshot({}, { bookOdds: { fd: '3000', dk: '2000', circa: '-153' } });
    assert.equal(context.getExtremeMarketDisagreement(insufficient), null, 'Candidate cannot serve as the third peer');
    const enough = { ...insufficient, bookOdds: { ...insufficient.bookOdds, b365: '1000' } };
    const result = context.getExtremeMarketDisagreement(enough);
    assert.equal(result.book, 'circa');
    assert.equal(result.peerCount, 3);
    close(result.medianProbability, implied(2000));
});

test('sparse markets and exchange quotes cannot supply three independent sportsbook peers', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    for (const bookOdds of [
        { nv: '-153' },
        { fd: '3000', nv: '-153' },
        { fd: '3000', dk: '2000', nv: '-153' },
        { fd: '3000', dk: '2000', nv: '-153', px: '3000', kal: '3000', poly: '3000' },
    ]) {
        assert.equal(context.getExtremeMarketDisagreement(longshot({}, { bookOdds })), null, JSON.stringify(bookOdds));
    }
});

test('Hard Rock regional quotes count as one independent peer', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    const row = longshot({}, { bookOdds: { hr: '2000', hr_az: '2200', hr_oh: '2400', nv: '-153' } });
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    row.bookOdds.fd = '3000';
    assert.equal(context.getExtremeMarketDisagreement(row), null, 'Three HR variants plus FD are only two peers');
    row.bookOdds.dk = '1000';
    const result = context.getExtremeMarketDisagreement(row);
    assert.equal(result.book, 'nv');
    assert.equal(result.peerCount, 3);
});

test('the candidate Hard Rock group cannot count its regional variants as independent peers', () => {
    const context = load({ DEVIG: 'hr', WEIGHT: '1' });
    const row = longshot({}, { bookOdds: { hr: '-153', hr_az: '2000', hr_oh: '2200', fd: '3000', dk: '1000' } });
    assert.equal(context.getExtremeMarketDisagreement(row), null);
    row.bookOdds.b365 = '2000';
    assert.equal(context.getExtremeMarketDisagreement(row).book, 'hr');
});

test('the comparison uses the row side, including explicit under quotes', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    const row = longshot({}, { under: true, bookOdds: { fd: '-10000/3000', dk: '-5000/2000', b365: '-3000/1000', nv: '125/-153' } });
    const result = context.getExtremeMarketDisagreement(row);
    assert.equal(result.book, 'nv');
    close(result.probability, implied(-153));
    close(result.medianProbability, implied(2000));
    assert.equal(context.getExtremeMarketDisagreement({ ...row, under: false }), null);
    assert.equal(context.getExtremeMarketDisagreement({ ...longshot(), under: true }), null);
});

test('missing under quotes are never inferred from their over side', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    const row = longshot({}, { under: true, bookOdds: { fd: '-10000/3000', dk: '-5000/2000', b365: '-3000/1000', nv: '125' } });
    assert.equal(context.getExtremeMarketDisagreement(row), null, 'Missing candidate under must not be complemented');
    row.bookOdds.nv = '125/-153';
    row.bookOdds.b365 = '-3000';
    assert.equal(context.getExtremeMarketDisagreement(row), null, 'Missing peer under must not supply the third quote');
});

test('malformed and non-American quote tokens cannot flag a row', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    for (const price of [null, undefined, '', ' ', '-', 0, 99, -99, true, {}, [], 'NaN', 'Infinity', '-153foo', '-153 ($100)', '$-153']) {
        assert.equal(context.getExtremeMarketDisagreement(longshot({ nv: price })), null, String(price));
    }
    for (const price of ['-153', ' -153 ', -153]) {
        assert.equal(context.getExtremeMarketDisagreement(longshot({ nv: price })).book, 'nv', String(price));
    }
    for (const price of ['-', '', '1000oops', 99, null]) {
        assert.equal(context.getExtremeMarketDisagreement(longshot({ b365: price })), null, `Invalid peer ${price}`);
    }
});

test('comparison is isolated to the exact row and does not pool different thresholds or props', () => {
    const context = load({ DEVIG: 'nv', WEIGHT: '1' });
    const good = longshot({ nv: '2200/-5000' }, { handicap: 6.5 });
    const sparse = longshot({}, { bookOdds: { fd: '3000', dk: '2000', nv: '-153' } });
    context.RES = { data: [longshot(), good, { ...good, prop: 'pts', handicap: 35.5, bookOdds: { b365: '2000' } }] };
    assert.equal(context.getExtremeMarketDisagreement(sparse), null);
    assert.equal(context.getExtremeMarketDisagreement(good), null);
    assert.equal(context.getExtremeMarketDisagreement(longshot()).book, 'nv');
});

test('missing price data remains visible under the default filter', () => {
    const context = load();
    for (const row of [{}, { bookOdds: undefined }, { bookOdds: null }, { bookOdds: {} }]) {
        assert.equal(context.getExtremeMarketDisagreement(row), null);
        assert.equal(context.passesFilterBuilder(row), true);
    }
});

test('Show extreme market disagreements reveals affected rows and combines with other filters', () => {
    const context = load();
    const row = longshot({}, { pos: 'SG', lineupStatus: 'confirmed' });
    for (const config of [{}, { marketDisagreements: { enabled: false } }]) {
        context.setConfig(config);
        assert.equal(context.passesFilterBuilder(row), false);
    }
    context.setConfig({ marketDisagreements: { enabled: true } });
    assert.equal(context.passesFilterBuilder(row), true);
    context.setConfig({ marketDisagreements: { enabled: true }, position: { enabled: true, value: 'PG' } });
    assert.equal(context.passesFilterBuilder(row), false);
    context.setConfig({ marketDisagreements: { enabled: true }, line: { enabled: true, min: '1000', max: '2000' } });
    assert.equal(context.passesFilterBuilder(row), false);
    context.setConfig({ marketDisagreements: { enabled: true }, position: { enabled: true, value: 'G' }, lineup: { enabled: true, value: 'confirmed' } });
    assert.equal(context.passesFilterBuilder(row), true);
    context.setConfig({});
    assert.equal(context.passesFilterBuilder(row), false, 'Resetting filters restores hidden-by-default behavior');
});

test('the pipeline counting bypass skips only market disagreements and still respects other filters', () => {
    const context = load();
    const row = longshot({}, { pos: 'SG' });
    assert.equal(context.passesFilterBuilder(row, { skipMarketDisagreements: true }), true);
    context.setConfig({ position: { enabled: true, value: 'PG' } });
    assert.equal(context.passesFilterBuilder(row, { skipMarketDisagreements: true }), false);
    context.setConfig({ position: { enabled: true, value: 'SG' } });
    assert.equal(context.passesFilterBuilder(row, { skipMarketDisagreements: true }), true);
    assert.equal(context.passesFilterBuilder(row), false);
});
