const test = require('node:test');
const assert = require('node:assert/strict');
const { reportForSource, buildView, buildPerformers, validateReport, exportCSV } = require('../devig-results.js');

const cell = (changes = {}) => ({ date: '2026-10-13', book: 'fd', prop: 'atgs', reference: 'pn;1', method: 'worst',
  odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 13, wins: 4, losses: 5, pushes: 1,
  pending: 2, ungraded: 1, profit_units: 5, ev_sum: 130, kelly_stake_units: 2, kelly_profit_units: -1, ...changes });
function sourceReport(source) {
  const rows = source === 'opening' ? [cell({ profit_units: 9, kelly_stake_units: 3, kelly_profit_units: 6 })]
    : [cell(), cell({ book: 'dk', profit_units: -2, kelly_stake_units: 8, kelly_profit_units: 6 })];
  return { version: 1, price_source: source, kelly_version: 1, share_odds_version: 1, sport: 'nhl',
    window: { start: '2026-10-07', end: '2026-10-13', days: 7 },
    references: [{ id: 'pn;1', name: 'Pinnacle', books: ['pn'] }],
    methods: [{ id: 'worst', name: 'Worst-case' }, { id: 'probit', name: 'Probit' }],
    coverage: { event_dates: source === 'opening' ? ['2026-10-13'] : ['2026-10-12', '2026-10-13'],
      raw_rows: source === 'opening' ? 17 : 123 },
    cells: [...rows, ...rows.map(row => ({ ...row, method: 'probit' }))],
    best_cells: [cell({ book: 'best', profit_units: source === 'opening' ? 7 : 12,
      kelly_stake_units: source === 'opening' ? 5 : 4, kelly_profit_units: source === 'opening' ? 2 : 8 })] };
}
function report() { return { ...sourceReport('archive'), opening_report: sourceReport('opening') }; }
const filters = { start: '2026-10-07', end: '2026-10-13', book: '', prop: 'atgs', reference: 'pn;1',
  method: 'worst', minimum: 1, profitableOnly: false };
const scope = (priceSource, extra = {}) => ({ ...filters, priceSource, ...extra });
const csvRows = csv => {
  const rows = csv.trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^\"]|\"\")*)"/g)].map(match => match[1].replaceAll('""', '"')));
  return rows.slice(1).map(row => Object.fromEntries(rows[0].map((heading, i) => [heading, row[i]])));
};

test('reportForSource selects independent cells, Kelly metrics, best offers, and coverage', () => {
  const data = report(), archive = reportForSource(data, 'archive'), opening = reportForSource(data, 'opening');
  assert.equal(archive.price_source, 'archive');
  assert.equal(opening.price_source, 'opening');
  assert.equal(archive.coverage.raw_rows, 123);
  assert.equal(opening.coverage.raw_rows, 17);
  assert.equal(archive.cells[0].profit_units, 5);
  assert.equal(opening.cells[0].profit_units, 9);
  assert.equal(archive.best_cells[0].profit_units, 12);
  assert.equal(opening.best_cells[0].profit_units, 7);
});

test('archive remains the default and opening views never pool with archived prices', () => {
  const data = report();
  assert.equal(buildView(data, filters).total.roi, 15);
  const opening = buildView(data, scope('opening'));
  assert.equal(opening.total.profit_units, 9);
  assert.equal(opening.total.settled, 10);
  assert.equal(opening.total.roi, 90);
  assert.deepEqual(opening.books.map(row => row.book), ['fd']);
  assert.equal(opening.byProp[0].total.profit_units, 9);
  assert.equal(opening.days[0].profit_units, 9);
  assert.equal(opening.strategies.find(row => row.method === 'worst').profit_units, 9);
});

test('opening and archive use their own quarter-Kelly stakes and profits', () => {
  const archive = buildView(report(), scope('archive', { staking: 'quarter-kelly' })).total;
  const opening = buildView(report(), scope('opening', { staking: 'quarter-kelly' })).total;
  assert.deepEqual([archive.profit_units, archive.stake_units, archive.roi], [5, 10, 50]);
  assert.deepEqual([opening.profit_units, opening.stake_units, opening.roi], [6, 3, 200]);
});

test('best available and share performers are selected from the requested source', () => {
  const best = buildView(report(), scope('opening', { book: 'best' })).total;
  assert.equal(best.profit_units, 7);
  const weighted = buildView(report(), scope('opening', { book: 'best', staking: 'quarter-kelly' })).total;
  assert.equal(weighted.roi, 40);
  const matrix = buildPerformers(report(), scope('opening', { method: 'probit', staking: 'quarter-kelly' }));
  assert.deepEqual(matrix.rows.map(row => row.book), ['fd']);
  assert.equal(matrix.rows[0].cells[0].row.profit_units, 6);
  assert.equal(matrix.rows[0].cells[0].row.roi, 200);
});

