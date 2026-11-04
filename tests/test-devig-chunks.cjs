const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { resolveReport, validateReport, buildView, buildPerformers, exportCSV, reportForSource } = require('../devig-results.js');

const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum', 'kelly_stake_units', 'kelly_profit_units'];
const hits = ['best_hit', 'highest_odds_hit', 'lowest_odds_hit'];
const fields = [...dimensions, ...metrics, ...hits];
const cell = (changes = {}) => ({ date: '2026-11-02', book: 'fd', prop: 'pts', reference: 'pn;1', method: 'probit',
  odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 5, wins: 1, losses: 1, pushes: 1,
  pending: 1, ungraded: 1, profit_units: 0.5, ev_sum: 12.12345678, kelly_stake_units: 1.5, kelly_profit_units: 0.2,
  best_hit: { player: 'Player', player_id: '42', date: '2026-11-02', game: 'bos @ ny', prop: 'pts', line: 20.5,
    under: false, odds: 150, profit_units: 1.5, book: 'fd' }, ...changes });
function sourceReport(source) {
  return { version: 1, sport: 'nba', generated_at: '2026-11-04T12:00:00Z', price_source: source,
    kelly_version: 1, best_hit_version: 1, hit_extremes_version: 1, share_odds_version: 1,
    window: { start: '2026-11-01', end: '2026-11-03', days: 3 },
    references: [{ id: 'pn;1', name: 'Pinnacle', books: ['pn'] }], methods: [{ id: 'probit', name: 'Probit' }],
    coverage: { valid_rows: 20, graded_rows: 15, unresolved_rows: 5 }, config: { min_ev: 0 }, notes: ['All results retained'],
    cells: [cell(), cell({ book: 'dk', profit_units: 3 }), cell({ date: '2026-11-03', prop: 'reb', profit_units: -1 })],
    best_cells: [cell({ book: 'best', profit_units: source === 'opening' ? 4 : 2 })] };
}
function packed(source) {
  const data = { ...source, version: 2, cell_encoding: 'indexed-v1', cell_fields: fields,
    cell_dictionaries: Object.fromEntries(dimensions.map(key => [key, []])), hit_table: [] };
  for (const section of ['cells', 'best_cells']) if (source[section] !== undefined) data[section] = source[section].map(cell => {
    return fields.map(field => {
      if (dimensions.includes(field)) {
        if (cell[field] === undefined) return null;
        const table = data.cell_dictionaries[field];
        if (!table.includes(cell[field])) table.push(cell[field]);
        return table.indexOf(cell[field]);
      }
      if (hits.includes(field)) {
        if (cell[field] === undefined) return null;
        const index = data.hit_table.length;
        data.hit_table.push(cell[field]);
        return index;
      }
      return cell[field];
    });
  });
  return data;
}
function fixture({ opening = true, standalone = false, many = false } = {}) {
  const report = sourceReport(standalone ? 'opening' : 'archive');
  if (opening && !standalone) report.opening_report = sourceReport('opening');
  if (many) report.cells = Array.from({ length: 9 }, (_, i) => cell({ ev_sum: i + 0.12345678 }));
  const shell = source => ({ ...structuredClone(source), cells: [], best_cells: [] });
  const manifest = { version: 3, report_encoding: 'chunked-indexed-v1', sport: 'nba', report: shell(report), parts: [] };
  if (report.opening_report) manifest.report.opening_report = shell(report.opening_report);
  const payloads = new Map();
  for (const source of [report, report.opening_report].filter(Boolean)) {
    const { opening_report, ...metadata } = source;
    const slices = source.cells.map(row => ({ ...metadata, cells: [row], best_cells: [] }));
    if (source.best_cells.length) slices.push({ ...metadata, cells: [], best_cells: source.best_cells });
    for (const slice of slices) {
      const part = packed(slice), raw = Buffer.from(JSON.stringify(part));
      const digest = createHash('sha256').update(raw).digest('hex');
      const descriptor = { dataset: `devig_results_nba_part_${digest}`, digest, source: source.price_source,
        cells: slice.cells.length, best_cells: slice.best_cells.length, raw_bytes: raw.length, gzip_bytes: gzipSync(raw).length };
      manifest.parts.push(descriptor);
      payloads.set(descriptor.dataset, part);
    }
  }
  return { report, manifest, payloads, fetchPart: async descriptor => payloads.get(descriptor.dataset) };
}
const filters = { start: '2026-11-01', end: '2026-11-03', book: '', prop: '', reference: 'pn;1', method: 'probit', minimum: 1, profitableOnly: false };

test('chunked reports preserve every cell, metadata, source, Kelly view, CSV, and share result', async () => {
  const { report, manifest, fetchPart } = fixture();
  const loaded = await resolveReport(manifest, { expectedSport: 'nba', fetchPart });
  assert.deepEqual(loaded, report);
  for (const priceSource of ['archive', 'opening']) for (const staking of ['flat', 'quarter-kelly']) {
    for (const scope of [{}, { book: 'best' }, { book: 'fd' }, { prop: 'reb' }, { start: '2026-11-03' }, { profitableOnly: true }]) {
      const filter = { ...filters, ...scope, priceSource, staking };
      assert.deepEqual(buildView(loaded, filter), buildView(report, filter));
      assert.equal(exportCSV(buildView(loaded, filter), filter), exportCSV(buildView(report, filter), filter));
      assert.deepEqual(buildPerformers(loaded, filter), buildPerformers(report, filter));
    }
  }
  assert.equal(reportForSource(loaded, 'opening').best_cells[0].profit_units, 4);
});

