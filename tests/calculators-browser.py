"""Offline calculator checks: python tests/calculators-browser.py."""
from decimal import Decimal
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
import tempfile

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def amount(page, field, expected, *, input_value=False, prefix="arb"):
    element = page.locator(f"#{prefix}-{field}")
    text = element.input_value() if input_value else element.inner_text()
    number = re.sub(r"[^0-9.\-]", "", text.replace("\N{MINUS SIGN}", "-"))
    assert number and Decimal(number) == Decimal(str(expected)), (field, text, expected)


def summary(page, stake, payout, profit, percent):
    amount(page, "total-stake", stake)
    amount(page, "total-payout", payout)
    amount(page, "profit", profit)
    amount(page, "profit-percent", percent)


def default_result(page):
    amount(page, "odds-0", -150, input_value=True)
    amount(page, "odds-1", 200, input_value=True)
    amount(page, "stake-0", 200, input_value=True)
    amount(page, "stake-1", "111.11", input_value=True)
    amount(page, "payout-0", "333.33", input_value=True)
    amount(page, "payout-1", "333.33", input_value=True)
    summary(page, "311.11", "333.33", "22.22", "6.67")


def cleared_result(page, opposite=1):
    for field in ("total-stake", "total-payout", "profit", "profit-percent"):
        assert not re.search(r"\d", page.locator(f"#arb-{field}").inner_text()), field
    for side in (0, 1):
        assert page.locator(f"#arb-payout-{side}").input_value() == ""
    assert page.locator(f"#arb-stake-{opposite}").input_value() == ""
    assert page.locator("#arb-status").inner_text().strip()


def conversion(page, fraction, decimal, american, probability, win, payout):
    for field, expected in zip(
            ("fraction", "decimal", "american", "probability", "to-win", "payout"),
            (fraction, decimal, american, probability, win, payout)):
        amount(page, field, expected, input_value=True, prefix="odds")


def converter_default(page):
    amount(page, "amount", 100, input_value=True, prefix="odds")
    conversion(page, 2, 3, 200, "33.33", 200, 300)


def selected_calculator(page, name):
    other = "odds-converter" if name == "arbitrage" else "arbitrage"
    selected = page.locator(f"#calc-tab-{name}")
    unselected = page.locator(f"#calc-tab-{other}")
    assert selected.get_attribute("role") == "tab"
    assert selected.get_attribute("aria-selected") == "true"
    assert selected.get_attribute("tabindex") == "0"
    assert unselected.get_attribute("aria-selected") == "false"
    assert unselected.get_attribute("tabindex") == "-1"
    assert page.locator(f"#calc-{name}").is_visible()
    assert page.locator(f"#calc-{name}").get_attribute("role") == "tabpanel"
    assert not page.locator(f"#calc-{other}").is_visible()


