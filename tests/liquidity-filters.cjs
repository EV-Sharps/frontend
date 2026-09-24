// Run with Node: node tests/liquidity-filters.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('let FB_CONFIG = {};'), source.indexOf('function getSavedFilterBuilders()')), context);
vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = normalizeFilterBuilderConfig(config); };', context);

function matches(config, data) {
	context.setConfig(config);
	return data.filter(context.passesFilterBuilder).map(row => row.id);
}

// EV-side liquidity follows the row's bet, so a liquid opposite side cannot qualify it.
const evRule = { enabled: true, book: 'px', amount: '50' };
const evRows = [
	{ id: 'over-pass', under: false, liquidity: { px: ['50', 5] } },
	{ id: 'under-fail', under: true, liquidity: { px: ['50', 5] } },
	{ id: 'under-pass', under: true, liquidity: { px: [5, '50'] } },
	{ id: 'over-fail', under: false, liquidity: { px: [5, '50'] } },
	{ id: 'over-default', liquidity: { px: [60, 0] } },
	{ id: 'wrong-book', under: true, liquidity: { nv: [0, 100] } },
	{ id: 'missing', under: true },
];
assert.deepEqual(matches({ liquidityEV: evRule }, evRows), ['over-pass', 'under-pass', 'over-default']);
assert.deepEqual(matches({ liquidityEV: { ...evRule, enabled: false } }, evRows), evRows.map(row => row.id));
assert.deepEqual(matches({ liquidityEV: { ...evRule, book: 'either' } }, evRows),
	['over-pass', 'under-pass', 'over-default', 'wrong-book']);
assert.deepEqual(matches({ liquidityEV: { ...evRule, book: 'both' } }, [
	{ id: 'all-under', under: true, liquidity: { nv: [0, 50], px: [0, 50], kal: [0, 50] } },
	{ id: 'mixed-sides', under: true, liquidity: { nv: [0, 50], px: [0, 50], kal: [100, 0] } },
]), ['all-under']);

// Other enabled criteria still have to match.
assert.deepEqual(matches({ liquidityEV: evRule,
	line: { enabled: true, min: '100', max: '150' } }, [
	{ ...evRows[0], id: 'in-range', line: 110 },
	{ ...evRows[0], id: 'out-of-range', line: 200 },
]), ['in-range']);
for (const missing of [undefined, null, '', 'invalid']) {
	assert.deepEqual(matches({ liquidityEV: evRule }, [
		{ under: false, liquidity: { px: [missing, 100] } },
		{ under: true, liquidity: { px: [100, missing] } },
	]), []);
}

// Previously saved side rules become one visible EV-row rule, never hidden restrictions.
for (const key of ['liquidity', 'liquidityOver']) {
	const legacy = { [key]: evRule, liquidityMatch: 'any', liquidityEV: { enabled: false } };
	assert.deepEqual(matches(legacy, evRows), ['over-pass', 'under-pass', 'over-default']);
	const normalized = JSON.parse(JSON.stringify(context.normalizeFilterBuilderConfig(legacy)));
	assert.deepEqual(normalized, { liquidityEV: evRule });
}
assert.deepEqual(matches({ liquidityEV: evRule, liquidityOver: { ...evRule, amount: '500' } }, evRows),
	['over-pass', 'under-pass', 'over-default']);
assert.deepEqual(matches({ liquidityOver: evRule, liquidity: { ...evRule, book: 'nv' } }, evRows),
	['over-pass', 'under-pass', 'over-default']);
assert.deepEqual(matches({}, evRows), evRows.map(row => row.id));

console.log('Single EV-row liquidity, legacy migration, both sides, missing amounts, book matching and thresholds passed.');
