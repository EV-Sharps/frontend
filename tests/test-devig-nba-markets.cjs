const test = require('node:test');
const assert = require('node:assert/strict');
const { nbaMarketLabel, nflMarketLabel, goalMarketLabel, sportFromSearch, configDescription,
  validateReport, buildView, buildPerformers, exportCSV } = require('../devig-results.js');

function sourceReport(source) {
  const props = source === 'opening' ? ['pts', '1h_total', '1q_ml']
    : ['1q_ml', 'home_total', 'pts+reb+ast', 'reb', 'spread', '3ptm', 'dd', 'pts', '1h_total', 'ml', 'blk+stl'];
  const cells = props.map((prop, index) => ({
    date: '2026-10-21', book: 'fd', prop, reference: 'pn;1', method: 'probit', odds_band: '+100 to +199',
    share_odds_bucket: 'short', selected: 5 + index, wins: 1, losses: 1 + index, pushes: 1,
    pending: 1, ungraded: 1, profit_units: (source === 'opening' ? 100 : 0) + index + 1,
    ev_sum: 30, kelly_stake_units: index + 2, kelly_profit_units: (source === 'opening' ? 20 : 0) + (index + 1) / 2,
    best_hit: { player: ['ml', 'spread', 'home_total', '1h_total', '1q_ml'].includes(prop) ? '' : 'Example Player',
      date: '2026-10-21', game: 'ny @ bos', prop, line: prop.includes('total') ? 110.5 : .5,
      under: false, book: 'fd', odds: 150, profit_units: 1.5 },
  }));
  return { version: 1, sport: 'nba', price_source: source, kelly_version: 1, best_hit_version: 1,
    share_odds_version: 1, window: { start: '2026-10-15', end: '2026-10-21', days: 7 },
    references: [{ id: 'pn;1', name: 'Pinnacle', books: ['pn'] }], methods: [{ id: 'probit', name: 'Probit' }],
    cells, best_cells: [{ ...cells[0], book: 'best', profit_units: 500, kelly_profit_units: 50 }] };
}
function fixture() { return { ...sourceReport('archive'), opening_report: sourceReport('opening') }; }
function compact(report) {
  const dimensions = ['date', 'book', 'prop', 'reference', 'method', 'odds_band', 'share_odds_bucket'];
  const metrics = ['selected', 'wins', 'losses', 'pushes', 'pending', 'ungraded', 'profit_units', 'ev_sum',
    'kelly_stake_units', 'kelly_profit_units'];
  const all = [...report.cells, ...report.best_cells];
  const dictionaries = Object.fromEntries(dimensions.map(key => [key, [...new Set(all.map(cell => cell[key]))]]));
  const encode = cell => [...dimensions.map(key => dictionaries[key].indexOf(cell[key])),
    ...metrics.map(key => cell[key]), all.indexOf(cell)];
  const output = { ...report, version: 2, cell_encoding: 'indexed-v1',
    cell_fields: [...dimensions, ...metrics, 'best_hit', 'highest_odds_hit', 'lowest_odds_hit'],
    cell_dictionaries: dictionaries, hit_table: all.map(cell => cell.best_hit),
    cells: report.cells.map(encode), best_cells: report.best_cells.map(encode) };
  if (report.opening_report) output.opening_report = compact(report.opening_report);
  return output;
}
const filters = { start: '2026-10-15', end: '2026-10-21', book: '', prop: '', reference: 'pn;1',
  method: 'probit', minimum: 1, profitableOnly: false };

