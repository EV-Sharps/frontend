import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAffiliateProgram } from './affiliate-api.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const PARTNER = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-13T12:00:00.000Z';
const LATER = '2026-11-12T12:00:00.000Z';
const seconds = value => new Date(value).getTime() / 1000;

function harness(overrides = {}) {
  const tables = {
    affiliates: [{ id: PARTNER, owner_user_id: OWNER, code: 'HOCKEY', status: 'active', created_at: NOW }],
    affiliate_visits: [], affiliate_referrals: [], affiliate_commissions: [], affiliate_payouts: [], affiliate_payout_items: [],
    profiles: [{ id: USER, stripe_customer_id: 'cus_user' }, { id: OWNER, stripe_customer_id: 'cus_owner' }],
  };
  const calls = { invoices: [], rpc: [], coupons: [], errors: [] };
  let dbError = null;
  function builder(table) {
    let predicates = [], mode = 'read', value, single = false, start = 0, end = Infinity;
    const query = {
      select() { return this; },
      eq(key, expected) { predicates.push(row => row[key] === expected); return this; },
      is(key, expected) { predicates.push(row => (row[key] ?? null) === expected); return this; },
      order() { return this; },
      range(first, last) { start = first; end = last; return this; },
      maybeSingle() { single = true; return this; },
      single() { single = true; return this; },
      insert(row) { mode = 'insert'; value = row; return this; },
      update(row) { mode = 'update'; value = row; return this; },
      delete() { mode = 'delete'; return this; },
      then(resolve, reject) {
        if (dbError) return Promise.resolve({ data: null, error: dbError }).then(resolve, reject);
        let rows = tables[table].filter(row => predicates.every(predicate => predicate(row)));
        if (mode === 'insert') {
          const row = { id: randomUUID(), created_at: NOW, expires_at: LATER, ...value };
          tables[table].push(row); rows = [row];
        }
        if (mode === 'update') rows.forEach(row => Object.assign(row, value));
        if (mode === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
        rows = rows.slice(start, end + 1);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  }
  const users = new Set([USER, OWNER, ADMIN]);
  const supabase = {
    from: builder,
    auth: {
      getUser: async token => ({ data: { user: users.has(token) ? { id: token, user_metadata: { admin: true } } : null } }),
      admin: { getUserById: async id => ({ data: { user: users.has(id) ? { id } : null } }) },
    },
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      if (dbError) return { data: null, error: dbError };
      if (name === 'affiliate_set_referral') {
        let referral = tables.affiliate_referrals.find(row => row.user_id === params.p_user_id);
        if (!referral) { referral = {}; tables.affiliate_referrals.push(referral); }
        Object.assign(referral, { user_id: params.p_user_id, affiliate_id: params.p_affiliate_id, visit_id: params.p_visit_id, source: params.p_source, created_at: NOW, expires_at: LATER, first_paid_at: null });
        return { data: referral };
      }
      if (name === 'affiliate_record_invoice') {
        let commission = tables.affiliate_commissions.find(row => row.stripe_invoice_id === params.p_invoice_id);
        if (!commission) { commission = { id: randomUUID(), stripe_invoice_id: params.p_invoice_id, user_id: params.p_user_id }; tables.affiliate_commissions.push(commission); }
        let referral = tables.affiliate_referrals.find(row => row.user_id === params.p_user_id);
        if (!referral) { referral = { user_id: params.p_user_id, affiliate_id: params.p_affiliate_id }; tables.affiliate_referrals.push(referral); }
        referral.first_paid_at ||= params.p_paid_at;
        return { data: { recorded: true, commission } };
      }
      return { data: { id: randomUUID(), affiliate_id: PARTNER, total_cents: 2500, currency: 'usd', status: params.p_cancel ? 'cancelled' : params.p_external_reference ? 'paid' : 'reserved', created_at: NOW, external_reference: params.p_external_reference } };
    },
  };
  const invoice = { id: 'in_first', customer: 'cus_user', subscription: 'sub_user', status: 'paid', amount_paid: 880, total: 880, total_excluding_tax: 800, currency: 'usd', charge: 'ch_user', created: seconds(NOW), status_transitions: { paid_at: seconds(NOW) } };
  const charge = { id: 'ch_user', invoice: 'in_first', payment_intent: 'pi_user', amount: 880, amount_captured: 880, amount_refunded: 0, paid: true, captured: true, status: 'succeeded', disputed: false };
  const metadata = { affiliate_program: 'evsharps-v1', affiliate_id: PARTNER, affiliate_user_id: USER, affiliate_code: 'HOCKEY', affiliate_referral_at: NOW };
  const stripe = {
    invoices: { list: async params => { calls.invoices.push(params); return { data: [], has_more: false }; }, retrieve: async () => invoice },
    subscriptions: { retrieve: async () => ({ id: 'sub_user', metadata }) },
    customers: { retrieve: async id => ({ id, metadata: { supabase_id: id === 'cus_owner' ? OWNER : USER } }) },
    charges: { retrieve: async () => charge },
    coupons: { retrieve: async id => { calls.coupons.push(id); return { valid: true, percent_off: 20, duration: 'once' }; } },
    disputes: { retrieve: async () => ({ id: 'du_user', charge: charge.id, status: 'needs_response' }), list: async () => ({ data: [{ status: 'needs_response' }] }) },
    paymentIntents: { retrieve: async () => ({ latest_charge: charge.id }) },
  };
  const service = createAffiliateProgram({ supabase, stripe, enabled: true, couponId: 'coupon_server', adminUserIds: [ADMIN], site: 'https://evsharps.com', now: () => new Date(NOW), logger: { error: (...args) => calls.errors.push(args) }, ...overrides });
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, handler) => routes.set(`${method} ${path}`, handler)]));
  service.registerRoutes(app);
  async function invoke(method, path, { user = USER, body, params, ip = '127.0.0.1' } = {}) {
    const response = { statusCode: 200, headersSent: false, headers: {}, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.headersSent = true; return this; }, type(type) { this.headers.type = type; return this; }, set(key, value) { this.headers[key] = value; return this; }, send(data) { this.data = data; this.headersSent = true; return this; } };
    await routes.get(`${method} /api/affiliates${path}`)({ body, params, headers: user ? { authorization: `Bearer ${user}` } : {}, ip }, response);
    return response;
  }
  return { tables, calls, supabase, stripe, invoice, charge, metadata, service, invoke, failDatabase: error => { dbError = error; } };
}

