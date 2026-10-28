"""Offline ATGS table/card order-book hover checks; no remote APIs are used."""
from copy import deepcopy
from pathlib import Path
from tempfile import mkdtemp
import runpy

from playwright.sync_api import expect


HARNESS = runpy.run_path(str(Path(__file__).with_name("prediction-depth.py")))


def fixture():
    payload = HARNESS["with_novig"](HARNESS["fixture"]("nhl", "atgs", "0.5"))
    payload["data"] = [payload["data"][0]]
    nv = payload["novigDepth"]["tor @ bos"]["depth alpha"]
    nv["sides"][0]["orders"].extend([
        {"probability": "0.07", "contracts": 20000},
        {"probability": "0.06", "contracts": 30000},
        {"probability": "0.05", "contracts": 40000},
    ])
    nv["sides"][1]["orders"].append({"probability": "0.90", "contracts": 40000})
    kal = deepcopy(nv)
    kal["market_id"] = "KXNHLGOAL-FIXTURE-ALPHA"
    kal["sides"] = [
        {"side": "over", "orders": [
            {"probability": p, "contracts": n} for p, n in
            [("0.15", "10.50"), ("0.10", "20"), ("0.05", "30"), ("0.02", "40")]
        ], "truncated": False},
        {"side": "under", "orders": [
            {"probability": p, "contracts": n} for p, n in
            [("0.80", "10"), ("0.75", "20"), ("0.70", "30"), ("0.65", "40")]
        ], "truncated": False},
    ]
    payload["kalshiDepth"] = {"tor @ bos": {"depth alpha": kal}}
    return payload


def install(page, payload):
    page.evaluate("""async payload => {
        const books = ['bookOdds.nv','bookOdds.kal'].map(field => ({...TABLE.getColumn(field).getDefinition(),frozen:false}));
        RES = payload; UPDATED[PAGE] = payload.updated;
        TABLE.clearFilter(true); TABLE.clearSort();
        // Keep the real ATGS formatter and its actual icon listeners.
        TABLE.setColumns([{title:'Player',field:'player',width:180}, ...books]);
        await TABLE.setData(payload.data);
        window.dispatchEvent(new Event('odds-rendered'));
    }""", payload)
    expect(page.locator('#table .nv-depth-trigger[data-depth-book="nv"]')).to_be_visible()
    expect(page.locator('#table .nv-depth-trigger[data-depth-book="kal"]')).to_be_visible()


def trigger(page, book="nv", cards=False):
    return page.locator(f'{"#card-container" if cards else "#table"} .nv-depth-trigger[data-depth-book="{book}"]').first


def preview(page):
    return page.locator("#orderbook-preview")


def side(page, outcome="over"):
    return preview(page).locator(f'[data-preview-side="{outcome}"]')


def hover(page, book="nv", cards=False):
    trigger(page, book, cards).hover()
    expect(preview(page)).to_be_visible()


def assert_contents(page, book="nv"):
    expect(preview(page)).to_have_attribute("role", "tooltip")
    expect(preview(page)).to_contain_text("Novig" if book == "nv" else "Kalshi")
    expected = {
        "nv": {"over": ["+1150", "+1076", "+1011"], "under": ["-1233", "-1329", "-1567"]},
        "kal": {"over": ["+400", "+300", "+233"], "under": ["-567", "-900", "-1900"]},
    }[book]
    totals = {"nv": {"over": "$181", "under": "$481"}, "kal": {"over": "$16", "under": "$55"}}[book]
    sizes = {"nv": {"over": ["$7", "$83", "$90"], "under": ["$13", "$186", "$282"]},
             "kal": {"over": ["$2", "$5", "$9"], "under": ["$8", "$18", "$28"]}}[book]
    for outcome in ["over", "under"]:
        panel = side(page, outcome)
        expect(panel).to_be_visible()
        expect(panel.locator(".nv-depth-preview-level")).to_have_count(3)
        odds = panel.locator(".nv-depth-preview-odds").all_text_contents()
        assert [value.replace(",", "") for value in odds] == expected[outcome], odds
        # Taker stakes must use each provider's contract units and the top three levels only.
        expect(panel.locator(".nv-depth-preview-size")).to_have_text(sizes[outcome])
        expect(panel.locator(".nv-depth-preview-total strong")).to_have_text(totals[outcome])


