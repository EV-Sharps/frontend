"""Topps public browsing, CSV modeling, private saves and account isolation."""
from pathlib import Path
from datetime import datetime, timezone
from tempfile import mkdtemp
import os
import shutil
import subprocess
import base64
import re
import playwright
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
NODE=os.environ.get('CARDS_TEST_NODE') or shutil.which('node') or str(Path(playwright.__file__).parent/'driver'/('node.exe' if os.name=='nt' else 'node'))
ARTIFACTS=Path(mkdtemp(prefix='topps-cards-'))
today=datetime.now(timezone.utc).date().isoformat()
csv=('pool,expected_per_pack,pool_size,card_id,name,number,parallel,raw_price,price_as_of,source_url,image_url\n'
     f'Gold,0.1,2,raw-1,Player A,1,Gold,100,{today},https://example.com/card/1,\n'
     f'Gold,0.1,2,raw-2,Player B,2,Gold,20,{today},https://example.com/card/2,https://images.example.test/manual.png\n').encode()
server=subprocess.Popen([NODE,str(ROOT/'tests/cards-server.mjs')],stdout=subprocess.PIPE,text=True)
try:
    base=server.stdout.readline().strip()
    assert base.startswith('http://127.0.0.1:')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['CARDS_TEST_CHROME']} if os.environ.get('CARDS_TEST_CHROME') else {}))
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        quote_requests=[]
        featured_requests=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:quote_requests.append(request) if request.url.endswith('/quotes') else None)
        page.on('request',lambda request:featured_requests.append(request) if request.url.endswith('/featured') else None)
        pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBckAAAAASUVORK5CYII=')
        page.route('https://images.example.test/source.png',lambda route:route.fulfill(body=pixel,content_type='image/png'))
        page.route('https://images.example.test/manual.png',lambda route:route.fulfill(status=404,body='Missing'))
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
        expect(page.locator('#count')).to_have_text('4 sets')
        expect(page.locator('#head')).to_contain_text('Sealed products')
        expect(page.locator('#source-status')).to_contain_text('Main Topps sets: recent flagship and Chrome sets for baseball, basketball and football, plus Bowman baseball.')
        expect(page.locator('#source-status')).to_contain_text('Older saved sets remain available in My models.')
        expect(page.locator('#source-status')).to_contain_text('sealed products for 1 of 3 shown source sets')
        expect(page.locator('#source-status')).to_contain_text('Product counts are not reported for 1 set.')
        expect(page.locator('#source-status')).to_contain_text('These counts do not include individual cards')
        expect(page.locator('#view option[value="catalog"]')).to_have_text('Main Topps sets')
        assert page.locator('#sport option').evaluate_all('(options)=>options.map(option=>option.value)')==['','baseball','basketball','football']
        for name,label in [('2026 Topps Baseball','6'),('2025 Topps Basketball','Unknown'),
                           ('2024 Topps Football','0'),('2026 Bowman Baseball','Reference only')]:
            expect(page.locator('#rows tr').filter(has_text=name).locator('td').nth(3)).to_have_text(label)
        expect(page.locator('#rows tr').filter(has_text='2024 Topps Football').locator('td').nth(3).locator('span')).to_have_attribute('title','No sealed products supplied by the price source.')
        expect(page.locator('meta[name=robots]')).to_have_attribute('content','noindex,nofollow')
        page.locator('#sport').select_option('basketball')
        expect(page.locator('#rows tr')).to_have_count(1)
        page.locator('#sport').select_option('')

        # Preview ranking is based on the returned recent-sale sample, never sale volume.
        preview=page.locator('#rows [data-featured-id="2026-topps-baseball"]')
        popup_preview=page.locator('#set-featured')
        expect(page.locator('#head')).to_contain_text('Highest recent prices')
        expect(preview.locator('.featured-card')).to_have_count(5)
        assert preview.locator('.featured-card strong').all_text_contents()==['$400.00','$275.00','$120.00','$60.00','$25.00']
        expect(preview).to_contain_text('From recent matched sales')
        expect(preview).to_contain_text('Partial coverage')
        expect(preview.locator('.featured-coverage')).to_have_attribute('title','Highest medians among this recent auction sample, not a complete set ranking. · 90 matched sales · 40 priced cards')
        expect(preview.locator('.featured-card').first).to_have_attribute('title',re.compile('Autographs.*1 sale.*Median from recent matched auctions'))
        expect(preview.locator('.featured-card').nth(1).locator('.no-art')).to_be_visible()
        assert len(featured_requests)==1
        page.locator('#sort').select_option('name')
        page.locator('#sort').select_option('year')
        expect(preview.locator('.featured-card')).to_have_count(5)
        assert len(featured_requests)==1, 'Catalog rerenders must reuse the preview cache'
        catalog_art_width=preview.locator('.card-art').first.bounding_box()['width']
        preview.locator('.featured-card').first.click()
        expect(page.locator('#cards-dialog')).to_be_visible()
        expect(popup_preview).to_be_visible()
        expect(popup_preview.locator('.featured-card')).to_have_count(5)
        popup_chase=popup_preview.locator('.featured-card').first
        expect(popup_chase).to_contain_text('Chase A')
        expect(popup_chase).to_contain_text('Autographs')
        expect(popup_chase).to_contain_text('$400.00')
        expect(popup_chase).to_contain_text(re.compile('median',re.I))
        expect(popup_chase).to_contain_text('1 sale')
        expect(popup_chase).to_contain_text('11/12/2026')
        expect(popup_chase.locator('a')).to_have_attribute('href','https://example.com/sale/0')
        expect(popup_chase.locator('.card-image')).to_have_attribute('src','https://images.example.test/source.png')
        expect(popup_preview.locator('.featured-card').nth(1)).to_contain_text('Gold')
        expect(popup_preview.locator('.featured-card').nth(1).locator('.no-art')).to_be_visible()
        assert popup_chase.locator('.card-art').bounding_box()['width']>catalog_art_width, 'Popup artwork should be larger than catalog thumbnails'
        expect(popup_preview).to_contain_text(re.compile('partial coverage',re.I))
        expect(page.locator('#source-coverage')).to_contain_text('Base checklist coverage:')
        expect(page.locator('#set-content').get_by_role('heading',name='Base checklist · 1',exact=True)).to_be_visible()
        assert len(featured_requests)==1, 'The popup must reuse the catalog preview request'
        expect(page.locator('#raw-cards tbody')).not_to_contain_text('Chase A')
        page.screenshot(path=str(ARTIFACTS/'cards-featured-popup.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(ARTIFACTS/'cards-featured-popup-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'), 'Popup overflows the mobile viewport'
        assert page.locator('#cards-dialog').bounding_box()['width']<=390, 'Popup is wider than the mobile viewport'
        page.set_viewport_size({'width':1440,'height':1000})
        page.locator('.close-dialog').click()
        assert len(quote_requests)==0
        page.locator('#refresh').click()
        expect(preview).to_contain_text('No eligible recent sales found.')
        expect(preview.locator('.featured-card')).to_have_count(0)
        page.locator('#refresh').click()
        expect(preview).to_contain_text('unavailable')
        preview.get_by_role('button',name='Retry',exact=True).click()
        expect(preview).to_contain_text('Recent-price service is busy')
        preview.get_by_role('button',name='Retry',exact=True).click()
        expect(preview.locator('.featured-card')).to_have_count(5)
        assert len(featured_requests)==5

        # Unavailable or old retail quotes remain visible but never become purchase costs.
        for format_id,status,price in [('retail-oos','Out of stock','$50.00'),
                                       ('retail-unknown','Availability unknown','$60.00'),
                                       ('retail-stale','Stale quote','$70.00'),
                                       ('retail-aged','Stale quote','$80.00')]:
            page.locator('.set-link').filter(has_text='2026 Topps Baseball').click()
            row=page.locator(f'[data-product="{format_id}"]')
            expect(row).to_contain_text(status)
            expect(row).to_contain_text(price)
            expect(row).to_contain_text('Retailer asking price')
            expect(row.locator('a')).to_have_attribute('href','https://www.steelcitycollectibles.com/i/2026-topps-series-1-baseball-hobby-box')
            assert row.locator('time').get_attribute('datetime')
            expect(page.locator('#retail-price-note')).to_contain_text('exclude shipping and tax')
            page.locator(f'[data-format="{format_id}"]').click()
            expect(page.locator('[name=box_cost]')).to_have_value('')
            expect(page.locator('[name=pack_count]')).to_have_value('10')
            expect(page.locator('[name=notes]')).to_contain_text('1 Silver Pack')
            page.locator('#close-editor').click()

        assert len(quote_requests)==0, 'Opening sets must not spend live quote requests'
        page.locator('.set-link').filter(has_text='2026 Topps Baseball').click()
        live_button=page.locator('[data-live-quote="raw-1"]')
        live_result=page.locator('.live-quote-result')
        live_button.click()
        expect(live_button).to_be_disabled()
        expect(live_result).to_contain_text('Recent raw auction median: $777.00')
        expect(live_result).to_contain_text('3 sales')
        expect(live_result.locator('a')).to_have_attribute('href','https://example.com/auction-sale')
        expect(page.locator('#raw-cards tbody tr').first.locator('td').nth(5)).to_contain_text('$125.00')
        page.locator('#card-view').select_option('gallery')
        expect(live_result).to_contain_text('$777.00')
        live_button.click()
        expect(live_result).to_contain_text('No eligible recent raw auction sales.')
        live_button.click()
        expect(live_result).to_contain_text('temporarily unavailable')
        expect(live_button).to_be_enabled()
        live_button.click()
        expect(live_result).to_contain_text('$777.00')
        assert len(quote_requests)==4
        page.locator('[data-format="hobby"]').click()
        page.locator('#add-pool').click()
        page.locator('[data-source-cards]').click()
        expect(page.locator('[data-c=raw_price]')).to_have_value('125')
        page.once('dialog',lambda dialog:dialog.accept())
        page.locator('#close-editor').click()
        page.locator('.set-link').filter(has_text='2026 Topps Baseball').click()
        expect(page.locator('.live-quote-result')).to_have_text('')
        assert len(quote_requests)==4, 'Reopening a modal must not reload live quotes'
        page.locator('.close-dialog').click()

        def model():
            page.locator('.set-link').filter(has_text='2026 Topps Baseball').click()
            expect(page.locator('#cards-dialog')).to_be_visible()
            expect(page.locator('#source-coverage')).to_contain_text('1 / 1 raw cards priced')
            expect(page.locator('#raw-cards .card-image')).to_have_attribute('src','https://images.example.test/source.png')
            page.locator('#published-odds summary').click()
            expect(page.locator('#published-odds-rows tr').first).to_contain_text('1:87')
            expect(page.locator('#published-odds-rows')).to_contain_text('Unclear (1:15.282)')
            expect(page.locator('#published-odds-rows')).to_contain_text('Unclear (01:11:00)')
            expect(page.locator('#published-odds-rows td[title]').first).to_have_attribute('title','This published value could not be interpreted reliably. Check the source PDF; it is not used as a pull-rate estimate.')
            page.locator('#published-odds-format').select_option('jumbo-6545')
            expect(page.locator('#published-odds-rows tr').first).to_contain_text('1:7')
            page.locator('#published-odds-search').fill('Retail')
            expect(page.locator('#published-odds-rows tr')).to_have_count(1)
            expect(page.locator('#published-odds-rows td').last).to_have_text('—')
            # Published pool rates must not imply unsupported per-card odds.
            expect(page.locator('#raw-cards tbody tr').first.locator('td').last).to_have_text('—')
            page.locator('[data-format="hobby"]').click()
            expect(page.locator('#editor')).to_be_visible()
            expect(page.locator('[name=box_cost]')).to_have_value('40')
            expect(page.locator('[name=notes]')).to_contain_text('1 Silver Pack')
            page.locator('#add-pool').click()
            page.locator('[data-source-cards]').click()
            expect(page.locator('[data-c=image_url]')).to_have_value('https://images.example.test/source.png')
            page.once('dialog',lambda dialog:dialog.accept())
            page.locator('#import-csv').set_input_files({'name':'pools.csv','mimeType':'text/csv','buffer':csv})
            expect(page.locator('#save-status')).to_have_text('Imported into draft. Review before saving.')
            expect(page.locator('[data-c=image_url]').last).to_have_value('https://images.example.test/manual.png')
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
        settings=page.request.get(base+'/api/cards/state',headers={'Authorization':'Bearer a'}).json()['settings']
        assert settings['entries'][0]['pools'][0]['cards'][1]['image_url']=='https://images.example.test/manual.png'
        with page.expect_download() as download:
            page.locator('#export-model').click()
        assert download.value.suggested_filename=='topps-cards.csv'
        page.locator('#view').select_option('models')
        expect(page.locator('#rows tr[data-model]')).to_have_count(1)
        assert page.locator('#sport option').evaluate_all('(options)=>options.map(option=>option.value)')==['','baseball']
        page.locator('#unit').select_option('box')
        expect(page.locator('#rows tr[data-model] td').nth(4)).to_have_text('$60.00')
        page.locator('#rows [data-open]').click()
        expect(page.locator('#raw-cards tbody tr')).to_have_count(2)
        expect(page.locator('#raw-cards tbody tr').first.locator('img')).to_have_attribute('src','https://images.example.test/source.png')
        expect(page.locator('#raw-cards tbody tr').first).to_contain_text('$100.00')
        expect(page.locator('#raw-cards tbody tr').first).not_to_contain_text('$125.00')
        expect(page.locator('#raw-cards tbody tr').last.locator('.no-art')).to_be_visible()
        expect(page.locator('#raw-cards tbody tr').first).to_contain_text('5 avg / 100 packs')
        page.locator('#card-odds-model').select_option('')
        expect(page.locator('#raw-cards tbody tr').first.locator('td').last).to_have_text('—')
        page.locator('#card-odds-model').select_option(index=0)
        page.locator('[data-star="raw-1"]').click()
        expect(page.locator('[data-star="raw-1"]')).to_have_attribute('aria-pressed','true')
        page.locator('#card-view').select_option('gallery')
        expect(page.locator('.raw-gallery article')).to_have_count(2)
        expect(page.locator('.raw-gallery article').first.locator('img')).to_have_attribute('src','https://images.example.test/source.png')
        expect(page.locator('.raw-gallery article').last.locator('.no-art')).to_be_visible()
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

        # Opening a saved model must fetch its preview even without a catalog cell.
        expect(page.locator('#rows [data-featured-id]')).to_have_count(0)
        before_model_preview=len(featured_requests)
        page.locator('#rows [data-open]').click()
        expect(popup_preview.locator('.featured-card')).to_have_count(5)
        assert len(featured_requests)==before_model_preview+1, 'A model popup needs its own lazy first fetch'
        expect(page.locator('#raw-cards')).not_to_contain_text('Chase A')
        expect(page.locator('#raw-cards')).to_contain_text('$100.00')
        page.locator('.close-dialog').click()
        page.locator('#rows [data-open]').click()
        expect(popup_preview.locator('.featured-card')).to_have_count(5)
        assert len(featured_requests)==before_model_preview+1, 'Reopening a model popup must reuse its preview cache'
        page.locator('.close-dialog').click()

        # A missing price suppresses EV, instead of counting it as zero.
        page.locator('[data-edit]').click()
        page.locator('[data-c=raw_price]').first.fill('')
        page.get_by_role('button',name='Calculate',exact=True).click()
        expect(page.locator('#model-result .metricline strong').first).to_have_text('—')
        expect(page.locator('#model-result')).to_contain_text('raw prices missing')
        page.evaluate('switchSession(null)')
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#count')).to_have_text('0 models')

        # Catalog focus does not hide older saved models or alter their settings.
        page.evaluate("switchSession('c')")
        expect(page.locator('#count')).to_have_text('1 models')
        assert page.locator('#sport option').evaluate_all('(options)=>options.map(option=>option.value)')==['','hockey']
        page.locator('#sport').select_option('hockey')
        expect(page.locator('#rows')).to_contain_text('2018 Topps Hockey')
        page.locator('#view').select_option('catalog')
        expect(page.locator('#count')).to_have_text('4 sets')
        expect(page.locator('#rows')).not_to_contain_text('2018 Topps Hockey')
        expect(page.locator('#sport')).to_have_value('')
        assert page.locator('#sport option').evaluate_all('(options)=>options.map(option=>option.value)')==['','baseball','basketball','football']
        page.locator('#view').select_option('models')
        expect(page.locator('#count')).to_have_text('1 models')
        page.locator('#rows [data-open]').click()
        expect(page.locator('#cards-title')).to_have_text('2018 Topps Hockey')
        expect(page.locator('#raw-cards')).to_contain_text('Saved Hockey Player')
        expect(page.locator('#raw-cards')).to_contain_text('$15.00')
        expect(page.locator('[data-star="legacy-card"]')).to_have_attribute('aria-pressed','true')
        page.locator('.close-dialog').click()
        page.locator('[data-edit="legacy-model"]').click()
        expect(page.locator('[name=notes]')).to_have_value('Saved before catalog focus.')
        page.locator('[name=notes]').fill('Older model retained after catalog focus.')
        page.locator('#save-model').click()
        expect(page.locator('#save-status')).to_have_text('Saved to your profile.')
        legacy_settings=page.request.get(base+'/api/cards/state',headers={'Authorization':'Bearer c'}).json()['settings']
        assert len(legacy_settings['entries'])==1
        assert legacy_settings['entries'][0]['set_id']=='2018-topps-hockey'
        assert legacy_settings['entries'][0]['pools'][0]['cards'][0]['raw_price']==15
        assert legacy_settings['entries'][0]['notes']=='Older model retained after catalog focus.'
        assert legacy_settings['favorites']==['legacy-card']
        page.evaluate('switchSession(null)')
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#count')).to_have_text('0 models')
        page.locator('#view').select_option('catalog')
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(ARTIFACTS/'cards-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'), 'Page overflows mobile viewport'
        page.evaluate("localStorage.setItem('authUnavailable','1')")
        page.reload()
        expect(page.locator('#count')).to_have_text('4 sets')
        # An idle page must discard cached prices after one hour without polling.
        page.set_viewport_size({'width':1440,'height':1000})
        page.clock.install()
        page.reload()
        expect(preview.locator('.featured-card')).to_have_count(5)
        preview.locator('.featured-card').first.click()
        expect(popup_preview.locator('.featured-card')).to_have_count(5)
        before_expiry=len(featured_requests)
        page.clock.fast_forward(60*60*1000+1000)
        expect(preview).to_contain_text('Preview expired.')
        expect(popup_preview).to_contain_text('Preview expired.')
        expect(preview.locator('.featured-card')).to_have_count(0)
        expect(popup_preview.locator('.featured-card')).to_have_count(0)
        assert len(featured_requests)==before_expiry, 'Expiring previews must not poll the provider'
        popup_preview.get_by_role('button',name='Refresh preview',exact=True).click()
        expect(preview.locator('.featured-card')).to_have_count(5)
        expect(popup_preview.locator('.featured-card')).to_have_count(5)
        assert len(featured_requests)==before_expiry+1, 'Popup refresh should update both views from one request'
        # Scope copy is driven by metadata, so older APIs retain their generic label.
        def without_scope(route):
            response=route.fetch()
            payload=response.json()
            payload.pop('catalog_scope',None)
            route.fulfill(response=response,json=payload)
        page.route('**/api/cards/state',without_scope)
        page.locator('.close-dialog').click()
        page.locator('#refresh').click()
        expect(page.locator('#view option[value="catalog"]')).to_have_text('Set catalog')
        expect(page.locator('#source-status')).not_to_contain_text('recent flagship and Chrome')
        expect(page.locator('#source-status')).to_contain_text('sealed products for 1 of 3 source sets')
        assert not errors, errors
        browser.close()
    print('Topps browser checks passed. Screenshots: '+str(ARTIFACTS))
finally:
    server.terminate()
    server.wait(timeout=10)
