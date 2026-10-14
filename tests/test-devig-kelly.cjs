const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, buildView, buildPerformers, validateReport, normalizeReport, exportCSV } = require('../devig-results.js');

const cell = (overrides = {}) => ({ date: '2026-10-12', book: 'fd', prop: 'atgs', reference: 'pn;1', method: 'worst',
  odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 13, wins: 4, losses: 5, pushes: 1,
  pending: 2, ungraded: 1, profit_units: 5, ev_sum: 130, kelly_stake_units: 2, kelly_profit_units: -1, ...overrides });
const report = () => ({ version: 1, kelly_version: 1, share_odds_version: 1, sport: 'nhl',
  window: { start: '2026-10-07', end: '2026-10-13', days: 7 },
  references: [{ id: 'pn;1', name: 'Pinnacle', books: ['pn'] }, { id: 'circa;1', name: 'Circa', books: ['circa'] }],
  methods: [{ id: 'worst', name: 'Worst-case' }, { id: 'probit', name: 'Probit' }],
  cells: [cell(), cell({ date: '2026-10-13', book: 'dk', profit_units: -2, kelly_stake_units: 8, kelly_profit_units: 6 }),
    cell({ reference: 'circa;1', profit_units: 100, kelly_stake_units: 5, kelly_profit_units: -4 }),
    cell({ method: 'probit' }), cell({ method: 'probit', book: 'dk', profit_units: -2, kelly_stake_units: 8, kelly_profit_units: 6 })],
  best_cells: [cell({ book: 'best', profit_units: 12, kelly_stake_units: 4, kelly_profit_units: 8 })] });
const filters = { start: '2026-10-07', end: '2026-10-13', book: '', prop: 'atgs', reference: 'pn;1', method: 'worst', minimum: 1, profitableOnly: false };
const weighted = overrides => ({ ...filters, staking: 'quarter-kelly', ...overrides });
const csvRows = csv => {
  const rows = csv.trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^\"]|\"\")*)"/g)].map(match => match[1].replaceAll('""', '"')));
  return rows.slice(1).map(row => Object.fromEntries(rows[0].map((heading, i) => [heading, row[i]])));
};

test('quarter Kelly uses settled risk, including pushes, without changing selected or unresolved counts', () => {
  const data = report(), flat = buildView(data, filters).total, quarter = buildView(data, weighted()).total;
  assert.equal(flat.profit_units, 3);
  assert.equal(flat.stake_units, 20);
  assert.equal(flat.roi, 15);
  assert.equal(quarter.profit_units, 5);
  assert.equal(quarter.stake_units, 10);
  assert.equal(quarter.roi, 50);
  for (const count of ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'settled']) assert.equal(quarter[count], flat[count]);
  assert.equal(quarter.settled, 20);
  assert.equal(quarter.pending, 4);
  assert.equal(quarter.ungraded, 2);
});

test('aggregate weights profit by risk, not an average of per-cell ROI or flat settlement count', () => {
  const rows = [cell(), cell({ profit_units: -2, kelly_stake_units: 8, kelly_profit_units: 6 })];
  const result = aggregate(rows, 'quarter-kelly');
  assert.equal(result.roi, 50); // (-1 + 6) / (2 + 8), not mean(-50%, 75%).
  assert.equal(aggregate(rows).roi, 15);
  const empty = aggregate([], 'quarter-kelly');
  assert.equal(empty.stake_units, 0);
  assert.equal(empty.profit_units, 0);
  assert.equal(empty.roi, null);
  const unresolved = aggregate([cell({ wins: 0, losses: 0, pushes: 0, pending: 12, ungraded: 1,
    profit_units: 0, kelly_stake_units: 0, kelly_profit_units: 0 })], 'quarter-kelly');
  assert.equal(unresolved.roi, null);
});

