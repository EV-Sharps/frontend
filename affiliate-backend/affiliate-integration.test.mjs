import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { AffiliateError } from './affiliate-api.mjs';
import { createCheckoutGuard } from './affiliate-checkout.mjs';

// Load Express itself, without importing api.js, dotenv, or any credentials.
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const express = requireApi('express');
const bodyParser = requireApi('body-parser');
const apiPath = fileURLToPath(new URL('../../api/api.js', import.meta.url));
const installer = readFileSync(new URL('./integrate.py', import.meta.url), 'utf8');
let source = readFileSync(apiPath, 'utf8').replaceAll('\r\n', '\n');
const installed = source.includes("from './affiliate-api.mjs'");
const scopedJson = (installed ? source : installer).match(/^app\.use\('\/api\/affiliates', express\.json\([^\n]+/m)?.[0];
assert.ok(scopedJson, 'Reviewed installer contains the affiliate-scoped JSON middleware');
if (!installed) {
  // Exercise the exact reviewed installer snippets before installation, or the
  // exact installed routes afterward. Neither branch reimplements the routes.
  const portal = installer.match(/PORTAL = '''([\s\S]*?)'''/)?.[1];
  const hook = installer.match(/source = source\.replace\(marker, '''([\s\S]*?)''' \+ marker\)/)?.[1];
  assert.ok(portal && hook, 'Reviewed checkout and webhook insertions exist');
  const start = source.indexOf('app.post("/api/stripe-portal",');
  const end = source.indexOf('\n/** Discord', start);
  assert.ok(start >= 0 && end > start);
  source = source.slice(0, start) + portal + '\n' + source.slice(end);
  source = source.replace('\tres.status(200).json({ receieved: true });', hook + '\tres.status(200).json({ receieved: true });');
}
const webhookStart = source.indexOf("app.post('/api/webhook',");
const portalStart = source.indexOf('app.post("/api/stripe-portal",');
const portalEnd = source.indexOf('\n/** Discord', portalStart);
assert.ok(webhookStart >= 0 && portalStart > webhookStart && portalEnd > portalStart);
const billingSource = source.slice(webhookStart, portalEnd);
assert.ok(billingSource.includes('affiliateProgram.handleEvent(event)'));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

async function fixture(t, options = {}) {
  const app = express();
  const calls = [];
  const state = { owner: USER, subs: [], openSessions: [], expiryError: null, referralError: null, webhookError: null, signatureError: false, ...options };
  const stripe = {
    customers: { retrieve: async id => { calls.push(['customer', id]); return { id, metadata: { supabase_id: state.owner } }; } },
    subscriptions: { list: async params => { calls.push(['subscriptions', params]); return { data: state.subs }; } },
    billingPortal: { sessions: { create: async params => { calls.push(['billing', params]); return { url: 'https://billing.test/session' }; } } },
    checkout: { sessions: {
      list: async params => { calls.push(['open-sessions', params]); return { data: [...state.openSessions], has_more: false }; },
      expire: async id => { calls.push(['expire', id]); if (state.expiryError) throw state.expiryError; state.openSessions = state.openSessions.filter(session => session.id !== id); },
      create: async params => { calls.push(['checkout', params]); return { url: 'https://checkout.test/session' }; },
    } },
    webhooks: { constructEvent: (body, signature, secret) => {
      calls.push(['signature', { body, signature, secret }]);
      assert.ok(Buffer.isBuffer(body), 'Webhook signature receives the unparsed raw Buffer');
      if (state.signatureError) throw new Error('Invalid signature');
      return JSON.parse(body.toString('utf8'));
    } },
  };
  const affiliateProgram = {
    authenticate: async req => { calls.push(['authenticate']); if (req.headers.authorization !== 'Bearer fixture-token') throw new AffiliateError(401, 'sign_in_required', 'Sign in to continue.'); return { id: USER }; },
    checkoutReferral: async input => {
      calls.push(['referral', input]);
      if (state.referralError) throw state.referralError;
      return input.code || input.visitToken ? { discounts: [{ coupon: 'server-coupon' }], subscription_data: { metadata: { affiliate_program: 'evsharps-v1', affiliate_id: 'approved-partner' } } } : {};
    },
    handleEvent: async event => { calls.push(['affiliate-event', event]); if (state.webhookError) throw state.webhookError; },
  };
  const dependencies = {
    app, express, bodyParser, stripe, affiliateProgram, AffiliateError,
    affiliateCheckout: createCheckoutGuard({ stripe }),
    getCustomerId: async header => { calls.push(['customer-id', header]); return 'cus_fixture'; },
    handleSubscriptionChange: async object => { calls.push(['subscription-change', object]); return { success: true }; },
    handleSubscriptionDeleted: async object => { calls.push(['subscription-delete', object]); return { success: true }; },
    TIER: { ANALYST: 'analyst', SHARP: 'sharp' }, SITE: 'http://localhost:8000', EXT: '.html',
    process: { env: { STRIPE_ANALYST_PRICE_ID: 'price_analyst', STRIPE_SHARP_PRICE_ID: 'price_sharp', STRIPE_WEBHOOK_SECRET: 'fixture-not-a-secret' } },
    console: { log() {}, error: (...args) => calls.push(['logged-error', args]) },
  };
  new Function(...Object.keys(dependencies), `${scopedJson}\n${billingSource}`)(...Object.values(dependencies));
  app.post('/api/affiliates/body-probe', (req, res) => res.json({ body: req.body }));
  // Do not print expected malformed-JSON errors through Express's default handler.
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type || 'request_failed' }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path = '/api/stripe-portal', { authenticated = true, tier = 'analyst', body, raw, headers = {} } = {}) {
    const response = await fetch(base + path, { method: 'POST', headers: { ...(authenticated ? { Authorization: 'Bearer fixture-token' } : {}), tier, 'Content-Type': 'application/json', ...headers }, body: raw ?? JSON.stringify(body ?? {}) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  }
  return { request, calls, state };
}

test('actual checkout route rejects unauthenticated users before billing work', async t => {
  const h = await fixture(t);
  const response = await h.request(undefined, { authenticated: false });
  assert.equal(response.status, 401);
  assert.equal(response.data.code, 'sign_in_required');
  assert.deepEqual(h.calls.map(call => call[0]), ['authenticate']);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('JSON code and token reach referral verification; the server discount reaches Stripe', async t => {
  const h = await fixture(t);
  const response = await h.request(undefined, { tier: 'sharp', body: { code: 'HOCKEY', visit_token: 'opaque-token', discounts: [{ coupon: 'attacker' }], userId: OTHER } });
  assert.equal(response.status, 200);
  assert.equal(response.data.url, 'https://checkout.test/session');
  const input = h.calls.find(call => call[0] === 'referral')[1];
  assert.deepEqual(input, { userId: USER, customerId: 'cus_fixture', code: 'HOCKEY', visitToken: 'opaque-token' });
  const checkout = h.calls.find(call => call[0] === 'checkout')[1];
  assert.deepEqual(checkout.discounts, [{ coupon: 'server-coupon' }]);
  assert.deepEqual(checkout.line_items, [{ price: 'price_sharp', quantity: 1 }]);
  assert.equal(checkout.subscription_data.metadata.affiliate_program, 'evsharps-v1');
  assert.equal(checkout.success_url, 'http://localhost:8000/post-checkout.html');
});

test('ordinary checkout has the requested price and no unsolicited discount', async t => {
  const h = await fixture(t);
  assert.equal((await h.request()).status, 200);
  const checkout = h.calls.find(call => call[0] === 'checkout')[1];
  assert.deepEqual(checkout.line_items, [{ price: 'price_analyst', quantity: 1 }]);
  assert.equal(Object.hasOwn(checkout, 'discounts'), false);
});

test('active paid subscribers go to the billing portal without new checkout or referral claims', async t => {
  const h = await fixture(t, { subs: [{ id: 'sub_existing', status: 'active' }] });
  const response = await h.request(undefined, { body: { code: 'HOCKEY' } });
  assert.equal(response.data.url, 'https://billing.test/session');
  assert.equal(h.calls.some(call => ['checkout', 'referral'].includes(call[0])), false);
});

test('invalid codes and invalid plans prevent Stripe Checkout creation', async t => {
  const h = await fixture(t, { referralError: new AffiliateError(404, 'invalid_code', 'Code is unavailable.') });
  const code = await h.request(undefined, { body: { code: 'INVALID' } });
  assert.equal(code.status, 404);
  assert.equal(code.data.code, 'invalid_code');
  const plan = await h.request(undefined, { tier: 'unlimited' });
  assert.equal(plan.status, 400);
  assert.equal(plan.data.code, 'invalid_plan');
  assert.equal(h.calls.some(call => call[0] === 'checkout'), false);
});

test('mismatched Stripe ownership is blocked before expiring or creating sessions', async t => {
  const h = await fixture(t, { owner: OTHER });
  const response = await h.request();
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'billing_account');
  assert.equal(h.calls.some(call => ['open-sessions', 'subscriptions', 'checkout', 'billing'].includes(call[0])), false);
});

test('old sessions expire before the subscription check, and a completion race aborts checkout', async t => {
  const h = await fixture(t, { openSessions: [{ id: 'cs_old', mode: 'subscription', status: 'open' }] });
  assert.equal((await h.request()).status, 200);
  const names = h.calls.map(call => call[0]);
  assert.ok(names.indexOf('expire') < names.indexOf('subscriptions'));
  h.calls.length = 0;
  h.state.openSessions = [{ id: 'cs_race', mode: 'subscription', status: 'open' }];
  h.state.expiryError = new Error('Session completed during expiration');
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.equal(response.data.code, 'checkout_failed');
  assert.equal(h.calls.some(call => ['subscriptions', 'checkout'].includes(call[0])), false);
});

test('JSON parsing is scoped and bounded while signed webhook bytes remain untouched', async t => {
  const h = await fixture(t);
  const probe = await h.request('/api/affiliates/body-probe', { body: { code: 'HOCKEY' } });
  assert.deepEqual(probe.data, { body: { code: 'HOCKEY' } });
  assert.equal((await h.request(undefined, { raw: '[1,2]' })).status, 400);
  assert.equal((await h.request(undefined, { raw: '{broken' })).status, 400);
  assert.equal((await h.request(undefined, { body: { code: 'x'.repeat(9000) } })).status, 413);
  const raw = '{ "id":"evt_exact", "type":"invoice.paid", "data":{"object":{"id":"in_paid"}} }\n';
  const hook = await h.request('/api/webhook', { raw, headers: { 'stripe-signature': 'fixture-signature' } });
  assert.equal(hook.status, 200);
  const signature = h.calls.find(call => call[0] === 'signature')[1];
  assert.equal(signature.body.toString('utf8'), raw);
  assert.equal(signature.signature, 'fixture-signature');
  assert.equal(signature.secret, 'fixture-not-a-secret');
  assert.equal(h.calls.find(call => call[0] === 'affiliate-event')[1].id, 'evt_exact');
});

test('webhook authentication precedes affiliate work and accounting failures request retries', async t => {
  const h = await fixture(t, { signatureError: true });
  const body = { id: 'evt_paid', type: 'invoice.paid', data: { object: { id: 'in_paid' } } };
  assert.equal((await h.request('/api/webhook', { body })).status, 400);
  assert.equal(h.calls.some(call => call[0] === 'affiliate-event'), false);
  h.state.signatureError = false;
  h.state.webhookError = new Error('Ledger unavailable');
  const response = await h.request('/api/webhook', { body });
  assert.equal(response.status, 500);
  assert.equal(response.data, 'Affiliate accounting failed');
});

test('existing subscription webhooks keep their existing handlers before affiliate processing', async t => {
  const h = await fixture(t);
  const response = await h.request('/api/webhook', { body: { id: 'evt_sub', type: 'customer.subscription.updated', data: { object: { id: 'sub_existing' } } } });
  assert.equal(response.status, 200);
  const names = h.calls.map(call => call[0]);
  assert.ok(names.indexOf('subscription-change') < names.indexOf('affiliate-event'));
});
