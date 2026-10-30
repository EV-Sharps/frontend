const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate, evaluate, american } = require('../parlay-generator.js');
const make = (id, prices, probabilities = { circa: .3, pn: .32 }, game = id, player = id) => ({ id, prices, probabilities, game, player });
const options = { books: ['fd', 'dk', 'b365'], referenceBooks: ['circa', 'pn'] };

test('All books compares whole-book totals and omits partial books', async () => {
  const legs = [make('a', { fd: 5, dk: 3, b365: 99 }), make('b', { fd: 4, dk: 2 })];
  const [result] = await generate({ ...options, legs, count: 2 });
  assert.deepEqual(result.prices.map(price => price.book), ['fd', 'dk']);
  assert.equal(result.best.decimal, 20);
  assert.equal(result.worst.decimal, 6);
  assert.equal(result.ev, 100 * (.3 * .3 * 20 - 1));
  assert.equal(result.gap, 100 * (20 / 6 - 1));
  assert.equal(result.fairOdds, american(1 / (.3 * .3)));
  assert.deepEqual(await generate({ ...options, legs, count: 2, requiredBooks: ['fd', 'dk', 'b365'] }), []);
});

test('The selected books must cover every leg even when another book offers a better price', async () => {
  const legs = [make('a', { fd: 10, dk: 2 }), make('b', { fd: 10, b365: 3 }),
    make('c', { fd: 5, dk: 4, b365: 999 }), make('d', { fd: 3, dk: 3, b365: 888 })];
  const results = await generate({ ...options, books: ['fd', 'dk'], requiredBooks: ['fd', 'dk'], legs, count: 2 });
  assert.ok(results.length);
  for (const result of results) {
    assert.ok(!result.ids.includes('b'));
    assert.equal(result.prices.length, 2);
    assert.ok(!result.prices.some(price => price.book === 'b365'));
  }
});

test('Fair references are complete products, never the best leg borrowed from each book', async () => {
  const legs = [make('a', { fd: 3, dk: 2 }, { circa: .2, pn: .5 }),
    make('b', { fd: 3, dk: 2 }, { circa: .5, pn: .2 })];
  const result = evaluate(legs, options);
  assert.equal(result.probability, .1);
  assert.equal(result.ev, -9.999999999999998);
  delete legs[0].probabilities.pn; delete legs[1].probabilities.circa;
  assert.equal(evaluate(legs, options), null);
  assert.deepEqual(await generate({ ...options, legs, count: 2 }), []);
});

test('Different-game, distinct-player rules apply to every alternative', async () => {
  const legs = [make('a', { fd: 10, dk: 2 }, undefined, 'game1', 'player1'),
    make('a-under', { fd: 20, dk: 2 }, undefined, 'game1', 'player1'),
    make('teammate', { fd: 30, dk: 2 }, undefined, 'game1', 'teammate'),
    make('b', { fd: 3, dk: 2 }, undefined, 'game2', 'player1'),
    make('c', { fd: 5, dk: 2 }, undefined, 'game3', 'player3')];
  const results = await generate({ ...options, legs, count: 2 });
  assert.ok(results.length);
  for (const result of results) {
    const selected = legs.filter(leg => result.ids.includes(leg.id));
    assert.equal(new Set(selected.map(leg => leg.player)).size, 2);
    assert.equal(new Set(selected.map(leg => leg.game)).size, 2);
  }
});

test('Gap and EV rankings differ; American odds near even money use decimal payout ratios', async () => {
  const legs = [make('gap', { fd: 4, dk: 1.1 }, { pn: .1 }),
    make('ev', { fd: 3, dk: 2.9 }, { pn: .6 }), make('base', { fd: 2, dk: 1.9 }, { pn: .6 })];
  const gaps = await generate({ ...options, legs, count: 2 });
  const evs = await generate({ ...options, legs, count: 2, rank: 'ev' });
  assert.ok(gaps[0].ids.includes('gap'));
  assert.ok(!evs[0].ids.includes('gap'));
  assert.ok(gaps[0].ev < 0);
  const boundary = evaluate([make('x', { fd: Math.sqrt(2.02), dk: Math.sqrt(1.98) }), make('y', { fd: Math.sqrt(2.02), dk: Math.sqrt(1.98) })], options);
  assert.ok(boundary.best.odds > 0 && boundary.worst.odds < 0);
  assert.ok(Math.abs(boundary.gap - 100 * (2.02 / 1.98 - 1)) < 1e-10);
});

test('2-8 legs, empty coverage, single-book EV, cancellation and deterministic deduplication', async () => {
  const legs = Array.from({ length: 10 }, (_, i) => make(String(i), { fd: 2 + i / 10, dk: 2 }, { pn: .4 }));
  for (let count = 2; count <= 8; count++) {
    const results = await generate({ ...options, legs, count });
    assert.ok(results.length <= 5 && results.length > 0);
    assert.ok(results.every(result => result.ids.length === count));
    assert.equal(new Set(results.map(result => [...result.ids].sort().join())).size, results.length);
  }
  assert.deepEqual(await generate({ ...options, legs: [], count: 2 }), []);
  const single = await generate({ ...options, books: ['fd'], requiredBooks: ['fd'], legs, count: 2, rank: 'ev' });
  assert.equal(single[0].gap, null);
  assert.deepEqual(await generate({ ...options, books: ['fd'], legs, count: 2 }), []);
  const controller = new AbortController();
  await assert.rejects(generate({ ...options, legs, count: 3, signal: controller.signal,
    yieldTask: async () => controller.abort() }), { name: 'AbortError' });
  await assert.rejects(generate({ ...options, legs, count: 9 }), /2 to 8/);
});
