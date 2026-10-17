"""Browser integration checks for the real pricing and affiliate pages.

Run: python -B affiliate-backend/affiliate-browser.test.py
Requires an installed Playwright Chromium. All API, OAuth, CDN, analytics, and
checkout traffic is intercepted; no live account, payment, or remote data is used.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
PARTNER_ID = '10000000-0000-4000-8000-000000000001'
VISIT_ID = '20000000-0000-4000-8000-000000000001'
PAYOUT_ID = '30000000-0000-4000-8000-000000000001'
USERS = {role: f'40000000-0000-4000-8000-00000000000{index}'
         for index, role in enumerate(['regular', 'partner', 'admin'], 1)}
EXPIRY = '2099-01-01T00:00:00.000Z'


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def session(role):
    return None if role is None else dict(access_token=f'test-{role}',
        user=dict(id=USERS[role], email=f'{role}@example.test', identities=[]))


def main():
    state = dict(role=None, requests=[], referral={}, payouts=[], reserve_error=False,
                 paid_error=False, hold_me=False, held_routes=[],
                 partner_email='partner@example.test', no_partners=False)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    partner = dict(id=PARTNER_ID, code='HOCKEYGUY', active=True,
                   referral_url=f'{origin}/pricing.html?ref=HOCKEYGUY')
    summary = dict(signups=17, conversions=8, pending_cents=800, available_cents=3000,
                   reserved_cents=0, paid_cents=12500, currency='usd')

    def me_payload(role):
        if role == 'partner':
            return dict(invited=True, admin=False, partner=partner, summary=summary,
                        payouts=[dict(id='history', partner_id=PARTNER_ID, amount_cents=12500,
                            status='paid', created_at='2026-09-01T00:00:00Z',
                            paid_at='2026-09-02T00:00:00Z', external_reference='PRIVATE-TRANSFER-OLD')])
        return dict(invited=False, admin=role == 'admin')

    def mock_supabase():
        return """
          window.__testSession = SESSION;
          window.__authListeners = [];
          window.__setSession = next => {
            window.__testSession = next;
            for (const listener of window.__authListeners) listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next);
          };
          const profile = () => ({id: window.__testSession?.user.id, tier: 'free', metadata: {}});
          function query() {
            const result = {data: profile(), error: null};
            const chain = {
              select: () => chain, eq: () => chain, update: () => chain, insert: () => chain,
              maybeSingle: async () => result, single: async () => result,
              then: (ok, bad) => Promise.resolve(result).then(ok, bad)
            };
            return chain;
          }
          window.supabase = {createClient: () => ({from: query, auth: {
            getSession: async () => ({data: {session: window.__testSession}, error: null}),
            getUser: async () => ({data: {user: window.__testSession?.user}, error: null}),
            onAuthStateChange: fn => {window.__authListeners.push(fn); return {data: {subscription: {unsubscribe() {}}}};},
            signOut: async () => {window.__setSession(null); return {error: null};},
            signInWithOAuth: async options => {window.__oauthOptions = options; return {data: {}, error: null};}
          }})};
        """.replace('SESSION', json.dumps(session(state['role'])))

    def intercept(route):
        request = route.request
        parsed = urlparse(request.url)
        if parsed.path.startswith('/api/'):
            body = json.loads(request.post_data or '{}')
            role = request.headers.get('authorization', '').removeprefix('Bearer test-')
            state['requests'].append(dict(path=parsed.path, method=request.method, body=body, role=role,
                                           headers=request.headers))
            path = parsed.path.removeprefix('/api/affiliates')
            if parsed.path == '/api/stripe-portal':
                route.fulfill(json={'url': f'{origin}/fixture-checkout'})
            elif path == '/capture':
                if body.get('code') not in ('HOCKEYGUY', 'SECOND'):
                    route.fulfill(status=404, json={'error': 'That affiliate code is not available.', 'code': 'invalid_code'})
                else:
                    route.fulfill(json=dict(code=body['code'], visit_token=VISIT_ID,
                                            expires_at=EXPIRY, discount_percent=20))
            elif role not in USERS:
                route.fulfill(status=401, json={'error': 'Sign in to continue.'})
            elif path == '/claim':
                code = body.get('code') or ('HOCKEYGUY' if body.get('visit_token') == VISIT_ID else None)
                if code not in ('HOCKEYGUY', 'SECOND'):
                    route.fulfill(status=404, json={'error': 'That affiliate code is not available.', 'code': 'invalid_code'})
                else:
                    state['referral'][role] = dict(code=code, expires_at=EXPIRY, discount_percent=20, locked=False)
                    route.fulfill(json=state['referral'][role])
            elif path == '/referral':
                if request.method == 'DELETE':
                    state['referral'].pop(role, None)
                route.fulfill(json=state['referral'].get(role, {'code': None}))
            elif path == '/me':
                if state['hold_me']:
                    state['held_routes'].append((route, me_payload(role)))
                else:
                    route.fulfill(json=me_payload(role))
            elif path.startswith('/admin') and role != 'admin':
                route.fulfill(status=403, json={'error': 'Administrator access is required.'})
            elif path == '/admin':
                partners = [] if state['no_partners'] else [dict(**partner, summary=summary,
                    user_id=USERS['partner'], email=state['partner_email'])]
                route.fulfill(json=dict(partners=partners, payouts=state['payouts']))
            elif path == '/admin/payouts' and request.method == 'POST':
                if state['reserve_error']:
                    route.fulfill(status=409, json={'error': 'At least $25 in available earnings is required.'})
                else:
                    payout = dict(id=PAYOUT_ID, partner_id=PARTNER_ID, amount_cents=3000,
                                  status='reserved', created_at='2026-10-01T00:00:00Z', paid_at=None)
                    state['payouts'] = [payout]
                    route.fulfill(json={'payout': payout})
            elif path == f'/admin/payouts/{PAYOUT_ID}/paid':
                if state['paid_error']:
                    route.fulfill(status=409, json={'error': 'This payout cannot be changed in its current state.'})
                else:
                    state['payouts'][0].update(status='paid', paid_at='2026-10-13T00:00:00Z',
                                              external_reference=body['external_reference'])
                    route.fulfill(json={'payout': state['payouts'][0]})
            else:
                route.fulfill(status=404, json={'error': f'Unexpected test API request: {path}'})
        elif '@supabase/supabase-js' in request.url:
            route.fulfill(content_type='application/javascript', body=mock_supabase())
        elif request.url == f'{origin}/fixture-checkout':
            route.fulfill(content_type='text/html', body='<h1>Mock checkout</h1>')
        elif request.url.startswith(origin + '/'):
            route.continue_()
        else:
            # No external request is allowed to reach the network.
            route.fulfill(status=200, content_type='application/javascript', body='')

    with TemporaryDirectory(prefix='affiliate-browser-') as artifacts:
        # Some Windows Chromium subprocesses ignore --log-file and write
        # debug.log in their inherited working directory. Keep those temporary.
        previous_directory = os.getcwd()
        os.chdir(artifacts)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    args=['--disable-logging', f'--log-file={Path(artifacts) / "chromium.log"}'])
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                context.route('**/*', intercept)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))

                def go(name, role=None):
                    state['role'] = role
                    page.goto(f'{origin}/{name}', wait_until='networkidle')

                def no_overflow():
                    size = page.evaluate('({scroll: document.documentElement.scrollWidth, width: innerWidth})')
                    assert size['scroll'] <= size['width'] + 1, size

                def portal_requests():
                    return [request for request in state['requests'] if request['path'] == '/api/stripe-portal']

                go('pricing.html?ref=HOCKEYGUY')
                expect(page.locator('#affiliate-code')).to_have_value('HOCKEYGUY')
                expect(page.locator('#affiliate-code-status')).to_contain_text('Sign in')
                assert not any(request['path'].endswith('/claim') for request in state['requests'])
                assert page.evaluate("JSON.parse(localStorage.getItem('ev_affiliate_referral_v1')).visit_token") == VISIT_ID
                state['role'] = 'regular'
                page.reload(wait_until='networkidle')
                expect(page.locator('#affiliate-price-analyst')).to_be_visible()
                expect(page.locator('#affiliate-price-analyst')).to_contain_text('$8 first month')
                assert any(request['path'].endswith('/claim') and request['body'].get('visit_token') == VISIT_ID
                           for request in state['requests'])
                assert page.evaluate('window.EVAffiliateReferrals.prepareCheckout(ACCESS_TOKEN)') == {'visit_token': VISIT_ID}
                print('PASS referral landing persists across sign-in and is automatically claimed')

                page.locator('#affiliate-code').fill('SECOND')
                page.locator('#affiliate-code-form button[type="submit"]').click()
                expect(page.locator('#affiliate-code-status')).to_contain_text('SECOND')
                assert state['referral']['regular']['code'] == 'SECOND'
                page.locator('#affiliate-code').fill('INVALID')
                page.locator('#affiliate-code-form button[type="submit"]').click()
                expect(page.locator('#affiliate-code-status')).to_contain_text('not available')
                expect(page.locator('#affiliate-price-analyst')).to_be_hidden()
                before = len(portal_requests())
                page.locator('[data-tier="analyst"] .select-btn').click()
                expect(page.locator('#plan-status')).to_contain_text('not available')
                assert len(portal_requests()) == before, 'An invalid entered code must stop checkout'
                print('PASS manual codes override referrals; invalid codes cannot silently open full-price checkout')

                page.locator('#affiliate-code-remove').click()
                expect(page.locator('#affiliate-code')).to_have_value('')
                expect(page.locator('#affiliate-price-analyst')).to_be_hidden()
                assert 'ref=' not in page.url, 'Removing a referral must prevent URL-based recapture on refresh'
                assert 'regular' not in state['referral']
                page.locator('[data-tier="analyst"] .select-btn').click()
                expect(page.locator('h1')).to_have_text('Mock checkout')
                assert portal_requests()[-1]['body'] == {}
                go('pricing.html', 'regular')
                page.locator('#affiliate-code').fill('HOCKEYGUY')
                page.locator('#affiliate-code-form button[type="submit"]').click()
                expect(page.locator('#affiliate-price-sharp')).to_contain_text('$20 first month')
                page.locator('[data-tier="sharp"] .select-btn').click()
                expect(page.locator('h1')).to_have_text('Mock checkout')
                assert portal_requests()[-1]['body'] == {'code': 'HOCKEYGUY'}
                assert portal_requests()[-1]['headers']['tier'] == 'sharp'
                print('PASS removal clears attribution and checkout sends only the verified code')

                go('affiliates.html')
                expect(page.locator('#aff-guest')).to_be_visible()
                expect(page.locator('#aff-partner')).to_be_hidden()
                expect(page.locator('#aff-admin')).to_be_hidden()
                go('affiliates.html', 'regular')
                expect(page.locator('#aff-uninvited')).to_be_visible()
                expect(page.locator('#aff-partner')).to_be_hidden()
                expect(page.locator('#aff-admin')).to_be_hidden()
                before = len(state['requests'])
                go('affiliates.html', 'partner')
                expect(page.locator('#aff-partner')).to_be_visible()
                expect(page.locator('#aff-code')).to_have_text('HOCKEYGUY')
                expect(page.locator('#aff-admin')).to_be_hidden()
                assert not any('/admin' in request['path'] for request in state['requests'][before:])
                expect(page.locator('#aff-admin-partners')).to_be_empty()
                assert '$125.00' in page.locator('#aff-metrics').inner_text()
                page.evaluate('window.__setSession(null)')
                expect(page.locator('#aff-guest')).to_be_visible()
                assert page.locator('#aff-metrics').inner_text() == ''
                assert page.locator('#aff-payout-history').inner_text() == ''
                assert page.locator('#aff-link').input_value() == ''
                assert 'PRIVATE-TRANSFER-OLD' not in page.locator('body').text_content()
                print('PASS guest, uninvited, and partner views stay isolated; logout removes financial data')

                go('affiliates.html', 'admin')
                expect(page.locator('#aff-admin')).to_be_visible()
                expect(page.locator('#aff-partner')).to_be_hidden()
                partner_cells = page.locator('#aff-admin-partners tr').first.locator('td')
                expect(partner_cells).to_have_count(8)
                expect(partner_cells.nth(1)).to_have_text('partner@example.test')
                expect(partner_cells.nth(2)).to_have_text(USERS['partner'])
                for email in (None, '<img src=x onerror=alert(1)>@example.test'):
                    state['partner_email'] = email
                    page.locator('#aff-refresh').click()
                    expect(partner_cells.nth(1)).to_have_text(email or '-')
                    expect(partner_cells.nth(2)).to_have_text(USERS['partner'])
                    expect(page.locator('#aff-admin-partners img')).to_have_count(0)
                state['no_partners'] = True
                page.locator('#aff-refresh').click()
                expect(page.locator('#aff-admin-partners td')).to_have_attribute('colspan', '8')
                state['no_partners'] = False
                state['partner_email'] = 'partner@example.test'
                page.locator('#aff-refresh').click()
                expect(partner_cells.nth(1)).to_have_text('partner@example.test')
                print('PASS admin partner table shows email and account UID, handles missing email, and renders identity as text')
                state['reserve_error'] = True
                page.get_by_role('button', name='Reserve payout', exact=True).click()
                expect(page.locator('#aff-status')).to_contain_text('At least $25')
                expect(page.get_by_role('button', name='Reserve payout', exact=True)).to_be_enabled()
                state['reserve_error'] = False
                page.get_by_role('button', name='Reserve payout', exact=True).click()
                expect(page.get_by_role('button', name='Record payment', exact=True)).to_be_visible()
                page.get_by_role('button', name='Record payment', exact=True).click()
                expect(page.locator('#aff-pay-dialog')).to_be_visible()
                page.locator('#aff-pay-reference').fill('PRIVATE-TRANSFER-NEW')
                state['paid_error'] = True
                page.get_by_role('button', name='Confirm payment recorded', exact=True).click()
                expect(page.locator('#aff-pay-status')).to_contain_text('cannot be changed')
                expect(page.locator('#aff-pay-dialog')).to_be_visible()
                state['paid_error'] = False
                page.get_by_role('button', name='Confirm payment recorded', exact=True).click()
                expect(page.locator('#aff-pay-dialog')).to_be_hidden()
                expect(page.locator('#aff-status')).to_have_text('Payment recorded.')
                expect(page.locator('#aff-admin-payouts')).to_contain_text('PRIVATE-TRANSFER-NEW')
                print('PASS payout reservation and manual reconciliation surface server errors without claiming payment success')

                page.evaluate('window.__setSession(null)')
                expect(page.locator('#aff-guest')).to_be_visible()
                expect(page.locator('#aff-admin-partners')).to_be_empty()
                assert page.locator('#aff-admin-payouts').inner_text() == ''
                assert page.locator('#aff-pay-description').text_content() == '', 'Logout must clear hidden payout details'
                assert page.locator('#aff-pay-reference').input_value() == '', 'Logout must clear bank references'
                assert page.locator('#aff-pay-status').text_content() == ''
                print('PASS administrator logout clears hidden payment dialog details and transaction references')

                go('pricing.html')
                page.locator('#affiliate-code').fill('SECOND')
                page.get_by_role('button', name='Sign in with Google', exact=True).click()
                page.wait_for_function('window.__oauthOptions?.provider === "google"')
                assert page.evaluate("JSON.parse(localStorage.getItem('ev_affiliate_referral_v1')).code") == 'SECOND'
                print('PASS an unapplied typed code is captured before Google OAuth starts')

                for width in (390, 1440):
                    page.set_viewport_size({'width': width, 'height': 1000})
                    go('pricing.html', 'regular')
                    no_overflow()
                    go('affiliates.html', 'admin')
                    no_overflow()
                    expect(partner_cells.nth(1)).to_have_text('partner@example.test')
                    expect(partner_cells.nth(2)).to_have_text(USERS['partner'])
                    page.get_by_role('button', name='Reserve payout', exact=True).scroll_into_view_if_needed()
                    no_overflow()
                    go('affiliates.html', 'partner')
                    no_overflow()
                print('PASS actual pricing and affiliate layouts fit 390px and 1440px viewports')

                state['hold_me'] = True
                state['role'] = 'partner'
                page.goto(f'{origin}/affiliates.html', wait_until='domcontentloaded')
                page.wait_for_function('window.__authListeners?.length > 0')
                # Pump browser events until the authenticated response is held.
                for _ in range(100):
                    if state['held_routes']:
                        break
                    page.wait_for_timeout(20)
                assert state['held_routes'], 'Expected a pending authenticated dashboard request'
                page.evaluate('window.__setSession(null)')
                expect(page.locator('#aff-guest')).to_be_visible()
                state['hold_me'] = False
                for route, payload in state['held_routes']:
                    route.fulfill(json=payload)
                state['held_routes'].clear()
                page.wait_for_load_state('networkidle')
                expect(page.locator('#aff-partner')).to_be_hidden()
                assert page.locator('#aff-metrics').inner_text() == ''
                print('PASS delayed authenticated response cannot restore earnings after logout')

                assert not errors, errors
                context.close()
                browser.close()
                print('PASS no browser JavaScript errors')
        finally:
            server.shutdown()
            server.server_close()
            os.chdir(previous_directory)


if __name__ == '__main__':
    main()
