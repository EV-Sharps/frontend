'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const depth = require('../novig-depth.js');
const prediction = require('../prediction-depth.js');

const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const options = {book: 'kal'};
const order = (probability, contracts) => ({probability, contracts, stake_usd: '9999999', payout_usd: '9999999', odds: 'untrusted'});
function fixture() {
  const row = {player: 'test scorer', game: 'tor @ bos', prop: 'atgs', handicap: '0.5', dt: '2026-10-28', bookOdds: {fd: '400/-500', kal: '900/-1100'}, liquidity: {kal: [9000, 8000]}, links: {fd: 'https://sportsbook.example/goal'}};
  const entry = {schema_version: 1, market_id: 'KXNHLGOAL-26OCT28TORBOS-SCORER', ticker: 'KXNHLGOAL-26OCT28TORBOS-SCORER', event_id: 'KXNHLGOAL-26OCT28TORBOS', updated: stamp(-60000), expires_at: stamp(240000), starts_at: '2026-10-28T23:00:00Z', sides: [
    {side: 'over', outcome_id: 'market:yes', orders: [order('0.075', '14.07')], truncated: false},
    {side: 'under', outcome_id: 'market:no', orders: [order('0.92', '96.30'), order('0.915', '980.74'), order('0.91', '1000')], truncated: true}
  ]};
  const payload = {data: [row, {...row, under: true}], updated: {fd: stamp(-60000), kal: stamp(-60000)}, times: {[row.game]: entry.starts_at}, kalshiDepth: {[row.game]: {[row.player]: entry}}};
  return {row, entry, payload};
}
const inspect = f => depth.inspect(f.row, f.payload, {...options, now: NOW});
const merged = f => prediction.collect(f.row, f.payload.data, f.payload, {now: NOW, novigDepth: depth});

test('Kalshi dollar contracts retain fractional quantities and derive amounts from raw bids', () => {
  const [got] = depth.normalizeOrders([order('0.25', '200.50')], options);
  assert.equal(got.contracts, '200.50');
  assert.equal(got.payout_usd, 200.5);
  assert.equal(got.stake_usd, 50.125);
  assert.equal(got.opposite_stake_usd, 150.375);
  assert.equal(got.odds, 300);
  assert.equal(got.opposite_odds, -300);
  assert.equal(depth.wholeStake([got]), '$50');
  assert.equal(depth.wholeStake([got], true), '$150');
  assert.equal(depth.normalizeOrders([order('0.25', 20000)])[0].stake_usd, 50, 'Novig default retains cent contracts');
});

test('fractional Kalshi sums and comparison thresholds use exact decimal amounts', () => {
  const orders = depth.normalizeOrders([order('0.29', '100.00000000000000000001')], options);
  assert.equal(orders[0].contracts, '100.00000000000000000001');
  assert.equal(depth.wholeStake(orders), '$29');
  assert.equal(depth.compareOrders(orders, {odds: 400}, '29.000000000000000000001').substantial, true);
  assert.equal(depth.compareOrders(orders, {odds: 400}, '29.00000000000000000001').substantial, false);
  assert.equal(depth.wholeStake(depth.normalizeOrders([order('0.58', '1.25'), order('0.22', '1.25')], options)), '$1');
});

