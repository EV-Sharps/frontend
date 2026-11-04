// node tests/one-way-filter.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('let FB_CONFIG = {};'), source.indexOf('function getSavedFilterBuilders()')), context);
vm.runInContext('globalThis.setConfig = config => { FB_CONFIG = config; };', context);
const rule = { hideOneWay: { enabled: true } };
function matches(config, row) {
	context.setConfig(config);
	return context.passesFilterBuilder(row);
}

for (const value of [200, '200', '200/', '200/-', '200/0', '200/99', '200/NaN', '200/Infinity',
	'200/null', '200/false', '200/-150abc', null, undefined, {}, []]) {
	const row = { bookOdds: { fd: value, dk: '+450' }, under: false };
	assert.equal(matches(rule, row), false, String(value));
	assert.equal(matches({}, row), true, 'default unchanged');
	assert.equal(matches({ hideOneWay: { enabled: false } }, row), true, 'disabled unchanged');
}
for (const book of ['fd', 'pn', 'kal', 'px', 'nv', 'poly']) {
	for (const under of [false, true]) {
		const row = { book: 'dk', under, bookOdds: { dk: '+450', [book]: '+300/-350' } };
		assert.equal(matches(rule, row), true, `${book}: checks all quotes, not only EV book`);
	}
}
assert.equal(matches(rule, { bookOdds: { fd: '/-110' } }), true, 'an actual under is present');
assert.equal(matches(rule, { bookOdds: { fd: '+100 / -100' } }), true, 'trimmed even-money quotes');
assert.equal(matches(rule, { bookOdds: {} }), false);
assert.equal(matches(rule, { under: true, line: -110, fairVal: -120, implied: 55 }), false, 'never infer under availability');
assert.equal(matches(rule, { circa_blurred: true, bookOdds: { circa: '200/-250', dk: '300' } }), false);
assert.equal(matches(rule, { circa_blurred: false, bookOdds: { circa: '200/-250', dk: '300' } }), true);
assert.equal(matches({ ...rule, liquidityEV: { enabled: true, book: 'px', amount: 50 } },
	{ bookOdds: { px: '200/-250' }, liquidity: { px: [10, 100] }, under: false }), false, 'other rules still apply');
assert.equal(matches({ ...rule, liquidityEV: { enabled: true, book: 'px', amount: 50 } },
	{ bookOdds: { px: '200' }, liquidity: { px: [100, 100] } }), false, 'liquidity cannot create an under quote');
console.log('Over-only filtering: valid under quotes, all books, missing/invalid prices, locked quotes, defaults and combined rules passed.');
