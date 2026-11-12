"""Public browsing and isolated profile saves against an in-memory Pokemon API."""
from pathlib import Path
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
        page = browser.new_page()
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
        assert not errors, errors
        browser.close()
    print('Pokemon browser access, exports, profile saves, sign-out and auth outage passed.')
finally:
    server.terminate()
    server.wait(timeout=10)
