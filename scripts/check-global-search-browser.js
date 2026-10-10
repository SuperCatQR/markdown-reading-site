async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const contexts = [];
  const errors = [];
  let stage = "initial";
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const ready = (target) => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  const fresh = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    contexts.push(context);
    const target = await context.newPage();
    target.on("pageerror", (error) => errors.push(error.message));
    await target.goto(`${base}?view=drafts&q=`, { waitUntil: "domcontentloaded" });
    await ready(target);
    return target;
  };
  try {
    const candidatePattern = /search-pairs-drafts[^/]*\.json/;
    const bodyPattern = /search-video-drafts[^/]*\.json/;
    const noQuery = await fresh();
    stage = "empty";
    console.log("stage: empty directory ready");
    assert(await noQuery.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /search-(pairs|candidates|video|drafts)/.test(entry.name)).length) === 0, "Empty directory eagerly downloads search data");

    for (const failurePattern of [candidatePattern, bodyPattern]) {
      const failed = await fresh();
      stage = `failure ${failurePattern}`;
      console.log(`stage: failure ${failurePattern}`);
      let count = 0;
      await failed.route(failurePattern, (route) => { count++; return count === 1 ? route.fulfill({ status: 503, body: "Unavailable" }) : route.continue(); });
      await failed.locator("#search").fill("海德格尔");
      await failed.locator("#retry-search").waitFor();
      assert(await failed.locator("#result-count").textContent() === "搜索未完成", "Partial result count escaped on failure");
      await failed.locator("#retry-search").click();
      await ready(failed);
      console.log("stage: retry ready");
      assert(/131\s*\/\s*583/.test(await failed.locator("#result-count").textContent()), "Retry results are incomplete");
      assert(await failed.locator(".match-summary").count() > 0, "Body evidence lost after retry");
    }

    const delayed = await fresh();
    stage = "delayed";
    console.log("stage: delayed");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await delayed.route(candidatePattern, async (route) => { await gate; await route.continue(); });
    await delayed.locator("#search").fill("海德格尔");
    await delayed.locator("#cancel-search").waitFor();
    await delayed.locator("#directory-results").getByText(/搜索资料仍在加载/).waitFor();
    await delayed.locator("#cancel-search").click();
    await ready(delayed);
    release();
    await delayed.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => /search-pairs/.test(entry.name)));
    assert(await delayed.locator("#search").inputValue() === "" && await delayed.locator(".match-summary").count() === 0, "Late candidate result replaced cancelled directory");
    assert(await delayed.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /search-video/.test(entry.name)).length) === 0, "Cancelled candidate query queued body downloads");

    const latest = await fresh();
    stage = "latest";
    console.log("stage: latest");
    let releaseLatest;
    const latestGate = new Promise((resolve) => { releaseLatest = resolve; });
    await latest.route(candidatePattern, async (route) => { await latestGate; await route.continue(); });
    await latest.locator("#search").fill("海德格尔");
    await latest.locator("#cancel-search").waitFor();
    await latest.locator("#search").fill("胡塞尔");
    // The debounce creates a second request version before the shared response
    // is released. Observe that version through persisted URL rather than sleep.
    await latest.waitForFunction(() => new URL(location.href).searchParams.get("q") === "胡塞尔");
    releaseLatest();
    await ready(latest);
    assert(/80\s*\/\s*583/.test(await latest.locator("#result-count").textContent()), "Superseded query replaced latest results");
    assert(await latest.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /search-drafts-[^/]*\.json/.test(entry.name)).length) === 0, "Concept query fell back to complete index");
    await latest.locator("#search").dispatchEvent("compositionstart");
    await latest.locator("#search").fill("无意义不存在xyzq987");
    await latest.locator("#search").dispatchEvent("compositionend");
    await latest.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false" && new URL(location.href).searchParams.get("q") === "无意义不存在xyzq987");
    assert(/0\s*\/\s*583/.test(await latest.locator("#result-count").textContent()), "IME no-result query wrong");

    const short = await fresh();
    stage = "short";
    console.log("stage: short");
    await short.locator("#search").fill("的");
    await short.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false" && new URL(location.href).searchParams.get("q") === "的");
    assert(/582\s*\/\s*583/.test(await short.locator("#result-count").textContent()), "Single character fallback changed results");
    assert(await short.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /search-(pairs|candidates|video)/.test(entry.name)).length) === 0, "Short fallback made hundreds of requests");
    assert(errors.length === 0, errors.join("\n"));
    return { passed: true, scenarios: ["empty directory", "candidate retry", "body retry", "long wait cancel", "latest response", "IME", "single-character fallback"], errors };
  } catch (error) { throw Error(`${stage}: ${error.message}`); }
  finally { await Promise.all(contexts.map((context) => context.close())); }
}
