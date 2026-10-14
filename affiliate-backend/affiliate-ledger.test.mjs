import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AFFILIATE_TERMS, calculateCommission, addCalendarMonthsUTC,
  isWithinCommissionWindow, extractInvoiceFacts, invoicePaymentIntentIds,
  invoicePriceIds, commissionBalance,
} from './affiliate-ledger.mjs';

function paidInvoice(overrides = {}) {
  return {
    id: 'in_first', customer: 'cus_1', subscription: 'sub_1',
    currency: 'usd', status: 'paid', total: 880, total_excluding_tax: 800,
    amount_paid: 880, status_transitions: { paid_at: 1767225600 },
    charge: 'ch_1', payment_intent: 'pi_1',
    lines: { data: [{ price: { id: 'price_analyst' } }] },
    ...overrides,
  };
}

test('launch terms use 20%, twelve months, thirty-day hold, and $25 minimum', () => {
  assert.deepEqual(AFFILIATE_TERMS, {
    commissionBps: 2000, discountPercent: 20, commissionMonths: 12,
    attributionDays: 30, holdDays: 30, minimumPayoutCents: 2500, currency: 'usd',
  });
});

test('first invoice discounts yield $1.60 / $4 and full renewals $2 / $5', () => {
  assert.equal(calculateCommission(800), 160);
  assert.equal(calculateCommission(2000), 400);
  assert.equal(calculateCommission(1000), 200);
  assert.equal(calculateCommission(2500), 500);
});

test('integer rounding is stable, inclusive of half cents, without overflow', () => {
  assert.equal(calculateCommission(3, 0, 5000), 2);
  assert.equal(calculateCommission(1, 0, 5000), 1);
  assert.equal(calculateCommission(Number.MAX_SAFE_INTEGER, 0, 10000), Number.MAX_SAFE_INTEGER);
  assert.equal(calculateCommission(Number.MAX_SAFE_INTEGER, 0, 2000), 1801439850948198);
  for (const invalid of [-1, 0.5, Infinity, NaN, '100', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateCommission(invalid), RangeError);
  }
  assert.throws(() => calculateCommission(100, -1), RangeError);
  assert.throws(() => calculateCommission(100, 0, 10001), RangeError);
});

test('partial and full refunds recompute net commission instead of rounding each refund', () => {
  assert.equal(calculateCommission(103), 21);
  assert.equal(calculateCommission(103, 1), 20);
  assert.equal(calculateCommission(103, 2), 20);
  assert.equal(calculateCommission(103, 103), 0);
  assert.equal(calculateCommission(103, 104), 0);
});

test('twelve calendar months clamp leap day in UTC and exclude the anniversary', () => {
  assert.equal(addCalendarMonthsUTC('2024-02-29T18:30:00Z').toISOString(), '2025-02-28T18:30:00.000Z');
  assert.equal(addCalendarMonthsUTC('2025-01-31T12:00:00Z', 1).toISOString(), '2025-02-28T12:00:00.000Z');
  const start = '2024-02-29T18:30:00Z';
  assert.equal(isWithinCommissionWindow(start, start), true);
  assert.equal(isWithinCommissionWindow(start, '2025-02-28T18:29:59.999Z'), true);
  assert.equal(isWithinCommissionWindow(start, '2025-02-28T18:30:00Z'), false);
  assert.equal(isWithinCommissionWindow(start, '2024-02-29T18:29:59Z'), false);
  assert.equal(isWithinCommissionWindow(start, 'garbage'), false);
  assert.throws(() => addCalendarMonthsUTC('garbage'), RangeError);
});

test('legacy Stripe invoice extracts pretax cash paid and identifiers', () => {
  const result = extractInvoiceFacts(paidInvoice(), { cashPaidCents: 880 });
  assert.equal(result.eligible, true);
  assert.equal(result.revenueCents, 800);
  assert.equal(result.refundedCents, 0);
  assert.equal(result.subscriptionId, 'sub_1');
  assert.equal(result.customerId, 'cus_1');
  assert.equal(result.chargeId, 'ch_1');
  assert.deepEqual(result.paymentIntentIds, ['pi_1']);
  assert.deepEqual(result.priceIds, ['price_analyst']);
  assert.equal(result.paidAt, '2026-01-01T00:00:00.000Z');
  assert.equal(result.disputed, null, 'ordinary invoice events must not clear a dispute');
});

test('new Stripe invoice extracts parent subscription, payment records, and line pricing', () => {
  const invoice = paidInvoice({
    subscription: undefined, payment_intent: undefined, charge: undefined,
    customer: { id: 'cus_expanded' }, parent: { subscription_details: { subscription: { id: 'sub_new' } } },
    payments: { data: [{ payment: { payment_intent: 'pi_new' } }, { payment: { payment_intent: { id: 'pi_new' } } }] },
    lines: { data: [{ pricing: { price_details: { price: 'price_new' } } }] },
  });
  const result = extractInvoiceFacts(invoice, { cashPaidCents: 880 });
  assert.equal(result.subscriptionId, 'sub_new');
  assert.equal(result.customerId, 'cus_expanded');
  assert.deepEqual(invoicePaymentIntentIds(invoice), ['pi_new']);
  assert.deepEqual(invoicePriceIds(invoice), ['price_new']);
});

