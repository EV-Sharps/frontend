from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet);Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
 page.on('pageerror',lambda e:errors.append(e.stack))
 page.route('**/auth.js',lambda r:r.fulfill(body=Path('auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;','let ENABLE_AUTH = false;'),content_type='application/javascript'))
 page.route('https://**/*',lambda r:r.fulfill(body='',content_type='application/javascript'))
 page.route('**/api/**',lambda r:r.fulfill(json={'data':[],'games':[],'props':[],'updated':{}}))
 page.goto(f'http://localhost:{server.server_port}/dingers.html');page.wait_for_function("document.getElementById('data-status')?.hidden === true")
 page.evaluate('''async () => {
  TABLE.setColumns([...getDingersColumnItems().filter(item=>['player','ev','fairVal','book','kelly'].includes(item.key)).flatMap(item=>item.cols),...getDingersColumnItems().filter(item=>['bookOdds_circa','bookOdds_fd','bookOdds_dk','bookOdds_pn','bookOdds_kal'].includes(item.key)).flatMap(item=>item.cols)]);
  syncOddsSummaryColumns();
  TABLE.clearFilter(true);
  await TABLE.replaceData([
   {player:'Over example',book:'fd',line:500,kelly:0.31,under:false,ev:8.2,fairVal:450,bookOdds:{circa:'470/-620',fd:'+500/-700',dk:'+450/-650',pn:'+470/-690',kal:'+490/-710'},liquidity:{kal:[1200,2500]},links:{fd:'https://example.com/betslip'}},
   {player:'Under example',under:true,ev:5.2,fairVal:-650,bookOdds:{fd:'+500/-600',dk:'+450/-650',pn:'+470/-690',kal:'+490/-710'}},
   {player:'Circa restricted',circa_blurred:true,under:false,ev:8.1,fairVal:450,bookOdds:{circa:'470/-620',fd:'+500/-700'}},
   {player:'Over only',under:false,ev:2,fairVal:450,bookOdds:{fd:'+500',dk:'+450/-650'}},
   {player:'Restricted row',blurred:true,circa_blurred:true,under:false,ev:8.2,fairVal:450,bookOdds:{circa:'470/-620',fd:'+500/-700'}}
  ]);
 }''')
 page.wait_for_timeout(100)
 assert page.locator('.tabulator-row').first.locator('[tabulator-field="bookOdds.kal"] .stacked-odds-line').all_text_contents()==['+490 ($1,200)','-710 ($2,500)']
 assert page.locator('.tabulator-row').first.locator('[tabulator-field="bookOdds.kal"]').bounding_box()['width']>=110
 assert not page.evaluate("TABLE.getColumn('fairVal').isVisible()")
 assert not page.evaluate("TABLE.getColumn('book').isVisible()")
 assert '+500' in page.locator('.tabulator-row').first.locator('.stacked-player-summary .evbook-cell').inner_text()
 assert 'FV +450' in page.locator('.tabulator-row').first.locator('[tabulator-field="ev"]').inner_text()
 print('stacked',page.locator('.tabulator-row').first.bounding_box())
 assert page.locator('.tabulator-row').first.bounding_box()['height']==42
 first=page.locator('.tabulator-row').first.locator('[tabulator-field="bookOdds.fd"]')
 assert first.locator('.stacked-odds-line').count()==2
 assert first.locator('.odds-positive').inner_text().replace('\n','')=='+500'
 assert first.locator('a').get_attribute('href')=='https://example.com/betslip'
 assert page.locator('.tabulator-row').filter(has_text='Over only').locator('[tabulator-field="bookOdds.fd"] .stacked-odds-line').nth(1).inner_text().replace('\n','')=='-'
 assert page.locator('.tabulator-row').filter(has_text='Under example').locator('[tabulator-field="bookOdds.fd"] .odds-positive').inner_text().replace('\n','')=='-600'
 assert page.locator('.tabulator-row').filter(has_text='Restricted row').locator('[tabulator-field="bookOdds.fd"] .blurred').count()==1
 assert page.locator('.tabulator-row').filter(has_text='Circa restricted').locator('[tabulator-field="bookOdds.circa"] .blurred').count()==1
 assert page.locator('.tabulator-row').filter(has_text='Circa restricted').locator('[tabulator-field="bookOdds.fd"] .blurred').count()==0
 assert page.locator('.stacked-odds-side').count()==0
 assert page.locator('.tabulator-row').first.locator('[tabulator-field="bookOdds.circa"] .stacked-odds-line').all_text_contents()==['+470','-620']
 page.evaluate("localStorage.setItem('odds_format','decimal'); TABLE.getRows().forEach(r=>r.reformat())")
 assert '6.00' in first.inner_text()
 page.evaluate("localStorage.removeItem('odds_format'); TABLE.getRows().forEach(r=>r.reformat())")
 page.evaluate('RES = null; openOverlay()')
 page.locator('#custom-view-select').select_option('compact')
 page.wait_for_timeout(100)
 assert page.evaluate("TABLE.getColumn('fairVal').isVisible()")
 assert page.evaluate("TABLE.getColumn('book').isVisible()")
 assert page.locator('.stacked-player-summary').count()==0
 assert page.locator('.stacked-ev-summary').count()==0
 print('compact',page.locator('.tabulator-row').first.bounding_box())
 assert page.locator('.tabulator-row').first.bounding_box()['height']<=26
 assert first.locator('.stacked-odds-stack').count()==0
 assert '+500/-700' in first.inner_text().replace('\n','')
 page.locator('#custom-view-select').select_option('table')
 page.wait_for_timeout(100)
 assert page.locator('.tabulator-row').first.bounding_box()['height']==42
 page.evaluate('RES = null; openOverlay()')
 page.locator('#custom-view-select').select_option('compact')
 page.reload()
 page.wait_for_function("document.getElementById('data-status')?.hidden === true")
 assert page.locator('#custom-view-select').input_value()=='compact'
 assert 'stacked-odds' not in (page.locator('#table').get_attribute('class') or '')
 page.evaluate('openOverlay()')
 page.locator('#custom-view-select').select_option('mobile')
 assert page.locator('#card-container').is_visible()
 assert not page.locator('#table').is_visible()
 page.locator('#custom-view-select').select_option('table')
 assert page.locator('#table').is_visible()
 assert page.locator('#overlay #custom-view-select').count()==1
 assert page.locator('.stacked-odds-toolbar').count()==0
 assert not errors,errors
 print('Stacked/compact layout, highlights, missing under price, and betslip link passed.')
 browser.close()
server.shutdown()
