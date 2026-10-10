// Run on the isolated producer fixture site, in development or preview mode:
// playwright-cli -s=universal goto http://127.0.0.1:5177/
// playwright-cli -s=universal run-code --filename=scripts/check-universal-reader-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ reducedMotion: "reduce" });
  const target = await context.newPage();
  const assert = (value, message) => { if (!value) throw Error(message); };
  const errors = [];
  target.on("pageerror", error => errors.push(error.message));
  const ready = () => target.locator(".reading-article .prose, .continuous-part .prose").first().waitFor();
  const oldValue = '{"schemaVersion":1,"records":[{"bvid":"BVold"}]}';
  await context.addInitScript(value => {
    if (!localStorage.getItem("reader-history-v1")) localStorage.setItem("reader-history-v1", value);
  }, oldValue);
  try {
    await target.goto(base);
    await target.locator(".directory-shell").waitFor();
    const catalogs = await target.evaluate(async () => {
      const asset = performance.getEntriesByType("resource").find(r => /\/reader-catalog-/.test(r.name));
      if (asset) return Object.values(await import(asset.name)).filter(v => Array.isArray(v?.articles));
      return Promise.all(["content", "draft-content"].map(async folder => (await fetch(`${folder}/catalog.json`)).json()));
    });
    const entries = catalogs.flatMap(c => c.articles);
    assert(entries.some(e => e.platform === "youtube") && entries.some(e => e.platform === "bilibili"), "Requires both producer platforms");
    assert(entries.some(e => e.manuscriptType === "publication"), "Requires explicitly published producer fixture");
    let visits = 0;
    for (const width of [1440, 390, 320]) {
      await target.setViewportSize({ width, height: 900 });
      for (const entry of entries) {
        const view = entry.manuscriptType === "publication" ? "published" : "drafts";
        const selector = view === "published" ? `read=${entry.slug}` : `draft=${entry.editionId}`;
        await target.goto(`${base}?${selector}`);
        await ready();
        assert((await target.locator(".reader-tools .reader-current-label").textContent()) === (entry.platform === "youtube" ? "单视频" : `P${entry.partIndex + 1}`), "Incorrect platform part label");
        await target.locator(".reading-information > summary").click();
        await target.locator(".provenance > summary").click();
        const source = await target.locator(".provenance").textContent();
        assert(source.includes(entry.sourceMetadata.title), "Frozen source title lost");
        assert(source.includes(entry.sourceMetadata.creatorName || "未知"), "Unknown creator invented");
        assert(source.includes(entry.sourcePublishedAt || "未知"), "Unknown source time replaced");
        assert(await target.locator(".provenance a").first().getAttribute("href") === entry.sourceUrl, "Wrong source URL");
        assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
        const requests = [];
        const capture = request => { if (/search.*\.json/.test(request.url())) requests.push(request.url()); };
        target.on("request", capture);
        await target.locator("#reader-find").evaluate(button => button.click());
        await target.locator("#video-query").fill("contract-test-no-match");
        await target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false"
          && document.querySelector("#video-result-count")?.textContent.includes("篇稿件"));
        target.off("request", capture);
        assert(requests.length === 1, `Local search made unexpected requests: ${JSON.stringify(requests)}`);
        // Rollup may deduplicate a single-video index with the category index
        // when their bytes are identical. Check the actual response boundary.
        const index = await target.evaluate(async url => (await fetch(url)).json(), requests[0]);
        const expected = entries.filter(e => e.platform === entry.platform && e.externalVideoId === entry.externalVideoId
          && e.manuscriptType === entry.manuscriptType).map(e => `${e.manuscriptType}:${e.editionId}`).sort();
        assert(JSON.stringify(Object.keys(index).sort()) === JSON.stringify(expected), "Local search fetched outside platform/category scope");
        assert(!requests[0].includes("search-video-") || /[0-9a-f]{64}/.test(requests[0]), "Video asset lacks source key digest");
        assert(!requests[0].includes(entry.externalVideoId), "External ID used as asset path");
        await target.goto(`${base}?review=${entry.editionId}`);
        await ready();
        assert(await target.locator(".review-help").count() === 1, "Reference cannot be read");
        if (entry.platform === "youtube") {
          await target.goto(`${base}?platform=youtube&video=${entry.externalVideoId}&view=${view}&flow=continuous&part=${entry.editionId}`);
          await target.locator(".continuous-part .prose").waitFor();
          assert(await target.locator(".continuous-part").count() === 1, "YouTube synthesized multiple parts");
        }
        visits++;
      }
    }
    for (const query of ["?video=BVpreserve", "?platform=unknown&video=BVpreserve", "?platform=youtube&video=BVpreserve", "?platform=bilibili&video=BVpreserve&platform=youtube"]) {
      await target.goto(base + query);
      await target.locator(".empty-state").waitFor();
      assert(await target.locator(".reading-article").count() === 0, "Invalid or old route accepted");
    }
    assert(await target.evaluate(() => localStorage.getItem("reader-history-v1")) === oldValue, "Old progress changed");
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, visits, widths: [1440, 390, 320], platforms: ["bilibili", "youtube"], publicAndDraft: true,
      frozenSource: true, hashedScopedSearch: true, reference: true, oldStorageUntouched: true, productionInputsChanged: false };
  } finally { await context.close(); }
}