def assert_fits(page):
    box = preview(page).bounding_box()
    viewport = page.viewport_size
    assert box and box["x"] >= 0 and box["y"] >= 0, box
    assert box["x"] + box["width"] <= viewport["width"] + 1, box
    assert box["y"] + box["height"] <= viewport["height"] + 1, box
    assert preview(page).evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    yes, no = side(page).bounding_box(), side(page, "under").bounding_box()
    assert abs(yes["y"] - no["y"]) <= 1 and no["x"] >= yes["x"] + yes["width"] - 1


def table_checks(browser, base, artifacts):
    page, errors = HARNESS["new_page"](browser, base, "atgs")
    payload = fixture()
    install(page, payload)
    for book in ["nv", "kal"]:
        hover(page, book)
        assert_contents(page, book)
        assert_fits(page)
        assert trigger(page, book).get_attribute("aria-describedby") == "orderbook-preview"
        preview(page).hover()
        page.wait_for_timeout(350)
        expect(preview(page)).to_be_visible()
        page.screenshot(path=str(artifacts / f"{book}-table-preview.png"))
        page.keyboard.press("Escape")
        expect(preview(page)).not_to_be_visible()
        page.mouse.move(0, 0)
        trigger(page, book).focus()
        expect(preview(page)).to_be_visible()
        assert_contents(page, book)
        trigger(page, book).click()
        expect(page.locator("#novig-depth-dialog")).to_be_visible()
        expect(preview(page)).not_to_be_visible()
        expect(page.locator(".nv-depth-eyebrow")).to_contain_text("NOVIG" if book == "nv" else "KALSHI")
        expect(page.locator('[data-book-side="over"] .nv-depth-chart-row')).to_have_count(4)
        page.locator(".nv-depth-close").click()
        page.keyboard.press("Escape")
        page.mouse.move(0, 0)
        trigger(page, book).evaluate("el => el.blur()")

    hover(page)
    # Replace both payload and row objects while the icon still references the previous table row.
    changed = deepcopy(payload)
    changed["novigDepth"]["tor @ bos"]["depth alpha"]["sides"][1]["orders"][0] = {"probability": "0.93", "contracts": 10000}
    page.evaluate("payload => {RES = payload; UPDATED[PAGE] = payload.updated; window.dispatchEvent(new Event('odds-rendered'));}", changed)
    expect(side(page).locator(".nv-depth-preview-odds").first).to_have_text("+1329")
    page.evaluate("RES.data = []; window.dispatchEvent(new Event('odds-rendered'))")
    expect(preview(page)).not_to_be_visible()
    page.evaluate("payload => {RES = payload; window.dispatchEvent(new Event('odds-rendered'));}", payload)
    page.mouse.move(0, 0)
    hover(page)
    page.evaluate("RES.data = RES.data.map(row => ({...row,blurred:true})); window.dispatchEvent(new Event('odds-rendered'))")
    expect(preview(page)).not_to_be_visible()
    page.evaluate("payload => {RES = payload; window.dispatchEvent(new Event('odds-rendered'));}", payload)
    page.mouse.move(0, 0)
    hover(page, "kal")
    page.evaluate("RES.kalshiDepth['tor @ bos']['depth alpha'].expires_at = '2026-10-28T18:00:00Z'; window.dispatchEvent(new Event('odds-rendered'))")
    expect(preview(page)).not_to_be_visible()

    # Use the real formatter trigger near the viewport edges to exercise placement independently of table width.
    for width in [1280, 390, 320]:
        page.set_viewport_size({"width": width, "height": 844})
        page.evaluate("payload => {RES = payload; window.dispatchEvent(new Event('odds-rendered'));}", payload)
        for corner in ["top-left", "bottom-right"]:
            trigger(page).evaluate("""(el, corner) => {
                el.style.cssText = `position:fixed;z-index:1000;${corner === 'top-left' ? 'left:4px;top:4px' : 'right:4px;bottom:4px'}`;
            }""", corner)
            page.mouse.move(width / 2, 400)
            hover(page)
            assert_fits(page)
            page.screenshot(path=str(artifacts / f"nv-preview-{width}-{corner}.png"))
            page.keyboard.press("Escape")
        trigger(page).evaluate("el => el.removeAttribute('style')")

    page.set_viewport_size({"width": 1280, "height": 900})
    page.mouse.move(0, 0)
    hover(page)
    page.evaluate("window.dispatchEvent(new Event('scroll'))")
    expect(preview(page)).not_to_be_visible()
    page.mouse.move(0, 0)
    hover(page)
    page.set_viewport_size({"width": 1270, "height": 900})
    expect(preview(page)).not_to_be_visible()
    page.mouse.move(0, 0)
    hover(page)
    trigger(page).evaluate("el => el.remove()")
    expect(preview(page)).not_to_be_visible()
    assert not errors, errors
    page.close()
    print("Table preview: both providers/sides, executable top three and units, pointer/focus/Escape, full modal, refreshed/removed/blurred/expired data, edge bounds and cleanup passed.")


