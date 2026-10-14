const test = require('node:test');
const assert = require('node:assert/strict');
const { nflMarketLabel, goalMarketLabel, validateReport, buildView, buildPerformers, exportCSV } = require('../devig-results.js');

function sourceReport(source) {
  const props = source === 'opening' ? ['rec_yd', '1h_total', 'pass_yd']
    : ['rec_yd', '1h_total', 'pass_yd', 'attd', '2+td', 'no_td', 'rush_yd', 'tackles+ast'];
  const cells = props.map((prop, index) => ({
    date: '2026-10-13', book: 'fd', prop, reference: 'pn;1', method: 'probit', odds_band: '+100 to +199',
    share_odds_bucket: 'short', selected: 3 + index, wins: 1, losses: 1 + index, pushes: 0,
    pending: 1, ungraded: 0, profit_units: (source === 'opening' ? 100 : 0) + index + 1,
    ev_sum: 30, kelly_stake_units: index + 2, kelly_profit_units: (source === 'opening' ? 20 : 0) + (index + 1) / 2,
    best_hit: { player: prop === '1h_total' ? '' : 'Example Player', date: '2026-10-13', game: 'nyg @ dal',
      prop, line: prop === '2+td' ? 1.5 : .5, under: false, book: 'fd', odds: 150, profit_units: 1.5 },
  }));
  return { version: 1, sport: 'nfl', price_source: source, kelly_version: 1, best_hit_version: 1,
    share_odds_version: 1, window: { start: '2026-10-07', end: '2026-10-13', days: 7 },
    references: [{ id: 'pn;1', name: 'Pinnacle', books: ['pn'] }], methods: [{ id: 'probit', name: 'Probit' }],
    cells, best_cells: [] };
}
function fixture() { return { ...sourceReport('archive'), opening_report: sourceReport('opening') }; }
function compact(report) {
  const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
    'kelly_stake_units', 'kelly_profit_units'];
  const dictionaries = Object.fromEntries(dimensions.map(key => [key, [...new Set(report.cells.map(cell => cell[key]))]]));
  const output = { ...report, version: 2, cell_encoding: 'indexed-v1',
    cell_fields: [...dimensions, ...metrics, 'best_hit', 'highest_odds_hit', 'lowest_odds_hit'],
    cell_dictionaries: dictionaries, hit_table: report.cells.map(cell => cell.best_hit),
    cells: report.cells.map((cell, index) => [...dimensions.map(key => dictionaries[key].indexOf(cell[key])),
      ...metrics.map(key => cell[key]), index]) };
  if (report.opening_report) output.opening_report = compact(report.opening_report);
  return output;
}
const filters = { start: '2026-10-07', end: '2026-10-13', book: '', prop: '', reference: 'pn;1',
  method: 'probit', minimum: 1, profitableOnly: false };

test('NFL canonical prop names and legacy yard aliases have readable labels', () => {
  const expected = {
    pass_yd: 'Passing yards', pass_yds: 'Passing yards', rush_yd: 'Rushing yards', rush_yds: 'Rushing yards',
    rec_yd: 'Receiving yards', rec_yds: 'Receiving yards', rec: 'Receptions', pass_cmp: 'Pass completions',
    pass_att: 'Pass attempts', pass_int: 'Interceptions thrown', rush_att: 'Rush attempts',
    pass_td: 'Passing touchdowns', rush_td: 'Rushing touchdowns', rec_td: 'Receiving touchdowns',
    targets: 'Receiving targets', longest_pass: 'Longest completion', longest_rush: 'Longest rush', longest_rec: 'Longest reception',
    'pass_yd+rush_yd': 'Passing + rushing yards', 'rush_yd+rec_yd': 'Rushing + receiving yards',
    'pass_yd+rush_yd+rec_yd': 'Passing + rushing + receiving yards', 'tackles+ast': 'Tackles + assists',
  };
  for (const [prop, label] of Object.entries(expected)) assert.equal(nflMarketLabel(prop), label);
});
test('NFL touchdown tiers, unders and period lines remain explicit and distinct', () => {
  assert.equal(nflMarketLabel('attd'), 'ATTD (Anytime touchdown)');
  assert.equal(nflMarketLabel('no_td'), 'No touchdown (under 0.5)');
  assert.equal(nflMarketLabel('2+td'), '2+ touchdowns');
  assert.equal(nflMarketLabel('4+td'), '4+ touchdowns');
  assert.equal(nflMarketLabel('tds_under_1.5'), 'Under 1.5 touchdowns');
  assert.equal(nflMarketLabel('tds_over_2.5'), 'Over 2.5 touchdowns');
  assert.equal(nflMarketLabel('spread'), 'Point spread');
  assert.equal(nflMarketLabel('1h_total'), '1st half · Game total');
  assert.equal(nflMarketLabel('2h_team_total'), '2nd half · Team total');
  assert.equal(nflMarketLabel('1q_spread'), '1st quarter · Point spread');
  assert.equal(nflMarketLabel('4q_home_total'), '4th quarter · Home team total');
});
test('NFL markets group naturally while NHL goal tiers retain their previous order', () => {
  assert.deepEqual(buildView(fixture(), filters).byProp.map(row => row.prop),
    ['attd', '2+td', 'no_td', 'pass_yd', 'rush_yd', 'rec_yd', 'tackles+ast', '1h_total']);
  const nhl = { ...sourceReport('archive'), sport: 'nhl',
    cells: ['total', '4+goals', 'sog', 'atgs', '2+goals', 'ml'].map(prop => ({ ...sourceReport('archive').cells[0], prop })) };
  assert.deepEqual(buildView(nhl, filters).byProp.map(row => row.prop), ['atgs', '2+goals', '4+goals', 'sog', 'ml', 'total']);
  assert.equal(goalMarketLabel('2+goals'), 'ATGS — 2+ goals');
});
for (const format of ['legacy', 'compact']) for (const priceSource of ['archive', 'opening']) for (const staking of ['flat', 'quarter-kelly']) {
  test(`${format}/${priceSource}/${staking}: non-ATTD market filters retain exact source and staking metrics`, () => {
    const original = fixture(), report = format === 'compact' ? compact(original) : original;
    validateReport(report, 'nfl');
    const source = priceSource === 'opening' ? original.opening_report : original;
    for (const prop of ['pass_yd', 'rec_yd', '1h_total']) {
      const expected = source.cells.find(row => row.prop === prop), scoped = { ...filters, prop, priceSource, staking };
      const view = buildView(report, scoped), matrix = buildPerformers(report, scoped);
      const entry = matrix.rows[0].cells[0].row;
      assert.deepEqual(view.byProp.map(row => row.prop), [prop]);
      assert.equal(view.total.selected, expected.selected);
      assert.equal(view.total.profit_units, expected[staking === 'quarter-kelly' ? 'kelly_profit_units' : 'profit_units']);
      assert.equal(view.total.stake_units, staking === 'quarter-kelly' ? expected.kelly_stake_units : expected.wins + expected.losses);
      assert.equal(entry.profit_units, view.total.profit_units);
      assert.equal(entry.stake_units, view.total.stake_units);
      assert.equal(entry.best_hit.prop, prop);
      assert.ok(exportCSV(view, scoped).includes(`"${priceSource}"`));
    }
    const all = buildView(report, { ...filters, priceSource, staking });
    assert.equal(all.total.selected, source.cells.reduce((sum, row) => sum + row.selected, 0));
    if (priceSource === 'opening') assert.equal(buildView(report, { ...filters, priceSource, staking, prop: 'attd' }).total.selected, 0);
  });
}
