# Affiliate program launch

The frontend and the local sibling `api` repository are implemented. Nothing has been deployed, no database migration has been run, and no Stripe settings or real payouts have been changed. The API keeps the program off unless `AFFILIATE_PROGRAM_ENABLED=true`.

## What you need to do

1. **Supabase:** run [`affiliate-backend/affiliate-schema.sql`](affiliate-backend/affiliate-schema.sql) once in the SQL editor, starting with a test project. Use a backup before running it in production. The migration creates dedicated tables and transaction functions; browsers cannot read or write them. The API's existing `SUPABASE_SECRET` must be a server-side service-role secret. Do not put that key in the frontend.
2. **Stripe:** create a coupon for **20% off**, duration **Once**, with no product restriction. Copy its coupon ID, not a promotion-code ID. Create separate test and live coupons. You do not need one Stripe coupon per partner: partner codes are managed in the app. Stripe's `once` duration applies the discount to the first subscription charge. [Stripe coupon documentation](https://docs.stripe.com/api/coupons).
3. **API hosting environment:** set the variables below. Get your own account's UUID from **Supabase → Authentication → Users** for the administrator allowlist. Keep the feature off until the migration, prices, coupon, and webhook are ready; then turn it on in the test environment first.
4. **Stripe webhook:** update the existing `/api/webhook` endpoint's event selection using the list below. Keep the existing subscription events. Use the endpoint's matching signing secret in `STRIPE_WEBHOOK_SECRET`.
5. **Test and deploy:** complete the test checkout/refund/payout checks below, then deploy both repositories and repeat the setup with live keys and the live coupon. The local API source has already been wired; you do not need to rerun the installer here.
6. **Invite partners:** have each partner sign in normally, find their Supabase user UUID, and open **Pages → Affiliates** using your administrator account. Create their code there. Start with 5–10 partners. Codes use 3–24 letters, numbers, underscores, or hyphens.
7. **Choose how you will pay partners:** use your preferred external transfer method and a monthly payout date. Collect payment details privately. Reserve an eligible batch in the admin dashboard, send the payment outside the site, and only then record the actual transaction reference. The dashboard records payments; it does not transfer money.

## API environment

```dotenv
AFFILIATE_PROGRAM_ENABLED=false
AFFILIATE_COUPON_ID=your_stripe_coupon_id
AFFILIATE_ADMIN_USER_IDS=your_supabase_user_uuid
```

Multiple administrators can be comma separated. These settings belong on the API host, not in `shared.js` or the frontend. The existing `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ANALYST_PRICE_ID`, `STRIPE_SHARP_PRICE_ID`, `SUPABASE_URL`, `SUPABASE_SECRET`, and `SITE` must all point to the same environment. Use USD monthly prices of $10 for Analyst and $25 for Sharp so they match the pricing page.

For localhost, use the walkthrough below. The browser and API must both use the same test Supabase project. Authentication remains required for affiliate actions on localhost. Local referral links include `.html`.

Use one API process/replica for this first release. Checkout creation uses an in-process account lock and expires older open subscription checkouts before checking subscription status. Multiple replicas need a shared database lease before scaling out. Commission and payout mutations already use database transactions across processes.

## Stripe webhook events

Keep these existing events:

```text
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

Add these:

```text
invoice.paid
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
```

The code also accepts `invoice.payment_succeeded`, `refund.created`, and `refund.updated` if your endpoint already receives them; duplicate invoice events do not earn duplicate commissions. Every event still passes Stripe signature verification against the raw request body. Accounting failures return HTTP 500 for retries. Stripe does not guarantee event delivery order; the handler checks current Stripe data and can backfill the first qualifying invoice. [Stripe subscription webhook documentation](https://docs.stripe.com/billing/subscriptions/webhooks).

For local testing, run the Stripe CLI in Ubuntu alongside the API:

```bash
stripe listen --forward-to localhost:5001/api/webhook
```

Use the CLI's signing secret in your local environment, not the hosted endpoint's secret. Complete an actual test-mode subscription checkout so the invoice has this application's customer and referral metadata; generic generated invoice events are not enough to validate attribution.

## Test locally without deploying

The frontend already sends API requests to `http://localhost:5001` when opened on localhost. Stripe CLI forwards Stripe test events to that local API. You do not need to deploy either repository for this test. A hosted preview currently defaults to the production API, so do not assume a preview URL is isolated.

The terminal commands below use **Ubuntu/Bash**. Run Node/npm and the Stripe CLI inside Ubuntu. If you use Ubuntu through WSL, you can keep using your Windows browser and existing frontend server at `http://localhost:5500`.

