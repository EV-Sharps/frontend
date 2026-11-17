const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport, buildView, buildPerformers, reportForSource, validateReport, resolveReport } = require('../devig-results.js');

const preset = 'circa+nv+pn;1+1+1';
const alias = 'pn+circa+nv;1+1+1';
const weighted = 'circa+nv+pn;1+2+1';
const cell = (reference, changes = {}) => ({ date: '2026-11-15', book: 'fd', prop: 'sog', reference,
  method: 'probit', odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 5,
  wins: 3, losses: 2, pushes: 0, pending: 0, ungraded: 0, profit_units: 4, ev_sum: 50, ...changes });
const report = () => ({ version: 1, sport: 'nhl', price_source: 'archive', share_odds_version: 1,
  window: { start: '2026-11-15', end: '2026-11-15', days: 1 },
  references: [
    { id: preset, name: 'CIRC/NV/PN 33% Equal', books: ['circa', 'nv', 'pn'] },
    { id: alias, name: 'PN+Circa+NV', books: ['pn', 'circa', 'nv'] },
    { id: weighted, name: 'Novig weighted', books: ['circa', 'nv', 'pn'] },
  ], methods: [{ id: 'probit', name: 'Probit' }],
  cells: [cell(alias, { profit_units: 999 }), cell(preset), cell(weighted, { profit_units: 2 })],
  best_cells: [cell(alias, { book: 'best', profit_units: 999 }), cell(preset, { book: 'best' })],
});
const filters = { start: '2026-11-15', end: '2026-11-15', method: 'probit', reference: preset,
  prop: '', book: '', minimum: 1, profitableOnly: false };
const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum'];
const fields = [...dimensions, ...metrics, 'best_hit', 'highest_odds_hit', 'lowest_odds_hit'];
function pack(data) {
  const dictionaries = Object.fromEntries(dimensions.map(field => [field, []]));
  const encode = rows => rows.map(row => [
    ...dimensions.map(field => {
      if (row[field] === undefined && field === 'share_odds_bucket') return null;
      if (!dictionaries[field].includes(row[field])) dictionaries[field].push(row[field]);
      return dictionaries[field].indexOf(row[field]);
    }), ...metrics.map(field => row[field]),
  ]);
  const result = { ...data, version: 2, cell_encoding: 'indexed-v1', cell_fields: fields,
    cell_dictionaries: dictionaries, hit_table: [], cells: encode(data.cells), best_cells: encode(data.best_cells || []) };
  if (data.opening_report) result.opening_report = pack(data.opening_report);
  return result;
}

test('legacy duplicate references become one filter/ranking/share column without summing metrics', () => {
  const data = report(), before = structuredClone(data), normalized = normalizeReport(data);
  assert.deepEqual(normalized.references.map(reference => reference.id), [preset, weighted]);
  assert.equal(normalized.references[0].name, 'CIRC/NV/PN 33% Equal');
  assert.equal(normalized.cells.find(row => row.reference === preset).profit_units, 4);
  assert.equal(normalized.best_cells.length, 1);
  assert.equal(normalized.best_cells[0].profit_units, 4);
  const view = buildView(data, filters);
  assert.equal(view.total.selected, 5);
  assert.equal(view.total.profit_units, 4);
  assert.equal(view.strategies.length, 2);
  assert.deepEqual(buildView(data, { ...filters, reference: alias }), view, 'Old selection follows its retained reference');
  const matrix = buildPerformers(data, filters);
  assert.equal(matrix.columns.length, 2);
  assert.equal(matrix.rows[0].cells.find(item => item.reference === preset).row.profit_units, 4);
  assert.deepEqual(data, before, 'The published input remains immutable');
  assert.strictEqual(normalizeReport(data), normalized);
  assert.strictEqual(normalizeReport(normalized), normalized);
});

