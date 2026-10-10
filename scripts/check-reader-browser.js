// Run against an open dev or preview page:
// playwright-cli -s=p0 run-code --filename=scripts/check-reader-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = page.context();
  const errors = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = (target) => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  const requests = [];
  const isDocument = (url) => /\.md(?:\?|$)/.test(url) && !/[?&](?:url|import)(?:[=&]|$)/.test(url);
  const isSearchResource = (url) => /search-(?:(?:drafts|published)|(?:video-(?:drafts|published))|(?:candidates-(?:drafts|published))).*\.json(?:\?|$)/.test(url);
  const browser = await context.newPage();
  browser.on("pageerror", (error) => errors.push(error.message));
  browser.on("request", (request) => requests.push(request.url()));
  await browser.goto(base);
  await ready(browser);
  if (await browser.evaluate(() => document.documentElement.dataset.theme) === "dark") {
    await browser.getByRole("button", { name: "切换深浅主题" }).click();
  }
  assert(await browser.getByRole("heading", { name: "视频讲解，慢慢读。" }).count() === 1, "Home introduction missing");
  assert(!requests.some((url) => isDocument(url) || isSearchResource(url)), "Home fetched documents or search resources");
  const initialVideos = await browser.locator(".video-group").count();
  if (await browser.locator("#load-more").count()) {
    await browser.locator("#load-more").click();
    await browser.waitForFunction((count) => document.querySelectorAll(".video-group").length > count, initialVideos);
  }
  await browser.locator("#tag-filter-menu summary").click();
  await browser.getByRole("button", { name: "哲学", exact: true }).click();
  await ready(browser);
  await browser.getByRole("searchbox", { name: "搜索全部内容", exact: true }).fill("克尔凯郭尔");
  await browser.waitForFunction(() => document.querySelector(".passage-link mark")?.textContent === "克尔凯郭尔");
  assert(requests.some(isSearchResource), "Search resource was not requested");
  assert(!requests.some(isDocument), "Search fetched article bodies");
  const hit = browser.locator('.part-link[href*="#hit="]').first();
  await hit.scrollIntoViewIfNeeded();
  const before = await browser.evaluate(() => window.scrollY);
  await hit.click();
  await browser.locator(".search-passage mark").first().waitFor();
  assert((await browser.locator(".search-passage").textContent()).includes("克尔凯郭尔"), "Wrong search passage");
  assert(await browser.locator(".provenance").count() === 1, "Provenance missing");
  assert(requests.filter(isDocument).length === 1, "Reading loaded more than one document");
  await browser.screenshot({ path: "artifacts/p0-search-hit.png", animations: "disabled" });
  await browser.locator(".reading-navigation .back-link").click();
  await ready(browser);
  assert(await browser.locator("#search").inputValue() === "克尔凯郭尔", "Search query lost on return");
  assert(await browser.locator(".filter-current").textContent() === "哲学", "Tag lost on return");
  assert(Math.abs(await browser.evaluate(() => window.scrollY) - before) < 5, "Directory scroll lost on return");
  await browser.reload();
  await ready(browser);
  assert(await browser.locator("#search").inputValue() === "克尔凯郭尔", "Query lost after reload");
  await browser.locator("#clear-search").click();
  await browser.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false" && !document.querySelector("#directory-results mark"));
  const disclosure = browser.locator(".parts-disclosure").first();
  await disclosure.locator("summary").click();
  const video = await disclosure.getAttribute("data-video");
  const parts = await disclosure.locator(".part-number").allTextContents();
  assert(parts.length >= 2 && Number(parts[0].slice(1)) < Number(parts[1].slice(1)), "Directory parts are not in source order");
  await disclosure.locator(".part-link").first().click();
  await browser.locator(".prose").waitFor();
  const firstUrl = browser.url();
  assert(await browser.locator(".reading-heading .current-part").textContent() === parts[0], "Reader did not open the first collected part");
  await browser.locator(".reading-parts > summary").click();
  await browser.locator('.parts-navigation a[rel="next"]').first().click();
  await browser.waitForFunction((part) => document.querySelector(".reading-heading .current-part")?.textContent === part, parts[1]);
  assert(!browser.url().includes("#hit="), "Old search hash leaked to next part");
  await browser.goBack();
  await browser.waitForFunction((part) => document.querySelector(".reading-heading .current-part")?.textContent === part, parts[0]);
  const reference = browser.getByRole("link", { name: "校验参照稿件", exact: true });
  await reference.click();
  await browser.locator(".provenance > summary").click();
  await browser.locator(".review-reference-notice").waitFor();
  assert(await browser.locator(".prose").textContent() !== "", "Reference body missing");
  await browser.locator(".reading-navigation .back-link").click();
  await ready(browser);
  assert(await browser.locator(`.parts-disclosure[data-video="${video}"]`).getAttribute("open") !== null, "Expanded video lost on return");
  await browser.setViewportSize({ width: 390, height: 844 });
  await browser.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  assert(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile library overflow");
  await browser.screenshot({ path: "artifacts/p0-mobile.png", animations: "disabled" });
  await browser.getByRole("button", { name: "切换深浅主题" }).click();
  assert(await browser.evaluate(() => document.documentElement.dataset.theme) === "dark", "Dark mode not applied");
  await browser.screenshot({ path: "artifacts/p0-mobile-dark.png", animations: "disabled" });
  await browser.goto(firstUrl);
  await browser.locator(".prose").waitFor();
  assert(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile reader overflow");
  await browser.screenshot({ path: "artifacts/p0-reader-mobile.png", animations: "disabled" });
  await browser.goto(`${base}?view=published`);
  await ready(browser);
  if (await browser.getByRole("heading", { name: "暂无已发布稿件" }).count()) {
    assert(await browser.getByRole("link", { name: "阅读公开预览 →" }).count() === 1, "Empty published directory is a dead end");
  }
  await browser.goto(`${base}?draft=${"0".repeat(32)}`);
  await browser.getByRole("heading", { name: "没有找到这篇稿件" }).waitFor();
  assert(await browser.locator(".top-nav [aria-current]").count() === 0, "404 incorrectly marks a category active");
  assert(errors.length === 0, `Runtime errors: ${errors.join("; ")}`);
  await browser.close();
  return { passed: true, initialVideos, documentRequests: requests.filter(isDocument).length, checks: ["home lazy loading", "search index", "search passage", "directory state", "session reload", "expanded parts", "collected part order/history", "reference", "mobile light/dark", "empty publication", "404", "no runtime errors"] };
}
