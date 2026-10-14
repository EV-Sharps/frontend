import { commissionBalance, extractInvoiceFacts } from './affiliate-ledger.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const TERMS = Object.freeze({ discount_percent: 20, commission_percent: 20, commission_months: 12, referral_days: 30, hold_days: 30, minimum_payout_cents: 2500, currency: 'usd' });

export class AffiliateError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AffiliateError(status, code, message); };
const idOf = value => typeof value === 'string' ? value : value?.id;
const subscriptionOf = invoice => idOf(invoice.subscription || invoice.parent?.subscription_details?.subscription);
const asCode = value => {
  if (typeof value !== 'string' || !CODE.test(value.trim().toUpperCase())) fail(400, 'invalid_code', 'Enter a code using 3–24 letters, numbers, underscores, or hyphens.');
  return value.trim().toUpperCase();
};
const asId = (value, name = 'ID') => {
  if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'invalid_id', `Enter a valid ${name}.`);
  return value;
};
const bodyOf = req => {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_request', 'Send a JSON object.');
  return body;
};
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

/** Uses a Supabase service-role client. No financial table is exposed to browser clients. */
export function createAffiliateProgram({ supabase, stripe, enabled = false, couponId, adminUserIds = [], eligiblePriceIds = [], site, logger = console, now = () => new Date() }) {
  const admins = new Set((Array.isArray(adminUserIds) ? adminUserIds : String(adminUserIds).split(',')).map(id => id.trim()).filter(id => UUID.test(id)));
  const captureLimits = new Map();
  const allowedPrices = new Set(eligiblePriceIds.filter(Boolean));
  const baseUrl = String(site || '').replace(/\/$/, '');
  const localSite = (() => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname); } catch { return false; } })();
  const requireEnabled = () => { if (!enabled) fail(503, 'unavailable', 'Affiliate program is not available yet.'); };
  const checked = async query => {
    const { data, error } = await query;
    if (error) {
      const message = String(error.message || '');
      if (error.code === '23505') fail(409, 'already_exists', 'This account or code is already assigned.');
      if (/minimum|insufficient|2500/i.test(message)) fail(409, 'payout_minimum', 'At least $25 in available earnings is required.');
      if (/locked|first.paid/i.test(message)) fail(409, 'attribution_locked', 'A paid subscription already has its referral attribution.');
      if (/self.referral/i.test(message)) fail(409, 'self_referral', 'You cannot use your own affiliate code.');
      if (/expired|disabled|inactive|not active/i.test(message)) fail(409, 'referral_unavailable', 'This referral is no longer available.');
      if (/reserved|cancelled|already paid|already finalized/i.test(message)) fail(409, 'payout_state', 'This payout cannot be changed in its current state.');
      if (/Affiliate not found|Payout not found/i.test(message)) fail(404, 'not_found', 'The requested partner or payout was not found.');
      throw new Error(`Affiliate database operation failed (${error.code || 'unknown'}).`);
    }
    return data;
  };
  const one = (table, columns, field, value) => checked(supabase.from(table).select(columns).eq(field, value).maybeSingle());
  const all = async (table, columns = '*', filters = {}, order = 'created_at') => {
    const rows = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      let query = supabase.from(table).select(columns).order(order, { ascending: true }).range(offset, offset + 999);
      if (order === 'created_at') query = query.order(table === 'affiliate_referrals' ? 'user_id' : 'id', { ascending: true });
      for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
      const page = await checked(query);
      rows.push(...(page || []));
      if (!page || page.length < 1000) return rows;
    }
    throw new Error('Affiliate report is too large; use database reporting.');
  };
  async function authenticate(req) {
    const authorization = req.headers?.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) fail(401, 'sign_in_required', 'Sign in to continue.');
    const { data, error } = await supabase.auth.getUser(authorization.slice(7));
    if (error || !data?.user?.id || !UUID.test(data.user.id)) fail(401, 'sign_in_required', 'Sign in to continue.');
    return data.user;
  }
  async function authenticateAdmin(req) {
    const user = await authenticate(req);
    if (!admins.has(user.id)) fail(403, 'admin_required', 'Administrator access is required.');
    return user;
  }
  function limitCapture(req) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const timestamp = now().getTime();
    let slot = captureLimits.get(key);
    if (!slot || slot.expires <= timestamp) {
      if (captureLimits.size >= 10000) {
        for (const [ip, entry] of captureLimits) if (entry.expires <= timestamp) captureLimits.delete(ip);
        if (captureLimits.size >= 10000) fail(429, 'rate_limited', 'Please try again later.');
      }
      slot = { count: 0, expires: timestamp + 15 * 60000 };
      captureLimits.set(key, slot);
    }
    if (++slot.count > 60) fail(429, 'rate_limited', 'Too many referral requests. Please try again later.');
  }
  async function activePartner(code) {
    const partner = await one('affiliates', '*', 'code', asCode(code));
    if (!partner || partner.status !== 'active') fail(404, 'invalid_code', 'That affiliate code is not available.');
    return partner;
  }
  async function customerForUser(userId) {
    const profile = await one('profiles', 'stripe_customer_id', 'id', userId);
    return profile?.stripe_customer_id || null;
  }
  async function verifiedCustomer(userId, customerId) {
    if (!customerId) return null;
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || customer.metadata?.supabase_id !== userId) fail(409, 'customer_mismatch', 'Your billing account could not be verified. Please contact support.');
    return customerId;
  }
  async function earliestPaidSubscription(customerId) {
    if (!customerId) return null;
    let first = null;
    let startingAfter;
    for (;;) {
      const page = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      for (const invoice of page.data) {
        if (!subscriptionOf(invoice) || invoice.amount_paid <= 0) continue;
        const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
        if (!first || paidAt < first.paidAt || (paidAt === first.paidAt && invoice.created < first.created)) first = { id: invoice.id, paidAt, created: invoice.created };
      }
      if (!page.has_more || !page.data.length) return first;
      startingAfter = page.data.at(-1).id;
    }
  }
  async function assertNewSubscriber(userId, customerId) {
    const referral = await one('affiliate_referrals', '*', 'user_id', userId);
    const verified = await verifiedCustomer(userId, customerId || await customerForUser(userId));
    if (referral?.first_paid_at || await earliestPaidSubscription(verified)) fail(409, 'existing_subscriber', 'Affiliate discounts are for first-time paid subscribers.');
    return referral;
  }
  async function referralResponse(referral) {
    if (!referral || (!referral.first_paid_at && new Date(referral.expires_at) <= now())) return { code: null };
    const partner = await one('affiliates', '*', 'id', referral.affiliate_id);
    if (!partner || (!referral.first_paid_at && partner.status !== 'active')) return { code: null };
    return { code: partner.code, discount_percent: TERMS.discount_percent, locked: !!referral.first_paid_at, expires_at: referral.expires_at };
  }
  async function claimReferral(userId, input, customerId) {
    const previous = await assertNewSubscriber(userId, customerId);
    let partner, visitId = null, source;
    if (Object.hasOwn(input, 'code')) {
      partner = await activePartner(input.code); source = 'code';
    } else {
      visitId = asId(input.visit_token, 'referral token');
      const visit = await one('affiliate_visits', '*', 'id', visitId);
      if (!visit || new Date(visit.expires_at) <= now()) fail(410, 'referral_expired', 'This referral link has expired.');
      partner = await one('affiliates', '*', 'id', visit.affiliate_id); source = 'link';
      if (!partner || partner.status !== 'active') fail(404, 'invalid_code', 'That affiliate code is not available.');
      if (previous?.source === 'code' && new Date(previous.expires_at) > now()) return previous;
    }
    if (partner.owner_user_id === userId) fail(409, 'self_referral', 'You cannot use your own affiliate code.');
    return checked(supabase.rpc('affiliate_set_referral', { p_user_id: userId, p_affiliate_id: partner.id, p_visit_id: visitId, p_source: source }));
  }
  const publicPartner = partner => ({ id: partner.id, code: partner.code, active: partner.status === 'active', referral_url: `${baseUrl}/pricing${localSite ? '.html' : ''}?ref=${encodeURIComponent(partner.code)}` });
  const publicPayout = payout => ({ id: payout.id, partner_id: payout.affiliate_id, amount_cents: Number(payout.total_cents), currency: payout.currency, status: payout.status, created_at: payout.created_at, paid_at: payout.paid_at, external_reference: payout.external_reference });
  async function report(partner) {
    const [referrals, commissions, payouts] = await Promise.all([
      all('affiliate_referrals', '*', { affiliate_id: partner.id }),
      all('affiliate_commissions', '*', { affiliate_id: partner.id }),
      all('affiliate_payouts', '*', { affiliate_id: partner.id }),
    ]);
    let pending = 0, available = 0, reserved = 0, paid = 0;
    const items = (await Promise.all(payouts.map(async payout => (await all('affiliate_payout_items', '*', { payout_id: payout.id }, 'commission_id')).map(item => ({ ...item, amount_cents: Number(item.amount_cents), status: payout.status }))))).flat();
    for (const commission of commissions) {
      const balance = commissionBalance({ ...commission, commission_cents: Number(commission.commission_cents) }, items.filter(item => item.commission_id === commission.id), now());
      available += balance.available;
      pending += balance.held;
    }
    for (const payout of payouts) {
      if (payout.status === 'reserved') reserved += Number(payout.total_cents);
      if (payout.status === 'paid') paid += Number(payout.total_cents);
    }
    return { partner: publicPartner(partner), summary: { signups: referrals.length, conversions: referrals.filter(r => r.first_paid_at).length, pending_cents: pending, available_cents: available, reserved_cents: reserved, paid_cents: paid, currency: 'usd' }, payouts: payouts.map(publicPayout).reverse() };
  }

  /** Spread these returned options into Stripe Checkout. Clients never supply a coupon ID. */
  async function checkoutReferral({ userId, customerId, code, visitToken } = {}) {
    if (!enabled) {
      if (code !== undefined || visitToken !== undefined) requireEnabled();
      return {};
    }
    asId(userId, 'user ID');
    let referral;
    if (code !== undefined || visitToken !== undefined) referral = await claimReferral(userId, code !== undefined ? { code } : { visit_token: visitToken }, customerId);
    else referral = await one('affiliate_referrals', '*', 'user_id', userId);
    if (!referral || referral.first_paid_at || new Date(referral.expires_at) <= now()) return {};
    const partner = await one('affiliates', '*', 'id', referral.affiliate_id);
    if (!partner || partner.status !== 'active' || partner.owner_user_id === userId) return {};
    if (await earliestPaidSubscription(await verifiedCustomer(userId, customerId))) {
      if (code !== undefined || visitToken !== undefined) fail(409, 'existing_subscriber', 'Affiliate discounts are for first-time paid subscribers.');
      return {};
    }
    if (!couponId) fail(503, 'discount_unavailable', 'Affiliate discounts are not configured yet.');
    const coupon = await stripe.coupons.retrieve(couponId);
    if (!coupon.valid || coupon.percent_off !== 20 || coupon.duration !== 'once' || coupon.applies_to?.products?.length) fail(503, 'discount_unavailable', 'Affiliate discounts are not configured correctly.');
    return {
      discounts: [{ coupon: couponId }],
      subscription_data: { metadata: { affiliate_program: 'evsharps-v1', affiliate_id: partner.id, affiliate_user_id: userId, affiliate_code: partner.code, affiliate_referral_at: referral.created_at } },
    };
  }

  async function userForCustomer(customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    const userId = customer.deleted ? null : customer.metadata?.supabase_id;
    return UUID.test(userId || '') ? userId : null;
  }
  async function invoiceCharges(invoice) {
    const charges = [];
    const seen = new Set();
    const add = async charge => {
      const id = idOf(charge);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const record = await stripe.charges.retrieve(id);
      if (record.paid && record.captured !== false && record.status === 'succeeded') charges.push(record);
    };
    if (invoice.charge) await add(invoice.charge);
    const intents = [];
    if (invoice.payment_intent) intents.push(idOf(invoice.payment_intent));
    // Old API versions expose the complete single-payment relationship directly.
    // Only use the newer resource when those legacy relationships are absent.
    if (!invoice.charge && !invoice.payment_intent && stripe.invoicePayments?.list) {
      let after;
      for (;;) {
        const page = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100, ...(after ? { starting_after: after } : {}) });
        for (const payment of page.data) {
          if (payment.status !== 'paid') continue;
          if (payment.payment?.type === 'payment_intent') intents.push(idOf(payment.payment.payment_intent));
          if (payment.payment?.type === 'charge') await add(payment.payment.charge);
        }
        if (!page.has_more || !page.data.length) break;
        after = page.data.at(-1).id;
      }
    }
    for (const id of new Set(intents.filter(Boolean))) {
      const intent = await stripe.paymentIntents.retrieve(id);
      await add(intent.latest_charge);
    }
    return charges;
  }
  async function hasOpenDispute(charges) {
    for (const charge of charges.filter(row => row.disputed)) {
      const disputes = await stripe.disputes.list({ charge: charge.id, limit: 100 });
      if (disputes.data.some(dispute => !['won', 'warning_closed'].includes(dispute.status))) return true;
    }
    return false;
  }
  async function processInvoice(invoiceId, event, { disputed = null } = {}) {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId = subscriptionOf(invoice);
    if (!subscriptionId || invoice.status !== 'paid' || invoice.amount_paid <= 0 || invoice.currency !== 'usd') return;
    const existing = await one('affiliate_commissions', '*', 'stripe_invoice_id', invoice.id);
    if (!existing && allowedPrices.size) {
      let lines = invoice.lines?.data || [];
      if (invoice.lines?.has_more) {
        lines = [];
        let after;
        for (;;) {
          const page = await stripe.invoices.listLineItems(invoice.id, { limit: 100, ...(after ? { starting_after: after } : {}) });
          lines.push(...page.data);
          if (!page.has_more || !page.data.length) break;
          after = page.data.at(-1).id;
        }
      }
      if (!lines.length || lines.some(line => !allowedPrices.has(idOf(line.price) || idOf(line.pricing?.price_details?.price)))) return;
    }
    const customerId = idOf(invoice.customer);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const metadata = subscription.metadata || {};
    const userId = existing?.user_id || await userForCustomer(customerId);
    if (!userId) return;
    const referral = await one('affiliate_referrals', '*', 'user_id', userId);
    if (!existing && !referral?.first_paid_at) {
      if (metadata.affiliate_program !== 'evsharps-v1' || metadata.affiliate_user_id !== userId || !UUID.test(metadata.affiliate_id || '')) return;
      const first = await earliestPaidSubscription(customerId);
      if (!first) return;
      if (first.id !== invoice.id) {
        // Stripe does not guarantee delivery order. Backfill the first paid invoice
        // before a renewal; an older ineligible subscription still blocks attribution.
        await processInvoice(first.id, { ...event, id: `${event.id}:first:${first.id}` });
        const locked = await one('affiliate_referrals', '*', 'user_id', userId);
        if (!locked?.first_paid_at) return;
      }
    }
    if (!existing && !referral && metadata.affiliate_program !== 'evsharps-v1') return;
    const charges = await invoiceCharges(invoice);
    // A real successful charge is required; credits and out-of-band invoices never earn commission.
    const cashPaidCents = charges.reduce((sum, charge) => sum + (charge.amount_captured ?? charge.amount), 0);
    const refundedCashCents = charges.reduce((sum, charge) => sum + (charge.amount_refunded || 0), 0);
    const chargeDisputed = await hasOpenDispute(charges);
    const effectiveDispute = chargeDisputed || disputed === true ? true : disputed;
    const facts = extractInvoiceFacts(invoice, { cashPaidCents, refundedCashCents, disputed: effectiveDispute });
    if (!facts.eligible) return;
    const params = { p_event_id: event.id, p_event_created_at: new Date(event.created * 1000).toISOString(), p_user_id: userId, p_invoice_id: invoice.id, p_paid_at: facts.paidAt, p_revenue_cents: facts.revenueCents, p_refunded_cents: facts.refundedCents, p_disputed: effectiveDispute, p_currency: facts.currency, p_affiliate_id: metadata.affiliate_program === 'evsharps-v1' ? metadata.affiliate_id : null, p_attributed_at: metadata.affiliate_program === 'evsharps-v1' ? metadata.affiliate_referral_at : null };
    await checked(supabase.rpc('affiliate_record_invoice', params));
    if (charges.length) {
      await checked(supabase.from('affiliate_commissions').update({ stripe_charge_id: charges[0].id, stripe_payment_intent_id: idOf(charges[0].payment_intent) || null }).eq('stripe_invoice_id', invoice.id));
    }
  }
  async function invoiceForCharge(charge) {
    if (idOf(charge.invoice)) return idOf(charge.invoice);
    const byCharge = await one('affiliate_commissions', 'stripe_invoice_id', 'stripe_charge_id', charge.id);
    if (byCharge) return byCharge.stripe_invoice_id;
    const intentId = idOf(charge.payment_intent);
    if (intentId) {
      const byIntent = await one('affiliate_commissions', 'stripe_invoice_id', 'stripe_payment_intent_id', intentId);
      if (byIntent) return byIntent.stripe_invoice_id;
      if (stripe.invoicePayments?.list) {
        const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: intentId }, limit: 100 });
        const payment = payments.data.find(row => row.status === 'paid');
        if (payment) return idOf(payment.invoice);
      }
    }
    return null;
  }
  /** Call only AFTER the existing Stripe webhook signature has been verified. Errors must return HTTP 500 for Stripe retries. */
  async function handleEvent(event) {
    if (!enabled) return;
    if (!event?.id || !Number.isFinite(event.created) || !event.data?.object) throw new Error('Invalid verified Stripe event.');
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') return processInvoice(event.data.object.id, event);
    if (event.type === 'charge.refunded' || event.type === 'refund.created' || event.type === 'refund.updated') {
      const chargeId = event.type === 'charge.refunded' ? event.data.object.id : idOf(event.data.object.charge);
      if (!chargeId) return;
      const charge = await stripe.charges.retrieve(chargeId);
      const invoiceId = await invoiceForCharge(charge);
      if (invoiceId) await processInvoice(invoiceId, event);
    }
    if (['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'].includes(event.type)) {
      const dispute = await stripe.disputes.retrieve(event.data.object.id);
      const charge = await stripe.charges.retrieve(idOf(dispute.charge));
      const invoiceId = await invoiceForCharge(charge);
      if (invoiceId) await processInvoice(invoiceId, event, { disputed: dispute.status !== 'won' && dispute.status !== 'warning_closed' });
    }
  }

  function registerRoutes(app) {
    const route = (method, path, handler, auth = 'user') => app[method](`/api/affiliates${path}`, async (req, res) => {
      res.set('Cache-Control', 'private, no-store').set('Vary', 'Authorization');
      try {
        requireEnabled();
        const user = auth === 'admin' ? await authenticateAdmin(req) : auth === 'user' ? await authenticate(req) : null;
        const result = await handler(req, res, user);
        if (!res.headersSent) res.json(result);
      } catch (error) {
        if (!(error instanceof AffiliateError)) logger.error?.('Affiliate request failed:', error.message);
        if (!res.headersSent) res.status(error.status || 500).json({ error: error instanceof AffiliateError ? error.message : 'Affiliate request could not be completed. Please try again.', code: error.code || 'server_error' });
      }
    });
    route('post', '/capture', async req => {
      limitCapture(req);
      const partner = await activePartner(bodyOf(req).code);
      const visit = await checked(supabase.from('affiliate_visits').insert({ affiliate_id: partner.id }).select('id,expires_at').single());
      return { code: partner.code, visit_token: visit.id, expires_at: visit.expires_at, discount_percent: TERMS.discount_percent };
    }, 'public');
    route('post', '/claim', async (req, res, user) => referralResponse(await claimReferral(user.id, bodyOf(req))));
    route('get', '/referral', async (req, res, user) => referralResponse(await one('affiliate_referrals', '*', 'user_id', user.id)));
    route('delete', '/referral', async (req, res, user) => {
      const referral = await one('affiliate_referrals', '*', 'user_id', user.id);
      if (referral?.first_paid_at) fail(409, 'attribution_locked', 'A paid subscription already has its referral attribution.');
      await checked(supabase.from('affiliate_referrals').delete().eq('user_id', user.id).is('first_paid_at', null));
      return { code: null };
    });
    route('get', '/me', async (req, res, user) => {
      const partner = await one('affiliates', '*', 'owner_user_id', user.id);
      return partner ? { invited: true, admin: admins.has(user.id), terms: TERMS, ...await report(partner) } : { invited: false, admin: admins.has(user.id), terms: TERMS };
    });
    route('get', '/admin', async () => {
      const partners = await all('affiliates');
      const reports = await Promise.all(partners.map(report));
      return { partners: reports.map((entry, index) => ({ ...entry.partner, user_id: partners[index].owner_user_id, summary: entry.summary })), payouts: reports.flatMap(entry => entry.payouts).sort((a, b) => b.created_at.localeCompare(a.created_at)), terms: TERMS };
    }, 'admin');
    route('post', '/admin/partners', async req => {
      const body = bodyOf(req);
      const userId = asId(body.user_id, 'user ID');
      const code = asCode(body.code);
      if (body.active !== undefined && typeof body.active !== 'boolean') fail(400, 'invalid_status', 'Active must be true or false.');
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user) fail(404, 'user_not_found', 'Invite an existing account using its Supabase user ID.');
      const partner = await checked(supabase.from('affiliates').insert({ owner_user_id: userId, code, status: body.active === false ? 'disabled' : 'active' }).select('*').single());
      return { partner: publicPartner(partner) };
    }, 'admin');
    route('patch', '/admin/partners/:id', async req => {
      const id = asId(req.params.id, 'partner ID');
      if (typeof bodyOf(req).active !== 'boolean') fail(400, 'invalid_status', 'Active must be true or false.');
      const partner = await checked(supabase.from('affiliates').update({ status: req.body.active ? 'active' : 'disabled' }).eq('id', id).select('*').maybeSingle());
      if (!partner) fail(404, 'partner_not_found', 'Partner not found.');
      return { partner: publicPartner(partner) };
    }, 'admin');
    route('post', '/admin/payouts', async (req, res, user) => ({ payout: publicPayout(await checked(supabase.rpc('affiliate_reserve_payout', { p_affiliate_id: asId(bodyOf(req).partner_id, 'partner ID'), p_actor_user_id: user.id }))) }), 'admin');
    route('post', '/admin/payouts/:id/paid', async (req, res, user) => {
      const reference = bodyOf(req).external_reference;
      if (typeof reference !== 'string' || !reference.trim() || reference.trim().length > 200 || /[\r\n]/.test(reference)) fail(400, 'invalid_reference', 'Enter a payment reference of 1–200 characters.');
      return { payout: publicPayout(await checked(supabase.rpc('affiliate_finish_payout', { p_payout_id: asId(req.params.id, 'payout ID'), p_actor_user_id: user.id, p_external_reference: reference.trim(), p_cancel: false }))) };
    }, 'admin');
    route('post', '/admin/payouts/:id/cancel', async (req, res, user) => ({ payout: publicPayout(await checked(supabase.rpc('affiliate_finish_payout', { p_payout_id: asId(req.params.id, 'payout ID'), p_actor_user_id: user.id, p_external_reference: null, p_cancel: true }))) }), 'admin');
    route('get', '/admin/export', async (req, res) => {
      const [partners, payouts] = await Promise.all([all('affiliates'), all('affiliate_payouts')]);
      const codes = new Map(partners.map(partner => [partner.id, partner.code]));
      const rows = [['payout_id', 'partner_code', 'amount_cents', 'currency', 'status', 'created_at', 'paid_at', 'external_reference'], ...payouts.map(payout => [payout.id, codes.get(payout.affiliate_id), payout.total_cents, payout.currency, payout.status, payout.created_at, payout.paid_at, payout.external_reference])];
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="affiliate-payouts.csv"').send(rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
    }, 'admin');
  }
  return { registerRoutes, checkoutReferral, handleEvent, authenticate };
}