test('book order and proportional decimal weights normalize exactly without swapping weights', () => {
  const ids = ['fd+pn;0.1+0.2', 'pn+fd;20+10', 'pn+fd;10+20',
    'fd+pn;0.10000000000000001+0.2'];
  const data = { ...report(), references: ids.map(id => ({ id, name: id })),
    cells: ids.map(id => cell(id)), best_cells: [] };
  const normalized = normalizeReport(data);
  assert.deepEqual(normalized.references.map(reference => reference.id), [ids[0], ids[2], ids[3]]);
  assert.equal(normalized.cells.length, 3);
  assert.deepEqual(buildView(data, { ...filters, reference: ids[1] }), buildView(data, { ...filters, reference: ids[0] }));
});

test('alias cells fill missing retained-reference segments but never add to an existing segment', () => {
  const data = report();
  data.cells = [cell(alias), cell(preset), cell(alias, { book: 'dk', profit_units: 7 })];
  const normalized = normalizeReport(data);
  assert.equal(normalized.cells.length, 2);
  assert.ok(normalized.cells.every(row => row.reference === preset));
  assert.equal(buildView(data, filters).total.selected, 10);
  assert.equal(buildView(data, filters).total.profit_units, 11);
});

test('packed archive and opening reports use the same deduplication and keep source metrics separate', () => {
  const data = report();
  data.opening_report = { ...report(), price_source: 'opening' };
  data.opening_report.cells = data.opening_report.cells.map(row => ({ ...row, profit_units: row.reference === preset ? -2 : row.profit_units }));
  const packed = pack(data), before = structuredClone(packed);
  assert.deepEqual(normalizeReport(packed).references, normalizeReport(data).references);
  assert.equal(reportForSource(packed, 'opening').references.length, 2);
  assert.equal(buildView(packed, filters).total.profit_units, 4);
  assert.equal(buildView(packed, { ...filters, priceSource: 'opening', reference: alias }).total.profit_units, -2);
  assert.equal(buildPerformers(packed, { ...filters, priceSource: 'opening' }).columns.length, 2);
  validateReport(packed, 'nhl');
  assert.deepEqual(packed, before);
});

test('reports without equivalent references retain object identity and mutable legacy behavior', () => {
  const data = report();
  data.references = [data.references[0], data.references[2]];
  data.cells = data.cells.filter(row => row.reference !== alias);
  data.best_cells = data.best_cells.filter(row => row.reference !== alias);
  assert.strictEqual(normalizeReport(data), data);
  data.cells.push(cell(preset, { book: 'dk' }));
  assert.equal(buildView(data, filters).total.selected, 10);
});


test('chunked reports validate raw counts before collapsing aliases within and across parts', async () => {
  const data = report(), shell = { ...data, cells: [], best_cells: [] };
  const parts = [
    pack({ ...shell, cells: [cell(alias), cell(preset)], best_cells: [] }),
    pack({ ...shell, cells: [cell(alias, { book: 'dk' })], best_cells: [] }),
    pack({ ...shell, cells: [cell(preset, { book: 'dk', profit_units: 7 })], best_cells: data.best_cells }),
  ];
  const descriptors = parts.map((part, index) => {
    const digest = String(index + 1).repeat(64);
    return { dataset: `devig_results_nhl_part_${digest}`, digest, source: 'archive',
      cells: part.cells.length, best_cells: part.best_cells.length, raw_bytes: 10000, gzip_bytes: 1000 };
  });
  const manifest = { version: 3, sport: 'nhl', report_encoding: 'chunked-indexed-v1', report: shell, parts: descriptors };
  const before = structuredClone(manifest);
  const resolved = await resolveReport(manifest, { expectedSport: 'nhl',
    fetchPart: async descriptor => parts[descriptors.indexOf(descriptor)] });
  assert.equal(resolved.references.length, 2);
  assert.equal(resolved.cells.length, 2);
  assert.equal(resolved.best_cells.length, 1);
  assert.equal(buildView(resolved, filters).total.selected, 10);
  assert.equal(buildView(resolved, filters).total.profit_units, 11);
  assert.deepEqual(manifest, before);
});