def check_converter(page, origin, width):
    selected_calculator(page, "arbitrage")
    page.locator("#arb-stake-0").fill("300")
    page.locator("#calc-tab-odds-converter").click()
    selected_calculator(page, "odds-converter")
    converter_default(page)
    for field in ("to-win", "payout"):
        assert page.locator(f"#odds-{field}").get_attribute("readonly") is not None
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
    for field in ("amount", "fraction", "decimal", "american", "probability", "to-win", "payout"):
        bounds = page.locator(f"#odds-{field}").bounding_box()
        assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1, (field, bounds)
    screenshot = Path(tempfile.gettempdir()) / f"calculators-odds-converter-{width}.png"
    page.screenshot(path=str(screenshot), full_page=True)

    # Each odds format can become the source, including favorite prices and even money.
    page.locator("#odds-fraction").fill("1.5")
    conversion(page, "1.5", "2.5", 150, 40, 150, 250)
    page.locator("#odds-decimal").fill("1.8")
    conversion(page, "0.8", "1.8", -125, "55.56", 80, 180)
    page.locator("#odds-probability").fill("50")
    conversion(page, 1, 2, 100, 50, 100, 200)
    page.locator("#odds-american").fill("-110")
    conversion(page, "0.91", "1.91", -110, "52.38", "90.91", "190.91")

    # Recalculating money must use the edited American price, not rounded displayed decimals.
    page.locator("#odds-amount").fill("110")
    conversion(page, "0.91", "1.91", -110, "52.38", 100, 210)
    page.locator("#calc-tab-arbitrage").click()
    selected_calculator(page, "arbitrage")
    amount(page, "stake-0", 300, input_value=True)
    amount(page, "stake-1", "166.67", input_value=True)
    page.locator("#calc-tab-odds-converter").click()
    amount(page, "amount", 110, input_value=True, prefix="odds")
    conversion(page, "0.91", "1.91", -110, "52.38", 100, 210)
    page.locator("#odds-amount").fill("100")
    page.locator("#odds-american").fill("150.5")
    amount(page, "american", "150.5", input_value=True, prefix="odds")
    amount(page, "to-win", "150.50", input_value=True, prefix="odds")
    amount(page, "payout", "250.50", input_value=True, prefix="odds")

    for field, invalid_values in (
            ("fraction", ("", "0", "-1")),
            ("decimal", ("1", "0")),
            ("american", ("0", "99", "-99")),
            ("probability", ("0", "100", "101"))):
        for invalid_value in invalid_values:
            page.locator(f"#odds-{field}").fill(invalid_value)
            for cleared in ("fraction", "decimal", "american", "probability", "to-win", "payout"):
                if cleared != field:
                    assert page.locator(f"#odds-{cleared}").input_value() == "", (field, invalid_value, cleared)
            assert page.locator("#odds-status").inner_text().strip()
            page.locator(f"#odds-{field}").fill({
                "fraction": "2", "decimal": "3", "american": "200", "probability": "50",
            }[field])
            assert page.locator("#odds-payout").input_value() != ""
            page.locator("#odds-reset").click()
            converter_default(page)

    # Invalid money clears returns while leaving valid conversions available.
    for invalid_amount in ("", "-1", "1.001", "1000000001"):
        page.locator("#odds-amount").fill(invalid_amount)
        for field in ("to-win", "payout"):
            assert page.locator(f"#odds-{field}").input_value() == ""
        for field, expected in (("fraction", 2), ("decimal", 3), ("american", 200), ("probability", "33.33")):
            amount(page, field, expected, input_value=True, prefix="odds")
        assert page.locator("#odds-status").inner_text().strip()
        page.locator("#odds-amount").fill("100")
        converter_default(page)
    page.locator("#odds-amount").fill("0")
    conversion(page, 2, 3, 200, "33.33", 0, 0)
    page.locator("#odds-reset").click()
    converter_default(page)

    # Tabs expose a single keyboard stop and support standard navigation keys.
    page.locator("#calc-tab-odds-converter").focus()
    for key, target in (("ArrowLeft", "arbitrage"), ("ArrowRight", "odds-converter"),
                        ("Home", "arbitrage"), ("End", "odds-converter")):
        page.keyboard.press(key)
        selected_calculator(page, target)
        assert page.locator(f"#calc-tab-{target}").evaluate("element => element === document.activeElement")

    page.goto(f"{origin}/calculators.html#odds-converter")
    page.reload()
    selected_calculator(page, "odds-converter")
    converter_default(page)
    print(f"PASS odds converter {width}px: all formats, precision, invalid/zero/recovery, "
          f"preserved state, tabs/keyboard/deep link, no overflow; screenshot {screenshot}", flush=True)