test('cash-only revenue excludes tax and customer-credit-funded portions', () => {
  const result = extractInvoiceFacts(paidInvoice(), { cashPaidCents: 440 });
  assert.equal(result.revenueCents, 400);
  assert.equal(calculateCommission(result.revenueCents), 80);
  assert.equal(extractInvoiceFacts(paidInvoice(), { cashPaidCents: 0 }).eligible, false);
  assert.equal(extractInvoiceFacts(paidInvoice(), { cashPaidCents: 999999 }).revenueCents, 800);
});

test('cash refunds allocate tax proportionally and full refunds erase all commission', () => {
  const half = extractInvoiceFacts(paidInvoice(), { cashPaidCents: 880, refundedCashCents: 440 });
  assert.equal(half.refundedCents, 400);
  assert.equal(calculateCommission(half.revenueCents, half.refundedCents), 80);
  for (const refund of [880, 1000]) {
    const full = extractInvoiceFacts(paidInvoice(), { cashPaidCents: 880, refundedCashCents: refund });
    assert.equal(full.refundedCents, 800);
    assert.equal(calculateCommission(full.revenueCents, full.refundedCents), 0);
  }
});

test('fallback tax shapes support old and new Stripe invoices without double-counting', () => {
  for (const taxFields of [
    { total_tax_amounts: [{ amount: 80 }] },
    { total_taxes: [{ amount: 80 }], total_tax_amounts: [{ amount: 80 }] },
    { tax: 80 },
  ]) {
    assert.equal(extractInvoiceFacts(paidInvoice({ total_excluding_tax: null, ...taxFields })).revenueCents, 800);
  }
});

test('noncash, unpaid, one-off, foreign currency, or incomplete invoices are ineligible', () => {
  for (const change of [
    { paid_out_of_band: true }, { status: 'open' }, { subscription: null },
    { currency: 'eur' }, { status_transitions: {} }, { customer: null },
    { amount_paid: 0 }, { total: 0, amount_paid: 0 },
  ]) assert.equal(extractInvoiceFacts(paidInvoice(change)).eligible, false, JSON.stringify(change));
  assert.throws(() => extractInvoiceFacts(paidInvoice({ amount_paid: 1.5 })), RangeError);
});

test('hold expires at the exact timestamp; reserved and paid amounts cannot be withdrawn twice', () => {
  const commission = { commission_cents: 500, available_at: '2026-01-31T00:00:00Z' };
  assert.deepEqual(commissionBalance(commission, [], '2026-01-30T23:59:59.999Z'),
    { settled: 0, reserved: 0, balance: 500, available: 0, held: 500 });
  assert.equal(commissionBalance(commission, [], '2026-01-31T00:00:00Z').available, 500);
  for (const status of ['reserved', 'paid']) {
    assert.equal(commissionBalance(commission, [{ status, amount_cents: 500 }], '2026-02-01').available, 0);
  }
  assert.equal(commissionBalance(commission, [{ status: 'cancelled', amount_cents: 500 }], '2026-02-01').available, 500);
});

test('refund of a paid commission creates debt; signed future payout items settle that debt once', () => {
  const refunded = { commission_cents: 0, available_at: '2026-01-31T00:00:00Z' };
  const originalPayout = { status: 'paid', amount_cents: 500 };
  assert.equal(commissionBalance(refunded, [originalPayout], '2026-02-01').available, -500);
  const carryForward = { status: 'reserved', amount_cents: -500 };
  assert.equal(commissionBalance(refunded, [originalPayout, carryForward], '2026-02-01').available, 0);
  assert.equal(commissionBalance(refunded, [originalPayout, { ...carryForward, status: 'paid' }], '2026-02-01').available, 0);
});

test('reversal debt offsets available earnings even while other new earnings are held', () => {
  const commissions = [
    [{ commission_cents: 0, available_at: '2026-01-31' }, [{ status: 'paid', amount_cents: 500 }]],
    [{ commission_cents: 2900, available_at: '2026-02-01' }, []],
    [{ commission_cents: 500, available_at: '2026-03-01' }, []],
  ];
  const balances = commissions.map(([entry, items]) => commissionBalance(entry, items, '2026-02-15'));
  assert.equal(balances.reduce((sum, item) => sum + item.available, 0), 2400);
  assert.equal(balances.reduce((sum, item) => sum + item.held, 0), 500);
  assert.equal(balances.reduce((sum, item) => sum + item.available, 0) >= AFFILIATE_TERMS.minimumPayoutCents, false);
});

test('schema guards browser access and routes financial mutations through service-only transactions', () => {
  // This checks packaging/security invariants only. It does not substitute for
  // applying the migration and exercising RPCs in the operator's test project.
  const sql = readFileSync(new URL('./affiliate-schema.sql', import.meta.url), 'utf8');
  for (const table of ['affiliates', 'affiliate_visits', 'affiliate_referrals', 'affiliate_commissions',
    'affiliate_payouts', 'affiliate_payout_items', 'affiliate_webhook_events']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`));
  }
  assert.equal((sql.match(/security definer set search_path = ''/g) || []).length, 4);
  assert.equal((sql.match(/revoke all on function/g) || []).length, 4);
  assert.equal((sql.match(/grant execute on function/g) || []).length, 4);
  assert.match(sql, /stripe_invoice_id text not null unique/);
  assert.match(sql, /event_id text primary key/);
  assert.match(sql, /greatest\(v_commission.refunded_cents, least\(p_revenue_cents, p_refunded_cents\)\)/);
});