test('disabled deployment does not touch the database or change checkout', async () => {
  const h = harness({ enabled: false });
  h.failDatabase({ message: 'tables not installed' });
  assert.equal((await h.invoke('get', '/me')).statusCode, 503);
  assert.deepEqual(await h.service.checkoutReferral({}), {});
  await assert.rejects(h.service.checkoutReferral({ code: 'HOCKEY' }), error => error.code === 'unavailable');
  await h.service.handleEvent({});
  assert.equal(h.calls.errors.length, 0);
});

test('localhost requires authentication and user metadata cannot grant admin', async () => {
  const h = harness();
  const unauthenticated = await h.invoke('get', '/me', { user: null });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.headers['Cache-Control'], 'private, no-store');
  assert.equal(unauthenticated.headers.Vary, 'Authorization');
  assert.equal((await h.invoke('get', '/admin')).statusCode, 403);
  assert.equal((await h.invoke('get', '/admin', { user: ADMIN })).statusCode, 200);
});

test('capture normalizes codes, returns an opaque expiring token, and rate limits', async () => {
  const h = harness();
  const response = await h.invoke('post', '/capture', { user: null, body: { code: ' hockey ' } });
  assert.equal(response.data.code, 'HOCKEY');
  assert.equal(response.data.discount_percent, 20);
  assert.match(response.data.visit_token, /^[a-f0-9-]{36}$/);
  assert.equal(response.data.expires_at, LATER);
  assert.equal(Object.hasOwn(response.data, 'owner_user_id'), false);
  for (let index = 0; index < 59; index++) await h.invoke('post', '/capture', { body: { code: 'HOCKEY' } });
  assert.equal((await h.invoke('post', '/capture', { body: { code: 'HOCKEY' } })).statusCode, 429);
  assert.equal((await h.invoke('post', '/capture', { ip: 'other', body: { code: '<script>' } })).statusCode, 400);
});

