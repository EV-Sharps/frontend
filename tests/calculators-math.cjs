const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { calculateArbitrage, convertOdds, MAX_AMOUNT } = require('../calculators-math.js');

test('reference example balances the payouts and uses payout for the displayed profit percentage', () => {
    const result = calculateArbitrage({ odds: [-150, 200], stake: 200, stakeSide: 0 });
    assert.deepEqual(result.stakes, [200, 111.11]);
    assert.deepEqual(result.payouts, [333.33, 333.33]);
    assert.equal(result.totalStake, 311.11);
    assert.equal(result.totalPayout, 333.33);
    assert.equal(result.profit, 22.22);
    assert.equal(result.profitPercent.toFixed(2), '6.67');
    assert.equal(result.roi.toFixed(2), '7.14');
});

test('editing side 2 holds that stake fixed when odds change', () => {
    const first = calculateArbitrage({ odds: [-150, 200], stake: 150, stakeSide: 1 });
    assert.deepEqual(first.stakes, [270, 150]);
    assert.deepEqual(first.payouts, [450, 450]);
    assert.equal(first.profit, 30);
    const updated = calculateArbitrage({ odds: [-200, 200], stake: 150, stakeSide: 1 });
    assert.deepEqual(updated.stakes, [300, 150]);
    assert.equal(updated.totalPayout, 450);
    assert.equal(updated.profit, 0);
});

test('two positive prices report the smaller actual payout after stake rounding', () => {
    const result = calculateArbitrage({ odds: [150, 200], stake: 200, stakeSide: 0 });
    assert.deepEqual(result.stakes, [200, 166.67]);
    assert.deepEqual(result.payouts, [500, 500.01]);
    assert.equal(result.totalStake, 366.67);
    assert.equal(result.totalPayout, 500);
    assert.equal(result.profit, 133.33);
});

test('negative and mixed prices can produce a guaranteed loss', () => {
    const negative = calculateArbitrage({ odds: [-200, -200], stake: 100, stakeSide: 0 });
    assert.deepEqual(negative.stakes, [100, 100]);
    assert.equal(negative.totalPayout, 150);
    assert.equal(negative.profit, -50);
    assert.equal(negative.roi, -25);
    const mixed = calculateArbitrage({ odds: [-200, 150], stake: 100, stakeSide: 0 });
    assert.deepEqual(mixed.stakes, [100, 60]);
    assert.equal(mixed.totalPayout, 150);
    assert.equal(mixed.profit, -10);
    assert.equal(mixed.roi, -6.25);
});

test('break-even and zero stake remain finite without negative zero', () => {
    for (const odds of [[-100, 100], [-200, 200]]) {
        const result = calculateArbitrage({ odds, stake: 100, stakeSide: 0 });
        assert.equal(result.profit, 0);
        assert.equal(result.roi, 0);
        assert.equal(result.profitPercent, 0);
    }
    const zero = calculateArbitrage({ odds: [-150, 200], stake: 0, stakeSide: 1 });
    assert.deepEqual(zero, {
        stakes: [0, 0], payouts: [0, 0], totalStake: 0, totalPayout: 0,
        profit: 0, roi: 0, profitPercent: 0,
    });
});

test('half-cent stake rounding and conservative payout rounding are exact', () => {
    const rounded = calculateArbitrage({ odds: [-100, 100], stake: 1.005, stakeSide: 0 });
    assert.deepEqual(rounded.stakes, [1.01, 1.01]);
    const conservative = calculateArbitrage({ odds: [125, 100], stake: 0.02, stakeSide: 0 });
    assert.deepEqual(conservative.stakes, [0.02, 0.02]);
    assert.deepEqual(conservative.payouts, [0.04, 0.04]);
    assert.equal(conservative.totalPayout, 0.04);
    const fractional = calculateArbitrage({ odds: [101, 100], stake: 1.01, stakeSide: 0 });
    assert.deepEqual(fractional.stakes, [1.01, 1.02]);
    assert.deepEqual(fractional.payouts, [2.03, 2.04]);
    assert.equal(fractional.profit, 0);
});

test('calculation is symmetric and does not change the supplied odds', () => {
    const odds = Object.freeze([-150, 200]);
    const left = calculateArbitrage({ odds, stake: 200, stakeSide: 0 });
    const right = calculateArbitrage({ odds: [odds[1], odds[0]], stake: 200, stakeSide: 1 });
    assert.deepEqual(right.stakes, [...left.stakes].reverse());
    assert.deepEqual(right.payouts, [...left.payouts].reverse());
    assert.equal(right.totalPayout, left.totalPayout);
    assert.equal(right.profit, left.profit);
});

test('invalid and nonfinite inputs produce useful errors instead of totals', () => {
    const base = { odds: [-150, 200], stake: 200, stakeSide: 0 };
    for (const odds of [0, 99, -99, 150.5, NaN, Infinity, -Infinity, '200', Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => calculateArbitrage({ ...base, odds: [odds, 200] }), /American odds/);
        assert.throws(() => calculateArbitrage({ ...base, odds: [-150, odds] }), /American odds/);
    }
    for (const stake of [-1, NaN, Infinity, -Infinity, '200', null, MAX_AMOUNT + 1]) {
        assert.throws(() => calculateArbitrage({ ...base, stake }), /Enter a stake/);
    }
    for (const stakeSide of [-1, 2, 0.5, '0', null, undefined]) {
        assert.throws(() => calculateArbitrage({ ...base, stakeSide }), /hold fixed/);
    }
    for (const input of [undefined, null, {}, { ...base, odds: [-150] }, { ...base, odds: [-150, 200, 300] }, { ...base, odds: Array(2) }]) {
        assert.throws(() => calculateArbitrage(input), RangeError);
    }
    assert.throws(() => calculateArbitrage({ ...base, stake: MAX_AMOUNT }), /Reduce the stake or odds/);
    assert.throws(() => calculateArbitrage({ ...base, odds: [Number.MAX_SAFE_INTEGER, 100] }), /Reduce the stake or odds/);
});

