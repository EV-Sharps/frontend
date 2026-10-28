"""Offline Sharp Money page tests with API interception; no production requests.

python tests/sharp-money.py [--frontend PATH] [--overlay PATH]
"""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import mkdtemp
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect


NOW = datetime(2026, 10, 28, 18, tzinfo=timezone.utc)
START = (NOW + timedelta(hours=5)).isoformat()


def venue(book, support, probability=.12):
    opposite = support * (1 - probability) / probability
    return dict(book=book, supportStake=support, oppositeStake=opposite,
        weightedOdds=100 * (1 - probability) / probability, priceAdvantagePct=8,
        updated=(NOW-timedelta(seconds=40)).isoformat(),
        expiresAt=(NOW+timedelta(minutes=4)).isoformat(), levels=2)


def offer(book='fd', odds=800, support=300, probability=.12, venues=None):
    venues = venues or [venue('kal', support, probability)]
    return dict(book=book, odds=odds, url='https://example.com/selection',
        updated=(NOW-timedelta(seconds=45)).isoformat(), expiresAt=(NOW+timedelta(minutes=4)).isoformat(),
        supportStake=support, oppositeStake=support * (1-probability) / probability,
        weightedOdds=100*(1-probability)/probability, priceAdvantagePct=8, venues=venues,
        history=dict(firstSeen=(NOW-timedelta(minutes=4)).isoformat(),lastSeen=NOW.isoformat(),observations=3,
            firstOdds=750,firstSupportStake=125,points=[dict(at=(NOW-timedelta(minutes=offset)).isoformat(),
                odds=odds,supportStake=amount,priceAdvantagePct=8) for offset,amount in [(4,125),(2,225),(0,support)]]))


def sample():
    base=dict(id='nhl-ryan-over',sport='nhl',prop='atgs',game='tor @ sea',player='ryan winterton',
              side='over',line=.5,startsAt=START,offers=[
                  offer(venues=[venue('kal',200),venue('nv',100)]),offer('dk',900,75)])
    nfl=dict(base,id='nfl-receiver',sport='nfl',prop='attd',game='car @ gb',player='test receiver',offers=[
        offer('fd',200,250,.36),dict(offer('dk',250,150,.32),url='javascript:alert(1)')])
    mlb=dict(base,id='mlb-hitter',sport='mlb',prop='hr',game='mil @ tb',player='test hitter',offers=[
        offer('fd',400,200,.22),dict(offer('mgm',1000,1000),expiresAt=(NOW-timedelta(seconds=1)).isoformat()),
        offer('pn',2000,2000),offer('circa',2100,2000)])
    under=dict(base,id='nhl-ryan-under',side='under',offers=[offer('fd',-700,180,.9)])
    return dict(schemaVersion=1,generatedAt=NOW.isoformat(),expiresAt=(NOW+timedelta(minutes=5)).isoformat(),
        sports=['nhl','nfl','mlb'],coverage=[dict(sport=sport,status='current',rows=2 if sport=='nhl' else 1) for sport in ['nhl','nfl','mlb']],
        data=[base,nfl,mlb,under])