test('Python publication fixture restores identical archive/opening reports and rendered results', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/devig-chunks-python.json'), 'utf8'));
  const loaded = await resolveReport(fixture.manifest, {
    expectedSport: fixture.original.sport, fetchPart: async descriptor => fixture.parts[descriptor.dataset],
  });
  assert.deepEqual(loaded, fixture.original);
  const filter = { ...filters, start: loaded.window.start, end: loaded.window.end,
    reference: loaded.references[0].id, method: loaded.methods[0].id };
  for (const priceSource of ['archive', 'opening']) for (const staking of ['flat', 'quarter-kelly']) {
    const options = { ...filter, priceSource, staking };
    const expected = buildView(fixture.original, options), actual = buildView(loaded, options);
    assert.deepEqual(actual, expected);
    assert.equal(exportCSV(actual, options), exportCSV(expected, options));
    assert.deepEqual(buildPerformers(loaded, options), buildPerformers(fixture.original, options));
  }
});

test('legacy object and indexed reports retain their normal validation path', async () => {
  const report = sourceReport('archive');
  assert.strictEqual(await resolveReport(report, { expectedSport: 'nba' }), report);
  assert.deepEqual(await resolveReport(packed(report), { expectedSport: 'nba' }), report);
});

test('standalone opening reports and empty manifests remain valid', async () => {
  const { report, manifest, fetchPart } = fixture({ standalone: true });
  assert.deepEqual(await resolveReport(manifest, { fetchPart }), report);
  manifest.parts = [];
  assert.deepEqual(await resolveReport(manifest, { fetchPart }), manifest.report);
});

test('at most four part requests run concurrently and completion order does not reorder rows', async () => {
  const { report, manifest, payloads } = fixture({ opening: false, many: true });
  let active = 0, peak = 0;
  const loaded = await resolveReport(manifest, { fetchPart: async descriptor => {
    active++; peak = Math.max(peak, active);
    const index = manifest.parts.indexOf(descriptor);
    await new Promise(resolve => setTimeout(resolve, index % 3 === 0 ? 12 : 1));
    active--;
    return payloads.get(descriptor.dataset);
  } });
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(loaded, report);
});

test('failed or cancelled part loads never replace the previously accepted report', async () => {
  const { manifest, fetchPart } = fixture();
  const previous = sourceReport('archive');
  let accepted = previous;
  await assert.rejects(async () => { accepted = await resolveReport(manifest, { fetchPart: async descriptor => {
    if (descriptor === manifest.parts[2]) throw new Error('part unavailable');
    return fetchPart(descriptor);
  } }); }, /part unavailable/);
  assert.strictEqual(accepted, previous);
  const controller = new AbortController();
  await assert.rejects(resolveReport(manifest, { signal: controller.signal, fetchPart: async descriptor => {
    controller.abort(); return fetchPart(descriptor);
  } }), { name: 'AbortError' });
  let called = false;
  await assert.rejects(resolveReport(manifest, { signal: controller.signal, fetchPart: async () => { called = true; } }), { name: 'AbortError' });
  assert.equal(called, false);
});

test('frozen manifest inputs are not mutated and part metadata key order is irrelevant', async () => {
  const { manifest, report, payloads } = fixture();
  const before = structuredClone(manifest);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(manifest);
  const loaded = await resolveReport(manifest, { fetchPart: async descriptor =>
    Object.fromEntries(Object.entries(payloads.get(descriptor.dataset)).reverse()) });
  assert.deepEqual(loaded, report);
  assert.deepEqual(manifest, before);
});

for (const [name, mutate] of [
  ['unsupported encoding', f => { f.manifest.report_encoding = 'unknown'; }],
  ['wrong sport', f => { f.manifest.sport = 'nhl'; }],
  ['nonempty shell', f => { f.manifest.report.cells.push(cell()); }],
  ['nonempty opening shell', f => { f.manifest.report.opening_report.cells.push(cell()); }],
  ['invalid part digest', f => { f.manifest.parts[0].digest = 'bad'; }],
  ['wrong dataset', f => { f.manifest.parts[0].dataset = f.manifest.parts[0].dataset.replace('nba', 'nhl'); }],
  ['wrong source', f => { f.manifest.parts[0].source = 'opening'; }],
  ['unknown source', f => { f.manifest.parts[0].source = '__proto__'; }],
  ['negative row count', f => { f.manifest.parts[0].cells = -1; }],
  ['wrong row count', f => { f.manifest.parts[0].cells++; }],
  ['wrong best count', f => { f.manifest.parts[0].best_cells++; }],
  ['unsafe count', f => { f.manifest.parts[0].cells = 2 ** 53; }],
  ['oversized part', f => { f.manifest.parts[0].gzip_bytes = 16 * 1024 * 1024 + 1; }],
  ['oversized decoded part', f => { f.manifest.parts[0].raw_bytes = 128 * 1024 * 1024 + 1; }],
  ['nested report in part', f => { f.payloads.get(f.manifest.parts[0].dataset).opening_report = sourceReport('opening'); }],
  ['wrong report version', f => { f.payloads.get(f.manifest.parts[0].dataset).version = 1; }],
  ['wrong timestamp', f => { f.payloads.get(f.manifest.parts[0].dataset).generated_at = '2026-11-05T12:00:00Z'; }],
  ['wrong methods', f => { f.payloads.get(f.manifest.parts[0].dataset).methods = []; }],
  ['wrong window', f => { f.payloads.get(f.manifest.parts[0].dataset).window = { start: '2026-11-01', end: '2026-11-04' }; }],
]) test(`reject malformed chunked report: ${name}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(resolveReport(f.manifest, { expectedSport: 'nba', fetchPart: f.fetchPart }), /report|result|sport/i);
});