1. **Prepare an isolated Supabase project.** On a fresh test project, run [`affiliate-test-profiles.sql`](affiliate-backend/affiliate-test-profiles.sql) first, then [`affiliate-schema.sql`](affiliate-backend/affiliate-schema.sql). The first file is a minimal test-only profile schema and refuses to replace an existing `profiles` table. Do not run it on production. If your test project already has the app's profiles schema, skip the test fixture. Neither SQL file has been executed by the local automated tests.

2. **Configure Google sign-in in the test project.** Enable the Google provider with the test project's callback URL configured in Google OAuth. Set the test project's Auth Site URL to `http://localhost:5500` and add `http://localhost:5500/profile.html` to allowed redirect URLs. Use two Google accounts for the test; leave Discord unlinked to avoid production Discord role changes. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

3. **Serve the frontend.** If your frontend server is already running on port 5500, keep it running. Otherwise, from the frontend directory in Ubuntu, run:

   ```bash
   python3 -m http.server 5500 --bind localhost
   ```

   Open `http://localhost:5500/pricing.html`. Use `localhost` consistently, including redirects and the API's `SITE` value.

4. **Point this browser at the test Supabase project.** Open browser DevTools → Console on that localhost page and run the following with your test project's URL and **publishable key** (or legacy anon key):

   ```javascript
   localStorage.setItem('ev_dev_supabase', JSON.stringify({
     url: 'https://YOUR-TEST-PROJECT.supabase.co',
     publishableKey: 'YOUR_TEST_PUBLISHABLE_KEY'
   }));
   localStorage.removeItem('cached_profile');
   localStorage.removeItem('ev_affiliate_referral_v1');
   location.reload();
   ```

   This override only works on localhost, 127.0.0.1, or IPv6 loopback, and is ignored on the live website and packaged app. It never needs the service-role key. Apply it separately in every browser profile/incognito window used for testing. An invalid override fails sign-in rather than silently falling back to production. Removing `ev_dev_supabase` and reloading restores the usual project.

   Sign in with the future partner/admin account. Find its UUID under the **test** project's Authentication → Users.

5. **Prepare Stripe test objects.** In one Stripe sandbox/test environment, create the $10/month Analyst and $25/month Sharp USD prices plus the 20% coupon (Once, no product restriction). Use the `price_...` IDs, not product IDs. Live prices and coupons are not interchangeable with test objects. No real card is needed.

