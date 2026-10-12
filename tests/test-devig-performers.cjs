const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPerformers } = require('../devig-results.js');
const hit = (changes = {}) => ({ player: 'Player One', player_id: 'one', date: '2026-10-11',
  game: 'away @ home', prop: 'attd', line: .5, under: false, book: 'fd', odds: 150,
  profit_units: 1.5, ...changes });
function cell(changes = {}) {
  const row = { date: '2026-10-11', book: 'fd', prop: 'attd', reference: 'pn;1', method: 'probit',
    odds_band: '+100 to +199', share_odds_bucket: 'short', selected: 13, wins: 4, losses: 5, pushes: 1,
    pending: 2, ungraded: 1, profit_units: 3, ev_sum: 130, ...changes };
  const odds = { short: 150, mid: 500, long: 1200 }[row.share_odds_bucket] || 150;
  if (!Object.hasOwn(changes, 'best_hit')) row.best_hit = hit({ date: row.date, prop: row.prop,
    book: row.book === 'best' ? 'fd' : row.book, odds, profit_units: odds / 100 });
  return row;
}
const bucketCell = (bucket, changes = {}) => cell({ share_odds_bucket: bucket,
  odds_band: { short: '+100 to +199', mid: '+400 to +699', long: '+1000 and above' }[bucket], ...changes });
const refs = [
  { id: 'fd;1', name: 'FanDuel', books: ['fd'] },
  { id: 'pn+fd;1+1', name: 'Pinnacle + FD', books: ['pn', 'fd'] },
  { id: 'mb;1', name: 'Matchbook', books: ['mb'] },
  { id: 'poly;1', name: 'Polymarket', books: ['poly'] },
  { id: 'px;1', name: 'ProphetX', books: ['px'] },
  { id: 'nv;1', name: 'Novig', books: ['nv'] },
  { id: 'kal;1', name: 'Kalshi', books: ['kal'] },
  { id: 'pn+circa;1+1', name: 'Circa + Pinnacle', books: ['pn', 'circa'] },
  { id: 'pn;1', name: 'Pinnacle', books: ['pn'] },
  { id: 'circa;1', name: 'Circa', books: ['circa'] },
  { id: 'dk;1', name: 'DraftKings', books: ['dk'] },
];
const report = (cells, changes = {}) => ({ sport: 'nfl', share_odds_version: 1, best_hit_version: 1,
  hit_extremes_version: 1, references: structuredClone(refs), methods: ['probit', 'worst', 'power', 'mult', 'add'].map(id => ({ id, name: id })),
  cells, best_cells: [], ...changes });
const filters = { start: '2026-10-11', end: '2026-10-11', prop: 'attd', book: '', reference: 'pn;1',
  minimum: 10, profitableOnly: false };
const matrix = (data, changes = {}) => buildPerformers(data, { ...filters, ...changes });
const entry = (data, book = 'fd', reference = 'pn;1', changes = {}) => matrix(data, changes).rows.find(row => row.book === book)
  .cells.find(item => item.reference === reference);
const axes = result => ({ books: result.rows.map(row => row.book), refs: result.columns.map(column => column.id) });

test('declared devigs form fixed columns with Circa, Pinnacle, their blend and Kalshi first', () => {
  const data = report([cell({ profit_units: 100 }), cell({ reference: 'fd;1', profit_units: 1000 }),
    cell({ book: 'dk', reference: 'circa;1', profit_units: -100 })]);
  const result = matrix(data);
  assert.deepEqual(result.columns.map(column => column.id), [
    'circa;1', 'pn;1', 'pn+circa;1+1', 'kal;1', 'nv;1', 'px;1', 'poly;1', 'mb;1', 'pn+fd;1+1', 'dk;1', 'fd;1',
  ]);
  for (const column of result.columns) assert.deepEqual(column, refs.find(ref => ref.id === column.id));
  assert.deepEqual(result.rows.map(row => row.book), ['fd', 'dk']);
  for (const row of result.rows) assert.deepEqual(row.cells.map(item => item.reference), result.columns.map(column => column.id));
  assert.equal(result.rows[0].cells.length, refs.length, 'Columns are not limited to three historical leaders');
  assert.equal(entry(data, 'fd', 'fd;1').row.profit_units, 1000);
  assert.equal(entry(data, 'dk', 'circa;1').row.profit_units, -100);
});