def card_checks(browser, base, artifacts):
    page, errors = HARNESS["new_page"](browser, base, "atgs")
    install(page, fixture())
    page.evaluate("CURRENT_VIEW = 'mobile'; applyOddsTableView(TABLE); initializeCards(RES.data); window.dispatchEvent(new Event('odds-rendered'))")
    card = page.locator("#card-container .data-card").first
    if "expanded" not in (card.get_attribute("class") or ""):
        card.locator(".card-arrow-container").click()
    for book in ["nv", "kal"]:
        hover(page, book, cards=True)
        assert_contents(page, book)
        assert_fits(page)
        page.keyboard.press("Escape")
        page.mouse.move(0, 0)
    page.set_viewport_size({"width": 320, "height": 844})
    hover(page, "kal", cards=True)
    assert_fits(page)
    page.screenshot(path=str(artifacts / "kal-card-preview-320.png"))
    trigger(page, "kal", cards=True).click()
    expect(page.locator("#novig-depth-dialog")).to_be_visible()
    expect(preview(page)).not_to_be_visible()
    assert not errors, errors
    page.close()
    print("Card icons: Novig/Kalshi previews, 320px placement and full-modal click passed.")


def keyboard_return_checks(browser, base):
    page, errors = HARNESS["new_page"](browser, base, "atgs")
    install(page, fixture())
    page.keyboard.press("Tab")
    trigger(page).focus()
    expect(preview(page)).to_be_visible()
    trigger(page).press("Enter")
    expect(page.locator("#novig-depth-dialog")).to_be_visible()
    expect(preview(page)).not_to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#novig-depth-dialog")).not_to_be_visible()
    expect(trigger(page)).to_be_focused()
    # Native dialog focus restoration precedes the close event; cancel its queued preview.
    page.wait_for_timeout(350)
    expect(preview(page)).not_to_be_visible()
    trigger(page, "kal").focus()
    expect(preview(page)).to_be_visible()
    assert_contents(page, "kal")
    trigger(page).focus()
    expect(preview(page)).to_be_visible()
    assert_contents(page)
    assert not errors, errors
    page.close()
    print("Keyboard: Enter opens depth, Escape restores icon focus without reopening preview, and subsequent focus shows preview normally.")


class TouchBrowser:
    def __init__(self, browser):
        self.browser = browser

    def new_page(self, **kwargs):
        kwargs["viewport"] = {"width": 390, "height": 844}
        return self.browser.new_page(**kwargs, is_mobile=True, has_touch=True)


def touch_checks(browser, base):
    page, errors = HARNESS["new_page"](TouchBrowser(browser), base, "atgs")
    install(page, fixture())
    assert page.evaluate("matchMedia('(hover: none)').matches")
    target = trigger(page)
    target.tap()
    expect(page.locator("#novig-depth-dialog")).to_be_visible()
    expect(preview(page)).not_to_be_visible()
    page.locator(".nv-depth-close").tap()
    page.wait_for_timeout(350)
    expect(preview(page)).not_to_be_visible()
    assert not errors, errors
    page.close()
    print("Touch: tapping opens full depth without hover preview before/after dismissal.")


def main():
    artifacts = Path(mkdtemp(prefix="orderbook-preview-browser-"))
    server = HARNESS["ThreadingHTTPServer"](("127.0.0.1", 0), HARNESS["partial"](HARNESS["Quiet"], directory=str(HARNESS["ROOT"])))
    HARNESS["Thread"](target=server.serve_forever, daemon=True).start()
    try:
        with HARNESS["sync_playwright"]() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-logging", f"--log-file={artifacts / 'chromium.log'}"])
            base = f"http://localhost:{server.server_port}"
            table_checks(browser, base, artifacts)
            keyboard_return_checks(browser, base)
            card_checks(browser, base, artifacts)
            touch_checks(browser, base)
            browser.close()
    finally:
        server.shutdown()
    print(f"Screenshots: {artifacts}")


if __name__ == "__main__":
    main()