test('book, strategy, market, band, and daily totals all use the selected staking model', () => {
  const result = buildView(report(), weighted());
  assert.deepEqual(result.books.map(row => row.book), ['dk', 'fd']);
  assert.equal(result.books[0].roi, 75);
  assert.equal(result.books[1].roi, -50);
  assert.equal(result.strategies.find(row => row.reference === 'circa;1').profit_units, -4);
  assert.equal(result.byProp[0].total.stake_units, 10);
  assert.equal(result.byProp[0].bands[0].roi, 50);
  assert.equal(result.markets[0].profit_units, 5);
  assert.deepEqual(result.days.map(row => [row.date, row.profit_units, row.stake_units]),
    [['2026-10-12', -1, 2], ['2026-10-13', 6, 8]]);
});

test('date/book filters and profitable-only rankings apply to Kelly net profit while leaving headline scope intact', () => {
  assert.equal(buildView(report(), weighted({ end: '2026-10-12' })).total.roi, -50);
  assert.equal(buildView(report(), weighted({ book: 'dk' })).total.roi, 75);
  const result = buildView(report(), weighted({ profitableOnly: true }));
  assert.deepEqual(result.books.map(row => row.book), ['dk']);
  assert.equal(result.total.profit_units, 5);
  assert.equal(result.total.settled, 20);
  assert.deepEqual(buildView(report(), { ...filters, profitableOnly: true }).books.map(row => row.book), ['fd']);
});

test('Best available remains independent of individual-book Kelly risk and profit', () => {
  const result = buildView(report(), weighted({ book: 'best' }));
  assert.equal(result.total.stake_units, 4);
  assert.equal(result.total.profit_units, 8);
  assert.equal(result.total.roi, 200);
  assert.equal(result.total.settled, 10);
});

test('share performers use the same Kelly metrics and filter profitability in the selected mode', () => {
  const matrix = buildPerformers(report(), weighted({ method: 'probit' }));
  const find = book => matrix.rows.find(row => row.book === book).cells.find(item => item.reference === 'pn;1').row;
  assert.equal(find('fd').profit_units, -1);
  assert.equal(find('fd').roi, -50);
  assert.equal(find('dk').stake_units, 8);
  assert.equal(find('dk').roi, 75);
  const positive = buildPerformers(report(), weighted({ method: 'probit', profitableOnly: true }));
  assert.equal(positive.rows.find(row => row.book === 'fd').cells.find(item => item.reference === 'pn;1').reason, 'unprofitable');
});

test('CSV identifies the staking basis and settled stakes for every exported section', () => {
  for (const staking of ['flat', 'quarter-kelly']) {
    const scope = { ...filters, staking }, rows = csvRows(exportCSV(buildView(report(), scope), scope));
    assert.ok(rows.length > 5);
    assert.ok(rows.every(row => row.staking === staking));
    assert.ok(rows.every(row => Number.isFinite(Number(row.settled_stake_units))));
    const summary = rows.find(row => row.section === 'summary');
    assert.equal(Number(summary.settled_stake_units), staking === 'flat' ? 20 : 10);
    assert.equal(Number(summary.net_units), staking === 'flat' ? 3 : 5);
    assert.equal(Number(summary.roi_percent), staking === 'flat' ? 15 : 50);
  }
});

test('legacy reports remain valid for flat but cannot fabricate quarter-Kelly totals from missing data', () => {
  const legacy = report(); delete legacy.kelly_version;
  for (const row of [...legacy.cells, ...legacy.best_cells]) { delete row.kelly_stake_units; delete row.kelly_profit_units; }
  assert.equal(validateReport(legacy), legacy);
  assert.equal(buildView(legacy, filters).total.roi, 15);
  assert.throws(() => aggregate(legacy.cells, 'quarter-kelly'), /kelly|rebuild|staking|risk/i);
  assert.throws(() => buildView(legacy, weighted()), /kelly|rebuild|staking|risk/i);
  assert.throws(() => buildPerformers(legacy, weighted()), /kelly|rebuild|staking|risk/i);
});

