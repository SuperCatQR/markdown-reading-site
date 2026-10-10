async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const target = await context.newPage();
  const errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    await target.goto(base);
    const fixture = await target.evaluate(async () => {
      const asset = performance.getEntriesByType("resource").find((resource) => resource.name.includes("/reader-catalog-")).name;
      const catalogModule = await import(asset);
      const catalog = Object.values(catalogModule).find((value) => value?.articles?.some((entry) => entry.manuscriptType === "publication-draft"));
      const current = catalog.articles.find((entry) => entry.platform === "bilibili");
      const following = catalog.articles.find((entry) => entry.platform === "bilibili" && entry.externalVideoId !== current.externalVideoId);
      const binding = ({ slug, editionId, contentSha256, artifactSha256 }) => ({ slug, editionId, contentSha256, artifactSha256 });
      const definitions = [{ id: "synthetic-review-only", title: "合成系列验收", sourceUrl: "https://example.test/review", evidence: "离线合成的编辑依据，未录入快照。",
        members: [{ bvid: current.externalVideoId, label: "合成开始", ordinal: 1, entries: catalog.articles.filter((entry) => entry.externalVideoId === current.externalVideoId).sort((a, b) => a.partIndex - b.partIndex).map(binding) },
          { bvid: following.externalVideoId, label: "合成继续", ordinal: 3, entries: catalog.articles.filter((entry) => entry.externalVideoId === following.externalVideoId).sort((a, b) => a.partIndex - b.partIndex).map(binding) },
          { bvid: "BV0000000000", label: "合成未导出", ordinal: 4, entries: [] }],
        knownMissing: [{ ordinal: 2, label: "合成编辑确认缺失", note: "仅合成验收说明。" }] }];
      return { current, following, entries: catalog.articles, definitions };
    });
    await target.goto(`${base}?platform=bilibili&video=${fixture.current.externalVideoId}&view=drafts&flow=continuous&part=${fixture.current.editionId}`);
    await target.locator(".continuous-part .prose").first().waitFor();
    await target.evaluate(async (fixture) => {
      const asset = performance.getEntriesByType("resource").find((resource) => resource.name.includes("/continuous-reader-")).name;
      const { createContinuousReader } = await import(asset);
      const app = document.querySelector("#app");
      const seriesEntries = fixture.entries;
      const route = { kind: "continuous", entry: fixture.current, videoKey: `bilibili.${fixture.current.externalVideoId}`, view: "drafts",
        entries: seriesEntries.filter((entry) => entry.externalVideoId === fixture.current.externalVideoId).sort((a, b) => a.partIndex - b.partIndex) };
      const reader = createContinuousReader({ app, route, seriesEntries, series: fixture.definitions,
        videoEntries: route.entries, pageHeader: () => "", loadBody: async () => "# 合成验收\n\n连续正文。", isCurrent: () => true, onReady() {} });
      await reader.render();
    }, fixture);
    await target.locator(".reading-series > summary").click();
    assert(await target.locator(".reading-series nav li").count() === 4, "Synthetic source order or missing positions lost");
    assert(await target.locator(`.reading-series a[href="?draft=${fixture.following.editionId}"]`).count() === 1, "Continuous series cannot resolve other-video entries from full category catalog");
    assert((await target.locator(".reading-series").textContent()).includes("编辑确认缺失"), "Missing position mislabeled");
    assert((await target.locator(".reading-series").textContent()).includes("当前稿件类别暂无收录"), "Unavailable category lacks accurate explanation");
    assert(await target.locator('.reading-series a[href*="?review="], .reading-series a[href*="?read="]').count() === 0, "Series crosses category or links reference");
    for (const width of [320, 390, 1440]) {
      await target.setViewportSize({ width, height: 844 });
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Series overflow at ${width}`);
    }
    await target.setViewportSize({ width: 390, height: 844 });
    await target.locator(".reading-series").scrollIntoViewIfNeeded();
    await target.screenshot({ path: "artifacts/third-series-synthetic-mobile.png" });
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, syntheticOnly: true, productionInputsChanged: false, checks: ["production continuous module", "full category other-video links", "source order", "missing versus unavailable", "category isolation", "320/390/1440 widths"] };
  } finally { await context.close(); }
}
