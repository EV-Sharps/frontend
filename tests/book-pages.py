"""Offline coverage for every HTML page containing the exact book-select control.

Run: python tests/book-pages.py (requires Playwright and its Chromium browser).
Use --pages atgs nfl to rerun a subset or --audit to collect startup findings.
"""
import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'http://localhost:8123'
EMPTY = dict(data=[], games=[], props=[], updated={}, record={}, times={})
RESEARCH = [dict(player='research player', pra=30, sport='nba', team='bos', opp='tor',
                 game='bos @ tor', prop='pts+reb+ast', under=False)]
HEATMAP = dict(grid=dict(evMin=0, evStep=1, oddsMin=100, oddsStep=100),
               xy={'atgs': {'fd': {'circa': {'0': {'0': [2, 1, 1]}}},
                            'dk': {'circa': {'0': {'0': [1, 2, -1]}}},
                            'b365': {'circa': {'0': {'0': [3, 1, 2]}}}}}, record={})


class BookControl(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = False

    def handle_starttag(self, tag, attrs):
        self.found |= dict(attrs).get('id') == 'book-select'


def pages():
    found = []
    for path in sorted(ROOT.glob('*.html')):
        parser = BookControl()
        parser.feed(path.read_text(encoding='utf-8', errors='replace'))
        if parser.found:
            found.append(path.stem)
    return found


FIXTURE = """async () => {
    DEVIG='pn'; WEIGHT='1'; REQUIRED=[]; DEVIG_EXCLUDED=[];
    if (document.getElementById('ou-select')) document.getElementById('ou-select').value='o';
    const rows = [
        {player:'selected player', bookOdds:{fd:'300/-140',dk:'400/-160',b365:'900/120',pn:'100/-120'}},
        {player:'missing selected', bookOdds:{b365:'700/110',pn:'100/-120'}}
    ].map((row,id) => ({...row,id,game:'bos @ tor',team:'bos',opp:'tor',pos:'C',sport:SPORT,
        prop:['atgs','atgs2'].includes(PAGE)?'atgs':PAGE==='fgs'?'fgs':PAGE==='ftd'?'ftd':
            ['tds','tds2'].includes(PAGE)?'attd':PAGE.includes('main')?'ml':'rec',
        handicap:PAGE==='dingers2'?'1.5':'0.5',under:false,logs:[0,1,0,2],hitRates:{},percs:{},batter_percs:{},
        savant:{},pitcherData:{},pitcher:'test pitcher',throws:'R',bats:'R',bpp:'10%'}));
    RES = {...RES,data:rows};
    await changeFilter();
}"""


def check(browser, name, audit=False):
    page = browser.new_page(viewport=dict(width=1280, height=900))
    page.set_default_timeout(4000)
    errors = []
    page.on('pageerror', lambda error: errors.append('\n'.join(error.stack.splitlines()[:3])))
    page.add_init_script('window.EventSource=undefined;')

    def intercept(route):
        url = route.request.url
        path = urlsplit(url).path
        if name == 'heatmap' and '/heatmaps/' in path:
            route.fulfill(json=HEATMAP)
        elif name == 'heatmap' and 'pako' in path:
            route.fulfill(content_type='application/javascript', body='window.pako={ungzip: bytes => new TextDecoder().decode(bytes)};')
        elif '/api/' in path:
            data = [] if name == 'analysis' else RESEARCH if name == 'kotc' else EMPTY
            if name == 'sb':
                data = {'data': EMPTY}
            route.fulfill(json=data)
        elif url.startswith(ORIGIN + '/'):
            asset = (ROOT / path.lstrip('/')).resolve()
            if not asset.is_relative_to(ROOT) or not asset.is_file():
                route.fulfill(status=404, body='')
            elif asset.name == 'auth.js':
                route.fulfill(content_type='application/javascript', body=asset.read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'))
            elif asset.name == 'test.js':
                route.fulfill(content_type='application/javascript', body='TEST = {"atgs-vs-circa":{all:{wins:2,losses:1,profit:1,kelly:0.25}}};')
            else:
                route.fulfill(path=asset)
        else:
            route.fulfill(content_type='application/javascript', body='')

    page.route('**/*', intercept)
    stage = 'startup'
    try:
        query = 'view=compact&book=fd,dk&devig=pn&weight=1'
        if name == 'heatmap':
            query = 'sport=nhl&prop=atgs&book=fd,dk&devig=circa'
        page.goto(f'{ORIGIN}/{name}.html?{query}', wait_until='domcontentloaded', timeout=15000)
        expect(page.locator('#book-filter-button')).to_have_count(1)
        if audit:
            return dict(page=name, picker=True, errors=errors,
                        table=page.evaluate("typeof TABLE !== 'undefined' && !!TABLE"),
                        selection=page.locator('#book-select').input_value())
        expect(page.locator('#book-filter-value')).to_have_text('FD + DK')
        assert page.locator('#book-options [data-book-action="done"]').count() == 0
        page.locator('#book-filter-button').click()
        menu = page.locator('#book-options')
        expect(menu).to_be_visible()
        assert page.locator('#book-options input:checked').count() == 2
        bounds = menu.bounding_box()
        assert 0 <= bounds['x'] and bounds['x'] + bounds['width'] <= 1280
        special = name in ('analysis2', 'heatmap')
        if name == 'analysis2':
            expect(page.locator('#tables [role="status"]')).to_contain_text("Per-book history isn't available")
        if name == 'heatmap':
            expect(page.locator('.heatmap-chart.js-plotly-plot')).to_have_count(2)
        if name == 'kotc':
            stage = 'research selection'
            expect(page.locator('#kotc-book-status')).to_contain_text('Book prices are unavailable')
            page.locator('#book-options [data-book-action="all"]').click()
            page.wait_for_function("TABLE.getData('active').length === 1 && TABLE.getData('active')[0].pra === 30")
            page.locator('#book-options [data-book-action="none"]').click()
            page.wait_for_function("TABLE.getData('active').length === 0")
            page.locator('#book-options input[value="fd"]').check()
            page.locator('#book-options input[value="dk"]').check()
            expect(page.locator('#kotc-book-status')).to_contain_text('Book prices are unavailable')
            assert page.evaluate("TABLE.getData('active').length") == 0
        if not special:
            stage = 'table ready'
            page.wait_for_function("typeof TABLE !== 'undefined' && TABLE && typeof changeFilter === 'function'")
            page.wait_for_function("!document.getElementById('data-status') || document.getElementById('data-status').hidden")
            page.evaluate(FIXTURE)
            stage = 'initial selected price'
            page.wait_for_function("TABLE.getData('active').length === 1 && TABLE.getData('active')[0].book === 'dk'")
            if name in ('recap', 'nfl_recap'):
                records = page.evaluate("""() => {
                    const entry = {'hr-vs-pn':{All:{wins:3,losses:2,roi:10,profit:1,kelly:0.2}}};
                    return buildDevPickerData({[METHOD || 'worst']:{fd:entry,dk:entry,b365:entry}}, 'fd,dk').map(r => r.book);
                }""")
                assert sorted(records) == ['dk', 'fd'], records
        page.locator('#book-options input[value="dk"]').uncheck()
        expect(menu).to_be_visible()
        expect(page.locator('#book-filter-value')).to_have_text('FD')
        if name == 'heatmap':
            expect(page.locator('.heatmap-chart.js-plotly-plot')).to_have_count(1)
        if not special:
            stage = 'one book price'
            page.wait_for_function("TABLE.getData('active')[0]?.book === 'fd'")
        page.locator('#book-options input[value="dk"]').check()
        expect(menu).to_be_visible()
        expect(page.locator('#book-filter-value')).to_have_text('FD + DK')
        if name == 'heatmap':
            expect(page.locator('.heatmap-chart.js-plotly-plot')).to_have_count(2)
        page.locator('#book-options [data-book-action="none"]').click()
        expect(menu).to_be_visible()
        expect(page.locator('#book-filter-value')).to_have_text('None')
        if name == 'analysis2':
            expect(page.locator('#tables [role="status"]')).to_have_text('No books selected.')
        if name == 'heatmap':
            expect(page.locator('.heatmap-chart')).to_have_count(0)
        if not special:
            stage = 'none selected'
            page.wait_for_function("TABLE.getData('active').length === 0")
        page.locator('#book-options [data-book-action="all"]').click()
        expect(menu).to_be_visible()
        expect(page.locator('#book-filter-value')).to_have_text('All')
        if name == 'analysis2':
            expect(page.locator('#tables .js-plotly-plot')).to_have_count(6)
        if name == 'heatmap':
            expect(page.locator('.heatmap-chart.js-plotly-plot')).to_have_count(3)
        if not special:
            stage = 'all selected'
            page.wait_for_function("TABLE.getData('active').length === 2")
        page.keyboard.press('Escape')
        expect(menu).not_to_be_visible()
        assert page.locator('#book-filter-button').get_attribute('aria-expanded') == 'false'
        assert not errors, errors
        return dict(page=name, passed=True)
    except Exception as error:
        state = page.evaluate("""() => ({book: typeof BOOK === 'undefined' ? null : BOOK,
            filters: typeof TABLE === 'undefined' || !TABLE ? [] : [TABLE.getFilters(true),TABLE.getHeaderFilters()],
            props: typeof getOptions === 'function' && document.getElementById('prop-options') ? getOptions('prop-options') : [],
            rows: typeof TABLE === 'undefined' || !TABLE ? [] : TABLE.getData().map(r => ({player:r.player,book:r.book,ev:r.ev})),
            source: typeof RES === 'undefined' || !RES?.data ? [] : RES.data.map(r => ({player:r.player,book:r.book,ev:r.ev}))})""")
        return dict(page=name, stage=stage, failure=str(error).split('Call log:')[0].strip(), errors=errors, state=state)
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pages', nargs='+')
    parser.add_argument('--audit', action='store_true')
    args = parser.parse_args()
    names = pages()
    if args.pages:
        assert set(args.pages).issubset(names), 'Only exact book-select pages belong in this suite'
        names = [name for name in names if name in args.pages]
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for name in names:
                result = check(browser, name, args.audit)
                results.append(result)
                print(result, flush=True)
        finally:
            browser.close()
    failed = [result for result in results if 'failure' in result or result.get('errors')]
    assert not failed, f'{len(failed)}/{len(names)} pages failed: {[row["page"] for row in failed]}'
    print(f'PASS: {len(names)} exact book-select pages checked.')


if __name__ == '__main__':
    main()
