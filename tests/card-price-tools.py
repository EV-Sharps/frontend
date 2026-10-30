"""Mobile card shortcuts, estimated NHL goals and direct price-tool dialogs."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from tempfile import mkdtemp
from urllib.parse import urlsplit, parse_qs
import importlib.util
import sys
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=10000)
ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=Path(mkdtemp(prefix='card-price-tools-'))
def module(name, filename):
    spec=importlib.util.spec_from_file_location(name, ROOT/'tests'/filename)
    result=importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
fixtures=module('prediction_fixture','prediction-depth.py')
scorer=module('scorer_fixture','scorer-depth.py')
server=ThreadingHTTPServer(('127.0.0.1',0),partial(fixtures.Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--disable-logging',f'--log-file={ARTIFACTS/"chromium.log"}'])
        for name,sport,prop in [('atgs','nhl','atgs'),('nhl','nhl','sog'),('atgs2','nhl','atgs'),('fgs','nhl','fgs'),('tds','nfl','attd'),('dingers2','mlb','hr')]:
            if len(sys.argv)>1 and name not in sys.argv[1:]: continue
            page,errors=fixtures.new_page(browser,f'http://localhost:{server.server_port}',name)
            page.set_viewport_size({'width':390,'height':844})
            payload=scorer.fixture(sport,prop,'tor @ bos')
            row=payload['data'][0]
            row.update(teamTotal=3.42, avgTOI=17, implied=22, oppRank=8, book='fd',line=400)
            row['bookOdds'].update(fd='400/-550',pn='350/-450')
            row['liquidity']={'nv':[20,80],'kal':[30,70],'px':[40,60]}
            if prop!='atgs' or name=='atgs2':
                if name=='atgs2': row['handicap']='1.5'
            requests=[]
            def api(route):
                url=urlsplit(route.request.url); q={k:v[0] for k,v in parse_qs(url.query).items()}
                if url.path.endswith('-depth'):
                    requests.append(('depth',q))
                    route.fulfill(json=dict(schemaVersion=1,sport=sport,**q,entry=scorer.entry(q['book'])))
                elif url.path=='/api/line-movement':
                    requests.append(('movement',q))
                    selection=dict(id='a'*24,player=row['player'],game=row['game'],prop=row['prop'],handicap=row['handicap'],start=scorer.START,event_id='fixture',side_labels=['Over','Under'])
                    base=dict(day='2026-10-28',updated=scorer.UPDATED,sport=sport)
                    if 'id' not in q: route.fulfill(json=dict(base,rows=[selection],total=1))
                    else:
                        side=int(q['side'])
                        points=[dict(ts=stamp,observed_at=stamp,prices={'pn':pair[side],'fd':other[side]}) for stamp,pair,other in [('2026-10-28T17:00:00Z',[350,-450],[400,-550]),(scorer.UPDATED,[300,-400],[350,-450])]]
                        route.fulfill(json=dict(base,selection={**selection,'side':side},points=points))
                else: route.fulfill(json=payload)
            page.route('**/api/**',api)
            fixtures.install_rows(page,payload)
            page.evaluate('''() => { DEVIG='pn'; WEIGHT='1'; DEVIG_EXCLUDED=[]; initializeCards([RES.data[0]]); CURRENT_VIEW='mobile'; applyOddsTableView(); }''')
            card=page.locator('#card-container .data-card').first
            expect(card).to_be_visible()
            expect(card.locator('[data-card-detail]')).to_have_count(2)
            assert not requests,'Cards must not fetch detail data until requested'
            if name=='atgs':
                page.wait_for_function("[...document.querySelectorAll('#card-container .book-logo-small')].every(img=>img.complete && img.naturalWidth>0)")
                expect(card.locator('.nv-depth-card-trigger')).to_have_count(3)
                for book in ['nv','kal','px']:
                    tile=card.locator('.book-odd-item').filter(has=page.locator(f'.book-logo-small[alt="{book}"]'))
                    icon=tile.locator('.nv-depth-card-trigger')
                    logo=tile.locator('.book-logo-small')
                    ib,lb=icon.bounding_box(),logo.bounding_box()
                    assert ib['width']==24 and ib['height']==24
                    assert ib['x']>=lb['x']+lb['width'] and abs(ib['y']-lb['y'])<=4
                    assert ib['y']+ib['height']<=tile.locator('.book-odd-value').bounding_box()['y']+1
                was=card.get_attribute('class')
                card.locator('[data-depth-book="nv"]').click()
                expect(page.locator('#novig-depth-dialog')).to_be_visible()
                assert card.get_attribute('class')==was
                expect(page.locator('.nv-depth-chart-row')).to_have_count(2)
                page.locator('.nv-depth-close').click()
            # The NHL team estimate follows the existing Game/ranks presentation.
            if 'expanded' not in card.get_attribute('class'): card.locator('.card-arrow-container').click()
            if sport=='nhl':
                expect(card.locator('.nhl-team-total strong')).to_have_text('3.42')
                expect(card.locator('.nhl-team-total')).to_be_visible()
                assert card.locator('.nhl-team-total').evaluate('el=>el.previousElementSibling.classList.contains("card-game-pill")')
            else: assert card.locator('.nhl-team-total').count()==0
            if name=='atgs':
                for width in [390,320]:
                    page.set_viewport_size({'width':width,'height':844})
                    assert card.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    page.screenshot(path=str(ARTIFACTS/f'nhl-card-{width}.png'))
            # A legacy card page does not preload PlayerLines; clicking loads it once.
            if name=='dingers2': assert page.evaluate('typeof PlayerLines')=='undefined'
            before=card.get_attribute('class')
            card.locator('[data-card-detail="movement"]').click()
            expect(page.locator('[data-lines-view="movement"]')).to_have_attribute('aria-selected','true')
            page.wait_for_function("document.querySelector('.pm-chart')?.data?.some(t=>t.meta?.fair)")
            assert card.get_attribute('class')==before
            page.keyboard.press('Escape')
            assert page.locator('.pm-chart').count()==0
            card.locator('[data-card-detail="depth"]').click()
            expect(page.locator('[data-lines-view="depth"]')).to_have_attribute('aria-selected','true')
            try: expect(page.locator('.prediction-depth-book')).to_have_count(2)
            except AssertionError:
                print('Order book load failure:',page.locator('#player-lines-dialog').inner_text(),errors)
                raise
            expect(page.locator('.prediction-depth-odds').first).to_be_visible()
            assert card.get_attribute('class')==before
            page.keyboard.press('Escape')
            assert page.locator('.prediction-depth').count()==0
            if name=='atgs':
                # Regenerating card contents must preserve the shortcuts without duplicates.
                page.evaluate("() => { RES.data[0].teamTotal=3.8; updateExistingCard(document.querySelector('#card-container .data-card'),RES.data[0]); }")
                expect(card.locator('.nhl-team-total strong')).to_have_text('3.80')
                expect(card.locator('[data-card-detail]')).to_have_count(2)
                expect(card.locator('.book-odd-heading .nv-depth-trigger')).to_have_count(3)
                page.evaluate("() => { RES.data[0].teamTotal=null; updateExistingCard(document.querySelector('#card-container .data-card'),RES.data[0]); }")
                expect(card.locator('.nhl-team-total strong')).to_have_text('-')
                page.evaluate('showCardModal(RES.data[0])')
                modal=page.locator('#card-modal-inner .data-card')
                modal.locator('[data-card-detail="depth"]').click()
                expect(page.locator('[data-lines-view="depth"]')).to_have_attribute('aria-selected','true')
                expect(page.locator('.prediction-depth-book')).to_have_count(2)
                page.keyboard.press('Escape')
                assert page.locator('#card-modal-overlay').is_visible()
                page.evaluate('closeCardModal()')
            assert not errors,errors
            page.close()
            print(name,': card actions, correct dialogs, team goals and mobile layout passed',flush=True)
        browser.close()
finally:
    server.shutdown();server.server_close()
print('Screenshots:',ARTIFACTS)