def depth_entry(book):
    sides=[]
    for side,p,odds,maker,opposite_odds,taker in [('over','0.12',733,'12',-733,'88'),('under','0.9',-900,'90',900,'10')]:
        order=dict(probability=p,odds=odds,stake_usd=maker,opposite_odds=opposite_odds,opposite_stake_usd=taker,payout_usd='100')
        if book!='px': order['contracts']=10000 if book=='nv' else 100
        sides.append(dict(side=side,label=side,outcome_id=side,orders=[order],truncated=False))
    return dict(schema_version=1,market_id='fixture',event_id='fixture',sides=sides,
        starts_at=START,updated=(NOW-timedelta(seconds=20)).isoformat(),expires_at=(NOW+timedelta(minutes=3)).isoformat())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--overlay',type=Path)
    args=parser.parse_args(); frontend=args.frontend.resolve(); overlay=args.overlay.resolve() if args.overlay else None
    artifacts=Path(mkdtemp(prefix='sharp-money-browser-'))
    state=dict(payload=sample(),status=200,fail=False,requests=[],depth=[])
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        def intercept(route):
            url=urlsplit(route.request.url);state['requests'].append(route.request.url)
            if url.path=='/api/sharp-money':
                if state['fail']: route.abort('failed')
                else: route.fulfill(status=state['status'],json=state['payload'])
            elif url.path in ['/api/atgs-depth','/api/attd-depth','/api/homers-depth']:
                query={key:values[0] for key,values in parse_qs(url.query).items()};state['depth'].append((url.path,query))
                sport={'/api/atgs-depth':'nhl','/api/attd-depth':'nfl','/api/homers-depth':'mlb'}[url.path]
                route.fulfill(json=dict(schemaVersion=1,sport=sport,book=query['book'],game=query['game'],player=query['player'],start=query['start'],entry=depth_entry(query['book'])))
            elif url.hostname=='cdn.jsdelivr.net':
                route.fulfill(content_type='application/javascript',body='''window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}}),onAuthStateChange:fn=>{window.authChanged=fn;return {}}}})};''')
            elif url.hostname in ['ev-sharps.test','127.0.0.1']:
                path=url.path.lstrip('/') or 'sharp-money.html'
                staged=overlay/path if overlay else None; asset=staged if staged and staged.is_file() else frontend/path
                route.fulfill(path=asset) if asset.is_file() else route.fulfill(status=404,body='')
            else: route.fulfill(status=404,body='')
        page=browser.new_page(viewport=dict(width=1440,height=1050)); errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.route('**/*',intercept);page.clock.install(time=NOW)
        page.goto('https://ev-sharps.test/sharp-money.html')
        expect(page.locator('.rec-pick')).to_have_count(4)
        first=page.locator('.rec-pick').first
        assert first.get_attribute('data-book')=='fd', 'Filter support before choosing the best payout'
        assert '$300' in first.locator('.sm-support').inner_text()
        assert '+8.0%' in first.locator('.sm-advantage').inner_text()
        assert page.locator('#book-filter option[value=pn], #book-filter option[value=circa]').count()==0
        assert page.locator('a[href^="javascript:"]').count()==0
        assert page.locator('.rec-pick').filter(has_text='test hitter').get_attribute('data-book')=='fd'
        page.locator('#page-picker-btn').click()
        assert page.locator('.pp-tab.active').get_attribute('data-key')=='other'
        assert 'Sharp Money' in page.locator('.pp-page-btn.current-page.pp-sharp').inner_text()
        page.locator('#page-picker-btn').click()
        first.locator('.rec-toggle').click()
        expect(page.locator('.sm-history-chart').first).to_be_visible()
        assert 'all-exchange captures' in page.locator('.sm-history-caption').first.inner_text()
        page.locator('[data-depth-book=kal]').first.click()
        expect(page.locator('#novig-depth-dialog')).to_be_visible()
        expect(page.locator('#novig-depth-dialog .nv-depth-books')).to_be_visible()
        assert state['depth'][-1][0]=='/api/atgs-depth'
        page.locator('#novig-depth-dialog .nv-depth-close').click()
        page.screenshot(path=str(artifacts/'desktop.png'),full_page=True)
        page.select_option('#sport-filter','nhl');expect(page.locator('.rec-pick')).to_have_count(2)
        page.select_option('#book-filter','dk');expect(page.locator('.rec-pick')).to_have_count(0)
        page.select_option('#support-preset','custom');page.locator('#support-custom').fill('50')
        expect(page.locator('.rec-pick')).to_have_count(1)
        assert page.locator('.sm-book').first.inner_text().startswith('DraftKings +900')
        page.select_option('#book-filter','fd');page.select_option('#support-preset','100')
        page.select_option('#exchange-filter','nv');expect(page.locator('.rec-pick')).to_have_count(1)
        assert '$100' in page.locator('.sm-support').first.inner_text()
        page.select_option('#support-preset','250');expect(page.locator('.rec-pick')).to_have_count(0)
        page.select_option('#support-preset','100');page.select_option('#exchange-filter','')
        page.locator('#advantage-filter').fill('9');expect(page.locator('.rec-pick')).to_have_count(0)
        page.locator('#advantage-filter').fill('0');page.locator('#search-filter').fill('winterton')
        expect(page.locator('.rec-pick')).to_have_count(2)
        page.locator('#search-filter').fill('missing');expect(page.locator('.rec-pick')).to_have_count(0)
        page.locator('#search-filter').fill('')
        page.select_option('#sport-filter','');page.select_option('#book-filter','')
        page.set_viewport_size(dict(width=320,height=1000))
        expect(page.locator('.rec-pick')).to_have_count(4)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        assert page.locator('.sm-player').first.bounding_box()['width'] >= 250
        page.locator('.rec-toggle').first.click();page.locator('.rec-toggle').first.click()
        page.screenshot(path=str(artifacts/'mobile-320.png'),full_page=True)
        # Reject duplicate rows, injection, stale venues and future observations.
        validation=page.evaluate('''payload=>{const now=Date.now(), row=payload.data[0];
          const duplicate=structuredClone(payload);duplicate.data.push(structuredClone(row));
          const staleVenue=structuredClone(row.offers[0]);staleVenue.venues[0].expiresAt=new Date(now-1).toISOString();
          const future=structuredClone(row.offers[0]);future.updated=new Date(now+1000).toISOString();
          return {duplicates:SharpMoney.selectRows(duplicate).length, staleSupport:SharpMoney.metricForOffer(row,staleVenue).supportStake, future:SharpMoney.metricForOffer(row,future), safe:SharpMoney.safeLink('javascript:alert(1)')};}''',sample())
        assert validation==dict(duplicates=4,staleSupport=100,future=None,safe=None)
        injected=sample();injected['data'][0]['player']='<img src=x onerror=alert(1)>'
        state['payload']=injected;page.evaluate('refreshSharpMoney()')
        expect(page.locator('.sm-player').first).to_contain_text('<Img')
        assert page.locator('#picks [onerror], #picks img[src=x]').count()==0
        state['payload']=sample();page.evaluate('refreshSharpMoney()')
        expect(page.locator('.rec-pick')).to_have_count(4)
        # On sign-out all saved private data is removed before the next response.
        state['status']=401;page.evaluate("window.authChanged('SIGNED_OUT',null)")
        expect(page.locator('.rec-pick')).to_have_count(0);expect(page.locator('#access-panel')).to_be_visible()
        state['status']=403;page.evaluate("window.authChanged('SIGNED_IN',{access_token:'analyst'})")
        expect(page.locator('#access-panel')).to_be_visible()
        state['status']=200;page.evaluate("window.authChanged('SIGNED_IN',{access_token:'sharp'})")
        expect(page.locator('.rec-pick')).to_have_count(4)
        # A still-visible page hides prices as the saved snapshot expires.
        page.clock.fast_forward(301000);expect(page.locator('.rec-pick')).to_have_count(0)
        expect(page.locator('#freshness-status')).to_be_visible()
        assert not errors,errors
        # Local failures stay local; the paused production service is never a fallback.
        state['fail']=True;state['requests']=[]
        local=browser.new_page();local.route('**/*',intercept);local.clock.install(time=NOW)
        local.goto('http://127.0.0.1:8765/sharp-money.html?sport=mlb')
        expect(local.locator('#request-status')).to_contain_text('API is available')
        assert any(url.startswith('http://localhost:5001/api/sharp-money') for url in state['requests'])
        assert not any('railway.app' in url for url in state['requests'])
        local.locator('#page-picker-btn').click()
        assert local.locator('.pp-tab.active').get_attribute('data-key')=='mlb'
        state['fail']=False;state['payload']=dict(sample(),demo=True);state['requests']=[]
        local.goto('http://127.0.0.1:8765/sharp-money.html?api=http://127.0.0.1:5051')
        expect(local.locator('.rec-pick')).to_have_count(4)
        expect(local.locator('#demo-status')).to_contain_text('synthetic prices, not betting offers')
        assert any(url.startswith('http://127.0.0.1:5051/api/sharp-money') for url in state['requests'])
        assert not any('railway.app' in url for url in state['requests'])
        assert local.locator('#picks a, #picks [data-depth-book]').count()==0
        state['requests']=[]
        page.clock.set_fixed_time(NOW)
        page.goto('https://ev-sharps.test/sharp-money.html?api=http://127.0.0.1:5051')
        expect(page.locator('.rec-pick')).to_have_count(4)
        assert not any(url.startswith('http://127.0.0.1:5051') for url in state['requests'])
        browser.close()
    print('Sharp Money browser tests passed; artifacts:',artifacts)


if __name__=='__main__':main()
