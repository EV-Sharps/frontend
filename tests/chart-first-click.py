from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet);Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in [1400,390]:
  page=browser.new_page(viewport={'width':width,'height':850});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/auth.js',lambda r:r.fulfill(body=Path('auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;','let ENABLE_AUTH = false;'),content_type='application/javascript'))
  page.route('https://**/*',lambda r:r.fulfill(body='',content_type='application/javascript'))
  page.route('**/api/**',lambda r:r.fulfill(json={'data':[],'games':[],'props':[],'updated':{}}))
  page.goto(f'http://localhost:{server.server_port}/dingers.html');page.wait_for_function("document.getElementById('data-status')?.hidden")
  page.evaluate('''() => {
   const data={player:'test player',homerLogs:{pa:{btwn:[2,3,4],streak:2,med:3,avg:3},bbe:{btwn:[1,2],streak:1,med:2,avg:2}}};
   let selected=[];
   window.testRow={getData:()=>data,select:()=>selected=[testRow]};
   TABLE={getSelectedRows:()=>selected,deselectRow:()=>selected=[],getSelectedData:()=>selected.map(r=>r.getData())};
   document.getElementById('chart').style.display='none';
   rowClick(testRow);
  }''')
  page.wait_for_timeout(1500)
  assert page.locator('#chart .plot-container').count()==1
  assert page.locator('#chart').is_visible()
  assert not errors,errors
  print(width,page.evaluate("({loaded:!!window.Plotly,plots:document.querySelectorAll('#chart .plot-container').length,display:getComputedStyle(document.getElementById('chart')).display,rect:document.getElementById('chart').getBoundingClientRect().toJSON()})"),errors)
  page.close()
 browser.close()
server.shutdown()
