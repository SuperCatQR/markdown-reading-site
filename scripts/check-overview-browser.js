// playwright-cli -s=p0 run-code --filename=scripts/check-overview-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const ready = () => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  const requests = [];
  const errors = [];
  target.on("request", (request) => requests.push(request.url()));
  target.on("pageerror", (error) => errors.push(error.message));
  try {
    await target.goto(`${base}?view=all&q=`);
    await ready();
    const gaps = await target.locator(".video-group").first().evaluate((group) => {
      const meta = group.querySelector(".video-meta").getBoundingClientRect();
      const part = group.querySelector(".part-link").getBoundingClientRect();
      return { before: part.top - meta.bottom, after: group.getBoundingClientRect().bottom - part.bottom };
    });
    assert(gaps.before <= 8 && gaps.after <= 22, `Excess directory whitespace: ${JSON.stringify(gaps)}`);
    await target.screenshot({ path: "artifacts/compact-directory-desktop.png" });
    await target.goto(`${base}?video=BV115411T7GZ&view=all&q=`);
    await ready();
    assert(!await target.locator(".video-search").evaluate((details) => details.open), "Search should start folded");
    assert(!await target.locator(".video-category").evaluate((details) => details.open), "Single category should start folded");
    assert(await target.locator(".continuous-entry").count() === 0, "Single part has duplicate continuous action");
    assert(!await target.locator("#result-count").isVisible(), "Unfiltered result count duplicates metadata");
    for (const width of [1440, 1024, 768, 375]) {
      await target.setViewportSize({ width, height: 900 });
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      const part = await target.locator(".part-link").boundingBox();
      assert(part.y + part.height <= 900, `Single part below viewport at ${width}`);
      assert(part.height >= 44, "Reading target too small");
      if ([1440, 375].includes(width)) await target.screenshot({ path: `artifacts/single-video-${width}-light.png` });
    }
    assert(!requests.some((url) => /\.md$|search-.*\.json/.test(url)), "Browse eagerly fetched content");
    await target.getByRole("button", { name: "切换深浅主题" }).click();
    await target.screenshot({ path: "artifacts/single-video-mobile-dark.png" });
    await target.locator(".video-source-details > summary").click();
    assert(await target.locator(".video-source-details .article-tags").isVisible(), "Source tags unavailable");
    await target.locator(".video-source-details > summary").click();
    await target.locator(".part-link").click();
    await target.locator(".reading-article .prose").waitFor();
    await target.getByRole("link", { name: "视频总览 · 全部分 P →" }).click();
    await ready();
    await target.press("body", "/");
    assert(await target.locator(".video-search").evaluate((details) => details.open), "Search shortcut did not expand controls");
    assert(await target.locator("#search").evaluate((input) => document.activeElement === input), "Shortcut did not focus search");
    await target.locator(".video-category > summary").click();
    await target.getByRole("navigation", { name: "视频稿件类别" }).getByRole("link", { name: "已发布 0", exact: true }).click();
    await ready();
    await target.getByRole("heading", { name: "此类别暂无收录稿件" }).waitFor();
    assert(await target.locator(".video-category").evaluate((details) => details.open), "Empty category blocked recovery");
    await target.getByRole("navigation", { name: "视频稿件类别" }).getByRole("link", { name: "未发布 1", exact: true }).click();
    await ready();
    await target.locator(".part-link").waitFor();
    assert(errors.length === 0, errors.join("\n"));
    return { passed: true, gaps, checks: ["compact rows", "single primary reading action", "optional controls", "source tags", "empty category recovery", "keyboard search", "lazy loading", "responsive themes"] };
  } finally { await context.close(); }
}
