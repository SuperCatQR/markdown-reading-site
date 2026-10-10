// Kept at the original path so existing verification commands check the replacement flow.
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const target = await context.newPage();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const requests = [];
  const errors = [];
  target.on("request", (request) => requests.push(request.url()));
  target.on("pageerror", (error) => errors.push(error.message));
  try {
    await target.goto(`${base}?view=all&q=`);
    await target.locator(".video-group").first().waitFor();
    const gaps = await target.locator(".video-group").first().evaluate((group) => {
      const meta = group.querySelector(".video-meta").getBoundingClientRect();
      const part = group.querySelector(".part-link").getBoundingClientRect();
      return { before: part.top - meta.bottom, after: group.getBoundingClientRect().bottom - part.bottom };
    });
    assert(gaps.before <= 8 && gaps.after <= 22, "Directory spacing regressed");
    const title = target.locator(".video-heading h2 a").first();
    assert((await title.getAttribute("href")).startsWith("?draft="), "Title is still an intermediate video route");
    await title.click();
    await target.locator(".reader-video-search").waitFor();
    assert(await target.locator(".video-overview, .parts-navigation").count() === 0, "Single-part page has redundant overview or navigation");
    assert(!await target.locator(".reader-video-search").evaluate((details) => details.open), "Search should start folded");
    assert(requests.filter((url) => /\.md$/.test(url)).length === 1, "Direct reading did not fetch just one body");
    assert(!requests.some((url) => /search-.*\.json/.test(url)), "Reader eagerly loaded index");
    for (const width of [1440, 1024, 768, 375]) {
      await target.setViewportSize({ width, height: 900 });
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    }
    await target.screenshot({ path: "artifacts/direct-reader-mobile-light.png" });
    await target.locator(".reader-site-menu > summary").click();
    await target.getByRole("button", { name: "切换深浅主题" }).click();
    await target.screenshot({ path: "artifacts/direct-reader-mobile-dark.png" });
    await target.locator("main").focus();
    await target.press("body", "/");
    assert(await target.locator(".reader-video-search").evaluate((details) => details.open), "Shortcut did not expand search");
    assert(await target.locator("#video-query").evaluate((input) => document.activeElement === input), "Shortcut did not focus search");
    await target.locator("#video-search-view").selectOption("published");
    await target.getByRole("heading", { name: "此类别暂无收录稿件" }).waitFor();
    assert(await target.locator(".reading-article .prose").isVisible(), "Empty category removed open article");
    await target.locator("#video-search-view").selectOption("drafts");
    await target.waitForFunction(() => document.querySelector("#video-results")?.textContent === "");
    await target.goto(`${base}?platform=bilibili&video=BV115411T7GZ&view=published`);
    await target.getByRole("heading", { name: "此类别暂无收录稿件" }).waitFor();
    assert(await target.evaluate(() => !new URL(location.href).searchParams.has("video")), "Legacy overview URL did not resolve to reader");
    assert(await target.locator("#video-search-view").inputValue() === "published", "Legacy empty category silently changed scope");
    await target.goto(`${base}?draft=1a8e79034ff148c78e7df5a6f1859b90`);
    await target.locator(".reader-video-search").waitFor();
    await target.setViewportSize({ width: 1440, height: 900 });
    await target.screenshot({ path: "artifacts/direct-reader-desktop.png" });
    assert(errors.length === 0, errors.join("\n"));
    return { passed: true, gaps, checks: ["direct title", "single-part simplicity", "explicit platform URLs", "empty category recovery", "keyboard search", "lazy loading", "responsive themes", "requested reader URL"] };
  } finally { await context.close(); }
}
