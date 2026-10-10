// playwright-cli -s=issues run-code --filename=scripts/check-reading-history-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const key = "reader-history-v1";
  const absoluteUrl = (href) => target.evaluate(({ href, base }) => new URL(href, base).href, { href, base });
  const read = (tab) => tab.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{"records":[]}').records, key);
  const setRecords = (tab, records) => tab.evaluate(({ key, records }) => localStorage.setItem(key,
    JSON.stringify({ schemaVersion: 1, records, deleted: {}, clearedAt: 0 })), { key, records });
  const readyBody = (tab) => tab.locator(".reading-article .prose").waitFor();
  const openRecent = async (tab) => {
    const recent = tab.locator("#recent-reading details.recent-reading-management");
    await recent.waitFor();
    if (!await recent.evaluate((details) => details.open)) await recent.locator("summary").click();
  };
  const scrollToProse = async (tab, articleSelector = ".reading-article") => {
    await tab.locator(`${articleSelector} .prose [id]`).first().waitFor();
    const anchor = await tab.locator(articleSelector).evaluate((article) => {
      const blocks = [...article.querySelectorAll(".prose [id]")];
      const block = blocks[Math.min(12, blocks.length - 1)];
      const top = (document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0) + 12;
      scrollTo({ top: scrollY + block.getBoundingClientRect().top - top + block.getBoundingClientRect().height * 0.3, behavior: "instant" });
      return { id: block.id, editionId: article.dataset.edition };
    });
    await tab.waitForFunction(({ key, editionId }) => {
      const records = JSON.parse(localStorage.getItem(key) || '{"records":[]}').records;
      return records.some((record) => record.editionId === editionId);
    }, { key, editionId: anchor.editionId });
    return anchor;
  };
  let bodyUrl;
  let stage = "initial body save";
  try {
    await target.goto(`${base}?view=all`);
    await target.locator(".video-heading h2 a").first().waitFor();
    // Use the existing long-body fixture; newly imported first items may fit
    // entirely in one viewport and cannot exercise a nonzero paragraph offset.
    bodyUrl = await absoluteUrl("?draft=29fcc4b3cc2045c1abecaad159d95420");
    await target.goto(bodyUrl);
    await readyBody(target);
    const position = await scrollToProse(target);
    await target.waitForFunction(({ key, anchor }) => JSON.parse(localStorage.getItem(key) || '{"records":[]}').records
      .some((record) => record.anchor === anchor), { key, anchor: position.id });
    let saved = (await read(target)).find((record) => record.editionId === position.editionId);
    assert(saved.documentMode === "body" && saved.editionId && saved.contentSha256 && saved.artifactSha256,
      "Saved progress lacks frozen body identity");

    stage = "explicit resume";
    const fresh = await context.newPage();
    await fresh.goto(bodyUrl);
    await readyBody(fresh);
    await fresh.locator("[data-reading-continue]").waitFor();
    await fresh.locator("[data-reading-continue]").click();
    const delta = await fresh.evaluate((record) => {
      const target = document.getElementById(record.anchor);
      const rect = target.getBoundingClientRect();
      const top = (document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0) + 12;
      return Math.abs(rect.top + rect.height * record.offset - top);
    }, saved);
    assert(delta < 5, `Explicit resume did not restore paragraph-relative position: ${delta}`);

    stage = "hash and history priority";
    await fresh.goto(`${bodyUrl}#${encodeURIComponent(saved.anchor)}`);
    await readyBody(fresh);
    assert(await fresh.locator("[data-reading-continue]").count() === 0, "Explicit fragment was overridden by local progress");
    await fresh.waitForFunction((anchor) => {
      const rect = document.getElementById(anchor)?.getBoundingClientRect();
      return rect && rect.top >= 0 && rect.top < innerHeight;
    }, saved.anchor);
    await fresh.evaluate(() => scrollTo(0, 1500));
    const beforeHistory = await fresh.evaluate(() => scrollY);
    await fresh.locator(".reading-navigation .back-link").evaluate((link) => link.click());
    await openRecent(fresh);
    await fresh.locator("#recent-reading [data-reading-resume]").first().waitFor();
    await fresh.goBack();
    await readyBody(fresh);
    assert(await fresh.locator("[data-reading-continue]").count() === 0, "History navigation displayed a competing local resume prompt");
    assert(Math.abs(await fresh.evaluate(() => scrollY) - beforeHistory) < 5, "History position was not restored");

    stage = "reference isolation";
    await fresh.goto(`${base}?review=${saved.editionId}`);
    await readyBody(fresh);
    await fresh.locator(".provenance > summary").click();
    await fresh.locator(".review-reference-notice").waitFor();
    const beforeReviewScroll = (await read(fresh)).find((record) => record.id === saved.id);
    await fresh.evaluate(() => scrollTo(0, 1800));
    await fresh.waitForTimeout(700);
    const afterReviewScroll = (await read(fresh)).find((record) => record.id === saved.id);
    assert(JSON.stringify(beforeReviewScroll) === JSON.stringify(afterReviewScroll), "Reference reading overwrote body progress");
    await fresh.close();

    stage = "recent update and withdrawal";
    await target.goto(`${base}?view=all`);
    await openRecent(target);
    await target.locator("#recent-reading [data-reading-resume]").first().waitFor();
    assert(await target.locator("#recent-reading").textContent().then((text) => text.includes("当前浏览器")), "Recent records lack local-storage explanation");
    stage = "same-page recent relative resume";
    const currentRecent = (await read(target))[0];
    // Use a nonzero within-paragraph offset so an erroneous late hash-only
    // restoration cannot accidentally satisfy a paragraph-presence check.
    const relativeRecent = { ...currentRecent, offset: 0.6 };
    await setRecords(target, [relativeRecent]);
    await target.reload();
    await openRecent(target);
    await target.locator(`[data-reading-resume="${relativeRecent.id}"]`).first().click();
    await readyBody(target);
    await target.waitForLoadState("networkidle");
    const samePageDelta = await target.evaluate((record) => {
      const block = document.getElementById(record.anchor);
      const rect = block.getBoundingClientRect();
      const top = (document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0) + 12;
      return Math.abs(rect.top + rect.height * record.offset - top);
    }, relativeRecent);
    assert(samePageDelta < 5, `Late hash restoration overwrote same-page recent offset: ${samePageDelta}`);
    await target.goto(`${base}?view=all`);
    await openRecent(target);
    stage = "recent update and withdrawal";
    saved = (await read(target))[0];
    await setRecords(target, [{ ...saved, artifactSha256: "f".repeat(64) }]);
    await target.reload();
    await openRecent(target);
    await target.getByText("内容已更新，旧位置不可恢复", { exact: true }).first().waitFor();
    assert(await target.locator("#recent-reading [data-reading-resume]").count() === 0, "Updated body offered stale anchor restoration");
    await setRecords(target, [{ ...saved, videoPartId: 99999999, id: `${saved.manuscriptType}:99999999` }]);
    await target.reload();
    await openRecent(target);
    await target.getByText("稿件已撤回或不在当前快照中，位置不可恢复", { exact: true }).first().waitFor();
    await target.locator("[data-reading-delete]").click();
    assert((await read(target)).length === 0, "Delete retained a recent record");

    stage = "continuous visible part";
    await target.locator(".video-group:has(.parts-disclosure) .video-heading h2 a").first().click();
    await readyBody(target);
    await target.locator(".reading-article .reading-parts > summary").first().click();
    await target.locator(".reading-article .continuous-link").first().click();
    await target.locator(".continuous-part .prose").first().waitFor();
    const firstEdition = await target.locator(".continuous-part").first().getAttribute("data-edition");
    await target.locator(".continuous-feedback a[rel=next]").evaluate((link) => link.click());
    await target.waitForFunction(() => document.querySelectorAll(".continuous-part").length === 2
      && document.querySelector(".continuous-feedback")?.getAttribute("aria-busy") !== "true");
    const selectedEdition = await target.evaluate(() => new URL(location.href).searchParams.get("part"));
    assert(selectedEdition !== firstEdition, "Continuous test did not select a later route P");
    stage = "continuous search history layout";
    await target.locator(".reader-video-search > summary").click();
    await target.locator("#video-query").fill("哲学");
    await target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false"
      && document.querySelector("#video-result-count")?.textContent.includes("篇稿件"));
    await scrollToProse(target, ".continuous-part:first-child");
    const continuousScroll = await target.evaluate(() => scrollY);
    await target.locator(".reader-directory-link").evaluate((link) => link.click());
    await target.locator(".directory-shell").waitFor();
    await target.goBack();
    await target.waitForFunction(() => document.querySelectorAll(".continuous-part").length === 2
      && document.querySelector("#video-query")?.value === "哲学"
      && document.querySelector("#video-results")?.getAttribute("aria-busy") === "false"
      && document.querySelector("#video-result-count")?.textContent.includes("篇稿件"));
    assert(Math.abs(await target.evaluate(() => scrollY) - continuousScroll) < 5,
      "Continuous history restore moved after asynchronous video search expanded the layout");
    stage = "continuous visible part";
    await target.waitForFunction(({ key, firstEdition }) => JSON.parse(localStorage.getItem(key) || '{"records":[]}').records[0]?.editionId === firstEdition,
      { key, firstEdition });
    const actual = (await read(target))[0];
    assert(actual.readingMode === "continuous" && !actual.anchor.startsWith("part-"), "Continuous position did not normalize the actual visible P anchor");
    await target.goto(`${base}?view=all`);
    await openRecent(target);
    const continueLink = target.locator(`[data-reading-resume="${actual.id}"]`).first();
    await continueLink.waitFor();
    const sharedUrl = await absoluteUrl(await continueLink.getAttribute("href"));
    const reopened = await context.newPage();
    await reopened.goto(sharedUrl);
    await reopened.locator(".continuous-part .prose").waitFor();
    assert(await reopened.locator(".continuous-part").count() === 1, "Reopen fetched previously loaded stream parts");
    assert(await reopened.locator(".continuous-part").getAttribute("data-edition") === firstEdition, "Reopen used route's last-selected P instead of visible P");
    await reopened.close();
    await target.locator("[data-reading-clear]").click();
    assert((await read(target)).length === 0, "Clear retained records");
    assert(errors.length === 0, errors.join("\n"));

    stage = "user scroll interrupts late search restoration";
    const interruptedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let releaseSearch;
    const heldSearch = new Promise((resolve) => { releaseSearch = resolve; });
    try {
      const interrupted = await interruptedContext.newPage();
      await interrupted.route(/search-.*\.json$/, async (route) => { await heldSearch; await route.continue(); });
      const interruptedUrl = await target.evaluate(({ bodyUrl, anchor }) => {
        const url = new URL(bodyUrl);
        url.searchParams.set("vq", "不存在的异步搜索测试词");
        url.hash = anchor;
        return url.href;
      }, { bodyUrl, anchor: position.id });
      await interrupted.goto(interruptedUrl);
      await readyBody(interrupted);
      await interrupted.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "true");
      const originalHashScroll = await interrupted.evaluate(() => scrollY);
      await interrupted.mouse.move(1000, 600);
      await interrupted.mouse.wheel(0, 1200);
      await interrupted.waitForTimeout(150);
      const userPosition = await interrupted.evaluate(() => scrollY);
      assert(userPosition - originalHashScroll > 500, "User wheel did not move beyond the original shared anchor");
      releaseSearch();
      await interrupted.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
      await interrupted.waitForLoadState("networkidle");
      const interruptedState = await interrupted.evaluate((anchor) => ({
        scroll: scrollY, anchorTop: document.getElementById(anchor).getBoundingClientRect().top,
        headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom,
      }), position.id);
      assert(Math.abs(interruptedState.scroll - userPosition) < 5
        || Math.abs(interruptedState.anchorTop - interruptedState.headerBottom - 12) > 100,
      "Late search completion jumped back to the old hash after active user scrolling");
    } finally { releaseSearch(); await interruptedContext.close(); }

    for (const failure of ["quota", "disabled", "corrupt", "unsupported"]) {
      stage = `storage ${failure}`;
      const failedContext = await browser.newContext();
      try {
        await failedContext.addInitScript(({ key, failure }) => {
          if (failure === "corrupt" || failure === "unsupported") {
            localStorage.setItem(key, failure === "corrupt" ? "{broken" : '{"schemaVersion":99}');
            return;
          }
          const method = failure === "quota" ? "setItem" : "getItem";
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (storageKey, ...args) {
            if (storageKey === key) throw new DOMException("Storage denied", "QuotaExceededError");
            return original.call(this, storageKey, ...args);
          };
        }, { key, failure });
        const failed = await failedContext.newPage();
        await failed.goto(bodyUrl);
        await readyBody(failed);
        await failed.locator(".prose [id]").nth(3).evaluate((block) => block.scrollIntoView());
        await failed.locator(".reading-history-notice").waitFor();
        assert(await failed.locator(".reading-article .prose").isVisible(), `${failure} blocked reading`);
        assert(await failed.locator(".reading-history-notice").textContent().then((text) => !text.includes("已保存")), `${failure} falsely reported successful saving`);
      } finally { await failedContext.close(); }
    }
    return { status: "passed", exactBodyResume: true, samePageRelativeResume: true, hashPriority: true, historyPriority: true,
      referenceIsolation: true, updatedAndMissing: true, deleteAndClear: true,
      actualContinuousPart: true, continuousSearchHistory: true, userScrollInterruptedLateRestore: true,
      reopenedBodies: 1, failures: ["quota", "disabled", "corrupt", "unsupported"] };
  } catch (error) { throw new Error(`${stage}: ${error.message}`); }
  finally { await context.close(); }
}
