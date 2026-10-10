// playwright-cli -s=followup-search run-code --filename=scripts/check-scoped-search-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const contexts = [];
  const errors = [];
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const fresh = async (width = 1440) => {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, reducedMotion: "reduce" });
    contexts.push(context);
    const target = await context.newPage();
    target.on("pageerror", (error) => errors.push(error.message));
    return target;
  };
  const ready = (target) => target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
  const inputReady = async (target, query) => {
    const completed = await target.evaluate(() => performance.getEntriesByName("reader.search.total").length);
    await target.locator("#video-query").fill(query);
    await target.waitForFunction(({ completed, query }) => document.querySelector("#video-query")?.value === query
      && performance.getEntriesByName("reader.search.total").length > completed
      && document.querySelector("#video-results")?.getAttribute("aria-busy") === "false", { completed, query });
  };
  const visibleHit = async (target) => {
    const placement = await target.evaluate(() => ({
      top: document.querySelector(".search-passage")?.getBoundingClientRect().top,
      fixed: document.querySelector("#reader-search-navigation")?.getBoundingClientRect().bottom,
      focus: document.activeElement?.classList.contains("search-passage"),
      id: document.querySelector(".search-passage")?.id, hash: location.hash, scroll: scrollY,
      state: history.state,
    }));
    assert(placement.top >= placement.fixed && placement.top < 300, `Hit covered or misplaced: ${JSON.stringify(placement)}`);
    assert(placement.focus, "Hit did not receive keyboard focus");
  };
  const metrics = (target) => target.evaluate(() => ({
    userAgent: navigator.userAgent,
    stages: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search.")).map(({ name, duration, detail }) => ({ name, duration, detail })),
    resources: performance.getEntriesByType("resource").filter((entry) => /search-.*\.json/.test(entry.name)).map(({ name, duration, transferSize, encodedBodySize, decodedBodySize }) => ({ name, duration, transferSize, encodedBodySize, decodedBodySize })),
  }));
  try {
    const target = await fresh(390);
    const requests = [];
    target.on("request", (request) => { if (/search-.*\.json/.test(request.url())) requests.push(request.url()); });
    await target.goto(`${base}?draft=1a8e79034ff148c78e7df5a6f1859b90`);
    await target.locator(".prose [id]").first().waitFor();
    assert(await target.locator("#reader-search-navigation").isHidden(), "Ordinary reading shows search navigation");
    await target.locator("#reader-find").click();
    await target.locator("#video-query").fill("胡塞尔");
    await target.locator(".match-summary").first().waitFor();
    await ready(target);
    assert(requests.length === 1 && requests.every((url) => /search-video-drafts-BV115411T7GZ/.test(url)), "Single video query fetched the full library");
    const expectedCount = await target.locator("#video-results .passage-link").count();
    assert(expectedCount === 31, "The real Husserl fixture no longer has 31 matching paragraphs");
    const extra = target.locator(".passage-disclosure").first();
    await extra.locator("summary").click();
    await target.locator("#video-results .passage-link").first().click();
    await target.locator("#reader-search-navigation:not([hidden])").waitFor();
    await target.locator(".search-passage mark").first().waitFor();
    assert(await target.locator(".search-hit-position").textContent() === `1 / ${expectedCount}`, "Hit counter does not reflect actual paragraphs");
    assert(await target.locator('[data-search-hit="previous"]').count() === 0, "First hit wraps to previous");
    await visibleHit(target);
    await target.locator('[data-search-hit="next"]').focus();
    await target.keyboard.press("Enter");
    await target.waitForFunction(() => document.querySelector(".search-hit-position")?.textContent?.startsWith("2 /"));
    assert(await target.locator(".search-passage mark").count() > 0, "Next hit lost highlights");
    await visibleHit(target);
    await target.waitForFunction(() => document.querySelector(".search-passage")?.id === new URLSearchParams(location.hash.slice(1)).get("hit")
      && Math.abs((history.state?.articleScroll ?? -1) - scrollY) < 1);
    const secondHit = await target.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { id: document.querySelector(".search-passage").id, scroll: scrollY };
    });
    await target.goBack();
    await target.waitForFunction(() => document.querySelector(".search-hit-position")?.textContent?.startsWith("1 /")
      && document.querySelector(".search-passage mark")).catch(async () => {
        throw Error(`Back failed: ${JSON.stringify(await target.evaluate(() => ({ hash: location.hash, scroll: scrollY, mark: document.querySelector(".search-passage")?.id, nav: document.querySelector(".search-hit-position")?.textContent, state: history.state })))}`);
      });
    await ready(target);
    await target.goForward();
    await target.waitForFunction(({ id, scroll }) => document.querySelector(".search-hit-position")?.textContent?.startsWith("2 /")
      && document.querySelector(".search-passage")?.id === id && document.querySelector(".search-passage mark")
      && Math.abs(scrollY - scroll) < 5, secondHit).catch(async () => {
        throw Error(`Forward failed: ${JSON.stringify({ expected: secondHit, actual: await target.evaluate(() => ({ hash: location.hash, scroll: scrollY, mark: document.querySelector(".search-passage")?.id, nav: document.querySelector(".search-hit-position")?.textContent, state: history.state })) })}`);
      });
    await ready(target);
    assert(await target.locator("#video-query").inputValue() === "胡塞尔", "Hit history lost query");
    assert(await extra.evaluate((details) => details.open), "Hit history lost expansion");
    await visibleHit(target);
    await target.locator(".search-hit-actions > summary").click();
    await target.locator("[data-search-results]").click();
    assert(await target.locator("#video-query").inputValue() === "胡塞尔", "Return results lost query");
    assert(await extra.evaluate((details) => details.open), "Return results lost extra passages expansion");
    await target.locator("#video-results .passage-link").last().evaluate((link) => link.click());
    await target.waitForFunction((count) => document.querySelector(".search-hit-position")?.textContent === `${count} / ${count}`, expectedCount);
    assert(await target.locator('[data-search-hit="next"]').count() === 0, "Last hit wraps to next");
    await target.locator(".search-hit-actions > summary").click();
    await target.locator("[data-search-end]").click();
    assert(await target.locator("#reader-search-navigation").isHidden(), "End kept navigation active");
    assert(await target.locator("#video-query").inputValue() === "胡塞尔", "End destroyed retained query");
    assert(await target.evaluate(() => !location.hash.startsWith("#hit=")), "End kept hit URL");
    assert(await target.locator(".search-passage mark").count() === 0, "End kept search-only highlights");
    assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Search navigation overflows phone");

    await target.goto(`${base}?platform=bilibili&video=BV1dA411T7xD&view=drafts&q=${encodeURIComponent("审美")}`);
    await target.locator(".match-summary").first().waitFor();
    await ready(target);
    const first = target.locator("#video-results .video-part").first();
    const firstPart = await first.locator(".part-number").textContent();
    const secondPart = await target.locator("#video-results .video-part").nth(1).locator(".part-number").textContent();
    const firstHits = await first.locator(".passage-link").count();
    await first.locator(".passage-disclosure summary").click();
    await first.locator(".passage-link").last().evaluate((link) => link.click());
    await target.waitForFunction((position) => document.querySelector(".search-hit-position")?.textContent?.startsWith(`${position} /`), firstHits);
    await target.locator('[data-search-hit="next"]').click();
    await target.locator(".reading-meta .current-part").filter({ hasText: secondPart }).waitFor();
    await ready(target);
    await visibleHit(target);
    assert(await target.locator(".reading-status").textContent().then((text) => text.includes("未发布")), "Cross-P mixed release category");
    assert(await target.locator("#video-query").inputValue() === "审美", "Cross-P lost query");
    assert(await target.locator("#video-results .passage-disclosure").first().evaluate((details) => details.open), "Cross-P lost expanded result state");
    await target.locator('[data-search-hit="previous"]').click();
    await target.locator(".reading-meta .current-part").filter({ hasText: firstPart }).waitFor();
    await ready(target);

    // In all-keywords mode each paragraph hash contains only its local terms;
    // the video request must retain the full query across P navigation.
    await target.locator("#reader-find").click();
    await target.locator("#advanced-search > summary").click();
    await target.getByRole("radio", { name: "正文关键词", exact: true }).check();
    await inputReady(target, "审美 痛苦");
    const fullQueryCount = await target.locator("#video-results .passage-link").count();
    assert(fullQueryCount > 2, "Keyword fixture lacks multiple body passages");
    await target.locator("#video-results .passage-link").first().click();
    await target.locator("#reader-search-navigation:not([hidden])").waitFor();
    assert(await target.locator("#video-query").inputValue() === "审美 痛苦", "First keyword hit lost the full query");
    await target.locator('[data-search-hit="next"]').click();
    await target.waitForFunction(() => document.querySelector(".search-hit-position")?.textContent?.startsWith("2 /"));
    assert(await target.locator("#video-query").inputValue() === "审美 痛苦", "Next keyword hit replaced full query with local terms");
    assert(await target.locator('[name="search-mode"][value="keywords"]').isChecked(), "Keyword mode lost on hit navigation");
    await visibleHit(target);

    // Composition input is held until committed, then runs the latest request.
    await target.locator("#reader-find").click();
    const beforeComposition = await target.evaluate(() => ({ url: location.href, total: performance.getEntriesByName("reader.search.total").length }));
    await target.locator("#video-query").evaluate((input) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "自由";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    });
    await target.waitForTimeout(180); // Deliberately exceed the 120ms debounce while composing.
    assert(await target.evaluate(() => location.href) === beforeComposition.url, "Intermediate IME text altered share URL");
    assert(await target.evaluate(() => performance.getEntriesByName("reader.search.total").length) === beforeComposition.total, "Intermediate IME text started search");
    await target.locator("#video-query").evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await target.waitForFunction((completed) => performance.getEntriesByName("reader.search.total").length > completed
      && document.querySelector("#video-results")?.getAttribute("aria-busy") === "false", beforeComposition.total);
    assert(await target.locator("#video-query").inputValue() === "自由", "Committed IME query was lost");
    assert(await target.locator("#reader-search-navigation").isHidden(), "Changed query retained an unrelated hit navigator");

    await target.locator("#video-search-view").selectOption("published");
    await target.getByRole("heading", { name: "本视频没有匹配的稿件" }).waitFor();
    assert(await target.locator("#video-results .video-part").count() === 0, "Draft results leaked into published scope");
    await target.locator("#video-search-view").selectOption("all");
    await target.locator(".match-summary").first().waitFor();
    await ready(target);
    assert(await target.locator("#video-results .status-published").count() === 0, "Combined scope fabricated published manuscripts");

    await inputReady(target, "不存在的紫色大树xyz");
    assert(await target.locator("#reader-search-navigation").isHidden(), "No matches kept navigation visible");
    await target.getByRole("heading", { name: "本视频没有匹配的稿件" }).waitFor();

    for (const width of [320, 390]) {
      const enlarged = await fresh(width);
      await enlarged.goto(`${base}?draft=1a8e79034ff148c78e7df5a6f1859b90&vq=${encodeURIComponent("胡塞尔")}&vview=drafts#hit=passage-1&q=${encodeURIComponent("胡塞尔")}`);
      await enlarged.locator(".search-hit-position").waitFor();
      await ready(enlarged);
      // Keep the doubled typography rule active when hash navigation replaces
      // the toolbar markup; its ResizeObserver must update the real clearance.
      await enlarged.addStyleTag({ content: ".search-hit-navigation,.search-hit-navigation a,.search-hit-navigation span,.search-hit-actions>summary,.search-hit-actions p,.search-hit-actions button{font-size:26px!important}" });
      await enlarged.locator('[data-search-hit="next"]').focus();
      await enlarged.keyboard.press("Enter");
      await enlarged.waitForFunction(() => document.querySelector(".search-hit-position")?.textContent?.startsWith("2 /"));
      await visibleHit(enlarged);
      assert(await enlarged.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Enlarged navigation overflows narrow viewport");
      assert(await enlarged.evaluate(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--search-tools-height"))
        - document.querySelector("#reader-search-navigation").getBoundingClientRect().height) < 1), "Enlarged toolbar height was not observed");
      await enlarged.locator(".search-hit-actions > summary").click();
      assert(await enlarged.locator("[data-search-end]").isVisible(), "Enlarged navigation actions cannot be reached");
    }

    const samples = [];
    for (const network of ["normal", "limited"]) for (let i = 0; i < 3; i++) {
      const measured = await fresh();
      const cdp = await measured.context().newCDPSession(measured);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      if (network === "limited") await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 125000, uploadThroughput: 125000 });
      await measured.goto(`${base}?draft=20b3456f06f64577850122410d980c81&vq=${encodeURIComponent("无意识")}&vview=drafts`);
      await measured.locator(".match-summary").first().waitFor();
      await ready(measured);
      const cold = await metrics(measured);
      await inputReady(measured, "无意识概念");
      await measured.evaluate(() => performance.clearMeasures());
      await inputReady(measured, "无意识");
      const warm = await metrics(measured);
      assert(cold.resources.length === 1 && /search-video-drafts-/.test(cold.resources[0].name), "Measured query requested unrelated library data");
      assert(warm.stages.some((stage) => stage.name === "reader.search.memory-cache") && warm.stages.some((stage) => stage.name === "reader.search.total"), "Warm metrics sampled before the debounced query finished");
      assert(warm.resources.length === cold.resources.length, "Warm in-page query requested another index");
      samples.push({ network, sample: i + 1, cold, warm });
    }
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, conditions: "Windows Chromium, local production Pages subpath. normal unthrottled loopback; limited simulated RTT150ms and 125000bytes/s (1Mbps). 3 fresh cache-disabled samples per network; warm repeats same query using in-page Promise. Stage total excludes debounce and paint. These timings do not measure live CDN performance.",
      checks: ["video-only requests", "ordinary reading hides navigation", "31 Husserl paragraphs", "first/keyboard-next/last hit", "hit Back/Forward position/highlight/query/expansion", "hit focus and fixed toolbar clearance", "return and end retain query/expansion", "cross-P exact draft query/expanded state", "full keyword query retention", "IME commit", "category isolation and empty results", "320/390px doubled navigation text", "reduced motion", "cold/warm normal/throttled stage measurements"], samples };
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
