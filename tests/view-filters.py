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
 for name in ['tds2.html']:
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
   page.evaluate("""async () => {
    // Keep this focused on view/filter integration; capture the rendering inputs.
    const originalTable = TABLE;
    let cards, rows;
    initializeCards = data => { cards = data; };
    TABLE.replaceData = async data => { rows = data; };
    getAverageImplied = () => null;
    RES = {data:[{player:'over',under:false,prop:'attd',bookOdds:{}},{player:'under',under:true,prop:'attd',bookOdds:{}}]};
    for (const [ou, count, under] of [['o',1,false],['u',1,true],['ou',2,null]]) {
     document.getElementById('ou-select').value = ou;
     await changeView('mobile');
     if (cards.length !== count || (count === 1 && cards[0].under !== under)) throw new Error('Wrong mobile rows for '+ou);
     await changeView('table');
     if (rows.length !== count || (count === 1 && rows[0].under !== under)) throw new Error('Wrong table rows for '+ou);
     if (TABLE !== originalTable) throw new Error('View switch rebuilt table');
    }
   }""")
   assert not errors,errors
   print('View switching applies overs/unders/both immediately and reuses the table.')
  finally:
   page.close()
 browser.close()
server.shutdown()
