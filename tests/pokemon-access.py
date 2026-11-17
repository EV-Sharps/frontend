"""Public browsing and isolated profile saves against an in-memory Pokemon API."""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import os
import shutil
import subprocess
import playwright
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node') or str(Path(playwright.__file__).parent / 'driver' / ('node.exe' if os.name == 'nt' else 'node'))
server = subprocess.Popen([NODE, str(ROOT / 'tests/pokemon-access-server.mjs')], stdout=subprocess.PIPE, text=True)
try:
    base = server.stdout.readline().strip()
    assert base.startswith('http://127.0.0.1:'), base
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(timezone_id="America/New_York")
        page.clock.install()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/shared.js', lambda route: route.fulfill(body=f"let PAGE='', HTML='.html', API_BASE='{base}'; const IS_LOCALHOST=false;", content_type='text/javascript'))
        page.route('**/supabase-js@2', lambda route: route.fulfill(body='', content_type='text/javascript'))
        page.route('**/auth.js', lambda route: route.fulfill(body='''
          const session=token=>token?{access_token:token,user:{id:token}}:null;
          let callback;
          const SB=localStorage.getItem('authUnavailable')?undefined:{auth:{
            onAuthStateChange:fn=>{callback=fn;},
            getSession:async()=>({data:{session:session(localStorage.getItem('testToken'))}})
          }};
          window.switchSession=token=>{
            if(token)localStorage.setItem('testToken',token);else localStorage.removeItem('testToken');
            callback('SIGNED_IN',session(token));
          };
        ''', content_type='text/javascript'))
        page.goto(base + '/pokemon.html')
        expect(page.locator('#workbook')).to_be_visible()
        expect(page.locator('#rankings tr')).to_have_count(1)
        expect(page.locator('.add-details')).to_be_hidden()
        expect(page.locator('meta[name=robots]')).to_have_attribute('content', 'noindex,nofollow')
        page.get_by_role('button', name='Details', exact=True).click()
        expect(page.locator('#editor')).to_be_visible()
        expect(page.locator('button.save')).to_be_disabled()
        expect(page.locator('[name=pack_cost]')).to_be_disabled()
        page.locator('#config-form summary').filter(has_text='Cards & prices').click()
        with page.expect_download() as download:
            page.locator('#download-prices').click()
        assert download.value.suggested_filename == 'pokemon-1.csv'
        page.locator('#close-editor').click()
        page.locator('.set-open').click()
        expect(page.locator('#top-cards-rows tr')).to_have_count(2)
        expect(page.locator('.favorite-toggle')).to_have_count(0)
        # Daily eBay snapshot prices are separate from raw TCGplayer and never fetch live PSA data.
        ebay_original_ev = page.locator('#rankings td').nth(13).inner_text()
        page.locator('#top-cards-price-basis').select_option('ebay_sold')
        expect(page.locator('#top-cards-rows tr').first.locator('h3')).to_have_text('Eevee')
        expect(page.locator('[data-price-basis="ebay_sold"] a').first).to_have_text('$90.00')
        expect(page.locator('[data-price-basis="ebay_sold"] .ebay-price-meta').first).to_contain_text('30-day sample')
        expect(page.locator('[data-price-basis="ebay_sold"] .ebay-price-meta').first).to_contain_text('Last sold 11/16/2026')
        expect(page.locator('#top-cards-price-status')).to_contain_text('Daily eBay snapshot')
        expect(page.locator('#top-cards-refresh-prices')).to_be_hidden()
        assert page.request.get(base + '/test/graded-calls').json()['calls'] == 0
        page.locator('#top-cards-price-basis').select_option('ebay_buy_now')
        expect(page.locator('[data-price-basis="ebay_buy_now"] a').first).to_have_text('$85.00')
        expect(page.locator('[data-price-basis="ebay_buy_now"] .ebay-price-meta').last).to_contain_text('shipping unknown')
        expect(page.locator('#top-cards-price-status')).to_contain_text('1/2 cards priced')
        page.locator('#top-cards-minimum').fill('0')
        expect(page.locator('#top-cards-rows tr.chase-card')).to_have_count(1)
        page.locator('[data-card-view="medium"]').click()
        expect(page.locator('.large-card-market')).to_contain_text('$85.00')
        expect(page.locator('.large-card-market')).to_contain_text('Shipping included')
        expect(page.locator('#rankings td').nth(13)).to_have_text(ebay_original_ev)
        page.locator('#top-cards-minimum').fill('')
        page.locator('[data-card-view="table"]').click()
        page.locator('#top-cards-price-basis').select_option('raw')
        # Browsing PSA quotes is public, on demand, exact-grade only, and independent of raw EV.
        original_ev = page.locator('#rankings td').nth(13).inner_text()
        assert page.request.get(base + '/test/graded-calls').json()['calls'] == 0
        page.locator('#top-cards-price-basis').select_option('psa_10')
        expect(page.locator('#top-cards-rows tr').first.locator('h3')).to_have_text('Eevee')
        expect(page.locator('[data-price-basis="psa_10"]').first).to_have_text('$250.00')
        expect(page.locator('#top-cards-price-status')).to_contain_text('2/2 cards priced')
        assert page.request.get(base + '/test/graded-calls').json()['calls'] == 1
        page.locator('#top-cards-refresh-prices').click()
        expect(page.locator('#top-cards-refresh-prices')).to_be_enabled()
        assert page.request.get(base + '/test/graded-calls').json()['calls'] == 2
        page.locator('#top-cards-minimum').fill('200')
        expect(page.locator('#top-cards-rows tr.chase-card')).to_have_count(1)
        page.locator('#top-cards-minimum').fill('999')
        expect(page.locator('#top-cards-rows .empty')).to_have_text('No cards')
        page.locator('#top-cards-minimum').fill('0')
        page.locator('#top-cards-price-basis').select_option('psa_9')
        expect(page.locator('#top-cards-rows tr.chase-card')).to_have_count(1)
        expect(page.locator('#top-cards-rows tr').first.locator('h3')).to_have_text('Pikachu')
        page.locator('#top-cards-minimum').fill('')
        expect(page.locator('#top-cards-rows tr.chase-card')).to_have_count(2)
        expect(page.locator('[data-price-basis="psa_9"]').last).to_have_text('—')
        page.locator('[data-card-view="medium"]').click()
        expect(page.locator('.large-card-market').first).to_have_text('$99.00')
        expect(page.locator('.large-card-market').last).to_have_text('—')
        page.locator('#top-cards-price-basis').select_option('psa_10')
        expect(page.locator('.large-card-market').first).to_have_text('$250.00')
        expect(page.locator('#rankings td').nth(13)).to_have_text(original_ev)
        expect(page.locator('.preview-price').first).to_have_text('$250.00')
        page.locator('#top-cards-dialog .modal-close').click()
        page.reload()
        expect(page.locator('#card-price-basis')).to_have_value('psa_10')
        expect(page.locator('.preview-price')).to_have_count(0)
        page.locator('.set-open').click()
        expect(page.locator('.large-card-market').first).to_have_text('$250.00')
        page.locator('#top-cards-price-basis').select_option('raw')
        expect(page.locator('.large-card-market').first).to_have_text('$100.00')
        page.locator('[data-card-view="table"]').click()
        page.locator('#top-cards-dialog .modal-close').click()

        # Any signed-in user can save favorites and settings, persisting on reload.
        page.evaluate("switchSession('other')")
        expect(page.locator('.add-details')).to_be_visible()
        page.locator('.set-open').click()
        page.locator('[data-favorite="2"]').click()
        expect(page.locator('[data-favorite="2"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('#top-cards-dialog .modal-close').click()
        page.get_by_role('button', name='Edit', exact=True).click()
        page.locator('[name=pack_cost]').fill('17')
        page.locator('button.save').click()
        expect(page.locator('#save-status')).to_have_text('Saved.')
        page.reload()
        expect(page.locator('.pack-cost')).to_have_text('$17.00')
        expect(page.locator('.chases-open')).to_contain_text('1')

        # A separate signed-in profile starts with the public defaults.
        page.evaluate("switchSession('owner')")
        expect(page.locator('.pack-cost')).to_have_text('$5.00')
        expect(page.locator('.chases-open')).to_have_count(0)
        page.get_by_role('button', name='Edit', exact=True).click()
        page.locator('[name=pack_cost]').fill('23')
        page.locator('button.save').click()
        expect(page.locator('#save-status')).to_have_text('Saved.')
        page.evaluate("switchSession('other')")
        expect(page.locator('.pack-cost')).to_have_text('$17.00')

        # Signing out clears personal data and editing controls, without blocking browsing.
        page.evaluate('switchSession(null)')
        expect(page.locator('.pack-cost')).to_have_text('$5.00')
        expect(page.locator('.add-details')).to_be_hidden()
        expect(page.locator('#editor')).to_be_hidden()
        page.evaluate("localStorage.setItem('authUnavailable','1')")
        page.reload()
        expect(page.locator('#workbook')).to_be_visible()
        expect(page.locator('.pack-cost')).to_have_text('$5.00')
        # Lazy expiry also clears an open popup when timers have not fired yet.
        page.locator('.set-open').click()
        page.locator('#top-cards-price-basis').select_option('psa_10')
        expect(page.locator('.preview-price').first).to_have_text('$250.00')
        page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=2))
        page.evaluate("document.querySelector('#card-price-basis').dispatchEvent(new Event('change'))")
        expect(page.locator('[data-price-basis=psa_10]').first).to_have_text('\u2014')
        expect(page.locator('#top-cards-price-status')).to_contain_text('expired')
        page.clock.set_system_time(datetime.now(timezone.utc))
        page.locator('#top-cards-refresh-prices').click()
        expect(page.locator('.preview-price').first).to_have_text('$250.00')
        # Scheduled expiry also clears previews after the popup closes.
        page.locator('#top-cards-dialog .modal-close').click()
        page.clock.fast_forward(3600001)
        expect(page.locator('.preview-price')).to_have_count(0)
        # Old daily quotes remain clearly dated, but are excluded from current eBay filters/previews.
        page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=47, minutes=59, seconds=50))
        page.locator('.set-open').click()
        page.locator('#top-cards-price-basis').select_option('ebay_buy_now')
        page.locator('#top-cards-minimum').fill('0')
        expect(page.locator('#top-cards-rows tr.chase-card')).to_have_count(1)
        page.clock.fast_forward(15000)
        expect(page.locator('#top-cards-rows .empty')).to_have_text('No cards')
        page.locator('#top-cards-minimum').fill('')
        expect(page.locator('[data-price-basis="ebay_buy_now"] a').first).to_contain_text('Last seen')
        expect(page.locator('[data-price-basis="ebay_buy_now"] .ebay-price-meta').first).to_contain_text('Stale / unverified')
        expect(page.locator('#top-cards-price-status')).to_contain_text('0/2 cards priced')
        expect(page.locator('.preview-price')).to_have_count(0)
        page.locator('#top-cards-minimum').fill('0')
        expect(page.locator('#top-cards-rows .empty')).to_have_text('No cards')
        page.locator('#top-cards-price-basis').select_option('ebay_sold')
        expect(page.locator('#top-cards-rows .empty')).to_have_text('No cards')
        # The board also drops expired eBay previews while the popup is closed.
        page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=47, minutes=59, seconds=50))
        page.locator('#top-cards-price-basis').select_option('ebay_buy_now')
        page.locator('#top-cards-dialog .modal-close').click()
        expect(page.locator('.preview-price').first).to_have_text('$85.00')
        page.clock.fast_forward(15000)
        expect(page.locator('.preview-price')).to_have_count(0)
        assert not errors, errors
        browser.close()
    print('Pokemon browser access, exports, profile saves, sign-out and auth outage passed.')
finally:
    server.terminate()
    server.wait(timeout=10)