test('browser build exposes the same dependency-free calculator', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../calculators-math.js'), 'utf8'), context);
    const result = context.window.CalculatorsMath.calculateArbitrage({ odds: [-150, 200], stake: 200, stakeSide: 0 });
    assert.equal(result.profit, 22.22);
    assert.equal(context.window.CalculatorsMath.MAX_AMOUNT, MAX_AMOUNT);
    assert.equal(context.window.CalculatorsMath.convertOdds({ format: 'american', value: 200, stake: 100 }).payout, 300);
});

function nearlyEqual(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} should equal ${expected}`);
}

test('odds converter accepts each source format and retains unrounded equivalents', () => {
    for (const [format, value] of [['fraction', 2], ['decimal', 3], ['american', 200], ['probability', 100 / 3]]) {
        const result = convertOdds({ format, value, stake: 100 });
        nearlyEqual(result.fraction, 2);
        nearlyEqual(result.decimal, 3);
        nearlyEqual(result.american, 200);
        nearlyEqual(result.probability, 100 / 3);
        assert.equal(result.toWin, 200);
        assert.equal(result.payout, 300);
        assert.equal(result[format], value);
    }
});

test('odds converter handles negative and noninteger American odds', () => {
    const negative = convertOdds({ format: 'american', value: -150, stake: 100 });
    nearlyEqual(negative.fraction, 2 / 3);
    nearlyEqual(negative.decimal, 5 / 3);
    nearlyEqual(negative.probability, 60);
    assert.equal(negative.american, -150);
    assert.equal(negative.toWin, 66.67);
    assert.equal(negative.payout, 166.67);
    for (const value of [133.33333333333334, -133.33333333333334]) {
        const result = convertOdds({ format: 'american', value, stake: 100 });
        assert.equal(result.american, value);
        const roundTrip = convertOdds({ format: 'decimal', value: result.decimal, stake: 100 });
        nearlyEqual(roundTrip.american, value);
        assert.equal(roundTrip.toWin, result.toWin);
    }
});

test('odds converter canonicalizes even money and handles zero stakes', () => {
    for (const [format, value] of [['fraction', 1], ['decimal', 2], ['american', 100], ['american', -100], ['probability', 50]]) {
        assert.deepEqual(convertOdds({ format, value, stake: 100 }), {
            fraction: 1, decimal: 2, american: 100, probability: 50, toWin: 100, payout: 200,
        });
        const zero = convertOdds({ format, value, stake: 0 });
        assert.equal(zero.toWin, 0);
        assert.equal(zero.payout, 0);
    }
});

test('odds converter rounds winnings half up and adds the rounded stake for the payout', () => {
    const halfCent = convertOdds({ format: 'fraction', value: 0.5, stake: 0.01 });
    assert.equal(halfCent.toWin, 0.01);
    assert.equal(halfCent.payout, 0.02);
    const roundedStake = convertOdds({ format: 'fraction', value: 0.5, stake: 1.005 });
    assert.equal(roundedStake.toWin, 0.51);
    assert.equal(roundedStake.payout, 1.52);
    const unroundedOdds = convertOdds({ format: 'decimal', value: 1.3333333333333333, stake: 3 });
    assert.equal(unroundedOdds.decimal, 1.3333333333333333);
    assert.equal(unroundedOdds.toWin, 1);
    assert.equal(unroundedOdds.payout, 4);
});

test('odds converter rejects invalid source formats, values, and stakes', () => {
    for (const input of [undefined, null, {}, { format: 'unknown', value: 2, stake: 100 }]) {
        assert.throws(() => convertOdds(input), /Choose fractional/);
    }
    for (const format of ['fraction', 'decimal', 'american', 'probability']) {
        for (const value of [NaN, Infinity, -Infinity, '200', null, undefined]) {
            assert.throws(() => convertOdds({ format, value, stake: 100 }), /valid number/);
        }
    }
    for (const [format, values] of [
        ['fraction', [0, -1]], ['decimal', [0, 1, -1]],
        ['american', [-99.99, 0, 99.99]], ['probability', [-1, 0, 100, 101]],
    ]) {
        for (const value of values) assert.throws(() => convertOdds({ format, value, stake: 100 }), RangeError);
    }
    for (const stake of [-1, NaN, Infinity, -Infinity, '100', null, undefined, MAX_AMOUNT + 1]) {
        assert.throws(() => convertOdds({ format: 'american', value: 200, stake }), /Enter a stake/);
    }
});

test('odds converter guards numerical extremes and the payout limit', () => {
    for (const [format, value] of [['fraction', Number.MIN_VALUE], ['american', -Number.MAX_VALUE], ['probability', Number.MIN_VALUE]]) {
        assert.throws(() => convertOdds({ format, value, stake: 0 }), /too extreme/);
    }
    assert.throws(() => convertOdds({ format: 'fraction', value: Number.MAX_VALUE, stake: 0 }), /too extreme/);
    assert.throws(() => convertOdds({ format: 'american', value: Number.MAX_VALUE, stake: 1000 }), /Reduce the stake or odds/);
    assert.throws(() => convertOdds({ format: 'american', value: 200, stake: MAX_AMOUNT }), /Reduce the stake or odds/);
    assert.throws(() => convertOdds({ format: 'american', value: 100, stake: MAX_AMOUNT / 2 + 0.01 }), /Reduce the stake or odds/);
    assert.equal(convertOdds({ format: 'american', value: 100, stake: MAX_AMOUNT / 2 }).payout, MAX_AMOUNT);
});
