// Pure accounting helpers. All amounts are integer cents; never use floating
// point percentages to persist commissions. Database RPCs own ledger mutations.
export const AFFILIATE_TERMS = Object.freeze({
  commissionBps: 2000,
  discountPercent: 20,
  commissionMonths: 12,
  attributionDays: 30,
  holdDays: 30,
  minimumPayoutCents: 2500,
  currency: 'usd',
});

function cents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be nonnegative safe integer cents`);
  }
  return value;
}

function roundedRatio(numerator, denominator) {
  const result = (numerator + denominator / 2n) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds safe integer range');
  return Number(result);
}

export function calculateCommission(revenueCents, refundedCents = 0, bps = AFFILIATE_TERMS.commissionBps) {
  cents(revenueCents, 'Revenue');
  cents(refundedCents, 'Refund');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new RangeError('Invalid commission basis points');
  return roundedRatio(BigInt(Math.max(0, revenueCents - refundedCents)) * BigInt(bps), 10000n);
}

export function addCalendarMonthsUTC(value, months = AFFILIATE_TERMS.commissionMonths) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(months) || months < 0) {
    throw new RangeError('Invalid date or month count');
  }
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date;
}

export function isWithinCommissionWindow(firstPaidAt, paidAt) {
  const start = new Date(firstPaidAt);
  const paid = new Date(paidAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(paid.getTime())) return false;
  return paid >= start && paid < addCalendarMonthsUTC(start);
}

export function stripeObjectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

export function invoiceSubscriptionId(invoice) {
  return stripeObjectId(invoice?.subscription)
    || stripeObjectId(invoice?.parent?.subscription_details?.subscription);
}

export function invoicePaymentIntentIds(invoice) {
  const ids = [stripeObjectId(invoice?.payment_intent)];
  for (const payment of invoice?.payments?.data || []) {
    ids.push(stripeObjectId(payment?.payment?.payment_intent));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function invoicePriceIds(invoice) {
  return [...new Set((invoice?.lines?.data || []).map(line =>
    stripeObjectId(line?.price) || stripeObjectId(line?.pricing?.price_details?.price)
  ).filter(Boolean))];
}

/**
 * Supports invoices before and after Stripe's 2025-03-31 API shape change.
 * Pass succeeded-charge cashPaidCents from Stripe for strict cash accounting;
 * invoice.amount_paid alone is only a fallback, and out-of-band invoices never
 * qualify. Cash discounts/credits and refunded tax are allocated proportionally.
 */
export function extractInvoiceFacts(invoice, {
  cashPaidCents,
  refundedCashCents = 0,
  disputed = null,
} = {}) {
  const invoiceId = stripeObjectId(invoice);
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = stripeObjectId(invoice?.customer);
  const currency = String(invoice?.currency || '').toLowerCase();
  const paidSeconds = invoice?.status_transitions?.paid_at;
  const base = {
    invoiceId, subscriptionId, customerId, currency,
    chargeId: stripeObjectId(invoice?.charge),
    paymentIntentIds: invoicePaymentIntentIds(invoice),
    priceIds: invoicePriceIds(invoice),
    paidAt: Number.isSafeInteger(paidSeconds) && paidSeconds > 0 ? new Date(paidSeconds * 1000).toISOString() : null,
    revenueCents: 0, refundedCents: 0, disputed,
    eligible: false,
  };
  if (!invoiceId || !subscriptionId || !customerId || !base.paidAt) return { ...base, reason: 'incomplete_invoice' };
  if (!(invoice.status === 'paid' || invoice.paid === true) || invoice.paid_out_of_band) {
    return { ...base, reason: 'not_cash_paid' };
  }
  if (currency !== AFFILIATE_TERMS.currency) return { ...base, reason: 'unsupported_currency' };
  const total = cents(invoice.total, 'Invoice total');
  const paid = cents(invoice.amount_paid, 'Invoice amount paid');
  const cash = Math.min(cents(cashPaidCents ?? paid, 'Cash paid'), paid, total);
  const refund = cents(refundedCashCents, 'Cash refund');
  if (!total || !cash) return { ...base, reason: 'no_cash_revenue' };
  let pretax = invoice.total_excluding_tax;
  if (pretax == null) {
    const taxEntries = invoice.total_taxes ?? invoice.total_tax_amounts;
    const tax = Array.isArray(taxEntries)
      ? taxEntries.reduce((sum, item) => sum + cents(item.amount, 'Tax'), 0)
      : cents(invoice.tax ?? 0, 'Tax');
    pretax = Math.max(0, total - tax);
  }
  pretax = Math.min(total, cents(pretax, 'Pretax invoice total'));
  const revenueCents = roundedRatio(BigInt(cash) * BigInt(pretax), BigInt(total));
  const refundedCents = Math.min(revenueCents,
    roundedRatio(BigInt(Math.min(refund, cash)) * BigInt(revenueCents), BigInt(cash)));
  return { ...base, revenueCents, refundedCents, eligible: revenueCents > 0, reason: null };
}

/** Read-model calculation matching the payout RPC, useful for dashboards/tests. */
export function commissionBalance(commission, payoutItems = [], now = new Date()) {
  const settled = payoutItems.filter(item => item.status === 'paid')
    .reduce((sum, item) => sum + item.amount_cents, 0);
  const reserved = payoutItems.filter(item => item.status === 'reserved')
    .reduce((sum, item) => sum + item.amount_cents, 0);
  const balance = commission.commission_cents - settled - reserved;
  const held = balance > 0 && new Date(commission.available_at) > new Date(now);
  return { settled, reserved, balance, available: held ? 0 : balance, held: held ? balance : 0 };
}
