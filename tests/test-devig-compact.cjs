const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReport, validateReport, buildView, buildPerformers, defaultStrategy, exportCSV } = require('../devig-results.js');

const fields = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket',
  'selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
  'best_hit', 'highest_odds_hit', 'lowest_odds_hit'];
const hit = (changes = {}) => ({ player: 'Sample Goalie', player_id: '42', date: '2026-10-11',
  game: 'ana @ bos', prop: 'atgs', line: 0.5, under: false, book: 'fd', odds: 150, profit_units: 1.5, ...changes });
function fixture() {
  const first = hit(), best = hit({ date: '2026-10-12', book: 'dk', odds: 1200, profit_units: 12 });
  const high = hit({ date: '2026-10-12', book: 'dk', odds: 1500, profit_units: 10 });
  const low = hit({ date: '2026-10-12', book: 'dk', odds: 1100, profit_units: 11 });
  const metadata = { sport: 'nhl', generated_at: '2026-10-13T12:00:00Z', best_hit_version: 1,
    hit_extremes_version: 1, share_odds_version: 1, window: { start: '2026-10-11', end: '2026-10-12', days: 2 },
    references: [{ id: 'circa;1', name: 'Circa', books: ['circa'] }, { id: 'pn;1', name: 'Pinnacle', books: ['pn'] }],
    methods: [{ id: 'probit', name: 'Probit' }, { id: 'worst', name: 'Worst-case' }],
    coverage: { event_dates: ['2026-10-11', '2026-10-12'], missing_dates: [], raw_rows: 123 },
    config: { min_ev: 0, max_ev: null }, notes: ['Metadata and exact metrics must survive transport.'] };
  const v1 = { version: 1, ...metadata, cells: [
    { date: '2026-10-11', book: 'fd', prop: 'atgs', reference: 'circa;1', method: 'probit',
      odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 5, wins: 1, losses: 2,
      pushes: 1, pending: 1, ungraded: 0, profit_units: -0.5, ev_sum: 55.12345678, best_hit: first },
    { date: '2026-10-12', book: 'dk', prop: 'atgs', reference: 'circa;1', method: 'probit',
      odds_band: '+1000 and above', share_odds_bucket: 'long', selected: 6, wins: 2, losses: 2,
      pushes: 0, pending: 1, ungraded: 1, profit_units: 22, ev_sum: 78.87654321,
      best_hit: best, highest_odds_hit: high, lowest_odds_hit: low },
    { date: '2026-10-11', book: 'fd', prop: 'sog', reference: 'pn;1', method: 'worst',
      odds_band: '+1000 and above', share_odds_bucket: 'mid', selected: 3, wins: 0, losses: 1,
      pushes: 0, pending: 1, ungraded: 1, profit_units: -1, ev_sum: 0.125 },
  ], best_cells: [
    { date: '2026-10-12', book: 'best', prop: 'atgs', reference: 'circa;1', method: 'probit',
      odds_band: '+1000 and above', share_odds_bucket: 'long', selected: 2, wins: 1, losses: 1,
      pushes: 0, pending: 0, ungraded: 0, profit_units: 11, ev_sum: 7.01234567, best_hit: best },
  ] };
  // Explicit indices are independent of the decoder and Python encoder.
  const v2 = { version: 2, ...structuredClone(metadata), cell_encoding: 'indexed-v1', cell_fields: [...fields],
    cell_dictionaries: { date: ['2026-10-11', '2026-10-12'], book: ['fd', 'dk', 'best'], prop: ['atgs', 'sog'],
      reference: ['circa;1', 'pn;1'], method: ['probit', 'worst'], odds_band: ['+100 to +199', '+1000 and above'],
      share_odds_bucket: ['short', 'mid', 'long'] }, hit_table: [first, best, high, low],
    cells: [
      [0, 0, 0, 0, 0, 0, 0, 5, 1, 2, 1, 1, 0, -0.5, 55.12345678, 0],
      [1, 1, 0, 0, 0, 1, 2, 6, 2, 2, 0, 1, 1, 22, 78.87654321, 1, 2, 3],
      [0, 0, 1, 1, 1, 1, 1, 3, 0, 1, 0, 1, 1, -1, 0.125],
    ], best_cells: [[1, 2, 0, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0, 11, 7.01234567, 1]],
  };
  return { v1, v2 };
}
const baseFilters = { start: '2026-10-11', end: '2026-10-12', book: '', prop: '', reference: 'circa;1',
  method: 'probit', minimum: 1, profitableOnly: false };
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

