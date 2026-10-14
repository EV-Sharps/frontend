import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutGuard } from './affiliate-checkout.mjs';

test('the whole customer checkout operation is serialized for the same user', async () => {
  const guard = createCheckoutGuard({ stripe: {} });
  const steps = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = guard.withUserLock('user', async () => { steps.push('first starts'); await gate; steps.push('first ends'); return 1; });
  const second = guard.withUserLock('user', async () => { steps.push('second starts'); return 2; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(steps, ['first starts']);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(steps, ['first starts', 'first ends', 'second starts']);
});

test('different users run independently, and failures release the user lock', async () => {
  const guard = createCheckoutGuard({ stripe: {} });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const blocked = guard.withUserLock('first', () => gate);
  assert.equal(await guard.withUserLock('other', async () => 2), 2);
  release(); await blocked;
  await assert.rejects(guard.withUserLock('first', async () => { throw new Error('Stripe down'); }), /Stripe down/);
  assert.equal(await guard.withUserLock('first', async () => 3), 3);
});

test('expiration paginates, only closes open subscriptions, and uses customer scope', async () => {
  const calls = [], expired = [];
  const guard = createCheckoutGuard({ stripe: { checkout: { sessions: {
    list: async params => {
      calls.push(params);
      return params.starting_after
        ? { data: [{ id: 'cs_last', mode: 'subscription', status: 'open' }], has_more: false }
        : { data: [{ id: 'cs_sub', mode: 'subscription', status: 'open' }, { id: 'cs_payment', mode: 'payment', status: 'open' }], has_more: true };
    },
    expire: async id => { expired.push(id); },
  } } } });
  assert.equal(await guard.expireOpenSessions('cus_me'), 2);
  assert.deepEqual(expired, ['cs_sub', 'cs_last']);
  assert.equal(calls[0].customer, 'cus_me');
  assert.equal(calls[0].status, 'open');
  assert.equal(calls[1].starting_after, 'cs_payment');
});

test('a session completion race aborts expiration and propagates to checkout', async () => {
  const guard = createCheckoutGuard({ stripe: { checkout: { sessions: {
    list: async () => ({ data: [{ id: 'cs_race', mode: 'subscription', status: 'open' }], has_more: false }),
    expire: async () => { throw new Error('Session already completed'); },
  } } } });
  await assert.rejects(guard.expireOpenSessions('cus_me'), /already completed/);
});