test('NBA routing and report validation remain strict about the requested sport', () => {
  assert.equal(sportFromSearch('?sport=nba&preview=1'), 'nba');
  assert.equal(sportFromSearch('?sport=nfl'), 'nfl');
  assert.equal(sportFromSearch('?sport=nhl'), 'nhl');
  for (const query of ['', '?sport=mlb', '?sport=NBA', '?sport=nba%26invalid=1']) assert.equal(sportFromSearch(query), 'nhl');
  validateReport(fixture(), 'nba');
  assert.throws(() => validateReport(fixture(), 'nhl'), /different sport/);
  assert.throws(() => validateReport({ ...fixture(), sport: 'mlb' }), /format is not supported/);
  const wrongOpening = fixture(); wrongOpening.opening_report.sport = 'nfl';
  assert.throws(() => validateReport(wrongOpening, 'nba'), /different sport/);
  assert.match(configDescription({}, 'nba'), /Archived NBA offers/);
});
test('NBA labels distinguish basketball stats, game lines, halves and quarters', () => {
  const labels = {
    pts: 'Points', reb: 'Rebounds', oreb: 'Offensive rebounds', dreb: 'Defensive rebounds',
    ast: 'Assists', '3ptm': 'Made threes', '3pta': 'Three-point attempts',
    fgm: 'Field goals made', fga: 'Field goal attempts', ftm: 'Free throws made', fta: 'Free throw attempts',
    'pts+reb': 'Points + rebounds', 'pts+ast': 'Points + assists', 'reb+ast': 'Rebounds + assists',
    'pts+reb+ast': 'Points + rebounds + assists', stl: 'Steals', blk: 'Blocks', to: 'Turnovers',
    'blk+stl': 'Blocks + steals', 'stl+blk': 'Blocks + steals', dd: 'Double-double', td: 'Triple-double',
    ml: 'Moneyline', spread: 'Point spread', total: 'Game total', tt: 'Team total',
    team_total: 'Team total', home_total: 'Home team total', away_total: 'Away team total',
  };
  for (const [prop, label] of Object.entries(labels)) assert.equal(nbaMarketLabel(prop), label);
  assert.equal(nbaMarketLabel('1h_total'), '1st half · Game total');
  assert.equal(nbaMarketLabel('2h_home_total'), '2nd half · Home team total');
  assert.equal(nbaMarketLabel('1q_ml'), '1st quarter · Moneyline');
  assert.equal(nbaMarketLabel('3q_pts'), '3rd quarter · Points');
  assert.equal(nbaMarketLabel('4q_spread'), '4th quarter · Point spread');
  for (const prop of ['fb', '1st pts', '1st ast', 'attd', 'atgs', '5q_total', 'unknown']) assert.equal(nbaMarketLabel(prop), null);
  assert.equal(nflMarketLabel('td'), null);
  assert.equal(nflMarketLabel('attd'), 'ATTD (Anytime touchdown)');
  assert.equal(goalMarketLabel('2+goals'), 'ATGS - 2+ goals');
});
test('NBA groups retain separate full game, half and quarter result samples', () => {
  assert.deepEqual(buildView(fixture(), filters).byProp.map(row => row.prop),
    ['pts', 'reb', '3ptm', 'pts+reb+ast', 'blk+stl', 'dd', 'ml', 'spread', 'home_total', '1h_total', '1q_ml']);
  const source = fixture();
  source.cells.push({ ...source.cells[0], prop: 'unknown_stat' });
  assert.equal(buildView(source, filters).byProp.at(-1).prop, 'unknown_stat');
  assert.ok(!buildView(fixture(), filters).byProp.some(row => row.prop === 'fb'));
  const shooting = fixture();
  shooting.cells = ['fta', '3pta', 'fgm', 'dreb', 'ftm', 'oreb', 'fga']
    .map(prop => ({ ...shooting.cells[0], prop }));
  assert.deepEqual(buildView(shooting, filters).byProp.map(row => row.prop),
    ['oreb', 'dreb', '3pta', 'fgm', 'fga', 'ftm', 'fta']);
});
for (const format of ['legacy', 'compact']) for (const priceSource of ['archive', 'opening']) for (const staking of ['flat', 'quarter-kelly']) {
  test(`${format}/${priceSource}/${staking}: NBA filters, share cells and CSV use the same sample`, () => {
    const original = fixture(), report = format === 'compact' ? compact(original) : original;
    validateReport(report, 'nba');
    const source = priceSource === 'opening' ? original.opening_report : original;
    for (const prop of ['pts', '1h_total', '1q_ml']) {
      const expected = source.cells.find(row => row.prop === prop), scoped = { ...filters, prop, priceSource, staking };
      const view = buildView(report, scoped), matrix = buildPerformers(report, scoped);
      const entry = matrix.rows[0].cells[0].row;
      assert.deepEqual(view.byProp.map(row => row.prop), [prop]);
      assert.equal(view.total.selected, expected.selected);
      assert.equal(view.total.profit_units, expected[staking === 'quarter-kelly' ? 'kelly_profit_units' : 'profit_units']);
      assert.equal(view.total.stake_units, staking === 'quarter-kelly' ? expected.kelly_stake_units : expected.wins + expected.losses + expected.pushes);
      assert.equal(entry.profit_units, view.total.profit_units);
      assert.equal(entry.stake_units, view.total.stake_units);
      assert.equal(entry.best_hit.prop, prop);
      const csv = exportCSV(view, scoped);
      assert.ok(csv.includes(`"${priceSource}"`));
      assert.ok(csv.includes(`"${prop}"`));
    }
    const all = buildView(report, { ...filters, priceSource, staking });
    assert.equal(all.total.selected, source.cells.reduce((sum, row) => sum + row.selected, 0));
    const best = buildView(report, { ...filters, priceSource, staking, book: 'best' });
    assert.equal(best.total.profit_units, staking === 'quarter-kelly' ? 50 : 500);
    if (priceSource === 'opening') assert.equal(buildView(report, { ...filters, priceSource, staking, prop: 'reb' }).total.selected, 0);
  });
}
