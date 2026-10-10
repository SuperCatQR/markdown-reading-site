// playwright-cli -s=contributor-fix run-code --filename=scripts/check-contributor-edge-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const edition = "20b3456f06f64577850122410d980c81";
  const browser = await page.context().newPage();
  const errors = [];
  browser.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const ready = async () => { await browser.locator("article .prose").first().waitFor(); await browser.locator(".contribution-dialog").waitFor({ state: "attached" }); };
  const clickTool = async (selector) => { const rect = await browser.locator(selector).boundingBox(); await browser.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2); };
  const sourceRoute = `**/draft-content/drafts/edition-${edition}/review.md`;
  let fixture;
  await browser.route(sourceRoute, (route) => route.fulfill({ status: 200, contentType: "text/markdown", body: fixture }));
  try {
    await browser.goto(`${base}?draft=${edition}#passage-2`); await ready();
    let quote = await browser.locator("#passage-2").textContent();
    const group = (number) => `## 段落 ${number}：00:00:00 — 00:00:18\n\n来源：t1:s0；[回看](https://example.com/source?t=0)\n\n原文：重复测试原文。\n\n整理稿：${quote}\n\n- 疑点：测试疑点\n\n`;
    fixture = `# 测试重复参照\n\n${group(1)}${group(2)}`;
    await clickTool(".reader-mode-link"); await ready();
    await browser.locator("#review-arrival").getByText("参照有多处相同整理稿，请选择核对位置。", { exact: true }).waitFor();
    assert(await browser.locator(".review-correspondence").count() === 0, "Duplicate was mapped automatically");
    assert(await browser.locator('#review-arrival a[href^="#"]').count() === 2, "Duplicate candidates omitted");
    await browser.locator('#review-arrival a[href^="#"]').last().click();
    assert(await browser.evaluate(() => document.activeElement?.textContent.startsWith("整理稿：")), "Candidate anchor does not focus edited passage");
    await browser.evaluate(() => history.replaceState({ ...history.state, reviewContext: { ...history.state.reviewContext, quote: "不存在的原句" }, articleScroll: undefined }, "", `${location.pathname}${location.search}`));
    await browser.reload(); await ready();
    assert((await browser.locator("#review-arrival").textContent()).includes("未找到完全一致"), "No-match fallback missing");
    await browser.locator("[data-review-find-quote]").click();
    assert(await browser.locator("#review-query").inputValue() === "不存在的原句", "Fallback search lost quote");
    assert((await browser.locator(".review-search-tools output").textContent()).includes("0 处"), "No-match count inaccurate");
    await browser.keyboard.press("Escape");
    await browser.evaluate(() => history.replaceState({ ...history.state, reviewContext: { ...history.state.reviewContext, version: "stale" }, articleScroll: undefined }, "", location.href));
    await browser.reload(); await ready();
    assert((await browser.locator("#review-arrival").textContent()).includes("版本已变化"), "Stale version reused evidence");
    assert(await browser.locator(".review-correspondence").count() === 0, "Stale version auto-mapped");

    // Unknown formats remain readable, searchable and copied byte-for-byte.
    fixture = '# 未知格式的参照\n\n未知模板独有原句。\n\n<script>window.__unsafe = true</script>\n\n[危险链接](javascript:alert(1))\n';
    await browser.evaluate(() => history.replaceState(null, "", location.href));
    // A fresh document reload clears the in-memory document cache.
    await browser.reload(); await ready();
    assert(await browser.locator(".review-group").count() === 0, "Unknown template was guessed");
    assert(await browser.locator(".prose").getByText("未知模板独有原句。", { exact: true }).count() === 1, "Unknown content omitted");
    assert(await browser.evaluate(() => !window.__unsafe && !document.querySelector('.prose a[href^="javascript:"]')), "Untrusted Markdown executed");
    await browser.locator("#reader-find").click(); await browser.locator("#review-query").fill("未知模板独有");
    await browser.locator(".review-search-tools form button").click(); await browser.locator(".review-match").waitFor();
    await browser.keyboard.press("Escape");
    await browser.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__rawCopy = text; } } }));
    await browser.locator(".copy-markdown").click();
    assert(await browser.evaluate(() => window.__rawCopy) === fixture, "Original reference copy was rewritten");

    // Blocked session storage and long encoded URLs have explicit recovery.
    await browser.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw Error("denied"); } });
    });
    // The next document initializes the panel with storage access denied.
    await browser.goto(`${base}?draft=${edition}#passage-2`); await ready();
    await clickTool(".reader-tools [data-feedback]");
    await browser.locator("#feedback-suggestion").fill("长".repeat(4000));
    assert((await browser.locator(".feedback-status").textContent()).includes("暂存失败"), "Denied storage claimed success");
    assert((await browser.locator(".feedback-status").textContent()).includes("文本较长"), "Long URL fallback missing");
    assert((await browser.locator(".feedback-github").getAttribute("href")).endsWith("/issues/new"), "Long feedback truncated silently");
    await browser.keyboard.press("Escape");

    // A continuous part has its own exact edition and prefixed body anchor.
    await browser.goto(`${base}?platform=bilibili&video=BV1dA411T7xD&view=all`); await ready();
    const continuousEdition = await browser.locator('.reading-article').getAttribute('data-edition');
    quote = await browser.locator('#passage-2').textContent();
    await browser.unroute(sourceRoute);
    await browser.route('**/draft-content/drafts/edition-*/review.md', (route) => route.fulfill({ status: 200, contentType: 'text/markdown', body: fixture }));
    const flow = await browser.locator(".continuous-link").first().getAttribute("href");
    await browser.goto(`${base}${flow}`); await ready();
    const anchor = `part-${continuousEdition}-passage-2`;
    await browser.evaluate((id) => { const node = document.getElementById(id); window.scrollTo({ top: scrollY + node.getBoundingClientRect().top - 90, behavior: "instant" }); }, anchor);
    const originalScroll = await browser.evaluate(() => scrollY);
    await clickTool(".reader-tools [data-feedback]");
    assert((await browser.locator(".feedback-preview").inputValue()).includes(`#${anchor}`), "Continuous feedback missing prefixed anchor");
    await browser.keyboard.press("Escape");
    fixture = `# 测试连续参照\n\n${group(1)}`;
    await clickTool(".reader-mode-link"); await browser.locator(".review-correspondence").waitFor();
    assert((await browser.locator(".reader-mode-link").getAttribute("href")).includes("flow=continuous"), "Reference return lost continuous mode");
    await clickTool(".reader-mode-link"); await ready();
    assert(Math.abs((await browser.evaluate(() => scrollY)) - originalScroll) < 6, `Continuous scroll lost: ${JSON.stringify(await browser.evaluate((originalScroll) => ({ originalScroll, actual: scrollY, state: history.state }), originalScroll))}`);
    await browser.setViewportSize({ width: 320, height: 844 });
    assert(await browser.locator(".reader-part-menu").isVisible(), "Mobile part menu became inaccessible");
    assert(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile multiparts header overflows");
    assert(errors.length === 0, `Runtime errors: ${errors.join("; ")}`);
    return { passed: true, checks: "duplicates, edited/no match, stale version, generic template, raw bytes, unsafe Markdown, denied storage, long URL, continuous round trip, mobile part menu" };
  } finally { await browser.close(); }
}