test('claims reject self referrals, disabled codes, and paid history past the first page', async () => {
  const h = harness();
  assert.equal((await h.invoke('post', '/claim', { user: OWNER, body: { code: 'HOCKEY' } })).data.code, 'self_referral');
  h.tables.affiliates[0].status = 'disabled';
  assert.equal((await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } })).statusCode, 404);
  h.tables.affiliates[0].status = 'active';
  h.stripe.invoices.list = async params => params.starting_after ? { data: [{ ...h.invoice, id: 'in_old' }], has_more: false } : { data: [{ id: 'in_zero', amount_paid: 0 }], has_more: true };
  assert.equal((await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } })).data.code, 'existing_subscriber');
  assert.equal(h.calls.rpc.length, 0);
});

test('explicit codes take priority over links; expired visits cannot refresh attribution', async () => {
  const h = harness();
  const capture = await h.invoke('post', '/capture', { body: { code: 'HOCKEY' } });
  assert.equal((await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } })).data.locked, false);
  assert.equal(h.tables.affiliate_referrals[0].source, 'code');
  const previousCalls = h.calls.rpc.length;
  await h.invoke('post', '/claim', { body: { visit_token: capture.data.visit_token } });
  assert.equal(h.calls.rpc.length, previousCalls);
  h.tables.affiliate_visits[0].expires_at = '2026-10-12T00:00:00Z';
  assert.equal((await h.invoke('post', '/claim', { body: { visit_token: capture.data.visit_token } })).statusCode, 410);
});

test('saved pending referral can be fetched and removed, but a paid attribution cannot', async () => {
  const h = harness();
  await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } });
  assert.equal((await h.invoke('get', '/referral')).data.code, 'HOCKEY');
  assert.deepEqual((await h.invoke('delete', '/referral')).data, { code: null });
  await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } });
  h.tables.affiliate_referrals[0].first_paid_at = NOW;
  assert.equal((await h.invoke('delete', '/referral')).statusCode, 409);
});

test('checkout uses only a server coupon and snapshots the chosen affiliate', async () => {
  const h = harness();
  const result = await h.service.checkoutReferral({ userId: USER, customerId: 'cus_user', code: 'HOCKEY' });
  assert.deepEqual(result.discounts, [{ coupon: 'coupon_server' }]);
  assert.equal(result.subscription_data.metadata.affiliate_id, PARTNER);
  assert.equal(result.subscription_data.metadata.affiliate_referral_at, NOW);
  assert.equal(h.tables.affiliate_referrals[0].first_paid_at, null);
  h.stripe.coupons.retrieve = async () => ({ valid: true, percent_off: 20, duration: 'forever' });
  await assert.rejects(h.service.checkoutReferral({ userId: USER, customerId: 'cus_user' }), error => error.code === 'discount_unavailable');
});

test('an existing subscriber never receives the saved referral discount', async () => {
  const h = harness();
  await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } });
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  assert.deepEqual(await h.service.checkoutReferral({ userId: USER, customerId: 'cus_user' }), {});
  await assert.rejects(h.service.checkoutReferral({ userId: USER, customerId: 'cus_user', code: 'HOCKEY' }), error => error.code === 'existing_subscriber');
  assert.equal(h.calls.coupons.length, 0);
});