test('Probit is the default and an explicit method selects only its offers without choosing the best method', () => {
  const data = report([cell(), cell({ method: 'worst', profit_units: 999 }),
    cell({ method: 'power', profit_units: 500 })]);
  const defaultResult = matrix(data);
  assert.equal(defaultResult.method, 'probit');
  assert.equal(defaultResult.bucket, 'all');
  assert.equal(entry(data).row.method, 'probit');
  assert.equal(entry(data).row.profit_units, 3);
  assert.equal(entry(data, 'fd', 'pn;1', { method: 'worst' }).row.profit_units, 999);
  assert.equal(entry(data, 'fd', 'pn;1', { method: 'power' }).row.profit_units, 500);
  assert.deepEqual(axes(matrix(data, { method: 'worst' })), axes(defaultResult));
  const missing = report([cell({ method: 'worst' })]);
  assert.equal(matrix(missing).method, 'probit');
  assert.ok(matrix(missing).rows.every(row => row.cells.every(item => item.row === null)), 'Missing Probit must not fall back to Worst');
});

test('declared columns stay visible across filters and missing samples instead of sorting by net units or ROI', () => {
  const data = report([cell({ profit_units: 3 }), cell({ reference: 'circa;1', profit_units: -4 }),
    cell({ book: 'dk', reference: 'kal;1', profit_units: 100 })]);
  const expectedAxes = axes(matrix(data));
  for (const changes of [{ method: 'add' }, { minimum: 100 }, { profitableOnly: true }, { bucket: 'long' },
    { start: '2026-10-12', end: '2026-10-12' }]) {
    assert.deepEqual(axes(matrix(data, changes)), expectedAxes);
  }
  const absent = matrix(data, { book: 'absent' });
  assert.deepEqual(absent.rows.map(row => row.book), ['absent']);
  assert.ok(absent.rows[0].cells.every(item => item.row === null));
  assert.equal(matrix(report([])).columns.length, refs.length);
  assert.equal(matrix(report([])).rows.length, 0);
});

test('each coordinate aggregates only its book, reference and method while retaining settlement and unresolved counts', () => {
  const data = report([cell(), cell({ date: '2026-10-10', profit_units: 7 }), bucketCell('mid', { profit_units: 5 }),
    cell({ method: 'power', profit_units: 900 }), cell({ reference: 'circa;1', profit_units: 800 }), cell({ book: 'dk', profit_units: 700 })]);
  const row = entry(data, 'fd', 'pn;1', { start: '2026-10-10' }).row;
  assert.equal(row.profit_units, 15);
  assert.equal(row.selected, 39);
  assert.equal(row.settled, 30);
  assert.deepEqual([row.wins, row.losses, row.pushes, row.pending, row.ungraded], [12, 15, 3, 6, 3]);
  assert.equal(row.roi, 50);
  assert.equal(row.ev_sum, 390);
});

test('optional odds filters include exact +1000 in mid and keep +1001 in long; all keeps every offer', () => {
  const cases = [[-250, 'Below -200', 'short'], [-110, '-200 to -101', 'short'], [100, '+100 to +199', 'short'],
    [399, '+200 to +399', 'short'], [400, '+400 to +699', 'mid'], [999, '+700 to +999', 'mid'],
    [1000, '+1000 and above', 'mid'], [1001, '+1000 and above', 'long']];
  const data = report(cases.map(([odds, odds_band, share_odds_bucket], index) => cell({ odds_band, share_odds_bucket,
    profit_units: index + 1, best_hit: hit({ odds, profit_units: odds > 0 ? odds / 100 : 100 / -odds }) })));
  for (const [bucket, count, profit, bestOdds] of [['short', 52, 10, 399], ['mid', 39, 18, 1000], ['long', 13, 8, 1001], ['all', 104, 36, 1001]]) {
    const result = matrix(data, { bucket }), row = entry(data, 'fd', 'pn;1', { bucket }).row;
    assert.equal(result.bucket, bucket);
    assert.equal(row.selected, count);
    assert.equal(row.profit_units, profit);
    assert.equal(row.best_hit.odds, bestOdds);
  }
});

