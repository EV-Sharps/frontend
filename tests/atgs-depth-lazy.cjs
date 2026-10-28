'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = offset => new Date(NOW + offset).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(player = 'test scorer') {
  const row = {player, game: 'tor @ bos', prop: 'atgs', handicap: '0.5', dt: '2026-10-28', bookOdds: {nv: '300/-400', kal: '300/-400'}, liquidity: {nv: [30, 40]}};
  const entry = {schema_version: 1, market_id: 'fixture-market', event_id: 'event-id', updated: stamp(-60000), expires_at: stamp(240000), starts_at: stamp(18000000), sides: [
    {side: 'over', orders: [{probability: '0.25', contracts: 20000}], truncated: false},
    {side: 'under', orders: [{probability: '0.85', contracts: 10000}], truncated: false}
  ]};
  const payload = {data: [row], updated: {nv: stamp(-60000), kal: stamp(-60000)}, times: {[row.game]: entry.starts_at},
    depthAvailable: {[row.game]: {[player]: {nv: {updated: entry.updated, expires_at: entry.expires_at}}}}};
  const result = {schemaVersion: 1, book: 'nv', game: row.game, player, start: entry.starts_at, entry};
  return {row, entry, payload, result};
}
function harness() {
  let now = NOW;
  const requests = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({Date: Clock, URL, AbortController, setTimeout, clearTimeout, ACCESS_TOKEN: 'fixture-token', API_BASE: 'https://api.example/prefix/',
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({url: new URL(url), options, resolve, reject})); }});
  for (const file of ['novig-depth.js', 'prediction-depth.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const respond = (index, result, status = 200) => requests[index].resolve({ok: status >= 200 && status < 300, status, json: async () => clone(result)});
  return {context, depth: context.NovigDepth, aggregate: context.PredictionDepth, requests, respond, tick: delta => { now = NOW + delta; }};
}
const flush = () => Promise.resolve();

test('pure inspection and aggregate rendering never fetch; unloaded depth never masquerades as top quote', () => {
  const h = harness(), f = fixture();
  for (let n = 0; n < 5; n++) {
    assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
    const got = h.aggregate.collect(f.row, f.payload.data, f.payload);
    assert.equal(got.sources.find(source => source.book === 'nv').kind, 'pending');
    assert.ok(!got.sides.over.levels.some(level => level.book === 'nv'));
    assert.match(h.aggregate.renderSide(got, 'over'), /has not been loaded/);
  }
  assert.equal(h.requests.length, 0);
});

test('hover, focus and click share one selected-book request and reuse cache across side rows', async () => {
  const h = harness(), f = fixture(), before = JSON.stringify(f.payload);
  f.payload.depthAvailable[f.row.game][f.row.player].kal = clone(f.payload.depthAvailable[f.row.game][f.row.player].nv);
  const snapshot = JSON.stringify(f.payload);
  const a = h.depth.load(f.row, f.payload), b = h.depth.load({...f.row, under: true}, f.payload, {retry: true});
  assert.equal(a, b);
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'loading');
  await flush();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url.origin, 'https://api.example');
  assert.equal(request.url.pathname, '/api/atgs-depth');
  assert.equal(request.url.searchParams.get('book'), 'nv');
  assert.equal(request.url.searchParams.get('game'), f.row.game);
  assert.equal(request.url.searchParams.get('player'), f.row.player);
  assert.equal(request.url.searchParams.get('start'), f.entry.starts_at);
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-token');
  h.respond(0, f.result);
  assert.equal((await a).available, true);
  assert.equal((await h.depth.load({...f.row, under: true}, f.payload)).side, 'under');
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.stringify(f.payload), snapshot);
  assert.notEqual(before, snapshot);
  assert.equal(Object.isFrozen(h.depth.inspect(f.row, f.payload).entry.sides[0].orders), true);
});

test('new manifest generation and different game start cannot reuse old depth', async () => {
  const h = harness(), f = fixture();
  let pending = h.depth.load(f.row, f.payload); await flush(); h.respond(0, f.result); await pending;
  f.payload.depthAvailable[f.row.game][f.row.player].nv.updated = stamp(-30000);
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
  const newer = clone(f.result); newer.entry.updated = stamp(-30000);
  pending = h.depth.load(f.row, f.payload); await flush(); h.respond(1, newer); await pending;
  f.payload.times[f.row.game] = stamp(18060000);
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
  assert.equal(h.requests.length, 2);
});

test('newer entry is accepted but manifest expiration remains the limit', async () => {
  const h = harness(), f = fixture();
  f.result.entry.updated = stamp(-30000); f.result.entry.expires_at = stamp(300000);
  const pending = h.depth.load(f.row, f.payload); await flush(); h.respond(0, f.result); await pending;
  h.tick(239999); assert.equal(h.depth.inspect(f.row, f.payload).available, true);
  h.tick(240000); assert.equal(h.depth.inspect(f.row, f.payload).available, false);
  assert.equal((await h.depth.load(f.row, f.payload)).loadable, false);
  assert.equal(h.requests.length, 1);
});

