// Run with a local Vite server and playwright-cli:
// playwright-cli -s=visitor open http://127.0.0.1:5173
// playwright-cli -s=visitor run-code --filename=scripts/verify-visitor-experience.browser.js
async page => {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await context.newPage();
  const base = await page.evaluate(() => location.origin);
  const errors = [];
  p.on("pageerror", (error) => errors.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const settle = () => p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Tap sticky toolbar controls at their visible location. Locator.click's
  // scrollIntoView can move an already-visible sticky ancestor's flow position.
  const tapTool = async (selector) => {
    const bounds = await p.locator(selector).boundingBox();
    check(!!bounds, `Missing toolbar control ${selector}`);
    await p.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  const measurements = {};
  try {
    await p.goto(`${base}/?view=all&q=%C2%A0`);
    await p.locator("#directory-results[aria-busy=false]").waitFor();
    check(await p.locator("#search").inputValue() === "", "NBSP query must be empty");
    check(!await p.locator("#clear-search").isVisible(), "Empty input must show placeholder without clear control");
    check(await p.evaluate(() => new URLSearchParams(location.search).get("q")) === "", "Shared URL must normalize whitespace");
    measurements.homeFirstY = (await p.locator(".video-group").first().boundingBox()).y;
    check(measurements.homeFirstY < 400, "Mobile home should expose a content title before 400px");
    await p.locator("[data-directory-section=recent-reading]").click();
    check(await p.locator(".recent-empty").isVisible(), "New visitor needs truthful empty recent state");
    await p.locator("[data-directory-section=topics]").click();
    check(await p.locator("#tag-filter-menu").evaluate((el) => el.open), "Topic link must open the menu");
    check(await p.locator(".tag-option").count() <= 14, "Do not mount the whole 875-label catalogue");
    await p.locator("#tag-search").fill("黑格尔");
    check(await p.locator(".tag-option").count() > 0, "Search all original tags");
    await p.keyboard.press("Escape");
    check(await p.locator("#tag-filter-menu").evaluate((el) => !el.open && document.activeElement === el.querySelector("summary")), "Escape closes themes and returns focus");
    await p.locator("#tag-filter-menu summary").click();
    await p.locator("#search").click();
    check(await p.locator("#tag-filter-menu").evaluate((el) => !el.open), "Outside click closes theme menu");
    await p.locator(".theme-toggle").click();
    await p.waitForFunction(() => getComputedStyle(document.querySelector('.top-nav a[aria-current]')).color === "rgb(255, 171, 192)");
    measurements.darkNav = await p.locator(".top-nav a[aria-current]").evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    check(measurements.darkNav.color === "rgb(255, 171, 192)", "Dark selected navigation must use a visible theme color");
    await p.locator("#search").fill("黑格尔");
    await p.locator(".search-sort:not([hidden])").waitFor();
    await p.locator("#directory-results[aria-busy=false]").waitFor();
    check(await p.locator("#advanced-search").evaluate((el) => !el.open), "Sorting should not require advanced search");
    await p.locator("#search-sort").selectOption("title");
    await p.waitForFunction(() => new URLSearchParams(location.search).get("sort") === "title" && document.querySelector("#directory-results").getAttribute("aria-busy") === "false");
    check((await p.locator(".video-heading h2").first().innerText()).includes("黑格尔"), "Title priority should expose a title match first");
    measurements.searchFirstHeight = (await p.locator(".video-group").first().boundingBox()).height;
    const firstLink = p.locator(".video-heading h2 a").first();
    const readerUrl = await firstLink.getAttribute("href");
    await firstLink.click();
    await p.locator(".prose").waitFor();
    await p.locator("#reader-search-navigation:not([hidden])").waitFor();
    check(await p.locator(".search-hit-query").innerText() === "查找：黑格尔", "Keep the actual query visible at the passage");
    await p.locator(".reader-identity summary").click();
    check((await p.locator(".reader-current-title").innerText()).includes("黑格尔"), "Mobile sticky identity exposes full article title");
    await p.keyboard.press("Escape");
    await p.locator(".reader-directory-link").click();
    await p.locator("#directory-results[aria-busy=false]").waitFor();
    check(await p.locator("#search").inputValue() === "黑格尔" && await p.locator("#search-sort").inputValue() === "title", "Directory return must preserve query and sort");

    // Start an ordinary document without a search arrival and test long prose.
    await p.goto(`${base}/?view=all&q=`);
    await p.locator("#directory-results[aria-busy=false]").waitFor();
    await p.locator(".video-heading h2 a").first().click();
    await p.locator(".prose").waitFor();
    measurements.readerFirstY = (await p.locator(".prose > [id]").first().boundingBox()).y;
    check(measurements.readerFirstY < 350, "Mobile body should start before 350px");
    const paragraph = p.locator(".prose > [id]").nth(3);
    await paragraph.evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 76, behavior: "instant" }));
    await settle();
    const id = await paragraph.getAttribute("id");
    measurements.beforeSettings = await paragraph.evaluate((el) => ({ y: el.getBoundingClientRect().y, height: el.getBoundingClientRect().height, scroll: window.scrollY }));
    await tapTool("#reader-settings");
    await p.locator('[data-reading-preference="size"]').selectOption("21");
    await p.locator('[data-reading-preference="line"]').selectOption("2.2");
    await p.locator('[data-reading-preference="font"]').selectOption("sans");
    check((await p.locator(".settings-status").innerText()).includes("已保存"), "Successful persistence should be explicit");
    await p.keyboard.press("Escape");
    await settle();
    check(await p.locator("#reader-settings").evaluate((el) => document.activeElement === el), "Settings Escape returns focus to its trigger");
    measurements.afterSettingsY = (await p.locator(`#${id}`).boundingBox()).y;
    check(Math.abs(measurements.afterSettingsY - 76) < 4, `Changing typography must preserve the original paragraph position: ${JSON.stringify(measurements)}`);
    check(await p.locator(".prose").evaluate((el) => getComputedStyle(el).fontSize) === "21px", "Chosen text size must apply");
    await tapTool("#reader-outline");
    check(await p.locator(".paragraph-outline").isVisible(), "Headingless prose needs a source paragraph guide");
    await tapTool("#reader-settings");
    await p.locator('[data-reading-preference="line"]').selectOption("1.7");
    await p.keyboard.press("Escape");
    await p.locator("[data-reading-tool-return]").click();
    await settle();
    check(Math.abs((await p.locator(`#${id}`).boundingBox()).y - 76) < 5, "Guide → settings → return must restore the original body position");
    await tapTool("#reader-outline");
    const outlineHref = await p.locator(".paragraph-outline a").nth(2).getAttribute("href");
    await p.locator(".paragraph-outline a").nth(2).click();
    check(await p.locator(".paragraph-outline").evaluate((el) => !el.open), "Picking a paragraph should close the temporary guide");
    check(await p.locator(decodeURIComponent(outlineHref)).evaluate((el) => document.activeElement === el), "Guide target must be the original body anchor");
    await tapTool("#reader-find");
    check(await p.locator("#video-query").isVisible(), "Top find control opens the hidden search");
    await p.keyboard.press("Escape");
    await settle();
    check(await p.locator(".reader-video-search").evaluate((el) => !el.open), "Escape exits temporary find");
    await p.reload();
    await p.locator(".prose").waitFor();
    check(await p.locator(".prose").evaluate((el) => getComputedStyle(el).fontSize) === "21px", "Typography persists after reload");

    // Settings must work even when localStorage's accessor itself throws.
    await p.evaluate(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } }));
    await tapTool("#reader-settings");
    await p.locator('[data-reading-preference="size"]').selectOption("19");
    check((await p.locator(".settings-status").innerText()).includes("无法保存"), "Storage failure cannot claim settings were saved");
    await p.keyboard.press("Escape");

    // Use actual sparse video parts from the same shipped catalogue.
    await p.goto(`${base}/?view=all&q=`);
    const catalogue = await p.evaluate(async () => (await (await fetch("/draft-content/catalog.json")).json()).articles);
    const grouped = new Map();
    for (const entry of catalogue) { if (!grouped.has(entry.bvid)) grouped.set(entry.bvid, []); grouped.get(entry.bvid).push(entry); }
    const sparse = [...grouped.values()].find((entries) => entries.length > 1 && Math.min(...entries.map((e) => e.pageIndex)) > 0);
    check(!!sparse, "Fixture needs real sparse source parts");
    sparse.sort((a, b) => a.pageIndex - b.pageIndex);
    await p.goto(`${base}/?draft=${sparse[0].editionId}`);
    await p.locator(".prose").waitFor();
    await p.locator(".reader-part-menu summary").click();
    check((await p.locator(".reader-parts-popover .part-gaps").innerText()).includes("本站尚未收录"), "Sparse source P needs an explicit local gap explanation");
    check(await p.locator(".reader-flow-link").isVisible(), "Continuous reading is available from the top P menu");
    await p.locator(".reader-flow-link").click();
    await p.locator(".continuous-part .prose").waitFor();
    await tapTool("#reader-settings");
    await p.locator('[data-reading-preference="size"]').selectOption("17");
    await p.keyboard.press("Escape");
    await p.locator(".continuous-feedback a[rel=next]").click();
    await p.locator(".continuous-part").nth(1).waitFor();
    await p.locator(".continuous-part").nth(1).locator(".prose > [id]").first().evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 76, behavior: "instant" }));
    await settle();
    check((await p.locator(".reader-tools .reader-current-label").innerText()) === `P${sparse[1].pageIndex + 1}`, "Sticky identity must follow the visible continuous part");
    await tapTool("#reader-outline");
    check(await p.locator(".continuous-part").nth(1).locator(".table-of-contents").evaluate((el) => el.open), "Continuous outline must target the visible part");
    await p.locator("[data-reading-tool-return]").click();

    await p.setViewportSize({ width: 320, height: 700 });
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Reading controls must fit a 320px phone");
    check((await p.locator(".reader-header").boundingBox()).height === 64, "Narrow phone must keep the reading header compact");
    await p.goto(`${base}/?view=all&q=`);
    await p.locator("#directory-results[aria-busy=false]").waitFor();
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Home must fit a 320px phone");
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${base}${readerUrl.split("#")[0]}`);
    await p.locator(".prose").waitFor();
    await tapTool("#reader-settings");
    await p.locator('[data-reading-preference="width"]').selectOption("920");
    await p.keyboard.press("Escape");
    await settle();
    check(Math.round((await p.locator(".prose").boundingBox()).width) === 920, "Desktop wide preference must override the original prose width");
    check(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
    return { passed: true, measurements, browserErrors: errors };
  } finally { await context.close(); }
}
