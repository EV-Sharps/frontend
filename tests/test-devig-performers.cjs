const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPerformers } = require('../devig-results.js');
const cell = (changes = {}) => ({ date: '2026-10-11', book: 'fd', prop: 'attd', reference: 'pn;1', method: 'worst',
  odds_band: '+200 to +399', selected: 13, wins: 4, losses: 5, pushes: 1, pending: 2, ungraded: 1, profit_units: 3, ev_sum: 20, ...changes });
const filters = { start: '2026-10-11', end: '2026-10-11', prop: 'attd', book: '', reference: 'pn;1', method: 'worst', minimum: 10, profitableOnly: false };
const report = cells => ({ sport: 'nfl', cells, best_cells: [cell({ book: 'best', profit_units: 100 })] });

test('ranks complete combinations without pooling books, methods, references or props', () => {
  const data = report([cell(), cell({ book: 'dk', profit_units: 7 }), cell({ method: 'power', profit_units: 5 }),
    cell({ reference: 'circa;1', profit_units: -2 }), cell({ prop: 'sog', profit_units: 900 })]);
  const before = JSON.stringify(data);
  const rows = buildPerformers(data, filters);
  assert.deepEqual(rows.map(r => [r.book, r.reference, r.method, r.profit_units]), [
    ['dk', 'pn;1', 'worst', 7], ['fd', 'pn;1', 'power', 5], ['fd', 'pn;1', 'worst', 3], ['fd', 'circa;1', 'worst', -2],
  ]);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4]);
  assert.ok(rows.every(r => r.settled === 10 && r.pending === 2 && r.ungraded === 1));
  assert.equal(rows[0].roi, 70);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(buildPerformers(data, { ...filters, reference: 'bogus', method: 'add' }), rows);
});

test('aggregates dates and price bands within exactly one combination', () => {
  const data = report([cell(), cell({ date: '2026-10-10', odds_band: '+400 to +699', profit_units: -1 })]);
  const rows = buildPerformers(data, { ...filters, start: '2026-10-10' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].settled, 20);
  assert.equal(rows[0].profit_units, 2);
  assert.equal(rows[0].roi, 10);
});

test('date and explicit book filters, including Best available, stay exact', () => {
  const data = report([cell(), cell({ book: 'dk', profit_units: 7 }), cell({ date: '2026-10-10', profit_units: 100 })]);
  assert.equal(buildPerformers(data, { ...filters, book: 'fd' })[0].profit_units, 3);
  assert.deepEqual(buildPerformers(data, { ...filters, book: 'best' }).map(r => r.book), ['best']);
  assert.deepEqual(buildPerformers(data, { ...filters, start: '2026-10-12', end: '2026-10-12' }), []);
});

test('minimum settled excludes pending from sample; profit filter and empty results are honest', () => {
  const data = report([cell(), cell({ book: 'dk', profit_units: -7 }), cell({ book: 'mgm', wins: 0, losses: 0, pushes: 0, pending: 100, profit_units: 0 })]);
  assert.deepEqual(buildPerformers(data, { ...filters, profitableOnly: true }).map(r => r.book), ['fd']);
  assert.deepEqual(buildPerformers(data, { ...filters, minimum: 11 }), []);
  assert.equal(buildPerformers(data, { ...filters, minimum: 1 }).length, 2);
});

test('top counts are bounded and all-market records remain separate', () => {
  const data = report(Array.from({ length: 20 }, (_, i) => cell({ reference: `r${i}`, profit_units: i })));
  for (const limit of [5, 10, 15]) assert.equal(buildPerformers(data, filters, { limit }).length, limit);
  assert.equal(buildPerformers(data, filters, { limit: 200 }).length, 10);
  assert.equal(buildPerformers(data, filters, { limit: '5' })[0].profit_units, 19);
  const markets = buildPerformers(report([cell(), cell({ prop: 'atgs' })]), { ...filters, prop: '' });
  assert.deepEqual(markets.map(r => r.prop).sort(), ['atgs', 'attd']);
});