test('indexed reports restore every original cell, metric, metadata field and winning-hit override', () => {
  const { v1, v2 } = fixture();
  assert.deepEqual(validateReport(v2, 'nhl'), v1);
  assert.deepEqual(normalizeReport(v2), v1);
  assert.equal(normalizeReport(v2).cells[0].ev_sum, 55.12345678);
  assert.deepEqual(normalizeReport(v2).cells[1].lowest_odds_hit, v1.cells[1].lowest_odds_hit);
});
test('normalization leaves frozen input untouched, removes wire fields and caches the decoded object', () => {
  const { v2 } = fixture(), before = structuredClone(v2);
  freeze(v2);
  const first = normalizeReport(v2), second = validateReport(v2);
  assert.strictEqual(first, second);
  assert.deepEqual(v2, before);
  for (const field of ['cell_encoding', 'cell_fields', 'cell_dictionaries', 'hit_table']) assert.equal(Object.hasOwn(first, field), false);
  assert.notStrictEqual(first.cells[0].best_hit, v2.hit_table[0]);
  assert.strictEqual(first.cells[1].best_hit, first.best_cells[0].best_hit, 'pooled hit objects stay pooled in decoded memory');
});
test('legacy reports keep the existing identity and validation behavior', () => {
  const { v1 } = fixture();
  assert.strictEqual(normalizeReport(v1), v1);
  assert.strictEqual(validateReport(v1), v1);
});
test('all book/date/market/method/filter views and CSV exports match object reports', () => {
  const { v1, v2 } = fixture();
  for (const overrides of [{}, { book: 'best' }, { book: 'fd' }, { start: '2026-10-12' },
    { prop: 'atgs' }, { prop: 'sog', method: 'worst', reference: 'pn;1' },
    { profitableOnly: true }, { minimum: 1000 }]) {
    const filters = { ...baseFilters, ...overrides };
    const expected = buildView(v1, filters), actual = buildView(v2, filters);
    assert.deepEqual(actual, expected);
    assert.equal(exportCSV(actual, filters), exportCSV(expected, filters));
  }
  assert.deepEqual(defaultStrategy(v2), defaultStrategy(v1));
});
test('share matrix uses the same methods, ranges, best hits and synthetic best source book', () => {
  const { v1, v2 } = fixture();
  for (const bucket of ['all', 'short', 'mid', 'long']) for (const method of ['probit', 'worst']) {
    for (const book of ['', 'best', 'dk']) {
      const filters = { ...baseFilters, bucket, method, book };
      assert.deepEqual(buildPerformers(v2, filters), buildPerformers(v1, filters));
    }
  }
  const best = buildPerformers(v2, { ...baseFilters, book: 'best' }).rows[0].cells[0].row;
  assert.equal(best.best_hit.book, 'dk');
});
test('null bucket and explicit null hit slots restore omitted optional properties', () => {
  const { v1, v2 } = fixture();
  delete v1.cells[0].share_odds_bucket;
  v2.cells[0][6] = null;
  v2.cells[2].push(null, null, null);
  assert.deepEqual(validateReport(v2), v1);
  assert.equal(Object.hasOwn(normalizeReport(v2).cells[0], 'share_odds_bucket'), false);
  assert.equal(Object.hasOwn(normalizeReport(v2).cells[2], 'best_hit'), false);
});
test('an empty indexed report with empty dictionaries and hit table remains valid', () => {
  const { v2 } = fixture();
  v2.cells = []; v2.best_cells = []; v2.hit_table = [];
  for (const key of Object.keys(v2.cell_dictionaries)) v2.cell_dictionaries[key] = [];
  const result = validateReport(v2);
  assert.deepEqual(result.cells, []);
  assert.deepEqual(result.best_cells, []);
});
for (const [label, mutate] of [
  ['unsupported encoding', d => { d.cell_encoding = 'indexed-v2'; }],
  ['missing field names', d => { delete d.cell_fields; }],
  ['missing field', d => { d.cell_fields.pop(); }],
  ['reordered field', d => { [d.cell_fields[0], d.cell_fields[1]] = [d.cell_fields[1], d.cell_fields[0]]; }],
  ['unknown field', d => { d.cell_fields[15] = '__proto__'; }],
  ['missing dictionary', d => { delete d.cell_dictionaries.book; }],
  ['dictionary nonstring', d => { d.cell_dictionaries.book[0] = 123; }],
  ['dictionary wrong type', d => { d.cell_dictionaries.book = {}; }],
  ['short row', d => { d.cells[0].length = 14; }],
  ['long row', d => { d.cells[0] = Array(19).fill(0); }],
  ['nonarray row', d => { d.cells[0] = {}; }],
  ['negative dictionary index', d => { d.cells[0][0] = -1; }],
  ['dictionary index out of bounds', d => { d.cells[0][1] = 3; }],
  ['fractional dictionary index', d => { d.cells[0][1] = 0.5; }],
  ['string dictionary index', d => { d.cells[0][1] = '0'; }],
  ['required dimension null', d => { d.cells[0][0] = null; }],
  ['bucket index out of bounds', d => { d.cells[0][6] = 99; }],
  ['numeric metric null', d => { d.cells[0][7] = null; }],
  ['numeric metric string', d => { d.cells[0][14] = '10'; }],
  ['numeric metric infinite', d => { d.cells[0][13] = Infinity; }],
  ['negative count metric', d => { d.cells[0][8] = -1; }],
  ['missing hit table', d => { delete d.hit_table; }],
  ['nonobject hit', d => { d.hit_table[0] = 42; }],
  ['null hit object', d => { d.hit_table[0] = null; }],
  ['hit index out of bounds', d => { d.cells[0][15] = 4; }],
  ['negative hit index', d => { d.cells[0][15] = -1; }],
  ['fractional hit index', d => { d.cells[0][15] = 0.5; }],
  ['string hit index', d => { d.cells[0][15] = '0'; }],
  ['highest hit index out of bounds', d => { d.cells[1][16] = 99; }],
  ['lowest hit index out of bounds', d => { d.cells[1][17] = 99; }],
  ['synthetic best wrong book', d => { d.best_cells[0][1] = 0; }],
  ['date outside window', d => { d.cell_dictionaries.date[0] = '2026-10-01'; }],
  ['wrong payload sport', d => { d.sport = 'nfl'; }],
]) {
  test(`reject malformed compact report: ${label}`, () => {
    const { v2 } = fixture(); mutate(v2);
    assert.throws(() => validateReport(v2, 'nhl'), /published|sport|server|report|result/i);
  });
}

test('Python encoder fixture round-trips with exact views and share matrix', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures/devig-compact-python.json');
  assert.ok(fs.existsSync(fixturePath), 'The independently encoded Python fixture must be installed with this test.');
  const input = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(input.reports.length, 2, 'Exercise the Python encoder for both supported sports.');
  for (const { legacy: v1, compact: v2 } of input.reports) {
    assert.ok(v1 && v2, 'Expected original and compact reports in the cross-language fixture.');
    assert.deepEqual(validateReport(v2, v1.sport), v1);
    const filters = { start: v1.window.start, end: v1.window.end, book: '', prop: '',
      reference: v1.references[0]?.id, method: v1.methods[0]?.id, minimum: 1, profitableOnly: false };
    assert.deepEqual(buildView(v2, filters), buildView(v1, filters));
    for (const bucket of ['all', 'short', 'mid', 'long']) {
      assert.deepEqual(buildPerformers(v2, { ...filters, bucket }), buildPerformers(v1, { ...filters, bucket }));
    }
  }
});
