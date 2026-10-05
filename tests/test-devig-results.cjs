const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, buildView, defaultStrategy, dateRange, availableDates, validateReport, exportCSV } = require('../devig-results.js');

const cell = (overrides = {}) => ({ date: '2026-10-01', book: 'dk', prop: 'sog', reference: 'pn;1', method: 'worst',
  odds_band: '+100 to +199', selected: 15, wins: 6, losses: 4, pushes: 2, pending: 1, ungraded: 2, profit_units: 5, ev_sum: 40, ...overrides });
const report = () => ({ version: 1, sport: 'nhl', window: { start: '2026-09-28', end: '2026-10-04', days: 7 },
  references: [{ id: 'pn;1', name: 'Pinnacle' }, { id: 'fd;1', name: 'FanDuel' }], methods: [{ id: 'worst', name: 'Worst-case' }, { id: 'power', name: 'Power' }],
  cells: [cell(), cell({ book: 'fd', profit_units: -3 }), cell({ date: '2026-10-02', prop: 'atgs', profit_units: 7 }),
    cell({ reference: 'fd;1', profit_units: 100 }), cell({ method: 'power', profit_units: 50 })] });
const filters = { start: '2026-09-28', end: '2026-10-04', book: '', prop: '', reference: 'pn;1', method: 'worst', minimum: 10, profitableOnly: false };

test('one reference and method drive ROI; pushes count, unresolved offers do not', () => {
  const view = buildView(report(), filters);
  assert.equal(view.total.selected, 45);
  assert.equal(view.total.settled, 36);
  assert.equal(view.total.pending, 3);
  assert.equal(view.total.ungraded, 6);
  assert.equal(view.total.profit_units, 9);
  assert.equal(view.total.roi, 25);
  assert.equal(view.strategies.length, 3);
  assert.equal(view.strategies[0].reference, 'fd;1');
  assert.equal(view.days.reduce((sum, row) => sum + row.profit_units, 0), 9);
});
test('date, book and market filters also scope independent strategy comparisons', () => {
  const view = buildView(report(), { ...filters, start: '2026-10-01', end: '2026-10-01', book: 'dk', prop: 'sog' });
  assert.equal(view.total.settled, 12);
  assert.equal(view.total.profit_units, 5);
  assert.equal(view.books.length, 1);
  assert.equal(view.markets.length, 1);
  assert.equal(view.strategies.length, 3);
  assert.equal(view.strategies.find(row => row.reference === 'pn;1' && row.method === 'worst').profit_units, 5);
});
test('minimum sample and profitable-only limit rankings, never the headline', () => {
  const view = buildView(report(), { ...filters, minimum: 13, profitableOnly: true });
  assert.equal(view.total.profit_units, 9);
  assert.deepEqual(view.books.map(row => row.book), ['dk']);
  assert.equal(view.strategies.length, 1);
  const all = buildView(report(), { ...filters, minimum: 1, profitableOnly: true });
  assert.equal(all.books.some(row => row.book === 'fd'), false);
});
test('no settled sample has null ROI even if pending or ungraded exist', () => {
  const stats = aggregate([cell({ selected: 3, wins: 0, losses: 0, pushes: 0, pending: 1, ungraded: 2, profit_units: 0 })]);
  assert.equal(stats.roi, null);
  assert.equal(aggregate([]).roi, null);
  assert.equal(buildView(report(), { ...filters, book: 'absent' }).total.roi, null);
});
test('default is fixed Pinnacle/worst when present; fallback order never looks at ROI', () => {
  assert.deepEqual(defaultStrategy(report()), { reference: 'pn;1', method: 'worst', fallback: false });
  const data = report(); data.cells = data.cells.filter(row => row.method === 'power');
  assert.deepEqual(defaultStrategy(data), { reference: 'pn;1', method: 'power', fallback: true });
});
test('dates span DST safely and reports reject corrupt metrics', () => {
  assert.deepEqual(dateRange('2026-10-31', '2026-11-02'), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(dateRange('2026-02-30', '2026-03-01'), []);
  assert.equal(validateReport(report()).version, 1);
  const data = report(); data.cells[0].profit_units = null;
  assert.throws(() => validateReport(data), /invalid result rows/);
});
test('CSV exports filtered scope and neutralizes spreadsheet formula dimensions', () => {
  const data = report(); data.cells[0].book = '=DANGEROUS()';
  const f = { ...filters, book: '=DANGEROUS()' }, csv = exportCSV(buildView(data, f), f);
  assert.match(csv, /"'\=DANGEROUS\(\)"/);
  assert.match(csv, /"summary","selected strategy","pn;1","worst"/);
  assert.equal(csv.includes('"FanDuel"'), false);
});
test('event coverage uses missing event dates even when an archive filename exists', () => {
  const data = report();
  data.coverage = { files: [{ date: '2026-09-28', rows: 100 }], missing_dates: ['2026-09-28'] };
  const dates = availableDates(data);
  assert.equal(dates.has('2026-09-28'), false);
  assert.equal(dates.has('2026-10-01'), true);
  assert.equal(dates.size, 6);
  data.coverage.event_dates = ['2026-10-01'];
  assert.deepEqual([...availableDates(data)], ['2026-10-01']);
});
