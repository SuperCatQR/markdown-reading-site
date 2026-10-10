async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const ready = (target) => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  const errors = [];
  const contexts = [];
  const fresh = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    contexts.push(context);
    const target = await context.newPage();
    target.on("pageerror", (error) => errors.push(error.message));
    return target;
  };
  const metrics = (target) => target.evaluate(() => ({
    userAgent: navigator.userAgent,
    stages: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search.")).map(({ name, duration, detail }) => ({ name, duration, detail })),
    resources: performance.getEntriesByType("resource").filter((entry) => /search-(drafts|published|pairs|candidates|video)/.test(entry.name)).map(({ name, duration, transferSize, encodedBodySize, decodedBodySize }) => ({ name, duration, transferSize, encodedBodySize, decodedBodySize })),
  }));
  try {
    const slow = await fresh();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await slow.route(/search-pairs-drafts[^/]*\.json/, async (route) => { await gate; await route.continue(); });
    await slow.goto(`${base}?view=drafts&q=`);
    await ready(slow);
    assert(await slow.locator("#directory-results a").count() > 0, "Initial content absent");
    await slow.locator("#search").fill("海德格尔");
    await slow.locator("#cancel-search").waitFor();
    assert(await slow.locator("#directory-results a").count() === 0, "Stale links remain clickable during index load");
    await slow.locator("#directory-results").getByText(/搜索资料仍在加载/).waitFor();
    await slow.locator("#search").fill("不存在的词xyz987");
    await slow.locator("#cancel-search").click();
    await ready(slow);
    assert(await slow.locator("#search").inputValue() === "", "Cancel did not clear query");
    const response = slow.waitForResponse((response) => /search-pairs-drafts[^/]*\.json/.test(response.url()));
    release();
    await response;
    await slow.waitForFunction(() => performance.getEntriesByName("reader.search.parse").length > 0);
    assert(await slow.locator("#search").inputValue() === "" && await slow.locator(".match-summary").count() === 0, "Late response overrode clear");
    await slow.locator("#search").fill("海德格尔");
    await ready(slow);
    await slow.waitForFunction(() => new URL(location.href).searchParams.get("q") === "海德格尔" && document.querySelector(".match-summary"));
    const input = slow.locator("#search");
    await input.dispatchEvent("compositionstart");
    await input.fill("克尔凯郭尔");
    assert(await slow.locator("#search").count() === 1, "Composition input rebuilt");
    await input.dispatchEvent("compositionend");
    await slow.waitForFunction(() => new URL(location.href).searchParams.get("q") === "克尔凯郭尔" && document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
    await slow.locator("#advanced-search > summary").click();
    await slow.locator("#search-sort").selectOption("title");
    await slow.waitForFunction(() => new URL(location.href).searchParams.get("sort") === "title" && document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
    const shared = slow.url();
    const firstResult = await slow.locator(".video-heading h2").first().textContent();
    await slow.locator(".video-heading h2 a").first().click();
    await slow.locator(".reading-article .prose").waitFor();
    await slow.goBack();
    await ready(slow);
    assert(await slow.locator("#search-sort").inputValue() === "title", "History lost sort");
    await slow.reload();
    await ready(slow);
    assert(await slow.locator("#search-sort").inputValue() === "title", "Refresh lost sort");
    const sharedPage = await fresh();
    await sharedPage.goto(shared);
    await ready(sharedPage);
    assert(await sharedPage.locator("#search-sort").inputValue() === "title", "Share lost sort");
    assert(await sharedPage.locator(".video-heading h2").first().textContent() === firstResult, "Share changed sort result");
    await sharedPage.getByRole("radio", { name: "正文原句", exact: true }).check();
    assert(await sharedPage.locator("#search-sort").isDisabled(), "Phrase search offered unsupported title sort");

    const failed = await fresh();
    let attempts = 0;
    await failed.route(/search-candidates-drafts[^/]*\.json/, async (route) => ++attempts === 1 ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
    await failed.goto(`${base}?view=drafts&q=${encodeURIComponent("自由")}`);
    await failed.locator("#retry-search").waitFor();
    assert(await failed.locator("#directory-results a").count() === 0, "Failure retained old links");
    await failed.locator("#retry-search").click();
    await ready(failed);
    assert(attempts === 2 && await failed.locator(".video-group").count() > 0, "Retry did not reload successfully");

    const leaving = await fresh();
    let resume;
    const leaveGate = new Promise((resolve) => { resume = resolve; });
    await leaving.route(/search-pairs-drafts[^/]*\.json/, async (route) => { await leaveGate; await route.continue(); });
    await leaving.goto(`${base}?view=drafts&q=${encodeURIComponent("自由")}`);
    await leaving.locator("#cancel-search").waitFor();
    await leaving.locator('.top-nav a[href="?view=published"]').click();
    await ready(leaving);
    const late = leaving.waitForResponse((response) => /search-pairs-drafts[^/]*\.json/.test(response.url()));
    resume();
    await late;
    await leaving.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => /search-pairs-drafts/.test(entry.name)));
    assert(await leaving.evaluate(() => new URL(location.href).searchParams.get("view") === "published"), "Late response changed directory category");
    assert(await leaving.locator("#search").inputValue() === "" && await leaving.locator(".match-summary").count() === 0, "Late response rendered wrong category matches");

    const samples = [];
    for (let i = 0; i < 3; i++) {
      const target = await fresh();
      const cdp = await target.context().newCDPSession(target);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await target.goto(`${base}?view=drafts&q=${encodeURIComponent("海德格尔")}`);
      await ready(target);
      const cold = await metrics(target);
      await target.evaluate(() => performance.clearMeasures());
      await target.locator("#search").fill("海德格尔思想");
      await target.waitForFunction(() => new URL(location.href).searchParams.get("q") === "海德格尔思想" && document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
      await target.evaluate(() => performance.clearMeasures());
      await target.locator("#search").fill("海德格尔");
      await target.waitForFunction(() => new URL(location.href).searchParams.get("q") === "海德格尔" && document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
      const warm = await metrics(target);
      samples.push({ sample: i + 1, cold, warm });
    }
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, conditions: "Local Chromium desktop 1440x900, no network throttle; HTTP cache disabled for three fresh cold pages; cold and warm both search 海德格尔, warm queries reuse in-page Promise and normalized text. Stage total excludes 120ms input debounce and subsequent paint.",
      checks: ["slow load replaces stale links", "long wait explanation", "change query", "cancel then late response", "leave and switch category during pending request", "IME", "sort history/refresh/share", "phrase sort disabled", "503 retry"], samples };
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