test('date, market and book filters constrain records and best hits without filtering away reference columns', () => {
  const data = report([cell({ best_hit: hit({ player: 'In scope' }) }),
    cell({ date: '2026-10-10', profit_units: 100 }), cell({ prop: 'sog', profit_units: 200 }), cell({ book: 'dk', profit_units: 300 })]);
  const scoped = matrix(data, { book: 'fd' });
  assert.deepEqual(scoped.rows.map(row => row.book), ['fd']);
  assert.equal(entry(data, 'fd', 'pn;1', { book: 'fd' }).row.profit_units, 3);
  assert.equal(entry(data).row.best_hit.player, 'In scope');
  assert.equal(entry(data, 'fd', 'pn;1', { start: '2026-10-10' }).row.profit_units, 103);
  assert.equal(entry(data, 'fd', 'pn;1', { prop: '' }).row.profit_units, 203);
  assert.equal(matrix(data, { prop: 'atgs' }).rows.length, 0);
  assert.deepEqual(scoped.columns, matrix(data).columns);
  assert.deepEqual(matrix(data, { reference: 'circa;1' }), matrix(data), 'The page detail-view reference does not remove matrix columns');
});

test('one- and four-settled cells remain visible regardless of the main page minimum sample filter', () => {
  const one = { selected: 101, wins: 1, losses: 0, pushes: 0, pending: 90, ungraded: 10, profit_units: 1.5 };
  const four = { selected: 104, wins: 2, losses: 2, pushes: 0, pending: 90, ungraded: 10, profit_units: 1 };
  const data = report([cell(one), bucketCell('mid', four), cell({ ...four, method: 'power' }),
    cell({ ...one, reference: 'circa;1' })]);
  assert.equal(entry(data, 'fd', 'pn;1', { minimum: 1000 }).row.settled, 5);
  const short = entry(data, 'fd', 'pn;1', { bucket: 'short', minimum: 1000 });
  assert.equal(short.reason, null);
  assert.equal(short.row.settled, 1);
  assert.equal(short.row.pending, 90);
  assert.equal(short.row.ungraded, 10);
  assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'mid', minimum: 1000 }).row.settled, 4);
  assert.equal(entry(data, 'fd', 'circa;1', { minimum: 1000 }).row.settled, 1);
  assert.equal(entry(data, 'fd', 'pn;1', { method: 'power', minimum: 1000 }).row.settled, 4);
  assert.deepEqual(matrix(data, { minimum: 1000 }), matrix(data, { minimum: 1 }));
});

test('zero-settled and missing cells stay empty without borrowing another method or unresolved offers', () => {
  const data = report([cell({ selected: 100, wins: 0, losses: 0, pushes: 0, pending: 90, ungraded: 10,
    profit_units: 0, best_hit: undefined }), cell({ method: 'power', selected: 1, wins: 1,
      losses: 0, pushes: 0, pending: 0, ungraded: 0, profit_units: 1.5 })]);
  assert.deepEqual(entry(data), { reference: 'pn;1', row: null, reason: 'empty' });
  assert.deepEqual(entry(data, 'fd', 'circa;1'), { reference: 'circa;1', row: null, reason: 'empty' });
  assert.equal(entry(data, 'fd', 'pn;1', { method: 'power', minimum: 1000 }).row.settled, 1);
});

test('profitable-only blanks zero and losing cells while preserving their coordinates', () => {
  const data = report([cell({ profit_units: 1 }), cell({ reference: 'circa;1', profit_units: 0 }),
    cell({ reference: 'kal;1', profit_units: -1 })]);
  assert.equal(entry(data, 'fd', 'pn;1', { profitableOnly: true }).row.profit_units, 1);
  for (const reference of ['circa;1', 'kal;1']) {
    const item = entry(data, 'fd', reference, { profitableOnly: true });
    assert.equal(item.row, null);
    assert.equal(item.reason, 'unprofitable');
  }
  assert.deepEqual(axes(matrix(data, { profitableOnly: true })), axes(matrix(data)));
});

test('legacy +1000 ambiguity blocks only its own book/reference/method for mid or long; all odds remains usable', () => {
  const data = report([cell(), bucketCell('mid'), bucketCell('long'), bucketCell('mid', { reference: 'circa;1' }),
    bucketCell('mid', { book: 'dk' }), bucketCell('long', { method: 'power', reference: 'kal;1' })]);
  delete data.share_odds_version;
  for (const bucket of ['mid', 'long']) {
    assert.equal(entry(data, 'fd', 'pn;1', { bucket }).reason, 'rebuild');
    assert.equal(entry(data, 'fd', 'pn;1', { bucket }).row, null);
    assert.notEqual(entry(data, 'fd', 'circa;1', { bucket }).reason, 'rebuild');
    assert.notEqual(entry(data, 'dk', 'pn;1', { bucket }).reason, 'rebuild');
    assert.notEqual(entry(data, 'fd', 'kal;1', { bucket }).reason, 'rebuild', 'Other-method ambiguity cannot contaminate Probit');
  }
  assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'short' }).row.selected, 13);
  assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'all' }).row.selected, 39);
  assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'all' }).row.profit_units, 9);
  assert.equal(entry(data, 'fd', 'kal;1', { method: 'power', bucket: 'long' }).reason, 'rebuild');
  data.cells[2].date = '2026-10-10';
  assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'mid' }).row.selected, 13);
});

