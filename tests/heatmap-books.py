"""Offline heatmap multiselect checks with real Plotly rendering and PNG export."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def bins(wins, losses, profit):
    return {"1": {"0": [wins, losses, profit]}}


FIXTURE = {
    "grid": {"evMin": 0, "evStep": 1, "oddsMin": 100, "oddsStep": 100},
    "xy": {
        "atgs": {
            "best": {"circa": bins(5, 5, 3)},
            "fd": {"circa": bins(2, 1, 1), "pn": bins(4, 2, 2)},
            "dk": {"circa": bins(1, 3, -2)},
            "px": {"pn": bins(3, 1, 5)},
        },
        "sog": {"fd": {"circa": bins(3, 2, 1)}},
    },
    "record": {
        "fd": {"atgs-vs-circa": {"All": {"wins": 2, "losses": 1, "roi": 33.3}}},
        "dk": {"atgs-vs-circa": {"All": {"wins": 1, "losses": 3, "roi": -50}}},
    },
}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def ready(page, books):
    page.wait_for_function("""books => {
        const panels = [...document.querySelectorAll('.heatmap-panel')];
        return panels.map(panel => panel.dataset.book).join(',') === books.join(',') &&
            panels.every(panel => panel.querySelector('.heatmap-chart')?.data) &&
            document.getElementById('download-btn').disabled === !books.length;
    }""", arg=books)


def matrices(page):
    return page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.heatmap-panel')].map(panel => {
        const chart = panel.querySelector('.heatmap-chart');
        return [panel.dataset.book, {z:chart.data[0].z, x:chart.data[0].x,
            y:chart.data[0].y, annotations:chart.layout.annotations, title:chart.layout.title.text}];
    }))""")


def values(matrix):
    return [value for row in matrix["z"] for value in row if value is not None]


