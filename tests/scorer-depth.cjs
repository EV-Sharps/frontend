'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NOW = Date.parse('2026-10-28T18:00:00Z');
const stamp = delta => new Date(NOW + delta).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));

function harness() {
  const requests = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  const context = vm.createContext({Date: Clock, URL, AbortController, setTimeout, clearTimeout,
    ACCESS_TOKEN: 'fixture-token', API_BASE: 'https://api.example',
    fetch(url, options) { return new Promise(resolve => requests.push({url: new URL(url), options, resolve})); }});
  for (const file of ['novig-depth.js', 'prediction-depth.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return {context, requests, depth: context.NovigDepth, aggregate: context.PredictionDepth,
    respond(index, result) { requests[index].resolve({ok: true, json: async () => clone(result)}); }};
}

function fixture(sport, prop, game = 'tor @ bos') {
  const row = {sport, prop, game, player: 'same player', handicap: '0.5', dt: '2026-10-28',
    bookOdds: {nv: '400/-500', kal: '400/-500', px: '400/-500'}};
  const entry = {schema_version: 1, market_id: `${sport}-market`, updated: stamp(-60000),
    expires_at: stamp(240000), starts_at: stamp(18000000), sides: [
      {side: 'over', orders: [{probability: '0.2', contracts: 10000}], truncated: false},
      {side: 'under', orders: [{probability: '0.9', contracts: 10000}], truncated: false},
    ]};
  const payload = {data: [row], times: {[game]: entry.starts_at}, updated: {}, depthAvailable: {
    [game]: {[row.player]: {nv: {updated: entry.updated, expires_at: entry.expires_at}}}}};
  const result = {schemaVersion: 1, sport, book: 'nv', game, player: row.player, start: entry.starts_at, entry};
  return {row, payload, result};
}

for (const [sport, prop, endpoint, yes, no] of [
  ['nhl', 'atgs', '/api/atgs-depth', 'Goal', 'No goal'],
  ['mlb', 'hr', '/api/homers-depth', 'Home run', 'No home run'],
  ['nfl', 'attd', '/api/attd-depth', 'Touchdown', 'No touchdown'],
]) {
  test(`${sport} lazy depth uses the matching endpoint and labels, without inflating the live feed`, async () => {
    const h = harness(), f = fixture(sport, prop), before = JSON.stringify(f.payload);
    assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
    assert.equal(h.requests.length, 0);
    const pending = h.depth.load(f.row, f.payload);
    await Promise.resolve();
    assert.equal(h.requests[0].url.pathname, endpoint);
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer fixture-token');
    h.respond(0, f.result);
    const loaded = await pending;
    assert.equal(loaded.available, true);
    assert.equal(loaded.market.yes, yes);
    assert.equal(loaded.market.no, no);
    const html = h.depth.renderResult(loaded, 'available');
    assert.ok(html.includes(yes) && html.includes(no));
    const aggregate = h.aggregate.collect(f.row, f.payload.data, f.payload);
    assert.equal(aggregate.sources.find(source => source.book === 'nv').kind, 'depth');
    assert.equal(aggregate.sides.over.totalStake, 10);
    assert.equal(JSON.stringify(f.payload), before);
    assert.equal((await h.depth.load({...f.row, under: true}, f.payload)).side, 'under');
    assert.equal(h.requests.length, 1);
  });

  test(`${sport} alternate, first-scorer, wrong-sport and blurred rows cannot request full depth`, async () => {
    for (const change of [{handicap: 1.5}, {prop: sport === 'nfl' ? 'ftd' : sport === 'mlb' ? 'h' : 'fgs'},
      {sport: 'nba'}, {prop: 'constructor'}, {prop: '__proto__'}, {blurred: true}, {dt: '2026-10-29'}]) {
      const h = harness(), f = fixture(sport, prop);
      Object.assign(f.row, change);
      const got = await h.depth.load(f.row, f.payload, {discover: true});
      assert.equal(got.available, false);
      assert.equal(h.requests.length, 0);
    }
  });

  test(`${sport} wrong-sport responses cannot enter the cache`, async () => {
    const h = harness(), f = fixture(sport, prop);
    const pending = h.depth.load(f.row, f.payload);
    await Promise.resolve();
    h.respond(0, {...f.result, sport: 'nba'});
    assert.equal((await pending).available, false);
    assert.equal(h.depth.inspect(f.row, f.payload).status, 'error');
  });
}

test('identical player/game/start identities cannot share caches between sports or MLB doubleheaders', async () => {
  const h = harness();
  for (const [sport, prop, game] of [['nhl', 'atgs', 'tor @ bos'], ['mlb', 'hr', 'tor @ bos'],
    ['nfl', 'attd', 'tor @ bos'], ['mlb', 'hr', 'tor-gm2 @ bos-gm2']]) {
    const f = fixture(sport, prop, game);
    assert.equal(h.depth.inspect(f.row, f.payload).status, 'idle');
    const pending = h.depth.load(f.row, f.payload);
    await Promise.resolve();
    const index = h.requests.length - 1;
    assert.equal(h.requests[index].url.searchParams.get('game'), game);
    h.respond(index, f.result);
    assert.equal((await pending).entry.market_id, `${sport}-market`);
  }
  assert.equal(h.requests.length, 4);
});
