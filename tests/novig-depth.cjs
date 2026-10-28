'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const depth = require('../novig-depth.js');

const NOW = Date.parse('2026-10-27T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const order = (probability, contracts) => ({probability, contracts, odds: 'untrusted', stake_usd: '9999999', opposite_odds: 'bad', opposite_stake_usd: '9999999'});
function fixture() {
  const row = {player: 'test scorer', prop: 'atgs', handicap: '0.5', under: false, game: 'tor @ bos', dt: '2026-10-27', bookOdds: {fd: '400/-500', dk: '350/-400', nv: '9999/-101', kal: '9998/-102', px: '9997/-103', poly: '9996/-104', matchbook: '9995/-105'}, links: {fd: 'https://sportsbook.example/goal', dk: 'javascript:alert(1)'}};
  const entry = {schema_version: 1, market_id: 'test-market', event_id: 'test-event', updated: stamp(-60000), expires_at: stamp(240000), starts_at: '2026-10-27T23:00:00Z', sides: [
    {side: 'over', label: 'To score', outcome_id: 'over-id', orders: [order('0.3', 50000), order('0.25', 20000), order('0.1', 90000)], truncated: false},
    {side: 'under', label: 'Not to score', outcome_id: 'under-id', orders: [order('0.85', 20000)], truncated: false}
  ]};
  const updated = Object.fromEntries(Object.keys(row.bookOdds).map(book => [book, stamp(-120000)]));
  const payload = {data: [row], updated, times: {[row.game]: entry.starts_at}, novigDepth: {[row.game]: {[row.player]: entry}}};
  return {row, entry, payload};
}

test('maker/taker cent-contract units are derived from raw probability, not display fields', () => {
  const [got] = depth.normalizeOrders([order('0.25', 20000)]);
  assert.equal(got.probability, '0.25');
  assert.equal(got.stake_usd, 50);
  assert.equal(got.opposite_stake_usd, 150);
  assert.equal(got.payout_usd, 200);
  assert.equal(got.odds, 300);
  assert.equal(got.opposite_odds, -300);
});

test('hover preview shows only the three best executable levels and totals only those stakes', () => {
  const {row, entry, payload} = fixture();
  entry.sides[1].orders = [order('0.85', 20000), order('0.8', 50000), order('0.75', 40000), order('0.7', 100000)];
  row.player = '<img src=x onerror=alert(1)>';
  payload.novigDepth[row.game] = {[row.player]: entry};
  const html = depth.renderPreview(depth.inspect(row, payload, {now: NOW}), row);
  const yes = html.split('data-preview-side="over"')[1].split('</section>')[0];
  assert.equal((yes.match(/class="nv-depth-preview-level"/g) || []).length, 3);
  assert.match(yes, />\+567<.*>\+400<.*>\+300</s);
  assert.doesNotMatch(yes, />\+233</);
  assert.match(yes, /Shown <strong>\$230<\/strong>/);
  assert.match(html, /Top 3 prices per side/);
  assert.match(html, /Before fees/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('hover preview keeps an empty side empty and omits unavailable data', () => {
  const {row, entry, payload} = fixture();
  entry.sides[1].orders = [];
  const html = depth.renderPreview(depth.inspect(row, payload, {now: NOW}), row);
  const yes = html.split('data-preview-side="over"')[1].split('</section>')[0];
  assert.match(yes, /No liquidity/);
  assert.doesNotMatch(yes, /nv-depth-preview-level|Shown/);
  assert.equal(depth.renderPreview({available: false}, row), '');
});

test('fresh same-side conventional best price; maker probability weighted by contracts', () => {
  const {row, payload} = fixture();
  const got = depth.inspect(row, payload, {now: NOW});
  assert.equal(got.available, true);
  assert.equal(got.quote.book, 'fd');
  assert.equal(got.quote.odds, 400);
  assert.equal(got.comparison.matching.length, 2);
  assert.equal(got.comparison.makerStake, 200);
  assert.equal(got.comparison.oppositeStake, 500);
  assert.equal(got.comparison.contracts, 70000);
  assert.ok(Math.abs(got.comparison.weightedProbability - 2 / 7) < 1e-15);
  assert.equal(got.comparison.substantial, true);
});

test('under defaults to under pair and an explicit toggle changes both quotes and depth', () => {
  const {row, payload} = fixture();
  row.under = true;
  let got = depth.inspect(row, payload, {now: NOW});
  assert.equal(got.side, 'under');
  assert.equal(got.quote.book, 'dk');
  assert.equal(got.quote.odds, -400);
  assert.equal(got.orders[0].probability, '0.85');
  got = depth.inspect(row, payload, {now: NOW, side: 'over'});
  assert.equal(got.quote.book, 'fd');
  assert.equal(got.orders[0].probability, '0.3');
});

test('strict probability comparison does not use rounded American prices or Number equality', () => {
  const orders = depth.normalizeOrders([order('0.20000000000000000001', 20000), order('0.2', 20000), order('0.19999999999999999999', 20000)]);
  const got = depth.compareOrders(orders, {odds: 400});
  assert.equal(got.matching.length, 1);
  assert.equal(got.matching[0].probability, '0.20000000000000000001');
  assert.equal(got.substantial, false);
  assert.equal(depth.compareOrders(orders, {odds: 400}, 10).substantial, true);
});

test('exact threshold and neutral small stakes', () => {
  const small = depth.compareOrders(depth.normalizeOrders([order('.25', 40000)]), {odds: 400});
  assert.equal(small.matching.length, 0, 'probability wire format requires a leading zero');
  const boundary = depth.compareOrders(depth.normalizeOrders([order('0.25', 40000)]), {odds: 400});
  assert.equal(boundary.makerStake, 100);
  assert.equal(boundary.substantial, true);
  assert.equal(depth.compareOrders(depth.normalizeOrders([order('0.25', 39999)]), {odds: 400}).substantial, false);
});

test('stale, naive, future, missing and exchange book timestamps cannot create a comparison', () => {
  const {row, payload} = fixture();
  for (const bad of [stamp(-depth.MAX_AGE_MS - 1), stamp(1), '2026-10-27T17:59:00', null, undefined, 'not-a-date']) {
    payload.updated.fd = bad;
    payload.updated.dk = bad;
    const got = depth.inspect(row, payload, {now: NOW});
    assert.equal(got.available, true);
    assert.equal(got.quote, null);
    assert.equal(got.comparison.matching.length, 0);
  }
});

test('missing under prices never reuse the over quote and hidden Circa is excluded', () => {
  const {row, payload} = fixture();
  row.under = true;
  row.bookOdds = {fd: '500', dk: '', circa: '600/-120'};
  row.circa_blurred = true;
  payload.updated.circa = stamp(-10000);
  assert.equal(depth.inspect(row, payload, {now: NOW}).quote, null);
  row.circa_blurred = false;
  assert.equal(depth.inspect(row, payload, {now: NOW}).quote.odds, -120);
});

test('blurred, different market/line/date and absent rows cannot expose depth', () => {
  const {row, payload} = fixture();
  for (const change of [{blurred: true}, {prop: 'fgs'}, {handicap: '1.5'}, {handicap: null}, {game: 'other game'}, {player: 'other player'}, {dt: '2026-10-28'}, {dt: ''}, {date: '2026-10-28'}]) {
    assert.equal(depth.inspect({...row, ...change}, payload, {now: NOW}).available, false, JSON.stringify(change));
  }
  assert.equal(depth.inspect(null, payload, {now: NOW}).available, false);
});

test('Eastern date and bounded start discrepancy protect overnight slate identity', () => {
  const {row, entry, payload} = fixture();
  entry.starts_at = '2026-10-28T02:30:00Z';
  payload.times[row.game] = '2026-10-28T02:40:00Z';
  assert.equal(depth.inspect(row, payload, {now: NOW}).available, true);
  payload.times[row.game] = '2026-10-28T03:00:01Z';
  assert.equal(depth.inspect(row, payload, {now: NOW}).available, false);
});

test('depth expiration, future observations, stale observations and started games remove all comparisons', () => {
  for (const change of [{expires_at: stamp(0)}, {updated: stamp(1)}, {updated: stamp(-depth.MAX_AGE_MS - 1)}, {updated: '2026-10-27T17:59:00'}, {starts_at: stamp(0)}, {expires_at: '2026-10-28T23:00:00Z'}, {schema_version: 2}]) {
    const {row, entry, payload} = fixture();
    Object.assign(entry, change);
    const got = depth.inspect(row, payload, {now: NOW});
    assert.equal(got.available, false, JSON.stringify(change));
    assert.equal(got.comparison, undefined);
  }
});

test('empty side can toggle to populated side; fully empty/malformed books are unavailable', () => {
  const {row, entry, payload} = fixture();
  entry.sides[0].orders = [];
  assert.equal(depth.inspect(row, payload, {now: NOW}).available, true);
  assert.deepEqual(depth.inspect(row, payload, {now: NOW}).orders, []);
  entry.sides[1].orders = [];
  assert.equal(depth.inspect(row, payload, {now: NOW}).available, false);
  entry.sides = [entry.sides[0], entry.sides[0]];
  assert.equal(depth.inspect(row, payload, {now: NOW}).available, false);
});

test('invalid probabilities and contract quantities cannot invent liquidity', () => {
  for (const probability of [true, null, '', 'NaN', 'Infinity', '1', '0', '-0.1', '1.1', '<img>']) assert.deepEqual(depth.normalizeOrders([order(probability, 100)]), []);
  for (const contracts of [true, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, 'bad']) assert.deepEqual(depth.normalizeOrders([order('0.5', contracts)]), []);
  assert.deepEqual(depth.normalizeOrders(Array(21).fill(order('0.5', 100))), []);
});

test('only explicit safe HTTP(S) links are accepted; no script/data/credential links', () => {
  assert.equal(depth.safeLink('https://sportsbook.example/selection?x=1&y=2'), 'https://sportsbook.example/selection?x=1&y=2');
  for (const link of ['javascript:alert(1)', 'data:text/html,<script>', '//evil.example', 'https://name:secret@example.com', 'https://example.com\n', {}, null]) assert.equal(depth.safeLink(link), '');
});

test('shared saved Goal URLs must never be presented as No-goal selections', () => {
  const quote = {link: 'https://sportsbook.example/goal-selection'};
  assert.equal(depth.quoteLink(quote, 'over'), quote.link);
  assert.equal(depth.quoteLink(quote, 'under'), '');
  assert.equal(depth.quoteLink(quote), '');
  assert.equal(depth.quoteLink({link: 'javascript:alert(1)'}, 'over'), '');
});

test('ATGS integration preserves the Novig formatter and loads the scoped assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../atgs.html'), 'utf8');
  assert.match(html, /href="novig-depth\.css"/);
  assert.match(html, /src="novig-depth\.js"/);
  assert.equal((html.match(/NovigDepth\.formatter\(evOddsFormatter\)/g) || []).length, 1);
  const line = html.split('\n').find(line => line.includes('NovigDepth.formatter(evOddsFormatter)'));
  assert.match(line, /bookOdds_nv/);
  assert.match(html, /bookOdds_fd[^\n]*formatter: evOddsFormatter/);
});

function screenshotFixture() {
  const result = fixture();
  result.entry.sides[0].orders = [order('0.075', 1407)];
  result.entry.sides[1].orders = [order('0.92', 9630), order('0.915', 98074), order('0.91', 100000)];
  return result;
}

test('Available Yes uses opposite resting bids, exact screenshot complements and available stakes', () => {
  const {row, payload} = screenshotFixture();
  const got = depth.inspect(row, payload, {now: NOW, side: 'over'});
  assert.deepEqual(got.takingOrders.map(level => level.probability), ['0.08', '0.085', '0.09']);
  assert.deepEqual(got.takingOrders.map(level => level.odds), [1150, 1076, 1011]);
  assert.deepEqual(got.takingOrders.map(level => depth.wholeStake([level])), ['$7', '$83', '$90']);
  assert.ok(Math.abs(got.takingOrders[0].stake_usd - 7.704) < 1e-12);
  assert.ok(Math.abs(got.takingOrders[1].stake_usd - 83.3629) < 1e-12);
  assert.equal(got.orders[0].probability, '0.075', 'resting Yes remains a separate book');
  assert.equal(got.quote.odds, 400, 'comparison sportsbook quote uses the selected Yes outcome');
});

test('Available No comes from independent Yes bids, not a sign flip of the Available Yes ladder', () => {
  const {row, payload} = screenshotFixture();
  row.under = true;
  const got = depth.inspect(row, payload, {now: NOW});
  assert.equal(got.side, 'under');
  assert.equal(got.quote.odds, -400);
  assert.equal(got.takingOrders.length, 1);
  assert.equal(got.takingOrders[0].probability, '0.925');
  assert.equal(got.takingOrders[0].odds, -1233);
  assert.equal(depth.wholeStake(got.takingOrders), '$13');
  assert.ok(Math.abs(got.takingOrders[0].stake_usd - 13.01475) < 1e-12);
  assert.equal(depth.wholeStake([got.orders[0]]), '$88');
  assert.equal(depth.wholeStake([got.orders[0]], true), '$7');
});

test('whole-dollar display floors exact decimal amounts and sums; calculation amounts remain unchanged', () => {
  const orders = depth.normalizeOrders([order('0.58', 10000), order('0.29', 10000)]);
  assert.equal(depth.wholeStake([orders[0]]), '$58');
  assert.equal(depth.wholeStake([orders[1]]), '$29');
  assert.equal(depth.wholeStake(orders), '$87');
  assert.equal(depth.wholeStake(depth.normalizeOrders([order('0.91', 100000)]), true), '$90');
  assert.equal(depth.wholeStake(depth.normalizeOrders([order('0.1', 1)])), '<$1');
  assert.equal(depth.wholeStake([]), '$0');
  const partials = depth.normalizeOrders([order('0.58', 100), order('0.58', 100)]);
  assert.equal(depth.wholeStake(partials), '$1', 'sum full-precision stakes before truncating');
  const threshold = depth.compareOrders(depth.normalizeOrders([order('0.29', 10000)]), {odds: 400}, 29);
  assert.equal(threshold.substantial, true, 'a binary-float $28.999... must not miss an exact $29 threshold');
});

test('American price rounding uses exact magnitude at half points and displays even money as +100', () => {
  assert.equal(depth.americanFromProbability('0.68'), -213);
  assert.equal(depth.americanFromProbability('0.32'), 213);
  assert.equal(depth.americanFromProbability('0.5'), 100);
  assert.equal(depth.americanFromProbability('0.50001'), 100);
  assert.equal(depth.complementProbability('0.915'), '0.085');
  assert.equal(depth.complementProbability('0.075'), '0.925');
  assert.equal(depth.complementProbability('0.5'), '0.5');
});

function bookMarkup(html, side) {
  const marker = `data-book-side="${side}"`;
  assert.ok(html.includes(marker), `missing ${side} book`);
  return html.slice(html.indexOf(marker) + marker.length).split(/data-book-side="(?:over|under)"/)[0];
}

test('available rendering shows both executable books and never applies maker highlights', () => {
  const {row, payload} = screenshotFixture();
  const got = depth.inspect(row, payload, {now: NOW, side: 'under'});
  assert.ok(got.comparison.matching.length, 'fixture has maker comparisons which must stay out of the available view');
  const html = depth.renderResult(got);
  assert.match(html, /class="nv-depth-books"/);
  const yes = bookMarkup(html, 'over'), no = bookMarkup(html, 'under');
  assert.match(yes, /\+1150/);
  assert.match(yes, /\$7/);
  assert.match(no, /-1233/);
  assert.match(no, /\$13/);
  assert.match(yes, /nv-depth-chart-row/);
  assert.match(no, /nv-depth-chart-row/);
  assert.match(yes, /<b>Yes \+1047<\/b>/, 'average uses all displayed contract quantities');
  assert.match(no, /<b>No -1233<\/b>/);
  assert.doesNotMatch(html, /nv-depth-matching|nv-depth-comparison|Better price than resting orders|Matching maker stake/);
  assert.match(yes, /<a /, 'Yes retains the saved Goal selection link');
  assert.doesNotMatch(no, /<a /, 'No uses no saved Goal URL');
  assert.match(html, /rounded down; calculations use full precision/);
});

test('Resting interest retains maker comparison and opposing taker distinction', () => {
  const {row, payload} = screenshotFixture();
  const got = depth.inspect(row, payload, {now: NOW, side: 'under'});
  const html = depth.renderResult(got, 'resting');
  assert.match(html, /Better price than resting orders/);
  assert.match(html, /Maker wants/);
  assert.match(html, /-1150/);
  assert.match(html, /\$88/);
  assert.match(html, /\+1150/);
  assert.match(html, /\$7/);
  assert.match(html, /Taking them backs <strong>Goal<\/strong>/);
  assert.doesNotMatch(html, /nv-depth-books|nv-depth-chart-row/);
});

test('an empty available side stays empty even when same-side maker interest exists', () => {
  const {row, entry, payload} = screenshotFixture();
  entry.sides[1].orders = [];
  const got = depth.inspect(row, payload, {now: NOW, side: 'over'});
  assert.equal(got.available, true);
  assert.equal(got.orders.length, 1);
  assert.deepEqual(got.takingOrders, []);
  const html = depth.renderResult(got);
  const yes = bookMarkup(html, 'over'), no = bookMarkup(html, 'under');
  assert.match(yes, /No Yes liquidity(?: is)? available/);
  assert.doesNotMatch(yes, /nv-depth-chart-row/);
  assert.doesNotMatch(yes, /nv-depth-book-average/, 'an empty book has no average price');
  assert.match(no, /-1233/);
  assert.match(no, /\$13/);
});

test('both books use independent quotes and liquidity on one shared bar scale', () => {
  const {row, payload} = screenshotFixture();
  const got = depth.inspect(row, payload, {now: NOW, side: 'under'});
  assert.deepEqual(got.availableBooks.map(book => book.side), ['over', 'under']);
  const [yes, no] = got.availableBooks;
  assert.equal(yes.quote.odds, 400);
  assert.equal(yes.quote.book, 'fd');
  assert.equal(no.quote.odds, -400);
  assert.equal(no.quote.book, 'dk');
  assert.deepEqual(yes.orders.map(level => level.odds), [1150, 1076, 1011]);
  assert.deepEqual(no.orders.map(level => level.odds), [-1233]);
  const html = depth.renderResult(got);
  const widths = side => [...bookMarkup(html, side).matchAll(/--depth-width:\s*([\d.]+)%/g)].map(match => Number(match[1]));
  assert.equal(widths('over').length, 3);
  assert.equal(widths('under').length, 1);
  yes.orders.forEach((level, index) => assert.ok(Math.abs(widths('over')[index] - level.stake_usd / 90 * 100) < .001));
  assert.ok(Math.abs(widths('under')[0] - no.orders[0].stake_usd / 90 * 100) < .001,
    'No scales against the $90 maximum across both books, not its own $13 maximum');
});