def check_page(browser, origin, width):
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.set_default_timeout(10000)
    page.route("https://**/*", lambda route: route.fulfill(
        body="", content_type="application/javascript"))
    errors = []
    data_requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: data_requests.append(request.url)
            if "/api/" in request.url else None)
    page.goto(f"{origin}/calculators.html")
    page.locator("#arb-profit").wait_for()
    default_result(page)
    for side in (0, 1):
        assert page.locator(f"#arb-payout-{side}").get_attribute("readonly") is not None
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
    for field in ("odds-0", "odds-1", "stake-0", "stake-1", "payout-0", "payout-1"):
        bounds = page.locator(f"#arb-{field}").bounding_box()
        assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1, (field, bounds)
    screenshot = Path(tempfile.gettempdir()) / f"calculators-{width}.png"
    page.screenshot(path=str(screenshot), full_page=True)

    # Editing either stake controls the opposite side, including later odds edits.
    page.locator("#arb-stake-1").fill("150")
    amount(page, "stake-0", 270, input_value=True)
    amount(page, "stake-1", 150, input_value=True)
    summary(page, 420, 450, 30, "6.67")
    page.locator("#arb-odds-0").fill("100")
    amount(page, "stake-0", 225, input_value=True)
    amount(page, "stake-1", 150, input_value=True)
    summary(page, 375, 450, 75, "16.67")

    # Loss-making odds must remain a loss instead of reporting an arbitrage.
    page.locator("#arb-odds-0").fill("-110")
    page.locator("#arb-odds-1").fill("-110")
    page.locator("#arb-stake-0").fill("110")
    amount(page, "stake-1", 110, input_value=True)
    summary(page, 220, 210, -10, "-4.76")

    # There is no stale profit while the user clears or enters an invalid value.
    page.locator("#arb-reset").click()
    default_result(page)
    for invalid_odds in ("", "0", "99", "100.5"):
        page.locator("#arb-odds-1").fill(invalid_odds)
        cleared_result(page)
        amount(page, "stake-0", 200, input_value=True)
        page.locator("#arb-odds-1").fill("200")
        default_result(page)
    for invalid_stake in ("", "-1", "1.001"):
        page.locator("#arb-stake-0").fill(invalid_stake)
        cleared_result(page)
        page.locator("#arb-stake-0").fill("200")
        default_result(page)

    page.locator("#arb-stake-1").fill("0")
    amount(page, "stake-0", 0, input_value=True)
    summary(page, 0, 0, 0, 0)
    page.locator("#arb-reset").click()
    default_result(page)

    # A matching stake rounded down to zero cannot display a misleading 0% loss.
    page.locator("#arb-odds-0").fill("100")
    page.locator("#arb-odds-1").fill("1000000")
    page.locator("#arb-stake-0").fill("0.01")
    amount(page, "stake-1", 0, input_value=True)
    amount(page, "payout-0", "0.02", input_value=True)
    amount(page, "payout-1", 0, input_value=True)
    amount(page, "total-stake", "0.01")
    amount(page, "total-payout", 0)
    amount(page, "profit", "-0.01")
    assert page.locator("#arb-profit-percent").inner_text() == ""
    assert page.locator("#arb-form").get_attribute("data-result") == "negative"
    page.locator("#arb-reset").click()
    default_result(page)

    # The free tool participates in the existing navigation and current-page state.
    page.locator("#page-picker-btn").click()
    panel = page.locator("#page-picker-panel")
    panel.locator('.pp-tab[data-key="other"]').click()
    link = panel.locator('.pp-page-link[data-page="calculators"]')
    assert link.is_visible()
    assert link.get_attribute("href").endswith("calculators.html")
    assert link.get_attribute("aria-current") == "page"
    page.keyboard.press("Escape")
    assert not panel.is_visible()
    check_converter(page, origin, width)
    assert not data_requests, data_requests
    assert not errors, errors
    page.close()
    print(f"PASS calculators {width}px: reference, both stake anchors, odds edits, loss, "
          f"invalid/zero/recovery, cent rounding, reset, navigation, no overflow; screenshot {screenshot}", flush=True)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=[
                "--disable-logging",
                f"--log-file={Path(tempfile.gettempdir()) / 'calculators-browser.log'}",
            ])
            for width in (1440, 390, 320):
                check_page(browser, f"http://127.0.0.1:{server.server_port}", width)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