def open_picker(page):
    if page.locator('#book-filter-button').get_attribute('aria-expanded') != 'true':
        page.locator('#book-filter-button').click()


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width in [1440, 390]:
            page = browser.new_page(viewport={"width": width, "height": 1000 if width > 400 else 844})
            page.set_default_timeout(12000)
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def intercept(route):
                address = route.request.url
                if '/heatmaps/' in address and address.endswith('.json.gz'):
                    requests.append(address)
                    route.fulfill(content_type='application/octet-stream', body=json.dumps(FIXTURE).encode())
                elif 'pako' in address:
                    route.fulfill(content_type='application/javascript', body='window.pako = {ungzip: bytes => new TextDecoder().decode(bytes)};')
                elif address.startswith(f'http://localhost:{server.server_port}/'):
                    if urlsplit(address).path == '/auth.js':
                        route.fulfill(content_type='application/javascript', body=(ROOT / 'auth.js').read_text(encoding='utf-8').replace('let ENABLE_AUTH = true;', 'let ENABLE_AUTH = false;'))
                    else:
                        route.continue_()
                else:
                    route.fulfill(status=404, body='')

            page.route('**/*', intercept)
            base = f'http://localhost:{server.server_port}/heatmap.html?sport=nhl&prop=atgs&devig=circa'
            page.goto(base + '&book=fd,dk')
            ready(page, ['fd', 'dk'])
            result = matrices(page)
            assert abs(values(result['fd'])[0] - 1 / 3) < 1e-12, result
            assert values(result['dk']) == [-.5], result
            assert all(len(values(matrix)) == 1 for matrix in result.values())
            assert 'FD' in result['fd']['title'] and 'DK' in result['dk']['title']
            assert '2/2 books' in page.locator('#dev-picker').inner_text()
            assert '2W' not in page.locator('#dev-picker').inner_text(), 'Do not combine or imply one book record for several books'
            assert len(requests) == 1
            # The shared page layout hides overflow by default. Each history must be reachable.
            assert page.evaluate("""() => {
                const main = document.querySelector('main');
                return getComputedStyle(main).overflowY === 'auto' && main.scrollHeight > main.clientHeight &&
                    document.querySelector('.heatmap-chart').getBoundingClientRect().top >= main.getBoundingClientRect().top;
            }""")
            page.locator('main').hover()
            page.mouse.wheel(0, 900)
            page.wait_for_function("document.querySelector('main').scrollTop > 0")
            page.evaluate("document.querySelector('main').scrollTop = 0")

            open_picker(page)
            expect(page.locator('#book-options')).to_be_visible()
            expect(page.locator('#book-options button')).to_have_count(2)
            expect(page.locator('#book-options [data-book-action="done"]')).to_have_count(0)
            assert page.locator('#book-options input').evaluate_all('(inputs) => inputs.map(input => input.value)') == ['best', 'fd', 'dk', 'px']
            bounds = page.locator('#book-options').bounding_box()
            assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1, bounds
            page.locator('#book-options input[value="px"]').check()
            ready(page, ['fd', 'dk', 'px'])
            assert all(value is None for row in matrices(page)['px']['z'] for value in row)
            assert 'No history' in matrices(page)['px']['annotations'][0]['text']
            expect(page.locator('#book-options')).to_be_visible()
            page.keyboard.press('Escape')

            # All panels use the same selected reference; one missing history stays visibly empty.
            page.locator('#dev-picker .dev-chip[data-value="pn"]').click()
            ready(page, ['fd', 'dk', 'px'])
            result = matrices(page)
            assert abs(values(result['fd'])[0] - 1 / 3) < 1e-12 and values(result['px']) == [1.25]
            assert not values(result['dk']) and 'No history' in result['dk']['annotations'][0]['text']
            page.locator('#dev-picker .dev-chip[data-value="circa"]').click()
            ready(page, ['fd', 'dk', 'px'])

            # Display options apply to all charts without downloading or merging history.
            page.locator('#selEvStep').select_option('5')
            page.locator('#selOddsStep').select_option('200')
            page.locator('#selSizing').select_option('kelly')
            ready(page, ['fd', 'dk', 'px'])
            result = matrices(page)
            assert all(len(matrix['x']) == 3 and len(matrix['y']) == 6 for matrix in result.values())
            # fine-bin midpoint EV 1.5%, odds +150: Kelly fraction .01.
            assert abs(values(result['fd'])[0] - .02 / 3) < 1e-12
            assert abs(values(result['dk'])[0] - (-.015 / 4)) < 1e-12
            assert all('Kelly sizing' in matrix['title'] for matrix in result.values())
            assert len(requests) == 1
            page.locator('#method-select').select_option('probit')
            page.wait_for_function("document.getElementById('heatmap').layout?.title?.text.includes('probit')")
            ready(page, ['fd', 'dk', 'px'])
            assert requests[-1].endswith('/nhl_probit.json.gz')
            assert all(len(matrix['x']) == 5 and len(matrix['y']) == 13 for matrix in matrices(page).values())
            page.locator('#method-select').select_option('')
            page.wait_for_function("document.getElementById('heatmap').layout?.title?.text.includes('worst-case')")
            ready(page, ['fd', 'dk', 'px'])

            # None retains the reference for the next selection; All means separate actual datasets.
            open_picker(page)
            page.locator('#book-options [data-book-action="none"]').click()
            ready(page, [])
            expect(page.locator('#heatmaps')).to_contain_text('Select a betting book')
            expect(page.locator('#book-filter-value')).to_have_text('None')
            assert parse_qs(urlsplit(page.url).query)['book'] == ['none']
            assert page.evaluate('DEVIG') == 'circa'
            page.locator('#book-options [data-book-action="all"]').click()
            ready(page, ['best', 'fd', 'dk', 'px'])
            expect(page.locator('#book-filter-value')).to_have_text('All')
            assert parse_qs(urlsplit(page.url).query, keep_blank_values=True)['book'] == ['']
            page.keyboard.press('Escape')
            page.reload()
            ready(page, ['best', 'fd', 'dk', 'px'])
            assert abs(values(matrices(page)['best'])[0] - .3) < 1e-12
            if width == 1440:
                with page.expect_download() as all_download:
                    page.locator('#download-btn').click()
                all_png = Path(all_download.value.path()).read_bytes()
                assert int.from_bytes(all_png[16:20], 'big') == 2400 and int.from_bytes(all_png[20:24], 'big') == 1600
                expect(page.locator('#download-btn')).to_be_enabled()

            # Actual Best-book history remains independently addressable in shared URL parsing.
            page.goto(base + '&book=best')
            ready(page, ['best'])
            expect(page.locator('#book-filter-value')).to_have_text('BEST')
            assert abs(values(matrices(page)['best'])[0] - .3) < 1e-12
            page.goto(base + '&book=none')
            ready(page, [])
            expect(page.locator('#book-filter-value')).to_have_text('None')

            # One PNG contains each selected book, rather than multiple blocked downloads.
            page.goto(base + '&book=fd,dk')
            ready(page, ['fd', 'dk'])
            with page.expect_download() as download_info:
                page.locator('#download-btn').click()
            downloaded = download_info.value
            assert downloaded.suggested_filename == 'heatmap_nhl_atgs_fd_dk_circa.png', downloaded.suggested_filename
            path = Path(downloaded.path())
            png = path.read_bytes()
            assert png[:8] == b'\x89PNG\r\n\x1a\n'
            assert int.from_bytes(png[16:20], 'big') == 2400 and int.from_bytes(png[20:24], 'big') == 800
            expect(page.locator('#download-btn')).to_be_enabled()

            # Changing prop does not silently change the selected books or mix histories.
            page.locator('#selProp').select_option('sog')
            ready(page, ['fd', 'dk'])
            result = matrices(page)
            assert values(result['fd']) == [.2] and not values(result['dk'])
            page.locator('#selProp').select_option('atgs')
            ready(page, ['fd', 'dk'])
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), page.evaluate('[document.documentElement.scrollWidth,innerWidth]')
            page.evaluate("document.querySelector('main').scrollTop = 0")
            page.screenshot(path=str(Path(gettempdir()) / f'heatmap-books-{width}.png'), full_page=True)
            assert not errors, errors
            print(f'PASS heatmap multiselect {width}px: separate histories, references, URL, All/None, controls and PNG')
            page.close()
        browser.close()
finally:
    server.shutdown()
