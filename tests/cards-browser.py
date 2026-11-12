"""Topps public browsing, CSV modeling, private saves and account isolation."""
from pathlib import Path
from datetime import datetime, timezone
from tempfile import mkdtemp
import os
import shutil
import subprocess
import playwright
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
NODE=shutil.which('node') or str(Path(playwright.__file__).parent/'driver'/('node.exe' if os.name=='nt' else 'node'))
ARTIFACTS=Path(mkdtemp(prefix='topps-cards-'))
today=datetime.now(timezone.utc).date().isoformat()
csv=('pool,expected_per_pack,pool_size,card_id,name,number,parallel,raw_price,price_as_of,source_url\n'
     f'Gold,0.1,2,raw-1,Player A,1,Gold,100,{today},https://example.com/card/1\n'
     f'Gold,0.1,2,raw-2,Player B,2,Gold,20,{today},https://example.com/card/2\n').encode()
server=subprocess.Popen([NODE,str(ROOT/'tests/cards-server.mjs')],stdout=subprocess.PIPE,text=True)
try:
    base=server.stdout.readline().strip()
    assert base.startswith('http://127.0.0.1:')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/shared.js',lambda route:route.fulfill(body=f"let PAGE='', HTML='.html', API_BASE='{base}';",content_type='text/javascript'))
        page.route('**/supabase-js@2',lambda route:route.fulfill(body='',content_type='text/javascript'))
        page.route('**/auth.js',lambda route:route.fulfill(body='''
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
        ''',content_type='text/javascript'))
        page.goto(base+'/cards.html')
        expect(page.locator('#count')).to_have_text('2 sets')
        expect(page.locator('meta[name=robots]')).to_have_attribute('content','noindex,nofollow')
        page.locator('#sport').select_option('basketball')
        expect(page.locator('#rows tr')).to_have_count(1)
        page.locator('#sport').select_option('')

        def model():
            page.locator('.set-link').filter(has_text='2026 Topps Baseball').click()
            expect(page.locator('#cards-dialog')).to_be_visible()
            page.locator('[data-format="hobby"]').click()
            expect(page.locator('#editor')).to_be_visible()
            page.locator('#import-csv').set_input_files({'name':'pools.csv','mimeType':'text/csv','buffer':csv})
            expect(page.locator('#save-status')).to_have_text('Imported into draft. Review before saving.')
            page.locator('[name=pack_cost]').fill('5')
            page.locator('[name=fee_percent]').fill('10')
            page.locator('[name=cost_per_pack]').fill('1')
            page.locator('[name=odds_url]').fill('https://www.topps.com/pages/odds')
            page.locator('[name=complete]').check()
            page.locator('[name=reviewed]').check()
            page.get_by_role('button',name='Calculate',exact=True).click()
            expect(page.locator('#model-result .metricline strong').first).to_have_text('$6.00')
            expect(page.locator('#model-result .metricline strong').nth(2)).to_have_text('-$0.60')

        model()
        expect(page.locator('#save-model')).to_be_disabled()
        page.evaluate("switchSession('a')")
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#account-status')).to_have_text('Your private models and favorites')
        model()
        page.locator('#save-model').click()
        expect(page.locator('#save-status')).to_have_text('Saved to your profile.')
        with page.expect_download() as download:
            page.locator('#export-model').click()
        assert download.value.suggested_filename=='topps-cards.csv'
        page.locator('#view').select_option('models')
        expect(page.locator('#rows tr[data-model]')).to_have_count(1)
        page.locator('#unit').select_option('box')
        expect(page.locator('#rows tr[data-model] td').nth(4)).to_have_text('$60.00')
        page.locator('#rows [data-open]').click()
        expect(page.locator('#raw-cards tbody tr')).to_have_count(2)
        expect(page.locator('#raw-cards tbody tr').first).to_contain_text('5 avg / 100 packs')
        page.locator('#card-odds-model').select_option('')
        expect(page.locator('#raw-cards tbody tr').first.locator('td').last).to_have_text('—')
        page.locator('#card-odds-model').select_option(index=0)
        page.locator('[data-star="raw-1"]').click()
        expect(page.locator('[data-star="raw-1"]')).to_have_attribute('aria-pressed','true')
        page.locator('#card-view').select_option('gallery')
        expect(page.locator('.raw-gallery article')).to_have_count(2)
        page.locator('#favorites-only').check()
        expect(page.locator('.raw-gallery article')).to_have_count(1)
        page.locator('.close-dialog').click()
        page.reload()
        expect(page.locator('#account-status')).to_have_text('Your private models and favorites')
        page.locator('#view').select_option('models')
        expect(page.locator('#rows tr[data-model]')).to_have_count(1)
        page.evaluate("switchSession('b')")
        expect(page.locator('#count')).to_have_text('0 models')
        page.evaluate("switchSession('a')")
        expect(page.locator('#count')).to_have_text('1 models')

        # A missing price suppresses EV, instead of counting it as zero.
        page.locator('[data-edit]').click()
        page.locator('[data-c=raw_price]').first.fill('')
        page.get_by_role('button',name='Calculate',exact=True).click()
        expect(page.locator('#model-result .metricline strong').first).to_have_text('—')
        expect(page.locator('#model-result')).to_contain_text('raw prices missing')
        page.evaluate('switchSession(null)')
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#count')).to_have_text('0 models')
        page.locator('#view').select_option('catalog')
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(ARTIFACTS/'cards-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'), 'Page overflows mobile viewport'
        page.evaluate("localStorage.setItem('authUnavailable','1')")
        page.reload()
        expect(page.locator('#count')).to_have_text('2 sets')
        assert not errors, errors
        browser.close()
    print('Topps browser checks passed. Screenshot: '+str(ARTIFACTS/'cards-mobile.png'))
finally:
    server.terminate()
    server.wait(timeout=10)
