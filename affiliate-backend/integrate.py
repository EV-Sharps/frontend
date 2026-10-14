"""Preview/install the reviewed affiliate backend into the existing API checkout.

No database, environment variables, running services, or Stripe objects are changed.
Run --check first. --apply requires the SHA printed by that preview.
"""
import argparse
import difflib
import hashlib
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
MODULES = ("affiliate-api.mjs", "affiliate-ledger.mjs", "affiliate-checkout.mjs")

PORTAL = '''app.post("/api/stripe-portal", express.json({ limit: '8kb' }), async (req, res) => {
	res.set('Cache-Control', 'private, no-store');
	try {
		const user = await affiliateProgram.authenticate(req);
		const portalSession = await affiliateCheckout.withUserLock(user.id, async () => {
			const customerId = await getCustomerId(req.headers.authorization);
			const customer = await stripe.customers.retrieve(customerId);
			if (customer.deleted || customer.metadata?.supabase_id !== user.id) {
				throw new AffiliateError(409, 'billing_account', 'Your billing account could not be verified. Please contact support.');
			}
			// Expire first, then check subscriptions: a just-completed old session
			// must be visible before deciding that a new checkout is needed.
			await affiliateCheckout.expireOpenSessions(customerId);
			const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
			if (hasActiveSub(subs)) {
				return stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${SITE}/profile${EXT}` });
			}
			if (![TIER.ANALYST, TIER.SHARP].includes(req.headers.tier)) {
				throw new AffiliateError(400, 'invalid_plan', 'Choose Analyst or Sharp to continue.');
			}
			const body = req.body ?? {};
			if (typeof body !== 'object' || Array.isArray(body)) {
				throw new AffiliateError(400, 'invalid_request', 'Send a JSON object.');
			}
			const referral = await affiliateProgram.checkoutReferral({
				userId: user.id, customerId, code: body.code, visitToken: body.visit_token,
			});
			const price = req.headers.tier === TIER.ANALYST ? process.env.STRIPE_ANALYST_PRICE_ID : process.env.STRIPE_SHARP_PRICE_ID;
			return stripe.checkout.sessions.create({
				customer: customerId,
				payment_method_types: ['card'],
				mode: 'subscription',
				line_items: [{ price, quantity: 1 }],
				...referral,
				success_url: `${SITE}/post-checkout${EXT}`,
				cancel_url: `${SITE}/pricing${EXT}`,
			});
		});
		res.json({ url: portalSession.url });
	} catch (err) {
		if (!(err instanceof AffiliateError)) console.error('Billing checkout failed:', err.message);
		res.status(err instanceof AffiliateError ? err.status : 500).json({
			error: err instanceof AffiliateError ? err.message : 'Checkout could not be opened. Please try again.',
			code: err instanceof AffiliateError ? err.code : 'checkout_failed',
		});
	}
});'''


def integrate(source):
    if "./affiliate-api.mjs" in source:
        raise ValueError("Affiliate integration already exists; review changes manually instead of applying twice.")
    marker = "import 'dotenv/config';"
    assert source.count(marker) == 1, "Cannot find dotenv import"
    source = source.replace(marker, marker + "\nimport { createAffiliateProgram, AffiliateError } from './affiliate-api.mjs';\nimport { createCheckoutGuard } from './affiliate-checkout.mjs';")
    marker = "const PORT = process.env.PORT || 5000;"
    assert source.count(marker) == 1, "Cannot find API setup"
    source = source.replace(marker, marker + '''

// Keep off until the Supabase migration, coupon, and signed webhook are ready.
const affiliateProgram = createAffiliateProgram({
	supabase, stripe, site: SITE,
	enabled: process.env.AFFILIATE_PROGRAM_ENABLED === 'true',
	couponId: process.env.AFFILIATE_COUPON_ID,
	adminUserIds: (process.env.AFFILIATE_ADMIN_USER_IDS || '').split(','),
	eligiblePriceIds: [process.env.STRIPE_ANALYST_PRICE_ID, process.env.STRIPE_SHARP_PRICE_ID],
});
const affiliateCheckout = createCheckoutGuard({ stripe });
// Scoped JSON parsing preserves the webhook's raw body for signature checking.
app.use('/api/affiliates', express.json({ limit: '8kb' }));
affiliateProgram.registerRoutes(app);
''')
    marker = '\tres.status(200).json({ receieved: true });'
    assert source.count(marker) == 1, "Cannot find webhook acknowledgement"
    source = source.replace(marker, '''	try {
		await affiliateProgram.handleEvent(event);
	} catch (error) {
		console.error('Affiliate webhook failed:', error.message);
		return res.status(500).send('Affiliate accounting failed'); // Stripe retries.
	}
''' + marker)
    start = source.index('app.post("/api/stripe-portal",')
    end = source.index('\n/** Discord', start)
    assert source[start:end].count('app.post(') == 1, "Unexpected checkout route shape"
    source = source[:start] + PORTAL + '\n' + source[end:]
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('api_directory', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-sha')
    args = parser.parse_args()
    api = args.api_directory.resolve()
    target = api / 'api.js'
    original = target.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    source = original.decode('utf-8').replace('\r\n', '\n')
    changed = integrate(source)
    if not args.apply:
        print('Original api.js SHA256:', sha)
        print(''.join(difflib.unified_diff(source.splitlines(True), changed.splitlines(True), fromfile='api/api.js', tofile='api/api.js (affiliate integration)')))
        print('New API modules:', ', '.join(MODULES))
        return
    if args.expected_sha != sha:
        raise SystemExit('api.js changed or preview hash is missing; rerun --check and review.')
    for name in MODULES:
        if (api / name).exists():
            raise SystemExit(f'Refusing to overwrite existing module: {name}')
    for name in MODULES:
        shutil.copyfile(ROOT / name, api / name)
    newline = '\r\n' if b'\r\n' in original else '\n'
    target.write_bytes(changed.replace('\n', newline).encode('utf-8'))
    print('Installed affiliate modules and updated', target)
    print('Database, environment, services, and Stripe configuration were not changed.')


if __name__ == '__main__':
    main()
