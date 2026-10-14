const test = require('node:test');
const assert = require('node:assert/strict');
const { goalMarketLabel, buildView, buildPerformers, exportCSV } = require('../devig-results.js');

function fixture() {
  const cells = ['2+goals', 'atgs', '10+goals', 'sog', '4+goals', '3+goals'].map((prop, index) => ({
    date: '2026-10-13', book: 'fd', prop, reference: 'circa;1', method: 'probit',
    odds_band: '+1000 and above', share_odds_bucket: 'long', selected: 10 + index,
    wins: 1, losses: 9 + index, pushes: 0, pending: 0, ungraded: 0, profit_units: 3 - index, ev_sum: 20 + index,
    best_hit: { player: 'Sample Player', date: '2026-10-13', game: 'ana @ bos', prop,
      line: prop === 'atgs' ? .5 : prop === 'sog' ? 3.5 : Number.parseInt(prop, 10) - .5,
      under: false, book: 'fd', odds: 1200, profit_units: 12 },
  }));
  return { version: 1, sport: 'nhl', best_hit_version: 1, share_odds_version: 1,
    window: { start: '2026-10-13', end: '2026-10-13' },
    references: [{ id: 'circa;1', name: 'Circa', books: ['circa'] }], methods: [{ id: 'probit', name: 'Probit' }],
    cells, best_cells: [] };
}
function compact(report) {
  const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum'];
  const dictionaries = Object.fromEntries(dimensions.map(key => [key, [...new Set(report.cells.map(cell => cell[key]))]]));
  return { ...report, version: 2, cell_encoding: 'indexed-v1',
    cell_fields: [...dimensions, ...metrics, 'best_hit', 'highest_odds_hit', 'lowest_odds_hit'],
    cell_dictionaries: dictionaries, hit_table: report.cells.map(cell => cell.best_hit),
    cells: report.cells.map((cell, index) => [...dimensions.map(key => dictionaries[key].indexOf(cell[key])),
      ...metrics.map(key => cell[key]), index]) };
}
const filters = { start: '2026-10-13', end: '2026-10-13', book: '', prop: '', reference: 'circa;1',
  method: 'probit', minimum: 1, profitableOnly: false };

test('goal-tier labels explicitly distinguish one, two and higher goal totals', () => {
  assert.equal(goalMarketLabel('atgs'), 'ATGS — 1+ goals');
  assert.equal(goalMarketLabel('2+goals'), 'ATGS — 2+ goals');
  assert.equal(goalMarketLabel('3+goals'), 'ATGS — 3+ goals');
  assert.equal(goalMarketLabel('4+goals'), 'ATGS — 4+ goals');
  assert.equal(goalMarketLabel('10+goals'), 'ATGS — 10+ goals');
  for (const prop of ['no_goal', 'goals_under_1.5', 'sog', 'attd']) assert.equal(goalMarketLabel(prop), null);
});
for (const format of ['legacy', 'compact']) {
  test(`${format}: goal tiers stay adjacent in numeric order before unrelated props`, () => {
    const source = fixture(), report = format === 'compact' ? compact(source) : source;
    assert.deepEqual(buildView(report, filters).byProp.map(row => row.prop),
      ['atgs', '2+goals', '3+goals', '4+goals', '10+goals', 'sog']);
  });
  test(`${format}: one-goal and two-goal dashboard, odds/book ranks, share hits and CSV never pool`, () => {
    const source = fixture(), report = format === 'compact' ? compact(source) : source;
    for (const prop of ['atgs', '2+goals']) {
      const original = source.cells.find(cell => cell.prop === prop), scope = { ...filters, prop };
      const view = buildView(report, scope), share = buildPerformers(report, scope).rows[0].cells[0].row;
      assert.equal(view.total.selected, original.selected);
      assert.equal(view.total.profit_units, original.profit_units);
      assert.deepEqual(view.byProp.map(row => row.prop), [prop]);
      assert.equal(view.byProp[0].books[0].selected, original.selected);
      assert.equal(view.byProp[0].bands[0].selected, original.selected);
      assert.equal(share.selected, original.selected);
      assert.equal(share.profit_units, original.profit_units);
      assert.equal(share.best_hit.prop, prop);
      assert.equal(share.best_hit.line, prop === 'atgs' ? .5 : 1.5);
      const csv = exportCSV(view, scope);
      assert.ok(csv.includes(`"${prop}"`));
      assert.ok(!csv.includes(`"${prop === 'atgs' ? '2+goals' : 'atgs'}"`));
    }
    const all = buildView(report, filters);
    assert.equal(all.total.selected, source.cells.reduce((sum, row) => sum + row.selected, 0));
    assert.equal(all.byProp.length, source.cells.length);
  });
}
