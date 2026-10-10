async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const target = await context.newPage(), errors = [];
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  target.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    const checked = [];
    for (const view of ["published", "drafts"]) {
      await target.goto(`${base}?view=${view}`);
      await target.locator(".video-heading h2 a").first().waitFor();
      await target.locator(".video-heading h2 a").first().click();
      await target.locator(".reading-series").waitFor();
      await target.locator(".reading-series > summary").click();
      const series = target.locator(".reading-series");
      assert((await series.textContent()).includes("合成"), "Synthetic metadata missing");
      assert((await series.textContent()).includes("编辑确认缺失"), "Confirmed missing not distinguished");
      assert((await series.textContent()).includes("当前稿件类别暂无收录"), "Unavailable category links were inferred");
      const links = await series.locator(".series-parts a").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
      assert(links.length === (view === "drafts" ? 2 : 1) && links.every((href) => href.startsWith(view === "drafts" ? "?draft=" : "?read=")), "Series links crossed category");
      const evidence = series.locator('a[target="_blank"]');
      assert(await evidence.getAttribute("rel") === "noopener noreferrer", "Evidence opener isolation missing");
      await series.locator(".series-parts a").first().click();
      await target.locator(".prose").waitFor();
      const documentUrl = target.url();
      const bvid = await target.locator("article .reading-actions a").getAttribute("href");
      const videoId = bvid.split("/video/")[1].split("/")[0];
      await target.goto(`${base}?video=${videoId}&view=${view}&flow=continuous`);
      await target.locator(".continuous-part .prose").waitFor();
      await target.locator(".reading-series > summary").click();
      assert(await target.locator(".reading-series .series-parts a").count() === (view === "drafts" ? 2 : 1), "Continuous series entries missing");
      assert((await target.locator(".reading-series").textContent()).includes("编辑确认缺失"), "Continuous missing indication lost");
      if (view === "drafts") {
        const next = target.locator('.series-adjacent a[rel="next"]');
        assert(await next.count() === 1 && await next.getAttribute("href") === links[1], "Continuous reader cannot navigate confirmed next video");
        await next.click();
        await target.locator(".reading-article .prose").waitFor();
        assert(await target.locator('.series-adjacent a[rel="prev"]').getAttribute("href") === links[0], "Previous video link not exact");
      }
      assert(!await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), "Mobile series overflows");
      await target.screenshot({ path: `artifacts/third-series-${view}-mobile.png` });
      checked.push({ view, documentUrl, links });
    }
    await target.setViewportSize({ width: 1440, height: 1000 });
    await target.emulateMedia({ colorScheme: "dark" });
    await target.screenshot({ path: "artifacts/third-series-desktop-dark.png" });
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, checked, checks: ["real upstream synthetic export pair", "both category links", "confirmed missing vs unavailable", "evidence safety", "continuous reader", "mobile and desktop dark"] };
  } finally { await context.close(); }
}
