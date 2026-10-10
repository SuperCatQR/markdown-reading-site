// playwright-cli -s=followup-progress run-code --filename=scripts/check-tool-progress-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const target = await context.newPage();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const key = "reader-history-v2";
  const errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  const records = () => target.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{"records":[]}').records, key);
  const ready = () => target.locator(".reading-article .prose, .continuous-part .prose").first().waitFor();
  const settle = () => target.waitForTimeout(650);
  async function toolClick(selector) {
    // Locator.click scrolls the sticky header's underlying flow position before
    // pointerdown in Chromium; use the visible screen coordinate a reader taps.
    const bounds = await target.locator(selector).boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y < 64, `Tool is outside fixed bar: ${selector}`);
    await target.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }
  async function bodyPosition(selector = ".reading-article", blockIndex = 15) {
    return target.locator(selector).evaluate((article, blockIndex) => {
      const blocks = [...article.querySelectorAll(".prose [id]")];
      const block = blocks[Math.min(blockIndex, blocks.length - 1)];
      const offset = document.querySelector(".site-header").getBoundingClientRect().bottom + 12;
      scrollTo({ top: scrollY + block.getBoundingClientRect().top + block.getBoundingClientRect().height * 0.4 - offset, behavior: "instant" });
      return { id: block.id, edition: article.dataset.edition, height: block.getBoundingClientRect().height,
        fraction: Math.max(0, Math.min(1, (offset - block.getBoundingClientRect().top) / block.getBoundingClientRect().height)) };
    }, blockIndex);
  }
  async function assertReturned(position) {
    await target.waitForFunction(({ id }) => document.activeElement?.id === id, position);
    await target.waitForFunction(() => document.querySelector("#app").style.overflowAnchor === "");
    await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const returned = await target.evaluate(({ id, fraction }) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      const offset = document.querySelector(".site-header").getBoundingClientRect().bottom + 12;
      return { error: Math.abs(rect.top + rect.height * fraction - offset), focus: document.activeElement?.id,
        fraction, top: rect.top, height: rect.height, offset, searchHidden: document.querySelector('#reader-search-navigation')?.hidden,
        searchToolsHeight: getComputedStyle(document.documentElement).getPropertyValue('--search-tools-height'),
        shellPadding: getComputedStyle(document.querySelector('.reading-shell')).paddingTop };
    }, position);
    assert(returned.error < 5, `Tool close lost paragraph-relative position: ${JSON.stringify({ returned, position })}`);
    assert(returned.focus === position.id, "Tool return did not focus original prose paragraph");
  }
  let stage = "discover";
  try {
    await target.goto(`${base}?view=all`);
    await target.locator(".video-heading h2 a").first().waitFor();
    // Use the exact issue fixture; a directory title link can resolve to
    // a short current draft and cannot expose a true within-paragraph position.
    await target.goto(`${base}?draft=1a8e79034ff148c78e7df5a6f1859b90`);
    await ready();
    const bodyUrl = target.url();
    for (const waitForSave of [true, false]) {
      stage = waitForSave ? "saved search excursion" : "pending throttle excursion";
      const position = await bodyPosition(".reading-article", waitForSave ? 15 : 18);
      if (waitForSave) await settle();
      else assert((await records()).find((record) => record.editionId === position.edition)?.anchor !== position.id,
        "Pending-throttle fixture was already saved before opening tools");
      await toolClick("#reader-find");
      await target.locator("#video-query").waitFor();
      await settle();
      const saved = (await records()).find((record) => record.editionId === position.edition);
      assert(saved?.anchor === position.id, `Tool jump replaced body record (including pending throttle capture): ${JSON.stringify({ saved, position })}`);
      const beforeToolScroll = JSON.stringify(saved);
      await target.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await settle();
      assert(JSON.stringify((await records()).find((record) => record.editionId === position.edition)) === beforeToolScroll,
        "Programmatic tool-area scrolling overwrote saved progress");
      await target.locator(".reader-video-search > summary").click();
      await assertReturned(position);
      await settle();
      assert((await records()).find((record) => record.editionId === position.edition)?.anchor === position.id,
        "Return programmatic scroll overwrote progress");
    }

    stage = "outline and tool switching";
    // Exercise the existing paragraph outline generated from frozen prose.
    const outlinePosition = await bodyPosition();
    await target.locator("#reader-outline").waitFor({ state: "visible" });
    await toolClick("#reader-find");
    stage = "rapid close and reopen keeps new tool frozen";
    await target.evaluate(() => {
      document.querySelector('.reader-video-search [data-reading-tool-return]').click();
      document.querySelector('#reader-find').click();
      scrollTo({ top: 0, behavior: 'instant' });
    });
    await settle();
    assert((await records()).find((record) => record.editionId === outlinePosition.edition)?.anchor === outlinePosition.id,
      'An old return callback unfroze the immediately reopened tool');
    stage = "outline and tool switching";
    await toolClick("#reader-outline");
    assert(!await target.locator('.reader-video-search').evaluate((details) => details.open), "Switching tools left the old disclosure open");
    await target.locator(".table-of-contents [data-reading-tool-return]").click();
    await assertReturned(outlinePosition);
    await target.locator('.table-of-contents').evaluate((details) => details.remove());

    stage = "result disclosure does not overwrite progress";
    const resultPosition = await bodyPosition();
    await toolClick("#reader-find");
    await target.locator('#video-query').fill('胡塞尔');
    await target.waitForFunction(() => document.querySelector('#video-results')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('#video-results .passage-disclosure'));
    await target.locator('.passage-disclosure > summary').first().click();
    await settle();
    assert((await records()).find((record) => record.editionId === resultPosition.edition)?.anchor === resultPosition.id,
      'Expanding tool results overwrote the original body anchor');
    await target.locator('.passage-disclosure > summary').first().click();
    await target.locator('#clear-video-query').click();
    await target.locator('.reader-video-search [data-reading-tool-return]').click();
    await assertReturned(resultPosition);

    stage = "active reading leaves the tool";
    const beforeActive = await bodyPosition();
    await toolClick("#reader-find");
    await target.mouse.move(250, 650);
    await target.mouse.wheel(0, 2000);
    await target.waitForFunction(() => !document.querySelector('[data-reading-tool-return]'));
    await target.waitForFunction(({ key, anchor }) => JSON.parse(localStorage.getItem(key) || '{"records":[]}').records[0]?.anchor !== anchor,
      { key, anchor: beforeActive.id });

    stage = "cancel";
    const cancelPosition = await bodyPosition();
    await toolClick("#reader-find");
    await target.locator(".reader-video-search [data-reading-tool-return]").click();
    await assertReturned(cancelPosition);

    stage = "primary latest resume";
    await settle();
    await target.locator(".reader-directory-link").evaluate((link) => link.click());
    await target.locator(".recent-reading-primary [data-reading-resume]").waitFor();
    assert(!await target.locator(".recent-reading-management").evaluate((details) => details.open), "Recent management competes with primary task");
    assert(await target.locator(".recent-reading-primary").textContent().then((text) => text.includes("P1")), "Primary record does not identify P");
    await target.locator(".recent-reading-primary [data-reading-resume]").click();
    await ready();
    await target.waitForLoadState("networkidle");
    await assertReturned(cancelPosition);

    stage = "continuous tool return";
    await target.goto(`${base}?draft=57aefc47492b4166bd52d7d247c45d73`);
    await ready();
    await target.locator(".continuous-link").first().evaluate((link) => link.click());
    await ready();
    await target.locator(".continuous-feedback a[rel=next]").evaluate((link) => link.click());
    await target.waitForFunction(() => document.querySelectorAll(".continuous-part").length === 2
      && document.querySelector(".continuous-feedback")?.getAttribute("aria-busy") !== "true");
    await settle();
    const continuousPosition = await bodyPosition(".continuous-part:first-child");
    await toolClick("#reader-find");
    await settle();
    const continuousRecord = (await records()).find((record) => record.editionId === continuousPosition.edition);
    assert(continuousRecord?.anchor === continuousPosition.id.replace(`part-${continuousPosition.edition}-`, ""), `Continuous tool saved selected route P instead of visible P: ${JSON.stringify({ continuousRecord, continuousPosition })}`);
    await target.locator("#video-query").press("Escape");
    await assertReturned(continuousPosition);

    stage = "explicit hit resumes saving";
    await toolClick("#reader-find");
    await target.locator("#video-query").fill("哲学");
    await target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false"
      && document.querySelector("#video-results .passage-link"));
    await target.locator("#video-results .passage-link").first().click();
    await target.locator(".search-passage").waitFor();
    await bodyPosition();
    await settle();
    assert((await records())[0].readingMode === "single", "Explicit hit did not resume normal body capture");

    stage = "return results and end preserve hit reading place";
    const hitPosition = await target.evaluate(() => {
      const offset = document.querySelector('#reader-search-navigation').getBoundingClientRect().bottom + 12;
      const block = [...document.querySelectorAll('.prose [id]')].find((node) => {
        const r = node.getBoundingClientRect(); return r.height > 0 && r.bottom > offset && r.top < innerHeight;
      });
      const r = block.getBoundingClientRect();
      return { id: block.id, fraction: Math.max(0, Math.min(1, (offset - r.top) / r.height)) };
    });
    await target.locator('.search-hit-actions > summary').evaluate((summary) => summary.click());
    await target.locator('[data-search-results]').evaluate((button) => button.click());
    await target.locator('.search-hit-actions > summary').evaluate((summary) => { if (!summary.parentElement.open) summary.click(); });
    await target.locator('[data-search-end]').evaluate((button) => button.click());
    await target.waitForFunction(() => document.querySelector('#reader-search-navigation').hidden);
    await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertReturned(hitPosition);
    assert(await target.evaluate(() => document.querySelector('#app').style.overflowAnchor === ''), 'Tool leaked scroll-anchor override after completion');
    assert(errors.length === 0, errors.join("\n"));
    return { status: "passed", savedAndPendingTools: true, exactReturnAndFocus: true, primaryOneClick: true,
      continuousActualP: true, outlineAndCancel: true, toolSwitchAndRapidReopen: true,
      resultsExpandCollapse: true, activeReadingUnfreezes: true, endRestoresHitPosition: true,
      explicitHitResumesProgress: true, viewport: "390x844", bodyUrl };
  } catch (error) { throw Error(`${stage}: ${error.message}`); }
  finally { await context.close(); }
}