test('new missing or contradictory range metadata never guesses a ranged result or suppresses another coordinate', () => {
  for (const changes of [{ share_odds_bucket: undefined }, { share_odds_bucket: 'mid' }, { share_odds_bucket: 'bogus' }]) {
    const data = report([cell(changes), cell({ reference: 'circa;1' }), cell({ book: 'dk' })]);
    assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'short' }).reason, 'rebuild');
    assert.equal(entry(data, 'fd', 'circa;1', { bucket: 'short' }).row.profit_units, 3);
    assert.equal(entry(data, 'dk', 'pn;1', { bucket: 'short' }).row.profit_units, 3);
    assert.equal(entry(data, 'fd', 'pn;1', { bucket: 'all' }).row.profit_units, 3, 'All odds does not need bucket reconstruction');
  }
});

test('the winning highlight follows the exact selected method and odds range, with net units resolving its ranking', () => {
  const data = report([cell({ best_hit: hit({ player: 'Short win', odds: 399, profit_units: 3.99 }) }),
    bucketCell('mid', { best_hit: hit({ player: 'Gross longer', odds: 999, profit_units: 8.5 }) }),
    bucketCell('mid', { best_hit: hit({ player: 'Net larger', odds: 950, profit_units: 9.5 }) }),
    bucketCell('long', { best_hit: hit({ player: 'Long win', odds: 1500, profit_units: 15 }) }),
    bucketCell('long', { method: 'worst', best_hit: hit({ player: 'Other method', odds: 9999, profit_units: 99.99 }) })]);
  for (const [bucket, winner] of [['short', 'Short win'], ['mid', 'Net larger'], ['long', 'Long win'], ['all', 'Long win']]) {
    assert.equal(entry(data, 'fd', 'pn;1', { bucket }).row.best_hit.player, winner);
  }
  assert.equal(entry(data, 'fd', 'pn;1', { method: 'worst' }).row.best_hit.player, 'Other method');
});

test('invalid, missing or old winning metadata never invents a hit or discards valid records', () => {
  for (const changes of [{ book: 'dk' }, { date: '2026-10-10' }, { prop: 'sog' }, { odds: '150' },
    { odds: 0 }, { player: '', game: '' }, { profit_units: 0 }, { line: null }, { under: 'no' }]) {
    const row = entry(report([cell({ best_hit: hit(changes) })])).row;
    assert.equal(row.profit_units, 3);
    assert.equal(row.best_hit, null);
    assert.equal(row.hit_status, 'unavailable');
  }
  const old = report([cell()]); delete old.best_hit_version;
  assert.equal(entry(old).row.hit_status, 'rebuild');
  assert.equal(entry(report([cell(), cell({ best_hit: undefined })])).row.hit_status, 'unavailable');
  const noWins = report([cell({ wins: 0, losses: 9, pushes: 1, best_hit: undefined, profit_units: -9 })]);
  assert.equal(entry(noWins).row.hit_status, 'none');
  const team = report([cell({ prop: 'ml', best_hit: hit({ prop: 'ml', player: '', game: 'bos @ tor', line: 0 }) })]);
  assert.equal(entry(team, 'fd', 'pn;1', { prop: 'ml' }).row.best_hit.game, 'bos @ tor');
});

test('synthetic Best is explicit and retains actual winning source book; stable axes do not mutate the report', () => {
  const data = report([cell({ book: 'dk' }), cell()], { best_cells: [bucketCell('long', { book: 'best',
    best_hit: hit({ player: 'Exchange win', book: 'px', odds: 1500, profit_units: 14.7 }) })] });
  const before = JSON.stringify(data);
  assert.deepEqual(matrix(data).rows.map(row => row.book), ['fd', 'dk']);
  const best = matrix(data, { book: 'best' });
  assert.deepEqual(best.rows.map(row => row.book), ['best']);
  assert.equal(entry(data, 'best', 'pn;1', { book: 'best' }).row.best_hit.book, 'px');
  assert.equal(entry(data, 'best', 'pn;1', { book: 'best' }).row.best_hit.odds, 1500);
  assert.equal(JSON.stringify(data), before);
});
