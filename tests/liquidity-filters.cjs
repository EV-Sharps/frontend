// Run with Node: node tests/liquidity-filters.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('let FB_CONFIG = {};'), source.indexOf('function getSavedFilterBuilders()')), context);
vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = config; };', context);

const rule = (book, enabled = true) => ({ enabled, book, amount: '300' });
const rows = [
	{ id: 'both-px', liquidity: { px: [400, 500] }, line: 110 },
	{ id: 'over-px', liquidity: { px: [400, 100] }, line: 110 },
	{ id: 'under-px', liquidity: { px: [100, 500] }, line: 110 },
	{ id: 'over-nv', liquidity: { nv: [400, 100] }, line: 110 },
	{ id: 'under-kal', liquidity: { kal: [100, 500] }, line: 200 },
	{ id: 'boundary', liquidity: { nv: [300, 300], px: [300, 300], kal: [300, 300] }, line: 110 },
	{ id: 'missing', line: 110 },
];
function matches(config) {
	context.setConfig(config);
	return rows.filter(context.passesFilterBuilder).map(row => row.id);
}

assert.deepEqual(matches({ liquidityMatch: 'all', liquidity: rule('px'), liquidityOver: rule('px') }), ['both-px']);
assert.deepEqual(matches({ liquidityMatch: 'any', liquidity: rule('either'), liquidityOver: rule('nv') }),
	['both-px', 'under-px', 'over-nv', 'under-kal']);

// Old presets used AND and must keep the same meaning without the new setting.
assert.deepEqual(matches({ liquidity: rule('px'), liquidityOver: rule('px') }), ['both-px']);

// Disabled rules do not satisfy OR, and an empty group imposes no restriction.
assert.deepEqual(matches({ liquidityMatch: 'any', liquidity: rule('px', false), liquidityOver: rule('nv') }), ['over-nv']);
assert.deepEqual(matches({ liquidityMatch: 'any', liquidity: rule('px', false), liquidityOver: rule('nv', false) }), rows.map(row => row.id));

// OR applies only within liquidity; other enabled criteria remain required.
assert.deepEqual(matches({
	liquidityMatch: 'any', liquidity: rule('either'), liquidityOver: rule('nv'),
	line: { enabled: true, min: '100', max: '150' },
}), ['both-px', 'under-px', 'over-nv']);

// Book matching and the strict dollar threshold work independently on each side.
assert.equal(context.passesLiquidityRule({ liquidity: { nv: [301, 100], px: ['400', 100], kal: [500, 100] } }, rule('both'), 0), true);
assert.equal(context.passesLiquidityRule({ liquidity: { nv: [301, 100], px: [400, 100] } }, rule('both'), 0), false);
assert.equal(context.passesLiquidityRule({ liquidity: { px: [300, 300] } }, rule('px'), 0), false);
for (const missing of [undefined, null, '', 'invalid']) {
	assert.equal(context.passesLiquidityRule({ liquidity: { px: [missing, missing] } }, rule('px'), 0), false);
	assert.equal(context.passesLiquidityRule({ liquidity: { px: [missing, missing] } }, rule('px'), 1), false);
}

console.log('Liquidity AND/OR examples, legacy presets, disabled rules, other filters, and thresholds passed.');
