/**
 * The API currently runs as one process. Keep customer creation, subscription
 * lookup, session expiration, and Checkout creation inside withUserLock.
 * Multiple replicas require replacing this guard with a shared database lease.
 */
export function createCheckoutGuard({ stripe }) {
  const pending = new Map();

  async function withUserLock(userId, task) {
    if (typeof userId !== 'string' || !userId) throw new TypeError('A verified user ID is required.');
    if (typeof task !== 'function') throw new TypeError('A checkout task is required.');
    const previous = pending.get(userId) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    pending.set(userId, current);
    try { return await current; }
    finally { if (pending.get(userId) === current) pending.delete(userId); }
  }

  async function expireOpenSessions(customerId) {
    if (typeof customerId !== 'string' || !customerId) throw new TypeError('A verified Stripe customer is required.');
    let after;
    let expired = 0;
    for (;;) {
      const page = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100, ...(after ? { starting_after: after } : {}) });
      for (const session of page.data) {
        if (session.mode !== 'subscription' || session.status !== 'open') continue;
        // Do not suppress completion races or Stripe failures. The caller must
        // retry its subscription check before creating another payment session.
        await stripe.checkout.sessions.expire(session.id);
        expired++;
      }
      if (!page.has_more || !page.data.length) return expired;
      after = page.data.at(-1).id;
    }
  }

  return { withUserLock, expireOpenSessions };
}
