# Run from the repository root with Python and Playwright installed.
from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import json,re,sys
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet);Thread(target=server.serve_forever,daemon=True).start()
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for name in (sys.argv[1:] or json.loads(Path('tests/performance-tables.json').read_text())):
  page=browser.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(e.stack))
  page.on('request',lambda r:requests.append(r.url))
  page.route('**/auth.js',lambda r:r.fulfill(body=Path('auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;','let ENABLE_AUTH = false;'),content_type='application/javascript'))
  page.route('https://**/*',lambda r:r.fulfill(body='',content_type='application/javascript'))
  payload=[] if name in ['analysis.html','kotc.html'] else {'data':[],'games':[],'props':[],'updated':{},'record':{},'times':{}}
  page.route('**/api/**',lambda r:r.fulfill(json=payload))
  try:
   page.goto(f'http://localhost:{server.server_port}/{name}',wait_until='load')
   page.wait_for_function("document.getElementById('data-status')?.hidden === true",timeout=3500)
   assert page.locator('#custom-view-select').count()==1,'missing shared view selector'
   assert page.locator('#view-select').count()==0,'legacy view selector remains'
   if page.locator('#overlay').count():
    assert page.locator('#overlay #custom-view-select').count()==1,'view selector outside Customize'
   else:
    assert page.locator('#custom-view-select').is_visible(),'header view selector hidden'
   fn=re.search(r'const (fetchProps|fetchMain|fetchDingersData) = createDataRefresh',Path(name).read_text(encoding='utf-8-sig'))[1]
   page.evaluate('''() => {window.replacements=0;const original=TABLE.replaceData.bind(TABLE);TABLE.replaceData=(...args)=>{replacements++;return original(...args)};window.gameButton=document.querySelector('#game-options button');}''')
   page.evaluate(fn+'()')
   assert page.evaluate('replacements')==0,'unchanged response rendered'
   assert page.evaluate("gameButton===document.querySelector('#game-options button')"),'dropdown rebuilt'
   assert not any('plotly-3' in r or 'jspdf' in r for r in requests),'eager optional scripts'
   assert not errors,errors
   if isinstance(payload,dict):
    payload['updated']={'fd':123}
    page.evaluate(fn+'()')
    assert page.evaluate('replacements')==0,'timestamp-only response rendered'
    payload['times']={'test':'19:00'}
    page.evaluate(fn+'()')
    assert page.evaluate('replacements')==1,'changed response did not render'
   assert not errors,errors
   print(name+': PASS',flush=True)
  except Exception as e:
   result={'page':name,'failure':str(e)[:350],'errors':errors,'status':page.locator('#data-status').text_content() if page.locator('#data-status').count() else ''}
   results.append(result);print(result,flush=True)
  page.close()
 browser.close()
server.shutdown()
if results:
 raise SystemExit(f'{len(results)} table checks failed')
