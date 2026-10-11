"""Real browser acceptance for discovery, resume and reader search.

Requires the current validated snapshot and Python Playwright Chromium.
Run: python scripts/accept-discovery-browser.py --base http://127.0.0.1:5180
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright


MULTI_EDITION = "0724ad88f2f34abea2924007462b7f7b"


class Acceptance:
    def __init__(self, browser, base, output):
        self.browser = browser
        self.base = base.rstrip("/")
        self.output = output
        self.results = []

    @contextmanager
    def case(self, name, viewport=None, init_script=None):
        context = self.browser.new_context(
            viewport=viewport or {"width": 390, "height": 844},
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.set_default_timeout(30000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text)
                if message.type == "error" else None)
        if init_script:
            page.add_init_script(init_script)
        try:
            yield page, errors
            assert not errors, f"Unexpected console or page errors: {errors}"
        except Exception as error:
            screenshot = self.output / f"{name}-failure.png"
            try:
                page.screenshot(path=str(screenshot), full_page=True)
            except Exception:
                screenshot = None
            self.results.append({"case": name, "passed": False,
                                 "error": str(error), "consoleErrors": errors,
                                 "screenshot": str(screenshot) if screenshot else None})
            raise
        finally:
            context.close()

    def goto(self, page, route):
        page.goto(f"{self.base}/#{route}")

    def open_reader_find(self, page):
        self.goto(page, f"/read/{MULTI_EDITION}")
        expect(page.locator(".reader-prose")).to_be_visible()
        page.locator("[data-tool=find]").click()
        expect(page.locator("[data-reader-tool=find]")).to_be_visible()

    @staticmethod
    def submit_find(page, query, scope="video"):
        page.locator("[name=scope]").select_option(scope)
        page.locator("#reader-search-input").fill(query)
        page.locator("[data-reader-search] button[type=submit]").click()

    @staticmethod
    def wait_find_complete(page):
        expect(page.locator("[data-reader-search]")).to_have_attribute("aria-busy", "false")

    def responsive(self):
        for width, height in [(320, 800), (390, 844), (1440, 900)]:
            name = f"responsive-{width}"
            with self.case(name, {"width": width, "height": height}) as (page, _):
                self.goto(page, "/library")
                expect(page.locator(".result-group").first).to_be_visible()
                assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
                expect(page.locator(".search-options")).to_have_attribute("open", "")
                self.goto(page, "/search?q=CPU&view=drafts")
                expect(page.locator(".result-group").first).to_be_visible()
                assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
                self.results.append({"case": name, "passed": True,
                                     "searchFirstTop": page.locator(".result-group").first.bounding_box()["y"]})

    def query_resume_and_clear(self):
        with self.case("query-resume-clear") as (page, _):
            self.goto(page, "/search?q=CPU&view=drafts")
            expect(page.locator(".result-group").first).to_be_visible()
            page.locator('[data-filter="sort"]').select_option("title")
            page.wait_for_function("location.hash.includes('sort=title')")
            expect(page.locator(".results-section")).to_have_attribute("aria-busy", "false")
            page.locator(".result-part-link").first.click()
            expect(page.locator(".reader-prose")).to_be_visible()
            page.locator(".reader-back").click()
            expect(page.locator("#global-search")).to_have_value("CPU")
            expect(page.locator('[data-filter="sort"]')).to_have_value("title")
            page.locator(".clear-search").click()
            expect(page.locator("#global-search")).to_have_value("")
            expect(page.locator('[data-filter="sort"]')).to_be_disabled()
            expect(page.locator(".results-section")).to_have_attribute("aria-busy", "false")
            assert "view=drafts" in page.evaluate("location.hash")
            self.goto(page, "/recent")
            timestamp = page.locator(".recent-list time").first
            expect(timestamp).to_be_visible()
            assert timestamp.get_attribute("datetime")
            self.results.append({"case": "query-resume-clear", "passed": True,
                                 "recentTime": timestamp.inner_text(),
                                 "datetime": timestamp.get_attribute("datetime")})

    def scope_and_cross_part(self):
        with self.case("reader-scope-cross-part") as (page, _):
            self.open_reader_find(page)
            self.submit_find(page, "主义", "article")
            self.wait_find_complete(page)
            expect(page.locator(".reader-search-results li").first).to_be_visible()
            assert set(page.locator(".reader-search-results li span").all_inner_texts()) == {"P1"}
            self.submit_find(page, "社会")
            self.wait_find_complete(page)
            expect(page.locator(".reader-search-results a").first).to_be_visible()
            expect(page.locator("[data-action=previous-hit]")).to_be_disabled()
            expect(page.locator("[data-action=next-hit]")).to_be_enabled()
            ids = page.locator(".reader-search-results a").evaluate_all(
                "nodes => nodes.map(node => node.dataset.editionId)")
            target = next(edition for edition in ids if edition != MULTI_EDITION)
            page.locator(f'.reader-search-results a[data-edition-id="{target}"]').first.click()
            page.wait_for_function("id => location.hash.includes(id)", arg=target)
            expect(page.locator(".reader-prose")).to_be_visible()
            page.locator("[data-tool=find]").click()
            expect(page.locator("#reader-search-input")).to_have_value("社会")
            expect(page.locator("[name=scope]")).to_have_value("video")
            page.locator("[data-action=next-hit]").click()
            expect(page.locator("[data-reader-tool=find]")).to_be_visible()
            expect(page.locator(".reader-hit-navigation span")).to_have_text(f"3 / {len(ids)}")
            page.locator(".reader-search-results a").last.click()
            expect(page.locator(".reader-prose")).to_be_visible()
            page.locator("[data-tool=find]").click()
            expect(page.locator("[data-action=next-hit]")).to_be_disabled()
            expect(page.locator("[data-action=previous-hit]")).to_be_enabled()
            self.results.append({"case": "reader-scope-cross-part", "passed": True,
                                 "hits": len(ids), "lastNavigation": page.locator(".reader-hit-navigation").inner_text()})

    def delayed_search_tool_switch(self):
        # Delay in the browser so Playwright can continue interacting while the
        # request waits. Each case gets fresh cache/storage and cancellation.
        script = """{
            const originalFetch = fetch;
            window.fetch = async (...args) => {
                if (String(args[0]).includes('search-video-drafts'))
                    await new Promise(resolve => setTimeout(resolve, 1200));
                return originalFetch(...args);
            };
        }"""
        with self.case("delayed-search-tool-switch", init_script=script) as (page, _):
            self.open_reader_find(page)
            self.submit_find(page, "社会")
            expect(page.locator("[data-reader-search]")).to_have_attribute("aria-busy", "true")
            page.locator("[data-action=close-tool]").click()
            page.locator("[data-tool=more]").click()
            page.wait_for_timeout(1600)
            page.locator("[data-action=close-tool]").click()
            page.locator("[data-tool=find]").click()
            self.wait_find_complete(page)
            expect(page.locator(".reader-search-results li").first).to_be_visible()
            self.results.append({"case": "delayed-search-tool-switch", "passed": True,
                                 "hits": page.locator(".reader-search-results li").count()})

    def rapid_hit_navigation(self):
        with self.case("rapid-reader-hit-navigation", {"width": 1440, "height": 900}) as (page, _):
            self.open_reader_find(page)
            self.submit_find(page, "主义", "article")
            self.wait_find_complete(page)
            expect(page.locator(".tool-drawer")).to_have_attribute("aria-busy", "false")
            targets = page.locator(".reader-search-results a").evaluate_all(
                "nodes => nodes.map(node => ({editionId:node.dataset.editionId, block:node.dataset.readerBlock}))")
            assert len(targets) >= 2 and all(target["editionId"] == MULTI_EDITION for target in targets)
            # Both actions run in one task, before either tool reflow settles.
            # No artificial frame delay or wait separates the two jumps.
            page.evaluate("""() => {
                document.querySelector('[data-action="next-hit"]').click();
                document.querySelector('[data-action="next-hit"]').click();
            }""")
            expect(page.locator(".tool-drawer")).to_have_attribute("aria-busy", "false")
            expect(page.locator(".reader-hit-navigation span")).to_have_text(f"2 / {len(targets)}")
            final = page.evaluate("""() => {
                const hash=location.hash, split=hash.indexOf('?');
                const article=[...document.querySelectorAll('.reader-article')].find(node=>node.getBoundingClientRect().bottom>90);
                const prose=article?.querySelector('.reader-prose');
                const block=[...prose?.querySelectorAll('[data-block-id]')||[]].find(node=>node.checkVisibility()&&node.getBoundingClientRect().bottom>90);
                return {hash, routeEdition:hash.slice(0,split<0?undefined:split).split('/').at(-1),
                    routeBlock:new URLSearchParams(split<0?'':hash.slice(split+1)).get('block'),
                    visibleEdition:article?.dataset.editionId, visibleBlock:block?.dataset.blockId};
            }""")
            target = targets[1]
            assert final["routeEdition"] == final["visibleEdition"] == target["editionId"], final
            assert final["routeBlock"] == final["visibleBlock"] == target["block"], final
            self.results.append({"case": "rapid-reader-hit-navigation", "passed": True,
                                 "target": target, "final": final})

    def failed_search_retry(self):
        with self.case("failed-search-retry") as (page, errors):
            attempts = 0

            def inject_failure(route):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    route.fulfill(status=503, body="Injected unavailable index")
                else:
                    route.continue_()

            # Matches development paths and Vite production hashed assets.
            page.route("**/*search-video-drafts*.json", inject_failure)
            self.open_reader_find(page)
            self.submit_find(page, "社会")
            expect(page.locator(".tool-sheet [role=alert]")).to_be_visible()
            self.wait_find_complete(page)
            # A browser network diagnostic for the injected HTTP 503 is expected;
            # all application console errors and any other network error fail.
            def expected_503(error):
                return error.startswith("Failed to load resource:") and "status of 503" in error

            expected_network_errors = [error for error in errors if expected_503(error)]
            assert len(expected_network_errors) <= 1, "Unexpected additional HTTP 503 errors"
            errors[:] = [error for error in errors if not expected_503(error)]
            self.submit_find(page, "社会")
            self.wait_find_complete(page)
            expect(page.locator(".reader-search-results li").first).to_be_visible()
            assert attempts == 2, f"Expected one failure then one retry, got {attempts}"
            self.results.append({"case": "failed-search-retry", "passed": True,
                                 "attempts": attempts, "expectedNetworkDiagnostics": expected_network_errors})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:5180/")
    parser.add_argument("--out", type=Path, default=Path("artifacts/discovery"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    result = {"base": args.base.rstrip("/"), "startedAt": datetime.now(timezone.utc).isoformat()}
    failure = None
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        acceptance = Acceptance(browser, args.base, args.out)
        try:
            acceptance.responsive()
            acceptance.query_resume_and_clear()
            acceptance.scope_and_cross_part()
            acceptance.rapid_hit_navigation()
            acceptance.delayed_search_tool_switch()
            acceptance.failed_search_retry()
        except Exception as error:
            failure = str(error)
        finally:
            browser.close()
        result.update({"passed": failure is None, "checks": acceptance.results, "failure": failure})
    result["completedAt"] = datetime.now(timezone.utc).isoformat()
    report_file = args.out / "report.json"
    report_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 1 if failure else 0


if __name__ == "__main__":
    sys.exit(main())