test('billing identity comes from Stripe metadata, not editable profile fields', async () => {
  const h = harness();
  h.tables.profiles[0].stripe_customer_id = 'cus_owner';
  const response = await h.invoke('post', '/claim', { body: { code: 'HOCKEY' } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.data.code, 'customer_mismatch');
  assert.equal(h.calls.rpc.length, 0);
});

test('localhost affiliate links include the static HTML extension', async () => {
  const h = harness({ site: 'http://localhost:8000/' });
  const response = await h.invoke('get', '/me', { user: OWNER });
  assert.equal(response.data.partner.referral_url, 'http://localhost:8000/pricing.html?ref=HOCKEY');
});

test('partner dashboard exposes aggregate earnings and no referred customer data', async () => {
  const h = harness();
  h.tables.affiliate_referrals.push({ user_id: USER, email: 'private@example.com', affiliate_id: PARTNER, first_paid_at: NOW });
  h.tables.affiliate_commissions.push({ id: 'commission1', affiliate_id: PARTNER, user_id: USER, commission_cents: 100, available_at: '2026-10-01T00:00:00Z' });
  h.tables.affiliate_payouts.push({ id: 'payout1', affiliate_id: PARTNER, status: 'paid', total_cents: 300, created_at: NOW });
  h.tables.affiliate_payout_items.push({ payout_id: 'payout1', commission_id: 'commission1', amount_cents: 300 });
  const response = await h.invoke('get', '/me', { user: OWNER });
  assert.equal(response.data.summary.available_cents, -200);
  assert.equal(response.data.summary.paid_cents, 300);
  assert.equal(response.data.summary.conversions, 1);
  assert.equal(JSON.stringify(response.data).includes(USER), false);
  assert.equal(JSON.stringify(response.data).includes('private@example.com'), false);
});

test('admin invitations require an existing UUID; payouts require references and use atomic RPCs', async () => {
  const h = harness();
  assert.equal((await h.invoke('post', '/admin/partners', { user: ADMIN, body: { user_id: 'bad', code: 'GOOD' } })).statusCode, 400);
  assert.equal((await h.invoke('post', '/admin/partners', { user: ADMIN, body: { user_id: randomUUID(), code: 'GOOD' } })).statusCode, 404);
  const reservation = await h.invoke('post', '/admin/payouts', { user: ADMIN, body: { partner_id: PARTNER } });
  assert.equal(reservation.data.payout.status, 'reserved');
  assert.equal(h.calls.rpc[0].name, 'affiliate_reserve_payout');
  assert.equal(h.calls.rpc[0].params.p_actor_user_id, ADMIN);
  assert.equal((await h.invoke('post', '/admin/payouts/:id/paid', { user: ADMIN, params: { id: reservation.data.payout.id }, body: {} })).statusCode, 400);
  const paid = await h.invoke('post', '/admin/payouts/:id/paid', { user: ADMIN, params: { id: reservation.data.payout.id }, body: { external_reference: 'BANK-123' } });
  assert.equal(paid.data.payout.status, 'paid');
  assert.equal(h.calls.rpc.at(-1).params.p_external_reference, 'BANK-123');
});

test('CSV export prevents spreadsheet formulas in external references', async () => {
  const h = harness();
  h.tables.affiliate_payouts.push({ id: 'pay', affiliate_id: PARTNER, total_cents: 2500, status: 'paid', currency: 'usd', created_at: NOW, external_reference: '=HYPERLINK("evil")' });
  const response = await h.invoke('get', '/admin/export', { user: ADMIN });
  assert.equal(response.headers.type, 'text/csv');
  assert.match(response.data, /"'=HYPERLINK/);
});

const event = (type = 'invoice.paid', id = 'evt_invoice', object = { id: 'in_first' }) => ({ type, id, created: seconds(NOW), data: { object } });

test('paid invoice records pretax collected revenue and the immutable checkout snapshot', async () => {
  const h = harness();
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  await h.service.handleEvent(event());
  const params = h.calls.rpc.find(call => call.name === 'affiliate_record_invoice').params;
  assert.equal(params.p_revenue_cents, 800);
  assert.equal(params.p_refunded_cents, 0);
  assert.equal(params.p_affiliate_id, PARTNER);
  assert.equal(params.p_attributed_at, NOW);
  assert.equal(params.p_event_id, 'evt_invoice');
  assert.equal(h.tables.affiliate_commissions[0].stripe_charge_id, 'ch_user');
});

test('manual and credit-only paid invoices never create commissions', async () => {
  const h = harness();
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  h.invoice.paid_out_of_band = true;
  await h.service.handleEvent(event());
  assert.equal(h.calls.rpc.length, 0);
  h.invoice.paid_out_of_band = false;
  h.charge.captured = false;
  await h.service.handleEvent(event());
  assert.equal(h.calls.rpc.length, 0);
});

test('refunds send cumulative pretax reductions and won disputes are not reopened by payment events', async () => {
  const h = harness();
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  await h.service.handleEvent(event());
  h.charge.amount_refunded = 440;
  h.charge.disputed = true;
  h.stripe.disputes.list = async () => ({ data: [{ status: 'won' }] });
  await h.service.handleEvent(event('charge.refunded', 'evt_refund', { id: 'ch_user' }));
  assert.equal(h.calls.rpc.at(-1).params.p_refunded_cents, 400);
  assert.equal(h.calls.rpc.at(-1).params.p_disputed, null);
  h.stripe.disputes.retrieve = async () => ({ id: 'du_user', charge: 'ch_user', status: 'won' });
  await h.service.handleEvent(event('charge.dispute.closed', 'evt_won', { id: 'du_user' }));
  assert.equal(h.calls.rpc.at(-1).params.p_disputed, false);
});

test('only configured subscription price IDs earn new commissions', async () => {
  const h = harness({ eligiblePriceIds: ['price_analyst', 'price_sharp'] });
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  h.invoice.lines = { data: [{ price: { id: 'price_unrelated' } }], has_more: false };
  await h.service.handleEvent(event());
  assert.equal(h.calls.rpc.length, 0);
  h.invoice.lines.data[0].price.id = 'price_analyst';
  await h.service.handleEvent(event());
  assert.equal(h.calls.rpc[0].params.p_revenue_cents, 800);
});

test('renewal delivered before first invoice backfills attribution before processing renewal', async () => {
  const h = harness();
  const renewal = { ...h.invoice, id: 'in_renewal', created: seconds(LATER), status_transitions: { paid_at: seconds(LATER) } };
  h.stripe.invoices.list = async () => ({ data: [renewal, h.invoice], has_more: false });
  h.stripe.invoices.retrieve = async id => id === renewal.id ? renewal : h.invoice;
  await h.service.handleEvent(event('invoice.paid', 'evt_renewal', { id: renewal.id }));
  assert.deepEqual(h.calls.rpc.map(call => call.params.p_invoice_id), ['in_first', 'in_renewal']);
  assert.match(h.calls.rpc[0].params.p_event_id, /:first:in_first$/);
});

test('new Stripe invoice parent/payment mappings find the actual successful charge', async () => {
  const h = harness();
  delete h.invoice.subscription; delete h.invoice.charge;
  h.invoice.parent = { subscription_details: { subscription: 'sub_user' } };
  h.stripe.invoicePayments = { list: async () => ({ data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_user' }, invoice: h.invoice.id }], has_more: false }) };
  h.stripe.invoices.list = async () => ({ data: [h.invoice], has_more: false });
  await h.service.handleEvent(event());
  assert.equal(h.calls.rpc[0].params.p_revenue_cents, 800);
});

test('webhook failures propagate so the caller can request a Stripe retry', async () => {
  const h = harness();
  h.failDatabase({ code: '08006', message: 'connection lost' });
  await assert.rejects(h.service.handleEvent(event()), /database operation failed/);
  const response = await h.invoke('get', '/me');
  assert.equal(response.statusCode, 500);
  assert.equal(response.data.error.includes('connection lost'), false);
});
