// playwright-cli -s=p0 run-code --filename=scripts/check-reader-errors.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const isolated = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const target = await isolated.newPage();
  let failIndex = true;
  let failDocument = true;
  await target.route("**/*", (route) => {
    const url = route.request().url();
    if (failIndex && /search-(?:drafts|published).*\.json/.test(url)) return route.abort();
    if (failDocument && /\.md(?:\?|$)/.test(url) && !/[?&](?:url|import)(?:[=&]|$)/.test(url)) return route.abort();
    return route.continue();
  });
  await target.goto(base);
  await target.locator(".video-group").first().waitFor();
  await target.locator("#search").fill("克尔凯郭尔");
  await target.getByRole("button", { name: "重新搜索", exact: true }).waitFor();
  failIndex = false;
  await target.getByRole("button", { name: "重新搜索", exact: true }).click();
  await target.locator('.part-link[href*="#hit="]').first().waitFor();
  await target.locator('.part-link[href*="#hit="]').first().click();
  await target.getByRole("heading", { name: "稿件加载失败" }).waitFor();
  failDocument = false;
  await target.getByRole("button", { name: "重新加载", exact: true }).click();
  await target.locator(".search-passage mark").first().waitFor();

  // A delayed search must not replace the directory after navigation.
  await target.goto(base);
  await target.locator("#clear-search").click();
  await target.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  let release;
  let intercepted = false;
  const gate = new Promise((resolve) => { release = resolve; });
  await target.route("**/*search-drafts*.json", async (route) => { intercepted = true; await gate; await route.continue(); });
  await target.reload();
  await target.locator(".video-group").first().waitFor();
  await target.locator("#search").fill("克尔凯郭尔");
  let frames = 0;
  while (!intercepted && frames++ < 600) await target.evaluate(() => new Promise(requestAnimationFrame));
  assert(intercepted, "Search index request was not intercepted");
  await target.locator(".video-heading a").first().click();
  await target.locator(".prose").waitFor();
  const response = target.waitForResponse((response) => /search-drafts.*\.json/.test(response.url()));
  release();
  await response;
  await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(await target.locator("#directory-results").count() === 0, "Stale search replaced the reader");
  await isolated.close();

  const blocked = await page.context().browser().newContext({ viewport: { width: 375, height: 812 } });
  await blocked.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, { get() { throw new DOMException("Storage disabled", "SecurityError"); } });
    }
  });
  const blockedPage = await blocked.newPage();
  const errors = [];
  blockedPage.on("pageerror", (error) => errors.push(error.message));
  await blockedPage.goto(base);
  await blockedPage.locator(".video-group").first().waitFor();
  await blockedPage.locator("#search").fill("克尔凯郭尔");
  await blockedPage.locator('.part-link[href*="#hit="]').first().waitFor();
  await blockedPage.locator('.part-link[href*="#hit="]').first().click();
  await blockedPage.locator(".prose").waitFor();
  await blockedPage.locator(".reading-navigation .back-link").click();
  await blockedPage.waitForFunction(() => document.querySelector("#directory-results")?.getAttribute("aria-busy") === "false");
  assert(await blockedPage.locator("#search").inputValue() === "克尔凯郭尔", "In-memory state failed without storage");
  assert(errors.length === 0, "Blocked storage caused runtime errors");
  await blocked.close();
  return { passed: true, checks: ["index failure and retry", "document failure and retry", "stale search navigation", "blocked storage"] };
}
