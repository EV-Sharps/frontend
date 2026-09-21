const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const usage = require('./nfl-usage.js');

const sample = {
	usage: { year: 2026, weeks: [1, 2], team_share_positions: ['rb', 'wr', 'te'],
		snaps: { tot: [42, 58], pct: ['80%', '88%'] },
		targets: { tot: [13, 0], pos_share: [100, 0], team_share: [35.14, 0] },
		looks: { tot: [4, null], pos_share: [100, null], team_share: [30.77, null] }
	}
};
let checks = 0;
function test(name, callback) { callback(); checks++; console.log(`ok ${checks} - ${name}`); }
test('all seven usage columns have distinct matching nested fields', () => {
	assert.equal(usage.items().length, 7);
	assert.equal(new Set(usage.keys).size, 7);
	for (const item of usage.items()) assert.equal(item.cols[0].field.replaceAll('.', '_'), item.key);
});
test('missing newest week is not replaced by older stats', () => {
	assert.equal(usage.latest(sample, usage.specs[4]), null);
	const html = usage.render(sample, usage.specs[4]);
	assert.match(html, /<strong>-<\/strong>/);
	assert.match(html, /W2<\/small>/);
	assert.match(html, /W1: 4; W2: -/);
});
test('team latest published week can retain W1 until that team plays W2', () => {
	const prior = { usage: { ...sample.usage, latest_week: 1 } };
	assert.equal(usage.latest(prior, usage.specs[4]), 4);
	const html = usage.render(prior, usage.specs[4]);
	assert.match(html, /<strong>4<\/strong>/);
	assert.match(html, /W1<\/small>/);
	assert.match(html, /W1: 4; W2: -/);
	const current = { usage: { ...sample.usage, latest_week: 2 } };
	assert.equal(usage.latest(current, usage.specs[4]), null);
});
test('zero counts and zero percentages remain actual zeros', () => {
	assert.match(usage.render(sample, usage.specs[1]), /<strong>0<\/strong>/);
	assert.match(usage.render(sample, usage.specs[3]), /<strong>0%<\/strong>/);
});
test('week alignment failure is missing rather than shifted data', () => {
	const short = structuredClone(sample);
	short.usage.targets.tot = [13];
	assert.deepEqual(usage.series(short, usage.specs[1]), []);
	assert.match(usage.render(short, usage.specs[1]), /No data/);
});
test('invalid and duplicate week labels are rejected', () => {
	for (const weeks of [[1, '<script>'], [1, 1]]) {
		assert.deepEqual(usage.series({ usage: { ...sample.usage, weeks } }, usage.specs[0]), []);
	}
});
test('numeric parser rejects null, empty, booleans, infinities, and out-of-range share', () => {
	for (const invalid of [null, undefined, '', ' ', false, Infinity, -1, {}, 'foo']) assert.equal(usage.number(invalid, false), null);
	assert.equal(usage.number('101%', true), null);
	assert.equal(usage.number('88%', true), 88);
	assert.equal(usage.number('88%', false), null);
});
test('blurred values have no tooltip disclosure', () => {
	const html = usage.render({ ...sample, blurred: true }, usage.specs[0]);
	assert.match(html, /class="snap-share blurred"/);
	assert.doesNotMatch(html, / title=/);
});
test('team share descriptions explicitly exclude QBs', () => {
	for (const index of [3, 6]) assert.match(usage.items()[index].cols[0].headerTooltip, /RB \+ WR \+ TE.*QBs are excluded/);
});
test('missing values remain last in either Tabulator sort direction', () => {
	for (const dir of ['asc', 'desc']) {
		const factor = dir === 'asc' ? 1 : -1;
		assert.equal(Math.sign(usage.sortRows({}, sample, usage.specs[0], dir) * factor), 1);
		assert.equal(Math.sign(usage.sortRows(sample, {}, usage.specs[0], dir) * factor), -1);
	}
});
test('new columns migrate next to snaps in an existing layout', () => {
	const saved = ['player', 'logs', 'snaps', 'book'];
	const defaults = ['book', 'player', 'logs', 'snaps', ...usage.keys];
	assert.deepEqual(usage.columnOrder(saved, defaults), ['player', 'logs', 'snaps', ...usage.keys, 'book']);
});
test('explicit saved column order stays intact', () => {
	const saved = [usage.keys[3], 'player', 'snaps', ...usage.keys.filter(key => key !== usage.keys[3]), 'logs'];
	assert.deepEqual(usage.columnOrder(saved, ['player', 'logs', 'snaps', ...usage.keys]), saved);
});
test('visibility migration runs once and respects subsequent hiding', () => {
	const user = { metadata: { tds: ['player', 'snaps'] } };
	usage.migrateProfile(user, 'tds');
	assert.deepEqual(user.metadata.tds, ['player', 'snaps', ...usage.keys]);
	user.metadata.tds = ['player'];
	usage.migrateProfile(user, 'tds');
	assert.deepEqual(user.metadata.tds, ['player']);
});
test('snap column keeps the legacy field and fallback', () => {
	const legacy = { field: 'snaps', formatter: () => 'legacy', sorter: () => 42 };
	const col = usage.snapColumn(legacy);
	assert.equal(col.field, 'snaps');
	assert.equal(col.formatter({ getRow: () => ({ getData: () => ({ snaps: ['15%'] }) }) }), 'legacy');
	assert.match(col.formatter({ getRow: () => ({ getData: () => sample }) }), /W1: 80%; W2: 88%/);
});
for (const name of ['tds.html', 'nfl.html']) {
	test(`${name} scripts parse and each new picker control exists once`, () => {
		const html = fs.readFileSync(path.join(__dirname, name), 'utf8');
		for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
		for (const key of usage.keys) assert.equal(html.split(`id="custom_${key}"`).length - 1, 1);
		assert.equal(html.split('NflUsage.snapColumn(snapShareColumn())').length - 1, 1);
		assert.equal(html.split('...NflUsage.items()').length - 1, 1);
	});
}
console.log(`${checks} usage UI checks passed.`);
