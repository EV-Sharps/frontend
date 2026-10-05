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
const csvRows = csv => {
  const rows = csv.trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^\"]|\"\")*)"/g)].map(match => match[1].replaceAll('""', '"')));
  return rows.slice(1).map(row => Object.fromEntries(rows[0].map((heading, i) => [heading, row[i]])));
};

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

test('ATGS comes first and each prop ranks books and odds independently', () => {
  const view = buildView(report(), filters);
  assert.deepEqual(view.byProp.map(row => row.prop), ['atgs', 'sog']);
  const [atgs, sog] = view.byProp;
  assert.equal(atgs.total.profit_units, 7);
  assert.equal(atgs.total.settled, 12);
  assert.equal(atgs.books.length, 1);
  assert.equal(atgs.books[0].book, 'dk');
  assert.equal(atgs.books[0].profit_units, 7);
  assert.equal(atgs.bands[0].profit_units, 7);
  assert.equal(sog.total.profit_units, 2);
  assert.deepEqual(sog.books.map(row => [row.book, row.profit_units]), [['dk', 5], ['fd', -3]]);
  assert.equal(sog.bands[0].profit_units, 2);
  assert.equal(sog.bands[0].settled, 24);
  assert.equal(view.byProp.reduce((sum, row) => sum + row.total.selected, 0), view.total.selected);
});

test('each prop respects date, book, market, reference and method filters', () => {
  const dated = buildView(report(), { ...filters, end: '2026-10-01' });
  assert.deepEqual(dated.byProp.map(row => row.prop), ['sog']);
  const scoped = buildView(report(), { ...filters, prop: 'sog', book: 'dk' });
  assert.equal(scoped.byProp.length, 1);
  assert.equal(scoped.byProp[0].total.profit_units, 5);
  assert.deepEqual(scoped.byProp[0].books.map(row => row.book), ['dk']);
  assert.equal(buildView(report(), { ...filters, method: 'power' }).byProp.find(row => row.prop === 'sog').total.profit_units, 50);
  assert.equal(buildView(report(), { ...filters, reference: 'fd;1' }).byProp.find(row => row.prop === 'sog').total.profit_units, 100);
  assert.deepEqual(buildView(report(), { ...filters, book: 'absent' }).byProp, []);
});

test('prop summaries and raw samples survive sample and profit ranking filters', () => {
  const view = buildView(report(), { ...filters, minimum: 50, profitableOnly: true });
  assert.deepEqual(view.byProp.map(row => row.prop), ['atgs', 'sog']);
  for (const prop of view.byProp) {
    assert.equal(prop.books.length, 0);
    assert.equal(prop.bands.length, 0);
    assert.ok(prop.bookSamples.length > 0);
    assert.ok(prop.bandSamples.length > 0);
  }
  assert.equal(view.byProp[0].total.profit_units, 7);
  const losing = report();
  losing.cells = [cell({ prop: 'atgs', profit_units: -2 })];
  const atgs = buildView(losing, { ...filters, profitableOnly: true }).byProp[0];
  assert.equal(atgs.prop, 'atgs');
  assert.equal(atgs.total.profit_units, -2);
  assert.equal(atgs.books.length, 0);
  assert.equal(atgs.bands.length, 0);
  assert.equal(atgs.bookSamples[0].profit_units, -2);
});

test('small books do not borrow sample size from another prop', () => {
  const data = report();
  data.cells = [cell({ prop: 'atgs', selected: 8, wins: 3, losses: 2, pushes: 0, profit_units: 1 }),
    cell({ prop: 'sog', selected: 8, wins: 3, losses: 2, pushes: 0, profit_units: 2 })];
  const view = buildView(data, filters);
  assert.equal(view.books[0].settled, 10);
  assert.ok(view.byProp.every(prop => prop.books.length === 0 && prop.bands.length === 0));
  assert.ok(view.byProp.every(prop => prop.bookSamples[0].settled === 5));
  const small = buildView(data, { ...filters, minimum: 1 });
  assert.ok(small.byProp.every(prop => prop.books[0].settled === 5 && prop.bands[0].settled === 5));
});

test('unavailable selected strategy and pending-only props remain visible with null ROI', () => {
  const data = report();
  data.cells = [cell(), cell({ prop: 'atgs', reference: 'fd;1' }),
    cell({ prop: 'sv', selected: 3, wins: 0, losses: 0, pushes: 0, pending: 1, ungraded: 2, profit_units: 0 })];
  const view = buildView(data, filters);
  const atgs = view.byProp.find(row => row.prop === 'atgs');
  assert.equal(atgs.total.selected, 0);
  assert.equal(atgs.total.roi, null);
  assert.equal(atgs.books.length, 0);
  assert.equal(atgs.bookSamples.length, 0);
  const pending = view.byProp.find(row => row.prop === 'sv');
  assert.equal(pending.total.roi, null);
  assert.equal(pending.total.pending, 1);
  assert.equal(pending.total.ungraded, 2);
  assert.equal(pending.bookSamples.length, 1);
  assert.equal(pending.books.length, 0);
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
  assert.ok(csvRows(csv).some(row => row.section === 'summary' && row.reference === 'pn;1' && row.method === 'worst'));
  assert.equal(csv.includes('"FanDuel"'), false);
});

test('CSV identifies the prop for every odds-range and book ranking', () => {
  const rows = csvRows(exportCSV(buildView(report(), filters), filters));
  const books = rows.filter(row => row.section === 'books');
  const bands = rows.filter(row => row.section === 'odds_ranges');
  assert.equal(books.length, 3);
  assert.equal(bands.length, 2);
  assert.ok([...books, ...bands].every(row => row.prop === 'atgs' || row.prop === 'sog'));
  assert.equal(books.find(row => row.prop === 'atgs' && row.segment === 'dk').net_units, '7');
  assert.equal(books.find(row => row.prop === 'sog' && row.segment === 'dk').net_units, '5');
  assert.equal(bands.find(row => row.prop === 'atgs').net_units, '7');
  assert.equal(bands.find(row => row.prop === 'sog').net_units, '2');
  const f = { ...filters, prop: 'atgs' };
  const scoped = csvRows(exportCSV(buildView(report(), f), f));
  assert.ok(scoped.filter(row => ['books', 'odds_ranges'].includes(row.section)).every(row => row.prop === 'atgs'));
  assert.ok(scoped.every(row => row.market_filter === 'atgs'));
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
