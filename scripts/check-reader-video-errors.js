async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext();
  const target = await context.newPage();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  let release = () => {};
  try {
    await target.route(/search-video-drafts-BV1dA411T7xD.*\.json/, (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await target.goto(`${base}?video=BV1dA411T7xD&view=drafts&q=${encodeURIComponent("审美 痛苦")}&mode=keywords`);
    await target.getByRole("button", { name: "重新搜索", exact: true }).waitFor();
    assert(await target.locator(".reading-article .prose").count() === 1, "Failed index removed body");
    await target.unroute(/search-video-drafts-BV1dA411T7xD.*\.json/);
    await target.getByRole("button", { name: "重新搜索", exact: true }).click();
    await target.locator(".match-summary").first().waitFor();
    const details = target.locator(".passage-disclosure").first();
    await details.locator("summary").click();
    const edition = await details.getAttribute("data-entry");
    await details.locator(".passage-link").first().click();
    await target.locator(".search-passage mark").first().waitFor();
    await target.goBack();
    await target.locator(`.passage-disclosure[data-entry="${edition}"][open]`).waitFor();
    assert(await target.locator("#video-query").inputValue() === "审美 痛苦", "History lost scoped query");
    await target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
    await target.evaluate(() => scrollTo(0, 1400));
    const scroll = await target.evaluate(() => scrollY);
    await target.getByRole("navigation", { name: "稿件视图" }).getByRole("link", { name: "校验参照稿件", exact: true }).evaluate((link) => link.click());
    await target.locator(".provenance > summary").click();
    await target.locator(".review-reference-notice").waitFor();
    await target.goBack();
    await target.waitForFunction(() => document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
    try { await target.waitForFunction((scroll) => Math.abs(scrollY - scroll) < 5, scroll, { timeout: 3000 }); }
    catch { throw Error(`Scroll mismatch: expected=${scroll}, actual=${JSON.stringify(await target.evaluate(() => ({ scroll: scrollY, state: history.state, busy: document.querySelector('#video-results')?.getAttribute('aria-busy') })))}`); }

    await target.reload();
    await target.locator(".match-summary").first().waitFor();
    await target.locator("#video-query").fill("痛苦");
    await target.waitForFunction(() => new URL(location.href).searchParams.get("vq") === "痛苦" && document.querySelector("#video-results")?.getAttribute("aria-busy") === "false");
    assert(await target.locator("#video-results").textContent().then((text) => text.includes("痛苦")), "Latest input was not applied");

    const late = await context.newPage();
    late.on("pageerror", (error) => errors.push(error.message));
    const hold = new Promise((resolve) => { release = resolve; });
    await late.route(/search-video-drafts-BV1dA411T7xD.*\.json/, async (route) => { await hold; await route.continue(); });
    await late.goto(`${base}?video=BV1dA411T7xD&view=drafts`);
    await late.locator(".reader-video-search > summary").click();
    await late.locator("#video-query").fill("审美");
    await late.locator("#video-results .search-feedback").waitFor();
    await late.locator("#video-search-view").selectOption("published");
    await late.getByRole("heading", { name: "本视频没有匹配的稿件" }).waitFor();
    release();
    await late.waitForLoadState("networkidle");
    assert(await late.locator("#video-results .video-part").count() === 0, "Late draft response replaced empty published results");
    assert(await late.locator(".reading-article .prose").count() === 1, "Scope switch removed body");
    await late.close();
    const leaving = await context.newPage();
    const leavingHold = new Promise((resolve) => { release = resolve; });
    await leaving.route(/search-video-drafts-BV1dA411T7xD.*\.json/, async (route) => { await leavingHold; await route.continue(); });
    await leaving.goto(`${base}?video=BV1dA411T7xD&view=drafts&q=${encodeURIComponent("审美")}`);
    await leaving.locator("#video-results .search-feedback").waitFor();
    await leaving.locator(".reading-navigation .back-link").evaluate((link) => link.click());
    await leaving.locator(".video-group").first().waitFor();
    release();
    await leaving.waitForLoadState("networkidle");
    assert(await leaving.locator(".reader-video-search").count() === 0, "Late reader search replaced directory");
    await leaving.close();
    assert(errors.length === 0, errors.join("\n"));
    return { passed: true, checks: ["scoped index failure/retry", "reader survives failures", "history query/expansion/scroll", "latest input", "late category and navigation isolation"] };
  } finally { release(); await context.close(); }
}