test('authentication changes clear cache and discard an old response without poisoning new credentials', async () => {
  const h = harness(), f = fixture();
  const old = h.depth.load(f.row, f.payload); await flush();
  h.context.ACCESS_TOKEN = 'replacement-token';
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
  assert.equal(h.requests[0].options.signal.aborted, true);
  const current = h.depth.load(f.row, f.payload); await flush();
  h.respond(0, f.result); await old;
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'loading');
  h.respond(1, f.result); assert.equal((await current).available, true);
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer replacement-token');
  h.context.ACCESS_TOKEN = '';
  assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
});

test('network failures require explicit retry; errors do not disclose exception text', async () => {
  const h = harness(), f = fixture();
  let pending = h.depth.load(f.row, f.payload); await flush(); h.requests[0].reject(new Error('secret internal URL'));
  const failed = await pending;
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.reason, /secret/);
  await h.depth.load(f.row, f.payload); assert.equal(h.requests.length, 1);
  pending = h.depth.load(f.row, f.payload, {retry: true}); await flush(); h.respond(1, f.result);
  assert.equal((await pending).available, true);
});

for (const [name, edit] of [
  ['wrong book', r => { r.book = 'kal'; }], ['wrong player', r => { r.player = 'another scorer'; }],
  ['wrong game', r => { r.game = 'bos @ tor'; }], ['wrong start', r => { r.start = stamp(18060000); }],
  ['wrong schema', r => { r.schemaVersion = 2; }], ['older entry', r => { r.entry.updated = stamp(-120000); }],
  ['different event day', r => { r.entry.starts_at = stamp(86400000); }], ['expired entry', r => { r.entry.expires_at = stamp(0); }]
]) test(`reject ${name} response without caching`, async () => {
  const h = harness(), f = fixture(); edit(f.result);
  const pending = h.depth.load(f.row, f.payload); await flush(); h.respond(0, f.result);
  const got = await pending; assert.equal(got.available, false); assert.equal(got.status, 'error');
  assert.match(got.reason, /does not match/);
});

test('missing sidecar tells the user to refresh the table', async () => {
  const h = harness(), f = fixture();
  const pending = h.depth.load(f.row, f.payload); await flush(); h.respond(0, {}, 404);
  assert.match((await pending).reason, /no longer available.*Refresh the table/);
});

test('blurred, wrong-date, started and expired selections cannot initiate requests', async () => {
  for (const edit of [f => { f.row.blurred = true; }, f => { f.row.dt = '2026-10-29'; }, f => { f.row.date = '2026-10-29'; },
    f => { f.payload.times[f.row.game] = stamp(-1); }, f => { f.payload.depthAvailable[f.row.game][f.row.player].nv.expires_at = stamp(0); },
    f => { f.row.handicap = '1.5'; }, f => { delete f.payload.depthAvailable[f.row.game][f.row.player].nv; }]) {
    const h = harness(), f = fixture(); edit(f);
    assert.equal((await h.depth.load(f.row, f.payload)).available, false);
    assert.equal(h.requests.length, 0);
  }
});

test('legacy inline feeds and non-ATGS quotes stay synchronous and do not fetch', async () => {
  const h = harness(), f = fixture(); delete f.payload.depthAvailable;
  f.payload.novigDepth = {[f.row.game]: {[f.row.player]: f.entry}};
  assert.equal((await h.depth.load(f.row, f.payload)).available, true);
  assert.equal(h.aggregate.collect(f.row, f.payload.data, f.payload).sources.find(x => x.book === 'nv').kind, 'depth');
  f.row.prop = 'sog'; f.row.handicap = '2.5';
  assert.equal(h.aggregate.collect(f.row, f.payload.data, f.payload).sources.find(x => x.book === 'nv').kind, 'top');
  assert.equal(h.requests.length, 0);
});

test('an authoritative empty manifest prevents revival of legacy inline books', async () => {
  const h = harness(), f = fixture(); f.payload.depthAvailable = {};
  f.payload.novigDepth = {[f.row.game]: {[f.row.player]: f.entry}};
  assert.equal((await h.depth.load(f.row, f.payload)).available, false);
  const got = h.aggregate.collect(f.row, f.payload.data, f.payload);
  assert.equal(got.sources.find(x => x.book === 'nv').kind, 'unavailable');
  assert.ok(!got.sides.over.levels.some(x => x.book === 'nv'));
  assert.equal(h.requests.length, 0);
});

test('bounded cache evicts oldest entries without expanding feed rows', async () => {
  const h = harness(), first = fixture('scorer 0');
  for (let n = 0; n < 49; n++) {
    const f = n ? fixture(`scorer ${n}`) : first;
    const pending = h.depth.load(f.row, f.payload); await flush(); h.respond(n, f.result); await pending;
    assert.ok(!Object.hasOwn(f.row, 'novigDepth'));
  }
  assert.equal(h.depth.inspect(first.row, first.payload).status, 'idle');
  assert.equal(h.requests.length, 49);
});