test('Kalshi accepts up to 100 levels and rejects invalid fractional quantities', () => {
  assert.equal(depth.normalizeOrders(Array(100).fill(order('0.5', '0.01')), options).length, 100);
  assert.deepEqual(depth.normalizeOrders(Array(101).fill(order('0.5', '0.01')), options), []);
  for (const contracts of [true, null, '', 0, '-0.1', '1e3', 'NaN', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(depth.normalizeOrders([order('0.5', contracts)], options), [], String(contracts));
  }
});

test('available Kalshi books complement the opposite bids with exact $1 payouts', () => {
  const f = fixture(), result = inspect(f);
  assert.equal(result.available, true);
  assert.equal(result.provider.name, 'Kalshi');
  assert.deepEqual(result.availableBooks[0].orders.map(level => level.probability), ['0.08', '0.085', '0.09']);
  assert.deepEqual(result.availableBooks[0].orders.map(level => level.odds), [1150, 1076, 1011]);
  assert.deepEqual(result.availableBooks[0].orders.map(level => depth.wholeStake([level])), ['$7', '$83', '$90']);
  assert.equal(result.availableBooks[1].orders[0].probability, '0.925');
  assert.equal(depth.wholeStake(result.availableBooks[1].orders), '$13');
  const markup = depth.renderResult(result);
  assert.match(markup, /Top 100 price levels shown/);
  assert.match(markup, /Yes \+1047/);
  assert.doesNotMatch(markup, /Novig|Top 20/);
  assert.match(depth.renderResult({...result, truncated: true}, 'resting'), /top 100 price levels/);
});

test('Kalshi freshness independently expires at five minutes and never uses the Novig entry', () => {
  for (const changes of [{updated: stamp(-300001), expires_at: stamp(1)}, {expires_at: stamp(0)}, {updated: stamp(1)}, {starts_at: stamp(0)}, {schema_version: 2}]) {
    const f = fixture();
    Object.assign(f.entry, changes);
    assert.equal(inspect(f).available, false, JSON.stringify(changes));
  }
  const f = fixture();
  f.payload.novigDepth = f.payload.kalshiDepth;
  delete f.payload.kalshiDepth;
  assert.match(inspect(f).reason, /Kalshi/);
  assert.equal(inspect(f).available, false);
  assert.equal(depth.inspect(f.row, f.payload, {now: NOW}).available, false, 'fractional dollar quantities are invalid Novig contracts');
});

test('current Kalshi depth works without the top quote and accepts the .5 line spelling', () => {
  const f = fixture();
  delete f.row.bookOdds.kal;
  f.row.handicap = '.5';
  f.payload.updated.kal = stamp(-3600000);
  assert.equal(inspect(f).available, true);
  assert.equal(merged(f).sides.over.levels.filter(level => level.book === 'kal').length, 3);
  assert.equal(depth.inspect({...f.row, blurred: true}, f.payload, {...options, now: NOW}).available, false);
  assert.equal(depth.inspect({...f.row, dt: '2026-10-29'}, f.payload, {...options, now: NOW}).available, false);
});

test('merged Kalshi full depth replaces duplicate top quotes and reports its level limit', () => {
  const f = fixture(), before = JSON.stringify(f), result = merged(f);
  const levels = result.sides.over.levels.filter(level => level.book === 'kal');
  assert.deepEqual(levels.map(level => level.odds), [1150, 1076, 1011]);
  assert.ok(Math.abs(levels[0].stake - 7.704) < 1e-12);
  assert.equal(result.sides.under.levels.filter(level => level.book === 'kal').length, 1);
  assert.equal(result.sources.find(source => source.book === 'kal').kind, 'depth');
  assert.match(prediction.renderSide(result, 'over'), /Kalshi: top 100 levels/);
  assert.match(prediction.renderSide(result, 'under'), /Kalshi: available depth/);
  assert.doesNotMatch(prediction.renderSide(result, 'under'), /top 100 levels/);
  assert.equal(JSON.stringify(f), before);
});

test('empty, expired or invalid explicit Kalshi depth never revives the saved quote', () => {
  for (const changes of [{expires_at: stamp(0)}, {schema_version: 2}, {updated: stamp(-300001)}]) {
    const f = fixture();
    Object.assign(f.entry, changes);
    assert.equal(merged(f).sides.over.levels.some(level => level.book === 'kal'), false);
    assert.equal(merged(f).sources.find(source => source.book === 'kal').kind, 'unavailable');
  }
  const f = fixture();
  f.entry.sides[1].orders = [];
  assert.equal(merged(f).sides.over.levels.some(level => level.book === 'kal'), false);
  assert.equal(merged(f).sides.under.levels.some(level => level.book === 'kal'), true);
  f.payload.kalshiDepth[f.row.game][f.row.player] = null;
  assert.equal(merged(f).sides.over.levels.some(level => level.book === 'kal'), false);
});

test('Kalshi ATGS ladders never replace an alternate line quote', () => {
  const f = fixture();
  f.row.handicap = '1.5';
  assert.equal(inspect(f).available, false);
  assert.deepEqual(merged(f).sides.over.levels.map(level => [level.book, level.odds, level.kind]), [['kal', 900, 'top']]);
});

test('ATGS Kalshi column uses the shared orderbook formatter and retains Novig integration', () => {
  const html = fs.readFileSync(path.join(__dirname, '../atgs.html'), 'utf8');
  assert.match(html, /bookOdds_kal[^\n]*NovigDepth\.formatter\(evOddsFormatter, \{book: 'kal'\}\)/);
  assert.match(html, /bookOdds_nv[^\n]*NovigDepth\.formatter\(evOddsFormatter\)/);
});