test('filters missing in opening data remain empty instead of silently using archive or All books', () => {
  for (const override of [{ book: 'dk' }, { prop: 'sog' }, { end: '2026-10-12' }]) {
    const total = buildView(report(), scope('opening', override)).total;
    assert.equal(total.selected, 0);
    assert.equal(total.settled, 0);
    assert.equal(total.roi, null);
  }
  assert.equal(buildView(report(), scope('archive', { book: 'dk' })).total.profit_units, -2);
});

test('published empty opening data stays valid and produces empty opening results', () => {
  const data = report(); data.opening_report.cells = []; data.opening_report.best_cells = [];
  validateReport(data);
  assert.deepEqual(reportForSource(data, 'opening').cells, []);
  const opening = buildView(data, scope('opening', { staking: 'quarter-kelly' }));
  assert.equal(opening.total.selected, 0);
  assert.equal(opening.total.profit_units, 0);
  assert.equal(opening.total.roi, null);
  assert.deepEqual(buildPerformers(data, scope('opening')).rows, []);
  assert.equal(buildView(data, filters).total.profit_units, 3);
});

test('legacy reports retain archive behavior while explicit opening requests fail clearly', () => {
  const legacy = sourceReport('archive'); delete legacy.price_source;
  validateReport(legacy);
  assert.equal(reportForSource(legacy, 'archive').cells[0].profit_units, 5);
  assert.equal(buildView(legacy, filters).total.roi, 15);
  assert.throws(() => reportForSource(legacy, 'opening'), /opening|source|rebuild|available/i);
  assert.throws(() => buildView(legacy, scope('opening')), /opening|source|rebuild|available/i);
  assert.throws(() => buildPerformers(legacy, scope('opening')), /opening|source|rebuild|available/i);
});

test('CSV labels every section with its price source while keeping staking independent', () => {
  for (const priceSource of ['archive', 'opening']) for (const staking of ['flat', 'quarter-kelly']) {
    const f = scope(priceSource, { staking }), rows = csvRows(exportCSV(buildView(report(), f), f));
    assert.ok(rows.every(row => row.price_source === priceSource && row.staking === staking));
    const total = rows.find(row => row.section === 'summary');
    const expected = priceSource === 'opening' ? staking === 'flat' ? 9 : 6 : staking === 'flat' ? 3 : 5;
    assert.equal(Number(total.net_units), expected);
  }
});

function compact(input) {
  const data = structuredClone(input);
  const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
    'kelly_stake_units', 'kelly_profit_units'];
  const all = [...data.cells, ...(data.best_cells || [])];
  const dictionaries = Object.fromEntries(dimensions.map(key => [key, [...new Set(all.map(row => row[key]))]]));
  const encode = rows => rows.map(row => [...dimensions.map(key => dictionaries[key].indexOf(row[key])), ...metrics.map(key => row[key])]);
  return { ...data, version: 2, cell_encoding: 'indexed-v1', cell_fields: [...dimensions, ...metrics,
    'best_hit', 'highest_odds_hit', 'lowest_odds_hit'], cell_dictionaries: dictionaries, hit_table: [],
    cells: encode(data.cells), best_cells: encode(data.best_cells || []) };
}

test('object and compact outer/nested reports support every transport combination', () => {
  for (const outerCompact of [false, true]) for (const innerCompact of [false, true]) {
    const data = report();
    if (innerCompact) data.opening_report = compact(data.opening_report);
    const wire = outerCompact ? compact(data) : data;
    const decoded = validateReport(wire, 'nhl');
    assert.equal(buildView(decoded, scope('archive')).total.roi, 15);
    assert.equal(buildView(decoded, scope('opening')).total.roi, 90);
    assert.equal(buildView(wire, scope('opening', { staking: 'quarter-kelly' })).total.roi, 200);
    assert.equal(reportForSource(decoded, 'opening').coverage.raw_rows, 17);
  }
});

for (const [name, mutate] of [
  ['different sport', data => { data.opening_report.sport = 'nfl'; }],
  ['different start date', data => { data.opening_report.window.start = '2026-10-08'; }],
  ['different end date', data => { data.opening_report.window.end = '2026-10-14'; }],
  ['wrong nested source', data => { data.opening_report.price_source = 'archive'; }],
  ['missing nested source', data => { delete data.opening_report.price_source; }],
  ['wrong outer source', data => { data.price_source = 'other'; }],
  ['deeper nesting', data => { data.opening_report.opening_report = sourceReport('opening'); }],
  ['malformed nested cells', data => { data.opening_report.cells[0].profit_units = NaN; }],
  ['nonreport nested value', data => { data.opening_report = []; }],
]) test(`reject opening report with ${name}`, () => {
  const data = report(); mutate(data);
  assert.throws(() => validateReport(data), /report|opening|source|sport|window|result|format/i);
});

test('switching source and staking never modifies either published cell set', () => {
  const data = report(), before = structuredClone(data);
  for (const priceSource of ['opening', 'archive']) for (const staking of ['quarter-kelly', 'flat']) {
    buildView(data, scope(priceSource, { staking }));
    buildPerformers(data, scope(priceSource, { staking }));
  }
  assert.deepEqual(data, before);
});
