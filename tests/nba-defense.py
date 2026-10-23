"""Exercise staged NBA pages with real table/card code and offline DVP fixtures."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import tempfile
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--overlay',type=Path,default=Path(__file__).resolve().parents[1])
args=parser.parse_args()
artifacts=Path(tempfile.gettempdir())

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*values):pass
    def translate_path(self,path):
        relative=unquote(urlparse(path).path).lstrip('/')
        for directory in (args.overlay,args.root):
            target=(directory/relative).resolve()
            if target.is_relative_to(directory.resolve()) and target.is_file():return str(target)
        return str(args.root/'_missing')

def fixture(page):
    prop='3ptm' if page=='threes' else 'fb' if page=='fb' else 'pts'
    base={'prop':prop,'dt':'2099-10-22','team':'phi','pos':'PG','sport':'nba','handicap':.5,'under':False,
          'book':'fd','line':150,'bookOdds':{'fd':'150/-175','pn':'130/-155','circa':'135/-160'},
          'liquidity':{},'logs':[0,1,2],'hitRate':66,'hitRateLYR':50,'avgMin':30,'teamTotal':115,'oppRank':10}
    rows=[dict(base,id=1,player='known guard',opp='gsw',game='phi @ gsw',dvpPosition='G'),
          dict(base,id=2,player='zero guard',opp='ny',game='phi @ ny',dvpPosition='G'),
          dict(base,id=3,player='unknown guard',opp='bos',game='phi @ bos',oppPosRank=28),
          dict(base,id=4,player='locked guard',opp='gsw',game='phi @ gsw',blurred=True),
          dict(base,id=5,player='zero minute guard',opp='mia',game='phi @ mia',dvpPosition='G',
               dvpRank=1,dvpAllowed=0,dvpAllowed36=0,dvpMinutes=0,dvpRankBasis='per_36',dvpGames=2),
          dict(base,id=6,player='legacy guard',opp='bos',game='phi @ bos',dvpPosition='G',dvpRank=28,dvpAllowed=26.5,dvpGames=2)]
    return {'data':rows,'props':[prop],'games':['phi @ gsw','phi @ ny','phi @ bos','phi @ mia'],'updated':{},
      'times':{row['game']:'2099-10-22T23:00:00Z' for row in rows},'defenseVsPosition':{
        'schema_version':2,'rank_basis':'per_36','season':'2026-27','as_of':'2026-10-22','window':'season','season_type':'regular','position_basis':'source_groups','partial':True,
        'team_aliases':{'gsw':'gs'},'position_aliases':{'PG':'G'},'prop_metrics':{prop:prop},
        'data':{'gs':{'G':{'games':2,'minutes':180,'per_game':{prop:26.5},'per_36':{prop:10.6},'ranks':{prop:3},'ranked_teams_by_metric':{prop:4}}},
                'ny':{'G':{'games':2,'minutes':180,'per_game':{prop:0},'per_36':{prop:0},'ranks':{prop:1},'ranked_teams_by_metric':{prop:4}}}}}}

server=ThreadingHTTPServer(('127.0.0.1',0),Quiet)
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--disable-logging',f'--log-file={artifacts/"nba-defense-browser.log"}'])
        for name in ('nba','pts','threes'):
            cases=[('compact',1440),('mobile',390)]+([('table',320)] if name=='nba' else [])
            for view,width in cases:
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
                page.wait_for_function(f"document.getElementById('data-status')?.hidden === true && {count} === 6")
                assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()"),(name,view)
                assert page.evaluate("TABLE.getColumn('dvpAllowed36').isVisible()"),(name,view)
                assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpGames').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpMinutes').isVisible()")
                assert page.evaluate("RES.data.find(row=>row.player==='known guard').dvpPosition")=='G'
                assert page.evaluate("RES.data.find(row=>row.player==='known guard').dvpRankBasis")=='per_36'
                if view=='mobile':
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length===6")
                    assert page.locator('#card-container .nba-defense-card').count()==10
                    assert page.locator('#card-container .nba-defense-card .nba-defense-value').count()==4
                    card=page.locator('#card-container .data-card').filter(has=page.locator('.nba-defense-value')).first
                    card.locator('.card-arrow-container').click()
                    card.locator('.nba-defense-value').first.click()
                    assert page.locator('#nba-defense-dialog').is_visible()
                    assert 'vs guards' in page.locator('#nba-defense-dialog p').inner_text()
                    assert 'expanded' in card.get_attribute('class'),'Opening DVP details must not collapse the mobile card'
                    assert 'per 36 minutes' in page.locator('#nba-defense-dialog p').inner_text()
                    if name=='nba':page.screenshot(path=str(artifacts/'nba-dvp36-mobile.png'))
                    page.locator('#nba-defense-dialog button').click()
                    page.evaluate("changeView('compact')")
                page.evaluate("TABLE.showColumn('dvpAllowed');TABLE.showColumn('dvpGames');TABLE.showColumn('dvpMinutes');TABLE.clearSort();")
                page.wait_for_function("[...document.querySelectorAll('.tabulator-cell[tabulator-field=\"dvpAllowed\"]')].some(el=>el.textContent.includes('26.5'))")
                assert page.locator('.tabulator-cell[tabulator-field="dvpAllowed"]').all_text_contents().count('0pts/g' if name!='threes' else '03PM/g')==1
                assert page.locator('.tabulator-cell[tabulator-field="dvpAllowed36"]').all_text_contents().count('0pts/36' if name!='threes' else '03PM/36')==1
                assert page.locator('.tabulator-cell[tabulator-field="dvpAllowed36"] .nba-defense-empty').count()==4
                assert page.locator('.tabulator-cell[tabulator-field="dvpMinutes"] .nba-defense-value').count()==2
                details=page.locator('.tabulator-cell[tabulator-field="dvpRank"] .nba-defense-value').first
                assert details.inner_text()=='3rd','Position rank must show only its ordinal rank'
                assert details.locator('small').count()==0,'Position/sample context belongs in hover or tap details'
                assert page.evaluate("TABLE.getColumn('dvpRank').getWidth()===50 && TABLE.getColumn('oppRank').getWidth()===50"),(name,view)
                rank_colors=page.evaluate("""() => TABLE.getRows().filter(row=>NbaDefense.value(row.getData(),'dvpRank')!=null).map(row=>{
                    const rank=NbaDefense.value(row.getData(),'dvpRank'),strong=row.getCell('dvpRank').getElement().querySelector('strong');
                    const expected=document.createElement('span'); expected.style.color=getTDsOppRankColor(rank);
                    return [getComputedStyle(strong).color,expected.style.color];
                })""")
                assert len(rank_colors)==2 and all(actual==expected for actual,expected in rank_colors),(name,view,rank_colors)
                title=details.get_attribute('title')
                assert 'vs guards' in title and '10.6 allowed per 36 minutes' in title and '26.5 allowed per game' in title
                assert '2 completed regular-season games' in title and '180 combined actual minutes' in title
                assert details.get_attribute('aria-label')==title
                assert 'nba-defense-early' in details.get_attribute('class')
                assert details.evaluate('el=>el.scrollWidth <= el.closest(".tabulator-cell").clientWidth'),'Compact rank must fit its column'
                if name=='nba' and view=='compact':page.screenshot(path=str(artifacts/'nba-dvp36-compact.png'))
                details.scroll_into_view_if_needed();details.click()
                assert page.locator('#nba-defense-dialog').is_visible()
                text=page.locator('#nba-defense-dialog p').inner_text()
                assert 'vs guards' in text and 'Ties share a rank' in text and 'Early sample' in text and 'incomplete coverage' in text
                assert '10.6 allowed per 36 minutes' in text and '180 combined actual minutes' in text and 'not an assumed playing time' in text
                if name=='nba' and view=='compact':page.screenshot(path=str(artifacts/'nba-dvp36-desktop.png'))
                page.locator('#nba-defense-dialog button').click()
                if name=='nba':
                    header=page.locator('.tabulator-header [tabulator-field="dvpRank"]')
                    assert round(header.bounding_box()['width'])==50
                    assert header.locator('.tabulator-col-title').evaluate('el=>el.scrollWidth<=el.clientWidth'),'Position-rank header must fit 50px'
                    height=page.locator('.tabulator-header').bounding_box()['height']
                    page.evaluate("async()=>{await TABLE.getColumn('dvpRank').updateDefinition({title:'Opp<br>Rank'});TABLE.redraw(true);}")
                    baseline=page.locator('.tabulator-header').bounding_box()['height']
                    assert height<=baseline+1,(view,height,baseline)
                    page.evaluate("async()=>{await TABLE.getColumn('dvpRank').updateDefinition({title:'Vs Pos<br>Rank'});TABLE.redraw(true);}")
                    if width==320:
                        details.scroll_into_view_if_needed()
                        page.screenshot(path=str(artifacts/'nba-dvp-rank-table-320.png'))
                    print('NBA header',view,width,'height',height,'Opp Rank baseline',baseline,flush=True)
                    assert page.evaluate("buildNbaColumns(['player','oppPosRank','opp']).filter(column=>column.field==='dvpRank').length")==1
                for direction,expected in [('asc',['zero guard','known guard']),('desc',['known guard','zero guard'])]:
                    page.evaluate('direction=>TABLE.setSort("dvpAllowed36",direction)',direction)
                    assert page.evaluate("TABLE.getData('active').map(row=>row.player)")[:2]==expected
                page.evaluate("""() => {ENABLE_AUTH=true;CURR_USER={metadata:{[PAGE]:['player','oppPosRank']}};showHideUserTable(true);}""")
                assert page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpAllowed36').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpAllowed').isVisible()")
                assert not page.evaluate("TABLE.getColumn('dvpMinutes').isVisible()")
                page.evaluate("CURR_USER.metadata[PAGE]=['player'];showHideUserTable(true)")
                assert not page.evaluate("TABLE.getColumn('dvpRank').isVisible()")
                if view=='mobile':
                    page.evaluate("changeView('mobile')")
                    page.wait_for_function("document.querySelectorAll('#card-container .data-card').length===6")
                    assert page.locator('#card-container .nba-defense-card').count()==0
                assert errors==[],(name,view,errors)
                page.close()
                print(name,view,'passed',flush=True)
        browser.close()
finally:
    server.shutdown();server.server_close()
