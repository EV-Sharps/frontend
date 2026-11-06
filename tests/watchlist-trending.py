"""Offline trending play labels, precise selection, compatibility and mobile layout."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import runpy
import tempfile
from threading import Thread
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HARNESS = runpy.run_path(str(ROOT / 'tests/filter-window.py'))


class TrendingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1',0),partial(HARNESS['QuietHandler'],directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True,args=[
            '--disable-logging',f'--log-file={Path(tempfile.gettempdir()) / "watchlist-trending.log"}'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width':1280,'height':900})
        self.errors = []
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        HARNESS['mock_page'](self.page)
        self.page.route('https://**/*',lambda route:route.fulfill(
            body='window.supabase={createClient:()=>({rpc:async()=>({data:[]})})};' if 'supabase-js' in route.request.url else '',
            content_type='application/javascript'))
        self.page.goto(f'http://localhost:{self.server.server_port}/tracker.html')
        self.page.wait_for_function('WATCHLIST_TABLE !== null && trackerFetchPending === null')
        self.page.evaluate("""() => {
            window.dispatchEvent(new Event('pagehide'));
            CURR_USER={metadata:{watchlist:[],bets:[]}}; BETS=[];
            window.trendingFixtures=[
                {player:'test player',sport:'nba',page:'nba',prop:'pts',handicap:25.5,under:false,game:'bos @ ny',count:5},
                {player:'test player',sport:'nba',page:'nba',prop:'reb',handicap:8.5,under:true,game:'bos @ ny',count:3},
                {player:"d'angelo russell",sport:'nba',page:'nba',prop:'ast',handicap:0,under:false,count:2},
                {player:'<img src=x onerror=alert(1)>',sport:'nhl',page:'nhl',prop:'sog',handicap:2.5,under:true,count:1}
            ];
            window.rpcNames=[];
            SB={rpc:async name=>{rpcNames.push(name);return {data:trendingFixtures,error:null}}};
            ALL_ROWS=[
                {player:'test player',sport:'nba',watchlistPage:'nba',prop:'pts',handicap:25.5,under:false,game:'bos @ ny',book:'fd',line:100,bookOdds:{fd:'100/-120'}},
                {player:'test player',sport:'nba',watchlistPage:'nba',prop:'reb',handicap:9.5,under:true,game:'bos @ ny',book:'fd',line:900,bookOdds:{fd:'100/900'}},
                {player:'test player',sport:'nba',watchlistPage:'nba',prop:'reb',handicap:8.5,under:false,game:'bos @ ny',book:'fd',line:800,bookOdds:{fd:'800/700'}},
                {player:'test player',sport:'nba',watchlistPage:'nba',prop:'reb',handicap:8.5,under:true,game:'bos @ ny',book:'fd',line:150,bookOdds:{fd:'-175/150'}}
            ];
        }""")

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors,[])

    def fetch(self):
        self.page.evaluate("Promise.all([fetchPopularWatchlist({current:()=>true}),fetchPopularBets({current:()=>true})])")

    def test_labels_and_clicks_preserve_prop_line_and_side(self):
        self.fetch()
        expect(self.page.locator('#popular-watchlist-list .tracker-trending-market')).to_have_text(['o25.5 PTS','u8.5 REB','o0 AST','u2.5 SOG'])
        expect(self.page.locator('#popular-bets-list .tracker-trending-market')).to_have_text(['o25.5 PTS','u8.5 REB','o0 AST','u2.5 SOG'])
        expect(self.page.locator('#popular-watchlist-list img')).to_have_count(0)
        self.page.locator('#popular-watchlist-list button').nth(1).click()
        expect(self.page.locator('#abt-meta')).to_contain_text('REB')
        expect(self.page.locator('#abt-line')).to_have_value('8.5')
        expect(self.page.locator('#abt-side')).to_have_value('under')
        expect(self.page.locator('#abt-manual-odds')).to_have_value('150')
        self.page.evaluate('closeAddBet()')
        # A missing exact play keeps its saved selection with no unrelated quote.
        self.page.evaluate('ALL_ROWS = ALL_ROWS.slice(0,3)')
        self.page.locator('#popular-watchlist-list button').nth(1).click()
        expect(self.page.locator('#abt-line')).to_have_value('8.5')
        expect(self.page.locator('#abt-side')).to_have_value('under')
        expect(self.page.locator('#abt-manual-odds')).to_have_value('')

    def test_legacy_fallback_does_not_guess_a_market(self):
        self.page.evaluate("""() => {SB.rpc=async name=>{
            rpcNames.push(name);
            return name.endsWith('_plays') ? {error:{code:'PGRST202'}} : {data:[{player:'test player',count:8}]};
        };}""")
        self.fetch()
        self.assertEqual(sorted(self.page.evaluate('rpcNames')),sorted(['popular_watchlist_plays','popular_watchlist','popular_bet_plays','popular_bets']))
        expect(self.page.locator('#popular-watchlist-list .tracker-trending-market')).to_have_count(0)
        self.page.locator('#popular-watchlist-list button').click()
        expect(self.page.locator('#tracker-search')).to_have_value('test player')
        expect(self.page.locator('#add-bet-backdrop')).not_to_have_class('open')

    def test_hidden_requests_and_narrow_layout(self):
        self.page.evaluate('fetchPopularWatchlist()')
        self.assertEqual(self.page.evaluate('rpcNames'),[])
        self.fetch()
        for width in [390,320]:
            self.page.set_viewport_size({'width':width,'height':844})
            self.page.evaluate("document.querySelector('#popular-watchlist-wrap').scrollIntoView()")
            box=self.page.locator('#popular-watchlist-list').bounding_box()
            self.assertLessEqual(box['x']+box['width'],width+1)
            self.assertTrue(self.page.locator('#popular-watchlist-list').evaluate('el=>el.scrollWidth > el.clientWidth'))


if __name__=='__main__':
    unittest.main(verbosity=2)