test('reports claiming Kelly support reject absent, nonfinite, or negative settled-risk data', () => {
  for (const mutate of [
    row => { delete row.kelly_stake_units; }, row => { delete row.kelly_profit_units; },
    row => { row.kelly_stake_units = -1; }, row => { row.kelly_stake_units = NaN; },
    row => { row.kelly_profit_units = Infinity; }, row => { row.kelly_stake_units = '2'; },
  ]) {
    const data = report(); mutate(data.cells[0]);
    assert.throws(() => validateReport(data), /report|result|kelly|staking/i);
  }
  const best = report(); delete best.best_cells[0].kelly_profit_units;
  assert.throws(() => validateReport(best), /report|result|kelly|staking/i);
});

function compact(withKelly) {
  const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum'];
  const hits = ['best_hit', 'highest_odds_hit', 'lowest_odds_hit'];
  const data = { version: 2, sport: 'nhl', window: { start: '2026-10-12', end: '2026-10-12' },
    references: [{ id: 'pn;1', name: 'Pinnacle' }], methods: [{ id: 'worst', name: 'Worst-case' }],
    cell_encoding: 'indexed-v1', cell_fields: [...dimensions, ...metrics, ...(withKelly ? ['kelly_stake_units', 'kelly_profit_units'] : []), ...hits],
    cell_dictionaries: { date: ['2026-10-12'], book: ['fd'], prop: ['atgs'], reference: ['pn;1'], method: ['worst'],
      odds_band: ['+100 to +199'], share_odds_bucket: ['short'] },
    hit_table: [{ player: 'Fixture player', date: '2026-10-12', prop: 'atgs', book: 'fd', odds: 150, profit_units: 1.5,
      line: .5, under: false, game: 'away @ home' }],
    cells: [[0, 0, 0, 0, 0, 0, 0, 13, 4, 5, 1, 2, 1, 5, 130, ...(withKelly ? [2, -1] : []), 0, 0, 0]] };
  if (withKelly) data.kelly_version = 1;
  return data;
}

test('compact 18-field legacy and 20-field Kelly transports keep hit slots and numeric metrics separate', () => {
  const legacy = validateReport(compact(false)), modern = validateReport(compact(true));
  assert.equal(legacy.cells[0].best_hit.player, 'Fixture player');
  assert.equal(modern.cells[0].best_hit.player, 'Fixture player');
  assert.equal(modern.cells[0].highest_odds_hit.odds, 150);
  assert.equal(modern.cells[0].lowest_odds_hit.odds, 150);
  assert.equal(modern.cells[0].kelly_stake_units, 2);
  assert.equal(modern.cells[0].kelly_profit_units, -1);
  assert.equal(buildView(modern, weighted()).total.roi, -50);
  assert.equal(buildView(legacy, filters).total.roi, 50);
});

test('compact Kelly rows may omit trailing hit slots but must include both numeric staking fields', () => {
  const trimmed = compact(true); trimmed.cells[0].length = 17;
  assert.equal(normalizeReport(trimmed).cells[0].kelly_profit_units, -1);
  const missing = compact(true); missing.cells[0].length = 16;
  assert.throws(() => validateReport(missing), /report|result|kelly|staking/i);
  const swapped = compact(true); [swapped.cell_fields[15], swapped.cell_fields[16]] = [swapped.cell_fields[16], swapped.cell_fields[15]];
  assert.throws(() => validateReport(swapped), /report|result|kelly|staking/i);
});

test('switching staking views never mutates published cells or poisons later flat calculations', () => {
  const data = report(), before = structuredClone(data);
  buildView(data, weighted()); buildPerformers(data, weighted());
  assert.deepEqual(data, before);
  assert.equal(buildView(data, filters).total.roi, 15);
  assert.equal(buildView(data, weighted()).total.roi, 50);
});
