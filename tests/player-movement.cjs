const assert = require('node:assert/strict');
const { fairSeries, pairedProbability, joinDetails, matches } = require('../player-movement.js');
const p = (over, under) => (100 / (over + 100)) / (100 / (over + 100) + -under / (100 - under));
assert.equal(pairedProbability([200, -250], 0), p(200, -250));
assert.ok(Math.abs(pairedProbability([200, -250], 0) + pairedProbability([200, -250], 1) - 1) < 1e-12);
for (const pair of [[200, null], [200, -100000], [0, -110], [800, 800], [-500, -500]]) assert.equal(pairedProbability(pair, 0), null);
const points = [
    { pairs: { pn: [200, -250], fd: [220, -280], kal: [300, -320], br: [220, -280], kambi: [220, -280], hr: [220, -280], hr_az: [220, -280] } },
    { pairs: { pn: [180, -230], fd: [200, null] } },
    { pairs: { pn: [150, -190], fd: [180, -220] } }
];
const result = fairSeries(points, new Set(['pn', 'fd', 'kal']), 0);
assert.deepEqual(result.references, ['fd', 'pn']);
assert.equal(result.values[0], (p(200, -250) + p(220, -280)) / 2);
assert.equal(result.values[1], null, 'Missing references leave gaps, not a changing blend');
assert.equal(fairSeries(points, new Set(['pn']), 0).values[1], p(180, -230));
assert.deepEqual(fairSeries(points, new Set(['kal']), 0).values, [null, null, null]);
assert.deepEqual(fairSeries(points, new Set(['br', 'kambi', 'hr', 'hr_az']), 0).references, ['br', 'hr']);
const base = { day: '2026-10-30', updated: 'now', selection: { id: 'a' } };
const over = { ...base, points: [{ ts: '2026-10-30T16:00:00Z', observed_at: 'same', prices: { pn: 200, circa: 220 } }] };
const under = { ...base, points: [{ ts: '2026-10-30T16:00:00Z', observed_at: 'same', prices: { pn: -250, circa: -280 } }] };
assert.deepEqual(joinDetails(over, under, { circa_blurred: true }).books, ['pn']);
assert.equal(joinDetails(over, { ...under, points: [{ ...under.points[0], observed_at: 'other' }] }, {}).points[0].pairs.pn[1], null);
assert.throws(() => joinDetails(over, { ...under, updated: 'different' }, {}));
const row = { player: 'Test Player', prop: 'sog', game: 'nyr @ det', dt: '2026-10-30' };
const item = { player: 'test player', prop: 'sog', game: 'nyr@det', start: '2026-10-31T00:00:00Z' };
assert.ok(matches(row, item));
assert.ok(!matches(row, { ...item, prop: 'atgs' }));
assert.ok(!matches(row, { ...item, game: 'nyr @ bos' }));
assert.ok(!matches(row, { ...item, start: '2026-11-01T00:00:00Z' }));
assert.ok(!matches(row, item, '2026-10-31T02:00:00Z'));
console.log('Movement math, pairing, shared feeds, access masking and event matching passed.');