6. **Start webhook forwarding.** Install the [Stripe CLI](https://docs.stripe.com/stripe-cli/install) in Ubuntu, then in a separate Ubuntu terminal:

   ```bash
   stripe login
   stripe listen --forward-to localhost:5001/api/webhook
   ```

   Ensure the CLI is connected to the same Stripe test environment as the API's test key. Keep it running. Copy the printed `whsec_...` secret into the local API configuration below. [Stripe local webhook testing](https://docs.stripe.com/webhooks#test-locally-without-a-registered-url).

7. **Start the API with isolated test settings.** Keep the test environment file in your Ubuntu home directory at `~/ev-affiliate-test.env`, outside both repositories.

   If you use WSL and already created `C:\Users\zhech\Documents\ev-affiliate-test.env`, copy it into Ubuntu once before continuing:

   ```bash
   cp /mnt/c/Users/zhech/Documents/ev-affiliate-test.env "$HOME/ev-affiliate-test.env"
   ```

   Create or edit the Ubuntu copy:

   ```bash
   touch "$HOME/ev-affiliate-test.env"
   chmod 600 "$HOME/ev-affiliate-test.env"
   nano "$HOME/ev-affiliate-test.env"
   ```

   Fill in or confirm the following settings. In nano, save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**:

   ```dotenv
   PORT=5001
   SITE=http://localhost:5500
   API_BASE=http://localhost:5001
   SUPABASE_URL=https://YOUR-TEST-PROJECT.supabase.co
   SUPABASE_SECRET=YOUR_TEST_PROJECT_SERVER_SERVICE_ROLE_KEY
   STRIPE_SECRET=sk_test_YOUR_TEST_SECRET
   STRIPE_WEBHOOK_SECRET=whsec_FROM_STRIPE_LISTEN
   STRIPE_ANALYST_PRICE_ID=price_TEST_ANALYST
   STRIPE_SHARP_PRICE_ID=price_TEST_SHARP
   AFFILIATE_PROGRAM_ENABLED=true
   AFFILIATE_COUPON_ID=YOUR_TEST_COUPON_ID
   AFFILIATE_ADMIN_USER_IDS=YOUR_TEST_ACCOUNT_UUID
   ```

   From another Ubuntu terminal, enter your API checkout and start it:

   ```bash
   cd /path/to/api
   npm install
   DOTENV_CONFIG_PATH="$HOME/ev-affiliate-test.env" npm start
   ```

   Replace `/path/to/api` with your Ubuntu API directory. If WSL uses the existing Windows checkout beside this frontend, that path is `/mnt/c/Users/zhech/Documents/api`. Run `npm install` on first setup or after dependency changes; subsequent starts only need the last command.

   `DOTENV_CONFIG_PATH` selects the Ubuntu test file instead of the API's regular `.env`; you do not need to `source` the file. Already-exported shell variables take precedence over dotenv values, so use a terminal without exported production API settings. If you copied the file from Windows, later edits must go into the Ubuntu copy. Stop a previous local API using port 5001 before starting this one. Restart with the same command after changing settings. Do not pair Stripe test keys with your live Supabase database: test purchases write Stripe customer IDs and membership tiers.

   Keep both the API and `stripe listen` terminals running while completing steps 8 and 9. The API should report `http://localhost:5001` when it starts.

8. **Create a partner and complete a real test checkout.** Open `http://localhost:5500/affiliates.html` while signed in as the admin. Under Invite a partner, use that same test account's UUID and create code `TESTPARTNER`. You can be both admin and partner. Open a separate browser/incognito window, set its test Supabase override as in step 4, then visit `http://localhost:5500/pricing.html?ref=TESTPARTNER`. Sign in with the second Google account and choose Sharp. Because sign-in returns to Profile, return to Pricing afterward; the saved referral should remain applied.

   Confirm $20 for the first month before tax and $25 thereafter. Pay using Stripe's test card `4242 4242 4242 4242`, a future expiry, and any three-digit CVC. Use this card only in Stripe test mode. [Stripe test cards](https://docs.stripe.com/testing#testing-interactively).

9. **Check the result and a refund.** The CLI should show a successful `invoice.paid` delivery with HTTP 200. The customer's profile should become Sharp. Refresh the partner dashboard: expect 1 paid customer, $4 pending commission, $0 available, and no payout yet. In the same Stripe test dashboard, refund the full $20 payment. After successful webhook delivery and a dashboard refresh, that commission should be $0. A $10 partial refund of that $20 invoice would leave $2 commission. Use a fresh customer for the Analyst case: $8 paid and $1.60 pending commission.

After this first checkout/refund passes, complete the remaining duplicate-event, renewal, permissions, and payout checks below. Payout timing is based on the database clock; advancing a Stripe test clock alone does not mature the 30-day hold. Use isolated old-payment fixtures for payout testing rather than editing real payment records.

When testing is complete, deploy the API and frontend with the production Supabase project, live Stripe prices/coupon/key, and the hosted webhook's signing secret. Production stays off until that environment is configured. Test keys belong only in the test API process, never in the live Railway service.

## Terms implemented

| Rule | Behavior |
| --- | --- |
| Customer offer | 20% off the first paid month: Analyst $8, Sharp $20; existing free accounts qualify, prior paid subscribers do not |
| Partner earnings | Standard commission of 20% of collected subscription revenue after discounts and before tax, before Stripe processing fees |
| Higher commission rates | Partners may be considered for higher rates based on audience reach, engagement, and referral performance, subject to the program's economics. Increases are not automatic or guaranteed; any approved rate, effective date, and applicable referrals will be confirmed in writing |
| First commission | Analyst $1.60; Sharp $4.00 |
| Normal monthly renewal | Analyst $2.00; Sharp $5.00 |
| Earnings window | First 12 calendar months from first payment; upgrades, downgrades, and resubscriptions retain the original window |
| Review after 12 months | Review the program's economics, including customer retention, revenue, and operating costs, to decide whether to offer an extension. Extensions are not automatic or guaranteed; any approved duration and commission rate will be confirmed in writing |
| Referral window | 30 days; an entered code takes priority over a link before the first payment |
| Attribution | Locked to the purchased referral at the first qualifying payment |
| Hold and minimum | 30 days from payment; $25 minimum payout; smaller balances carry forward |
| Refunds | Cumulative refunds reduce earnings; refunds of paid commissions create a balance adjustment against future earnings |
| Disputes | The entire disputed invoice earns no commission while a dispute is open or lost, including a partial dispute; a won dispute restores eligible earnings |
| Exclusions | Self-referrals, stacking discounts, tax, failed payments, and credit-funded or out-of-band payments |
| Disabled partner | Stops new referrals; already locked customers continue earning eligible commissions |

The dashboard shows aggregate referrals and earnings, without exposing referred customers' emails or identities. Administrators can create/disable partners, reserve/cancel payout batches, record completed payments, and export payout history to CSV. Only one outstanding payout batch is allowed per partner. A refund after reservation becomes a future balance adjustment; cancel and reserve again before sending if you want a batch recalculated.

The partner dashboard includes the extension review policy above. The current payout logic still enforces 12 calendar months per referred customer. Before offering an extension, agree its terms in writing and implement and test the corresponding accounting change; the review wording alone does not extend commissions.

Higher commission rates also require configuration before taking effect. The database stores a rate per partner and locks each referral's rate at first payment, but the admin dashboard does not yet provide rate controls. Changing a partner's rate alone does not increase the rate for existing locked referrals; confirm the agreed scope and test the accounting before activating an increase. The commission examples above use the standard 20% rate.

The partner dashboard's **Program terms and sharing** section includes five disclosure examples: with the offer, simple, conversational, for a link, and partner wording. The recommended offer version is: “Use code YOURCODE for 20% off your first month. I earn a commission on subscriptions through my code.” Partners should replace YOURCODE with their actual code and include the disclosure with their promotional message, near the code or link.

## Before the first live invitation

The local automated tests cover calculation, authorization, mocked Stripe/database behavior, checkout wiring, and browser interactions. The migration and database functions still need to run against your test Supabase project; local tests do not substitute for that step.

- Create two separate test accounts: a partner and a referred customer. Your administrator can also be the partner, but cannot use their own code.
- Create a partner and open their link signed out. Sign in with the customer account, apply a different valid code, and confirm explicit-code priority. Remove a code and verify it stays removed on refresh.
- Buy Analyst in Stripe test mode. Confirm $8 due before tax, a locked referral, one $1.60 pending commission, and no available payout yet. Repeat Sharp with another new customer: $20 due and $4 pending.
- Replay the same paid event and an additional payment event for the same invoice. Confirm exactly one commission. Simulate a failed payment and confirm no new earnings.
- Test a renewal and a plan change. Verify $2/$5 on regular full-price payments and that the first-payment timestamp never resets.
- Issue partial and full refunds; verify proportional/zero earnings. Test a dispute and a won dispute. Include a refund after a payout has been marked paid and verify that it reduces future available earnings.
- Use isolated database fixtures with payments older than 30 days to exercise the hold and $25 threshold. Reserve twice and confirm one batch; cancel and reserve again; record the same payment reference twice and confirm one completed payout. Do not backdate live commission rows.
- Confirm anonymous and authenticated browser Supabase clients cannot select affiliate tables or execute the accounting functions. Confirm a regular signed-in user gets HTTP 403 for `/api/affiliates/admin`.
- Test normal checkout and the billing portal with the affiliate flag off and without a code. An explicitly submitted code while the program is off must fail clearly instead of silently charging full price.

After launch, use the dashboard's **Disable code** control to stop a partner's new referrals. The global feature flag disables webhook processing too; turning it off during live sales requires replaying affected Stripe events after re-enabling it.

## Files and local verification

- Frontend: `referrals.js`, `affiliates.html`, `affiliates.js`, `affiliates.css`, plus pricing/auth/navigation integration.
- API: sibling `api/api.js`, `api/affiliate-api.mjs`, `api/affiliate-ledger.mjs`, `api/affiliate-checkout.mjs`.
- Database migration: `affiliate-backend/affiliate-schema.sql`.
- Source copies, tests, and a guarded installer for another checkout are in `affiliate-backend/`. The installer prints the exact diff with `--check`, and requires that preview's source hash before `--apply`; it never runs the migration or modifies environment variables.

From the frontend directory in Ubuntu, with Node and Python 3/Playwright available:

```bash
node --test affiliate-backend/affiliate-api.test.mjs affiliate-backend/affiliate-ledger.test.mjs affiliate-backend/affiliate-checkout.test.mjs affiliate-backend/affiliate-integration.test.mjs affiliate-backend/affiliate-local-config.test.mjs
python3 -B affiliate-backend/affiliate-browser.test.py
```

Commit and deploy the frontend and API repositories separately. Keep service-role keys, Stripe secrets, and payout account details out of both commits.
