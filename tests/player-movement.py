"""Offline movement popup tests: paired fair value, lazy loading and mobile layout."""
from pathlib import Path
from datetime import datetime, timezone
from tempfile import mkdtemp
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(mkdtemp(prefix='player-movement-'))
NOW = datetime(2026, 10, 30, 19, tzinfo=timezone.utc)
TIMES = ['2026-10-30T16:00:00Z','2026-10-30T17:00:00Z','2026-10-30T18:30:00Z']
ROW = dict(player='test player', game='nyr @ det', prop='sog', handicap='2.5', sport='nhl', dt='2026-10-30', under=False, ouIdx=0, bookOdds={'pn':'200/-250','fd':'220/-280'}, logs=[0,1,3,4])
BASE = dict(day='2026-10-30', updated=TIMES[-1], sport='nhl', status='ok')
PAIRS = [dict(pn=[200,-250], fd=[220,-280], kal=[250,-270]), dict(pn=[180,-230], fd=[200,None], kal=[230,-250]), dict(pn=[150,-190], fd=[180,-220], kal=[200,-220])]

def selection(i=1, **kw):
    return dict(dict(id=f'{i:024x}', event_id='game-1', game=ROW['game'], start='2026-10-31T00:00:00Z', player=ROW['player'], prop='sog', handicap='2.5', side_labels=['Over','Under']), **kw)

HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><script>var API_BASE=location.origin,ACCESS_TOKEN='fixture',SPORT='nhl',RES={};function title(s){return s}function convertProp(s){return s}function oddsDisplay(s){return s}</script><script src="page-performance.js"></script><script src="player-lines.js"></script><script src="player-history.js"></script></head><body style="background:#091521"><button id="open">Open player</button></body></html>'''

def chart(page):
    page.wait_for_function("document.querySelector('.pm-chart')?.data?.length > 0")
    return page.locator('.pm-chart').evaluate('(el)=>({data:el.data,layout:el.layout})')

def open_lines(page, row=ROW):
    page.evaluate('row => { window.row=row; PlayerLines.open(row,[row,{...row,prop:"atgs",handicap:"0.5"}],{player:row.player,formatOdds:s=>s}); }', row)

def fair(page):
    return next(t for t in chart(page)['data'] if t.get('meta',{}).get('fair'))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1280,'height':900})
    page.set_default_timeout(10000)
    page.clock.install(time=NOW)
    errors=[]; requests=[]; pending=[]
    state={'status':200,'hold':False}
    page.on('pageerror',lambda error:errors.append(str(error)))
    def intercept(route):
        url=urlsplit(route.request.url)
        if url.path=='/api/line-movement':
            query={k:v[0] for k,v in parse_qs(url.query).items()}; requests.append(query)
            assert route.request.headers.get('authorization')=='Bearer fixture'
            if state['hold']:
                pending.append(route); return
            if state['status']!=200:
                route.fulfill(status=state['status'],json={'error':'blocked'}); return
            if 'id' not in query:
                prop=query.get('props','sog')
                rows=[selection(),selection(2,handicap='3.5'),selection(3,prop='atgs',handicap='0.5'),selection(4,game='nyr @ bos'),selection(5,start='2026-11-01T00:00:00Z')]
                rows=[r for r in rows if r['prop']==prop]
                route.fulfill(json={**BASE,'rows':rows,'total':len(rows)})
            else:
                idx=int(query['id'],16); side=int(query['side'])
                row=selection(idx,prop='atgs' if idx==3 else 'sog',handicap='0.5' if idx==3 else '3.5' if idx==2 else '2.5')
                points=[dict(ts=ts,observed_at=ts,prices={book:pair[side] for book,pair in pairs.items()}) for ts,pairs in zip(TIMES,PAIRS)]
                route.fulfill(json={**BASE,'selection':{**row,'side':side},'points':points})
        elif url.netloc=='ev-sharps.test':
            asset=ROOT/url.path.lstrip('/')
            if url.path=='/fixture.html': route.fulfill(body=HTML,content_type='text/html')
            elif asset.is_file(): route.fulfill(path=asset)
            else: route.fulfill(status=404,body='')
        else: route.fulfill(status=404,body='')
    page.route('**/*',intercept)
    page.goto('https://ev-sharps.test/fixture.html')
    open_lines(page)
    assert not requests, 'Opening comparison must not download movement'
    page.locator('[data-lines-view="movement"]').click()
    data=chart(page)
    assert len(requests)==3 and all(q['window']=='today' for q in requests)
    assert set(page.locator('[data-pm-line] option').evaluate_all('els=>els.map(el=>el.textContent)'))=={'2.5','3.5'}
    expected=(1/3/(1/3+250/350)+100/320/(100/320+280/380))*50
    assert abs(fair(page)['y'][0]-expected)<1e-10
    assert fair(page)['y'][1] is None
    assert len(data['data'])==4
    assert data['layout']['yaxis']['range'][0]>data['layout']['yaxis']['range'][1]
    assert all(t.get('connectgaps') is False for t in data['data'])
    assert fair(page)['x'][-1]==datetime.fromisoformat(TIMES[-1]).timestamp()*1000
    page.locator('[data-pm-book="fd"]').uncheck()
    pn=fair(page)['y']; assert pn[1] is not None
    expect(page.locator('.pm-reference')).to_contain_text('Single-book reference')
    page.locator('[data-pm-side]').select_option('1')
    assert abs(pn[0]+fair(page)['y'][0]-100)<1e-8
    assert len(requests)==3, 'Book and side changes reuse the captured pairs'
    page.locator('[data-pm-scale]').select_option('probability')
    data=chart(page); assert data['layout']['yaxis']['range'][0]<data['layout']['yaxis']['range'][1]
    page.locator('[data-pm-scale]').select_option('odds')
    page.locator('[data-pm-refresh]').click(); chart(page)
    assert len(requests)==5
    assert not page.locator('[data-pm-book="fd"]').is_checked(), 'Refresh keeps book choices'
    page.screenshot(path=str(ARTIFACTS/'desktop.png'))
    for width in [390,320]:
        page.set_viewport_size({'width':width,'height':844}); page.clock.run_for(300); chart(page)
        popup=page.locator('#player-lines-dialog')
        box=popup.bounding_box(); assert box['x']>=0 and box['x']+box['width']<=width+1
        assert popup.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
        page.screenshot(path=str(ARTIFACTS/f'mobile-{width}.png'))
    page.set_viewport_size({'width':1280,'height':900}); page.clock.run_for(100)
    page.locator('[data-pm-none]').click()
    expect(page.locator('.pm-status')).to_contain_text('Choose books')
    assert page.locator('.pm-chart').count()==0
    page.locator('[data-pm-all]').click(); chart(page)
    page.locator('#player-lines-prop').select_option('atgs'); chart(page)
    assert page.locator('[data-pm-line]').input_value()==f'{3:024x}'
    assert requests[-1]['id']==f'{3:024x}'
    page.locator('[data-lines-view="movement"]').focus(); page.keyboard.press('ArrowRight')
    expect(page.locator('[data-lines-view="depth"]')).to_have_attribute('aria-selected','true')
    page.locator('[data-lines-view="lines"]').click()
    page.keyboard.press('Escape')
    open_lines(page,{**ROW,'handicap':'8.5'}); page.locator('[data-lines-view="movement"]').click()
    expect(page.locator('.pm-status')).to_contain_text('No captured prices')
    assert page.locator('.pm-chart').count()==0
    page.locator('[data-pm-line]').select_option(f'{2:024x}'); chart(page)
    page.keyboard.press('Escape')
    for history in ['NhlHistory','NflHistory','NbaHistory']:
        page.evaluate('({history,row})=>window[history].open(row)',{'history':history,'row':ROW})
        page.locator('[data-history-view="movement"]:visible').click(); chart(page)
        assert not page.locator('.player-history-dialog[open] .nhl-history-ranges').is_visible()
        page.locator('.player-history-dialog[open] [data-history-view="logs"]').click()
        assert page.locator('.pm-chart').count()==0
        page.keyboard.press('Escape')
    open_lines(page); page.locator('[data-lines-view="movement"]').click(); chart(page)
    state['status']=403
    page.locator('[data-pm-refresh]').click()
    expect(page.locator('.pm-status')).to_have_text('Movement requires a Sharp subscription.')
    assert not page.locator('.pm-body').is_visible()
    state['status']=200
    page.locator('[data-pm-refresh]').click(); chart(page)
    state['hold']=True
    page.locator('[data-pm-refresh]').click()
    page.wait_for_function("document.querySelector('.pm-status').textContent.includes('Loading')")
    page.wait_for_timeout(100)
    assert pending
    page.keyboard.press('Escape')
    for route in pending:
        try: route.fulfill(json={**BASE,'selection':selection(),'points':[]})
        except Exception: pass
    page.wait_for_timeout(100)
    assert page.locator('.pm-chart').count()==0
    assert not errors,errors
    browser.close()
print('Player movement browser checks passed:', ARTIFACTS)

# Exercise the real Homer row callback and sidebar, in addition to the dialogs above.
import importlib.util
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
spec = importlib.util.spec_from_file_location('price_history_fixtures', ROOT/'tests'/'price-history.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(fixture.Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page, errors=fixture.new_page(browser,390)
        page.clock.install(time=NOW)
        fixture.setup_hr_page(page, 'dingers', f'http://localhost:{server.server_port}')
        page.evaluate("async () => { await Promise.all(TABLE.getRows().map(row=>row.update({dt:'2026-10-30'}))); }")
        requested=[]
        def homer_movement(route):
            q={k:v[0] for k,v in parse_qs(urlsplit(route.request.url).query).items()}
            requested.append(q)
            player=q.get('query','history alpha')
            item={**selection(), 'player':player,'game':'nyy @ bos','prop':'hr','handicap':'0.5'}
            if 'id' not in q:
                route.fulfill(json={**BASE,'rows':[item],'total':1})
            else:
                points=[dict(ts=ts,observed_at=ts,prices={book:pair[int(q['side'])] for book,pair in pairs.items()}) for ts,pairs in zip(TIMES,PAIRS)]
                route.fulfill(json={**BASE,'selection':item,'points':points})
        page.route('**/api/line-movement?**',homer_movement)
        page.locator('[data-price-fixture="history alpha"]').click()
        assert not requested
        page.locator('#btwn-select').select_option('movement')
        chart(page)
        assert len(requested)==3 and requested[0]['props']=='hr'
        fixture.assert_fits(page.locator('.player-movement'),390)
        page.locator('#btwn-select').select_option('pa')
        assert page.locator('.pm-chart').count()==0
        page.locator('#btwn-select').select_option('movement'); chart(page)
        page.evaluate('closeRightBody()')
        assert page.locator('.pm-chart').count()==0
        assert not errors,errors
        browser.close()
finally:
    server.shutdown(); server.server_close()
print('Homer sidebar Movement integration passed.')
