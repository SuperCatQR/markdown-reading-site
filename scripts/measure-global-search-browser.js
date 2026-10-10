async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const contexts = [];
  const samples = [];
  const errors = [];
  let stage = "initial";
  let lastTarget;
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const ready = (target) => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  try {
    for (const network of ["normal", "150ms-1Mbps"]) for (const strategy of ["full-baseline", "candidates"]) for (let run = 0; run < 3; run++) {
      stage = `${network}/${strategy}/${run + 1}/load`;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      contexts.push(context);
      const target = await context.newPage();
      lastTarget = target;
      target.on("pageerror", (error) => errors.push(error.message));
      if (strategy === "full-baseline") {
        // Test-only removal of the candidate descriptor exercises the retained
        // full-index path using the very same UI, normalization and matcher.
        await target.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
          const response = await route.fetch();
          const text = await response.text();
          assert(text.includes("candidates:"), "Production candidate descriptor not found for baseline");
          await route.fulfill({ response, body: text.replace("candidates:", "baselineCandidates:") });
        });
      }
      await target.goto(`${base}?view=drafts&q=`, { waitUntil: "domcontentloaded" });
      await ready(target);
      const session = await context.newCDPSession(target);
      await session.send("Network.enable");
      await session.send("Network.setCacheDisabled", { cacheDisabled: true });
      if (network !== "normal") await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 125000, uploadThroughput: 125000 });
      const before = await session.send("Runtime.getHeapUsage");
      for (const temperature of ["cold", "warm"]) {
        stage = `${network}/${strategy}/${run + 1}/${temperature}`;
        await target.evaluate(() => {
          performance.clearResourceTimings();
          for (const name of new Set(performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search.")).map((entry) => entry.name))) performance.clearMeasures(name);
          window.__searchBenchStart = null;
          document.querySelector("#search").addEventListener("input", () => { window.__searchBenchStart = performance.now(); }, { once: true });
          window.__searchBenchObserver?.disconnect();
          window.__searchBenchObserver = new MutationObserver(() => {
            const results = document.querySelector("#directory-results");
            if (window.__searchBenchStart !== null && results?.getAttribute("aria-busy") === "false" && document.querySelector(".match-summary")) {
              window.__searchBenchEnd = performance.now();
              window.__searchBenchObserver.disconnect();
            }
          });
          window.__searchBenchObserver.observe(document.querySelector("#directory-results"), { childList: true, attributes: true, subtree: true });
        });
        await target.locator("#search").fill("海德格尔");
        await target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false" && new URL(location.href).searchParams.get("q") === "海德格尔" && document.querySelector(".match-summary"), null, { timeout: 120000 });
        assert(/131\s*\/\s*583/.test(await target.locator("#result-count").textContent()), "Benchmark results changed");
        const after = await session.send("Runtime.getHeapUsage");
        const metric = await target.evaluate(() => ({
          inputToResultMs: window.__searchBenchEnd - window.__searchBenchStart,
          resources: performance.getEntriesByType("resource").filter((entry) => /search-(pairs|candidates|video|drafts|published)/.test(entry.name)).map(({ name, duration, transferSize, encodedBodySize, decodedBodySize }) => ({ name: name.split("/").at(-1), duration, transferSize, encodedBodySize, decodedBodySize })),
          stages: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search.")).map(({ name, duration, detail }) => ({ name, duration, detail })),
        }));
        assert(metric.resources.every((resource) => resource.encodedBodySize > 0), "Resource body size missing");
        if (temperature === "warm") assert(metric.resources.length === 0, "Warm search redownloaded indices");
        samples.push({ network, strategy, run: run + 1, temperature, ...metric,
          bytes: metric.resources.reduce((sum, resource) => ({ encoded: sum.encoded + resource.encodedBodySize, decoded: sum.decoded + resource.decodedBodySize, transfer: sum.transfer + resource.transferSize }), { encoded: 0, decoded: 0, transfer: 0 }),
          heap: { beforeUsed: before.usedSize, afterUsed: after.usedSize, afterTotal: after.totalSize, retainedAfterGC: null },
        });
        await session.send("HeapProfiler.collectGarbage");
        samples.at(-1).heap.retainedAfterGC = (await session.send("Runtime.getHeapUsage")).usedSize;
        await target.locator("#clear-search").click();
        await ready(target);
      }
      await context.close();
    }
    assert(errors.length === 0, errors.join("\n"));
    return { userAgent: await page.evaluate(() => navigator.userAgent), base, note: "Production preview on localhost; throttling applies after first screen. Input-to-result includes 120ms debounce and DOM completion. Heap is Chromium CDP JS heap, not total process memory. Full baseline changes only descriptor name in test context.", samples, errors };
  } catch (error) { throw Error(`${stage}: ${error.message}; state=${JSON.stringify(await lastTarget?.evaluate(() => ({ url: location.href, count: document.querySelector("#result-count")?.innerText, busy: document.querySelector("#directory-results")?.getAttribute("aria-busy") })).catch(() => null))}`); }
  finally { await Promise.all(contexts.map((context) => context.close())); }
}
