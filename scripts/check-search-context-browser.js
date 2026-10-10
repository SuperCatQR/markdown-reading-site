async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const target = await context.newPage();
  const errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const directoryReady = () => target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  const hitsReady = () => target.locator("#reader-search-navigation:not([hidden]) .search-hit-position").waitFor();
  const actions = () => target.locator(".search-hit-actions > summary");
  const parseUrl = (value) => target.evaluate((value) => { const url = new URL(value, location.href); return { href: url.href, hash: url.hash, params: Object.fromEntries(url.searchParams) }; }, value);
  const returnGlobal = async () => {
    await actions().click();
    await target.getByRole("link", { name: "返回全站搜索结果", exact: true }).click();
    await directoryReady();
  };
  try {
    await target.goto(`${base}?view=all&q=${encodeURIComponent("海德格尔")}&sort=title`);
    await directoryReady();
    await target.locator("#load-more").click();
    await directoryReady();
    const disclosure = target.locator(".passage-disclosure").first();
    if (await disclosure.count()) await disclosure.locator("summary").click();
    const title = target.locator('.video-heading h2 a[href*="#hit="]').nth(2);
    await title.scrollIntoViewIfNeeded();
    const expected = await title.getAttribute("href");
    const expectedUrl = await parseUrl(expected);
    assert(expectedUrl.params.vq === "海德格尔", "Title lost full query");
    assert(expectedUrl.hash.includes("hit="), "Title does not select real body hit");
    await title.click();
    await hitsReady();
    await target.waitForFunction(() => {
      const arrival = document.querySelector(".search-arrival")?.getBoundingClientRect();
      const toolbar = document.querySelector("#reader-search-navigation")?.getBoundingClientRect();
      return arrival && toolbar && arrival.top >= toolbar.bottom && arrival.top < innerHeight / 2;
    });
    const origin = await target.evaluate(() => structuredClone(history.state.searchOrigin));
    assert(origin?.kind === "directory-search" && origin.directory.visibleCount === 48, "Explicit origin or loaded count missing");
    assert(origin.directory.sort === "title" && origin.directory.passages.length > 0, "Sort or expanded passages missing");
    const hitBefore = await target.evaluate(() => ({ url: location.href, scroll: scrollY, hit: document.querySelector(".search-passage")?.id }));
    await actions().click();
    await target.keyboard.press("Escape");
    assert(await target.locator(".search-hit-actions").evaluate((node) => !node.open), "Escape left actions menu open");
    assert(await actions().evaluate((node) => node === document.activeElement), "Escape did not restore summary focus");
    assert(await target.evaluate((before) => location.href === before.url && Math.abs(scrollY - before.scroll) < 2 && document.querySelector(".search-passage")?.id === before.hit, hitBefore), "Escape changed reading position or hit");
    await actions().click();
    await target.locator(".search-arrival").click();
    assert(await target.locator(".search-hit-actions").evaluate((node) => !node.open), "Outside body click left menu open");
    assert(target.url() === hitBefore.url, "Outside click changed URL");
    await target.screenshot({ path: "artifacts/third-search-context-mobile.png" });
    await target.reload();
    await hitsReady();
    assert(await target.evaluate(() => history.state.searchOrigin.directory.visibleCount) === 48, "Reload lost origin");
    await target.locator('.search-hit-step[data-search-hit="next"]').click();
    await hitsReady();
    assert(await target.evaluate(() => history.state.searchOrigin.directory.query) === "海德格尔", "Next hit lost origin");
    await returnGlobal();
    assert(await target.locator("#search").inputValue() === "海德格尔", "Return lost global query");
    assert(await target.locator("#search-sort").inputValue() === "title", "Return lost sorting");
    const restored = await target.evaluate(() => ({ directory: history.state.directory, scroll: scrollY }));
    for (const key of ["query", "mode", "sort", "tag", "visibleCount", "expanded", "passages"]) {
      assert(JSON.stringify(restored.directory[key]) === JSON.stringify(origin.directory[key]), `Return lost ${key}`);
    }
    assert(Math.abs(restored.scroll - origin.directory.scroll) < 3, "Return lost scroll");
    await target.goBack();
    await hitsReady();
    await target.goForward();
    await directoryReady();
    assert(await target.evaluate(() => history.state.directory.visibleCount) === 48, "Forward lost results state");

    // A copied URL has no session origin even if a stale directory cache exists.
    const direct = await context.newPage();
    await direct.goto(expectedUrl.href);
    await direct.locator("#reader-search-navigation:not([hidden])").waitFor();
    await direct.locator(".search-hit-actions > summary").click();
    assert(await direct.getByRole("link", { name: "返回全站搜索结果", exact: true }).count() === 0, "Share claimed a nonexistent prior session");
    assert(await direct.getByRole("link", { name: "重新全站搜索", exact: true }).count() === 1, "Share lacks explicit new global search fallback");
    await direct.getByRole("button", { name: "查看本视频命中", exact: true }).click();
    assert(await direct.locator(".reader-video-search").evaluate((node) => node.open), "Local hit button did not open local scope");
    assert(await direct.locator(".search-hit-actions").evaluate((node) => !node.open), "Local operation left covering menu open");
    await direct.evaluate(() => history.replaceState({ ...history.state, directory: { view: "all", query: "旧的目录搜索", mode: "general", tag: "全部", scroll: 400 } }, ""));
    await direct.reload();
    await direct.locator("#reader-search-navigation:not([hidden])").waitFor();
    await direct.locator(".search-hit-actions > summary").click();
    assert(await direct.getByRole("link", { name: "返回全站搜索结果", exact: true }).count() === 0, "Inherited directory cache falsely established global origin");
    await direct.close();

    // Complete multi-keyword requests survive a hash containing only one term.
    await target.goto(`${base}?view=drafts&mode=keywords&q=${encodeURIComponent("审美 痛苦")}`);
    await directoryReady();
    const keywordTitle = target.locator(".video-heading h2 a").first();
    await keywordTitle.click();
    await hitsReady();
    assert(await target.locator("#video-query").inputValue() === "审美 痛苦", "Keyword title reduced request to local term");
    const keywordUrl = await parseUrl(target.url());
    assert(keywordUrl.params.vm === "keywords", "Keyword mode lost");
    assert(keywordUrl.params.vview === "drafts", "Category scope lost");
    const keywordBvid = await target.evaluate(() => history.state.searchOrigin.bvid);
    await actions().click();
    await target.getByRole("button", { name: "查看本视频命中", exact: true }).click();
    const otherPart = target.locator("#video-results .part-link").filter({ hasText: "P" }).last();
    await otherPart.click();
    await hitsReady();
    assert(await target.evaluate((bvid) => history.state.searchOrigin?.bvid === bvid, keywordBvid), "Cross-P lost global origin");
    await returnGlobal();
    assert(await target.locator("#search").inputValue() === "审美 痛苦", "Cross-P return lost complete keywords");

    await target.goto(`${base}?view=all&mode=phrase&q=${encodeURIComponent("海德格尔")}&tag=${encodeURIComponent("哲学")}&sort=title`);
    await directoryReady();
    await target.locator('.video-heading h2 a[href*="#hit="]').first().click();
    await hitsReady();
    await actions().click();
    await target.getByRole("button", { name: "查看本视频命中", exact: true }).click();
    await target.locator("#video-query").fill("存在");
    await target.waitForFunction(() => new URL(location.href).searchParams.get("vq") === "存在" && document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
    await target.locator("#video-results .passage-link").first().click();
    await hitsReady();
    await returnGlobal();
    assert(await target.locator("#search").inputValue() === "海德格尔", "Local query edit overwrote original global query");
    assert(await target.getByRole("radio", { name: "正文原句", exact: true }).isChecked(), "Return lost original phrase mode");
    assert(await target.locator(".filter-current").textContent() === "哲学", "Return lost exact source theme");
    assert(await target.locator("#search-sort").inputValue() === "title", "Phrase return lost stored sorting preference");

    const blocked = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await blocked.addInitScript(() => {
        for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      const reader = await blocked.newPage();
      reader.on("pageerror", (error) => errors.push(error.message));
      await reader.goto(`${base}?view=drafts&mode=phrase&q=${encodeURIComponent("海德格尔")}`);
      await reader.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
      await reader.locator('.video-heading h2 a[href*="#hit="]').first().click();
      await reader.locator("#reader-search-navigation:not([hidden])").waitFor();
      await reader.locator(".search-hit-actions > summary").click();
      await reader.getByRole("link", { name: "返回全站搜索结果", exact: true }).click();
      await reader.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
      assert(await reader.locator("#search").inputValue() === "海德格尔", "Blocked storage broke in-memory return");
      assert(await reader.getByRole("radio", { name: "正文原句", exact: true }).isChecked(), "Blocked storage lost phrase mode");
    } finally { await blocked.close(); }
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, checks: ["title body arrival", "Escape focus and unchanged hit", "outside click", "reload origin", "next hit", "global full state/scroll restore", "history back/forward", "direct share scope", "local button", "complete keywords", "cross-P origin", "old directory pollution", "edited local query", "phrase/theme/sort restore", "blocked storage"] };
  } finally { await context.close(); }
}
