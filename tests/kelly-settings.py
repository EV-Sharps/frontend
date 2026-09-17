from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet)
Thread(target=server.serve_forever,daemon=True).start()
base=f'http://localhost:{server.server_port}'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(e.stack))
 def external(r):
  r.fulfill(body='window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})};' if 'supabase-js' in r.request.url else '',content_type='application/javascript')
 page.route('https://**/*',external)
 page.route('**/api/**',lambda r:r.fulfill(json={'data':[],'games':[],'props':[],'updated':{}}))
 page.goto(base+'/tds.html')
 page.wait_for_function("document.getElementById('data-status')?.hidden === true")
 assert page.evaluate("""() => {
  const column = TABLE.getColumn('kelly');
  const button = column.getElement().querySelector('.kelly-fraction-button');
  const title = button.parentElement;
  return column.getWidth() >= 65 && getComputedStyle(button).whiteSpace === 'nowrap' && button.getBoundingClientRect().width <= title.clientWidth;
 }""")
 assert page.evaluate('getKelly(200,10)')==1.25
 assert page.evaluate('getKelly(-200,10)')==5
 page.locator('.tabulator-col-title .kelly-fraction-button').click()
 page.locator('#page-kelly-fraction').select_option('0.125')
 page.locator('#kelly-settings button[type=submit]').click()
 page.wait_for_function("!document.getElementById('kelly-settings').open")
 assert page.evaluate('getKelly(200,10)')==0.625
 assert page.evaluate('getKelly(-200,10)')==2.5
 assert page.evaluate('formatKellyValue(getKelly(200,10))')=='0.63u'
 assert page.evaluate('KELLY_DOLLARS=true; formatKellyValue(getKelly(200,10))')=='$62.50'
 assert page.evaluate('getProfileKellyFraction()')==0.25
 page.reload();page.wait_for_function("document.getElementById('data-status')?.hidden === true")
 assert page.evaluate('getKellyFraction()')==0.125
 page.goto(base+'/nfl.html');page.wait_for_function("document.getElementById('data-status')?.hidden === true")
 assert page.evaluate('getKellyFraction()')==0.25
 page.locator('.tabulator-col-title .kelly-fraction-button').click()
 page.locator('#page-kelly-fraction').select_option('custom')
 page.locator('#page-kelly-custom').fill('10')
 page.locator('#kelly-settings button[type=submit]').click()
 page.wait_for_function("!document.getElementById('kelly-settings').open")
 assert page.evaluate('getKelly(200,10)')==0.5
 assert page.evaluate('kellyFractionLabel()')=='10%'
 assert page.evaluate('validKellyFraction(0)||validKellyFraction(-1)||validKellyFraction(2)||validKellyFraction("bad")')==False
 # Verify the actual filter-to-card path updates stored sizing, not just labels.
 page.evaluate("""async () => {
  RES={data:[{player:'test player',team:'buf',opp:'mia',game:'buf @ mia',sport:'nfl',prop:'rec_yd',handicap:50.5,under:false,logs:[],bookOdds:{fd:'+200/-250',dk:'+180/-220',pn:'+150/-180'}}]};
  await changeView('mobile');
  window.previousKelly=RES.data[0].kelly;
 }""")
 assert page.evaluate('previousKelly > 0')
 assert page.locator('.data-card .kelly-fraction-button').count()==1
 page.locator('.data-card .kelly-fraction-button').click()
 page.locator('#page-kelly-fraction').select_option('0.0625')
 page.locator('#kelly-settings button[type=submit]').click()
 page.wait_for_function("!document.getElementById('kelly-settings').open")
 assert abs(page.evaluate('RES.data[0].kelly / previousKelly')-0.625)<1e-9
 assert page.locator('.data-card .kelly-fraction-button').inner_text()==page.evaluate('kellyFractionLabel()+" Kelly"')
 # Save a profile default using a stubbed write, without contacting Supabase.
 page.goto(base+'/profile.html');page.wait_for_function("document.getElementById('profile-kelly-fraction').options.length > 0")
 page.evaluate('''() => {
  CURR_USER={id:'test-user',metadata:{unit_size:100,existing:'preserved'}};
  SB={from:()=>({update:payload=>({eq:async()=>{window.savedProfile=payload.metadata;return {error:null};}})})};
  loadProfileKellyFields();
 }''')
 page.locator('#profile-kelly-fraction').select_option('0.0625')
 page.evaluate('saveKellyFraction()')
 assert page.evaluate('savedProfile.kelly_fraction')==0.0625
 assert page.evaluate('savedProfile.existing')=='preserved'
 assert page.evaluate('getProfileKellyFraction()')==0.0625
 page.evaluate("SB.from=()=>({update:()=>({eq:async()=>({error:{message:'failed'}})})})")
 page.locator('#profile-kelly-fraction').select_option('1')
 page.evaluate('saveKellyFraction()')
 assert page.evaluate('getProfileKellyFraction()')==0.0625
 assert 'Could not save' in page.locator('#kelly-save-status').inner_text()
 # Returning to the default must use the latest profile value, not the prior override.
 page.evaluate("PAGE='nfl'; SPORT='nfl'; openKellySettings()")
 page.locator('#page-kelly-fraction').select_option('default')
 page.locator('#kelly-settings button[type=submit]').click()
 page.wait_for_function("!document.getElementById('kelly-settings').open")
 assert page.evaluate('getKelly(200,10)')==0.3125
 assert not errors,errors
 print('Kelly fractions, units/dollars, page isolation, persistence, custom validation, profile save/failure, and default reset passed.')
 browser.close()
server.shutdown()
