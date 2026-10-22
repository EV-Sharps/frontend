"""Exercise staged NBA pages with real table/card code and offline DVP fixtures."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--overlay',type=Path,default=Path(__file__).resolve().parents[1])
args=parser.parse_args()

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*values):pass
    def translate_path(self,path):
        relative=unquote(urlparse(path).path).lstrip('/')
        for directory in (args.overlay,args.root):
            target=(directory/relative).resolve()
            if target.is_relative_to(directory.resolve()) and target.is_file():return str(target)
        return str(args.root/'_missing')

def fixture(page):
    prop='3ptm' if page=='threes' else 'pts'
    base={'prop':prop,'dt':'2099-10-22','team':'phi','pos':'PG','sport':'nba','handicap':.5,'under':False,
          'book':'fd','line':150,'bookOdds':{'fd':'150/-175','pn':'130/-155','circa':'135/-160'},
          'liquidity':{},'logs':[0,1,2],'hitRate':66,'hitRateLYR':50,'avgMin':30,'teamTotal':115,'oppRank':10}
    rows=[dict(base,id=1,player='known guard',opp='gsw',game='phi @ gsw',dvpPosition='G'),
          dict(base,id=2,player='zero guard',opp='ny',game='phi @ ny',dvpPosition='G'),
          dict(base,id=3,player='unknown guard',opp='bos',game='phi @ bos',oppPosRank=28),
          dict(base,id=4,player='locked guard',opp='gsw',game='phi @ gsw',blurred=True)]
    return {'data':rows,'props':[prop],'games':['phi @ gsw','phi @ ny','phi @ bos'],'updated':{},
      'times':{row['game']:'2099-10-22T23:00:00Z' for row in rows},'defenseVsPosition':{
        'season':'2026-27','as_of':'2026-10-22','window':'season','season_type':'regular','position_basis':'source_groups','partial':True,
        'team_aliases':{'gsw':'gs'},'position_aliases':{'PG':'G'},'prop_metrics':{prop:prop},
        'data':{'gs':{'G':{'games':2,'per_game':{prop:26.5},'ranks':{prop:3},'ranked_teams_by_metric':{prop:4}}},
                'ny':{'G':{'games':2,'per_game':{prop:0},'ranks':{prop:1},'ranked_teams_by_metric':{prop:4}}}}}}

server=ThreadingHTTPServer(('127.0.0.1',0),Quiet)
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        for name in ('nba','pts','threes'):
            for view,width in (('compact',1440),('mobile',390)):
                page=browser.new_page(viewport={'width':width,'height':900},has_touch=True)
                page.set_default_timeout(8000)
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.add_init_script('window.EventSource=undefined;')
                page.route('https://**/*',lambda route:route.fulfill(body='',content_type='application/javascript'))
                page.route('**/auth.js',lambda route:route.fulfill(body=(args.root/'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;','let ENABLE_AUTH = false;'),content_type='application/javascript'))
                page.route('**/record_*.js',lambda route:route.fulfill(body="let RECORD_UPD=''; let RECORD={worst:{best:{}}};",content_type='application/javascript'))
                page.route('**/api/**',lambda route:route.fulfill(json=fixture(name)))
                page.goto(f'http://localhost:{server.server_port}/{name}.html?view={view}&devig=pn-circa&weight=1-1')
                count="document.querySelectorAll('#card-container .data-card').length" if view=='mobile' else "TABLE?.getData().length"
                page.wait_for_function(f"document.getElementById('data-status')?.hidden === true && {count} === 4")
                assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()"),(name,view)
                assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpGames').isVisible()")
                assert page.evaluate("RES.data.find(row=>row.player==='known guard').dvpPosition")=='G'
                if view=='mobile':
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length===4")
                    assert page.locator('#card-container .nba-defense-card').count()==3
                    card=page.locator('#card-container .data-card').filter(has=page.locator('.nba-defense-value')).first
                    card.locator('.card-arrow-container').click()
                    card.locator('.nba-defense-value').first.click()
                    assert page.locator('#nba-defense-dialog').is_visible()
                    assert 'vs guards' in page.locator('#nba-defense-dialog p').inner_text()
                    assert 'expanded' in card.get_attribute('class'),'Opening DVP details must not collapse the mobile card'
                    if name=='nba':page.screenshot(path=str(args.overlay/'nba-dvp-mobile.png'))
                    page.locator('#nba-defense-dialog button').click()
                    page.evaluate("changeView('compact')")
                page.evaluate("TABLE.showColumn('dvpAllowed');TABLE.showColumn('dvpGames');TABLE.clearSort();")
                page.wait_for_function("[...document.querySelectorAll('.tabulator-cell[tabulator-field=\"dvpAllowed\"]')].some(el=>el.textContent.includes('26.5'))")
                assert page.locator('.tabulator-cell[tabulator-field="dvpAllowed"]').all_text_contents().count('0pts/g' if name!='threes' else '03PM/g')==1
                details=page.locator('.tabulator-cell[tabulator-field="dvpRank"] .nba-defense-value').first
                assert details.locator('small').is_visible(),'Compact rank must show its position and sample'
                assert details.locator('small').inner_text()=='G · 2g'
                assert 'nba-defense-early' in details.get_attribute('class')
                assert details.locator('small').evaluate('el=>getComputedStyle(el).fontWeight')=='700'
                assert details.evaluate('el=>el.scrollWidth <= el.closest(".tabulator-cell").clientWidth'),'Compact rank must fit its column'
                if name=='nba' and view=='compact':page.screenshot(path=str(args.overlay/'nba-dvp-compact.png'))
                details.scroll_into_view_if_needed();details.click()
                assert page.locator('#nba-defense-dialog').is_visible()
                text=page.locator('#nba-defense-dialog p').inner_text()
                assert 'vs guards' in text and 'Ties share a rank' in text and 'Early sample' in text and 'incomplete coverage' in text
                if name=='nba' and view=='compact':page.screenshot(path=str(args.overlay/'nba-dvp-desktop.png'))
                page.locator('#nba-defense-dialog button').click()
                if name=='nba':
                    assert page.evaluate("buildNbaColumns(['player','oppPosRank','opp']).filter(column=>column.field==='dvpRank').length")==1
                for direction,expected in [('asc',['zero guard','known guard']),('desc',['known guard','zero guard'])]:
                    page.evaluate('direction=>TABLE.setSort("dvpAllowed",direction)',direction)
                    assert page.evaluate("TABLE.getData('active').map(row=>row.player)")[:2]==expected
                page.evaluate("""() => {ENABLE_AUTH=true;CURR_USER={metadata:{[PAGE]:['player','oppPosRank']}};showHideUserTable(true);}""")
                assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
                page.evaluate("CURR_USER.metadata[PAGE]=['player'];showHideUserTable(true)")
                assert not page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
                if view=='mobile':
                    page.evaluate("changeView('mobile')")
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length===4")
                    assert page.locator('#card-container .nba-defense-card').count()==0
                assert errors==[],(name,view,errors)
                page.close()
                print(name,view,'passed',flush=True)
        browser.close()
finally:
    server.shutdown();server.server_close()
