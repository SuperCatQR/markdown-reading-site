// playwright-cli -s=contributor-fix run-code --filename=scripts/check-contributor-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = await page.context().newPage();
  const edition = "18e76d4ae0464b0fa478507531463970";
  const errors = [], requests = [], measurements = [];
  browser.on("pageerror", (error) => errors.push(error.message));
  browser.on("request", (request) => requests.push(request.url()));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => { await browser.locator(".reading-article .prose, .continuous-part .prose").first().waitFor(); await browser.locator(".contribution-dialog").waitFor({ state: "attached" }); };
  const settle = () => browser.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const clickTool = async (selector) => {
    const bounds = await browser.locator(selector).boundingBox();
    assert(bounds && bounds.y >= 0, `Tool is outside viewport: ${selector}`);
    await browser.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  try {
  const bodyUrl = `${base}?draft=${edition}#hit=passage-2&q=${encodeURIComponent("无意识")}`;
  await browser.setViewportSize({ width: 1440, height: 900 });
  await browser.goto(bodyUrl); await ready();
  await browser.waitForFunction(() => document.querySelector(".search-passage")?.id === "passage-2");
  const quote = await browser.locator("#passage-2").textContent();
  const before = await browser.evaluate(() => window.scrollY);
  const beforeLayout = await browser.evaluate(() => ({ y: scrollY, hash: location.hash, passage: document.querySelector('#passage-2').getBoundingClientRect().top, header: document.querySelector('.reader-mode-link').getBoundingClientRect().top }));
  await clickTool(".reader-mode-link"); await browser.locator(".review-correspondence").waitFor();
  assert(await browser.locator(".review-correspondence").getAttribute("id") === "passage-14", `Incorrect reference mapping: ${JSON.stringify({ beforeLayout, context: await browser.evaluate(() => history.state.reviewContext) })}`);
  assert((await browser.locator(".review-correspondence").textContent()).endsWith(quote), "Wrong reference quote");
  assert(await browser.evaluate(() => !location.hash), "Carried incompatible body hash to reference");
  assert((await browser.locator(".reader-mode-link").getAttribute("href")).includes("#hit=passage-2"), "Return hash missing");
  await clickTool(".reader-mode-link"); await ready(); await settle();
  assert(Math.abs((await browser.evaluate(() => window.scrollY)) - before) < 6, "Body position lost on return");
  await browser.goBack(); await browser.locator(".review-correspondence").waitFor();
  assert((await browser.locator(".reader-mode-link").getAttribute("href")).includes("#hit=passage-2"), "History return lost source URL");
  await browser.reload(); await browser.locator(".review-correspondence").waitFor();
  assert((await browser.locator(".reader-mode-link").getAttribute("href")).includes("#hit=passage-2"), "Reload lost versioned context");

  await browser.evaluate(() => history.replaceState(null, "", location.href));
  await browser.goto(`${base}?review=${edition}`); await ready();
  const reviewRequests = requests.length;
  await browser.getByRole("button", { name: "查找当前校验参照", exact: true }).click();
  await browser.locator("#review-query").fill("公共实践性体验");
  await browser.locator(".review-search-tools form button").click();
  await browser.locator(".review-match").waitFor();
  assert((await browser.locator(".review-match").textContent()).includes("公共实践性体验"), "Reference-only query not found");
  assert(await browser.locator("mark[data-review-highlight]").count() > 0, "Reference highlight missing");
  assert(!requests.slice(reviewRequests).some((url) => /search-.*\.json/.test(url)), "Reference search fetched body index");
  await browser.locator("#review-query").fill("疑点"); await browser.locator(".review-search-tools form button").click();
  assert(await browser.locator(".review-search-tools output").textContent() !== "0 处命中 · 仅当前参照", "Doubts not searchable");
  const first = await browser.locator(".review-match").getAttribute("id");
  await browser.locator("[data-review-next]").click();
  assert(await browser.locator(".review-match").getAttribute("id") !== first, "Next reference hit failed");
  await browser.locator("[data-review-prev]").click();
  assert(await browser.locator(".review-match").getAttribute("id") === first, "Previous reference hit failed");
  await browser.locator("[data-review-close]").click(); await settle();
  assert((await browser.evaluate(() => window.scrollY)) < 6, `Reference search failed to restore top: ${await browser.evaluate(() => window.scrollY)}`);
  // Hidden technical metadata is searchable and opens before positioning.
  await browser.locator("#reader-find").click(); await browser.locator("#review-query").fill("top_p");
  await browser.locator(".review-search-tools form button").click();
  assert(await browser.locator(".review-metadata").getAttribute("open") !== null, "Hidden metadata not revealed");
  await browser.keyboard.press("Escape"); await settle();
  assert(await browser.locator(".review-metadata").getAttribute("open") === null, "Reference search changed disclosure state on return");

  // Verify selection, native modal focus, no-login copy, same-version recovery.
  await browser.goto(bodyUrl); await ready();
  await browser.evaluate(() => {
    const paragraph = document.querySelector("#passage-2");
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await settle();
  await clickTool(".reader-tools [data-feedback]");
  await browser.locator("dialog[open]").waitFor();
  assert(await browser.locator("#feedback-quote").inputValue() === quote, "Selection not captured");
  assert(await browser.locator("#feedback-suggestion").evaluate((node) => document.activeElement === node), "Modal focus incorrect");
  await browser.locator("#feedback-suggestion").fill("浏览器回归测试建议");
  await browser.locator("#feedback-reason").fill("测试理由");
  const text = await browser.locator(".feedback-preview").inputValue();
  assert(text.includes(edition) && text.includes("#passage-2") && text.includes("完整内容 SHA-256"), "Feedback evidence incomplete");
  assert(await browser.locator(".feedback-github").evaluate((node, text) => new URL(node.href).searchParams.get("body") === text, text), "GitHub prefill differs from copy text");
  await browser.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__feedbackCopy = text; } } }); });
  await browser.locator("[data-feedback-copy]").click();
  assert(await browser.evaluate(() => window.__feedbackCopy) === text, "No-login copy failed");
  await browser.keyboard.press("Escape");
  await clickTool(".reader-tools [data-feedback]");
  assert(await browser.locator("#feedback-suggestion").inputValue() === "浏览器回归测试建议", "Session feedback draft lost");
  await browser.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw Error("denied"); } } }); });
  await browser.locator("[data-feedback-copy]").click();
  assert((await browser.locator(".feedback-status").textContent()).includes("手动复制"), "Clipboard denial has no recovery");
  assert(await browser.locator(".feedback-preview").evaluate((node) => node.selectionEnd > node.selectionStart), "Manual copy text not selected");
  await browser.locator("[data-feedback-clear]").click(); await browser.keyboard.press("Escape");
  // Review drafts have their own key and immutable reference hash.
  await clickTool(".reader-mode-link"); await browser.locator(".review-correspondence").waitFor();
  await clickTool(".reader-tools [data-feedback]");
  assert(await browser.locator("#feedback-suggestion").inputValue() === "", "Body suggestion leaked into reference version");
  assert((await browser.locator(".feedback-preview").inputValue()).includes("校验参照文件 SHA-256"), "Reference hash missing from suggestion");
  await browser.keyboard.press("Escape");

  for (const [width, height] of [[1440, 900], [390, 844], [320, 844]]) {
    await browser.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(() => history.replaceState(null, "", location.href));
      await browser.goto(`${base}?review=${edition}`); await ready();
      await browser.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await browser.evaluate(() => document.fonts.ready); await settle();
      const layout = await browser.evaluate(() => ({
        firstGroup: document.querySelector(".review-group h2").getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth - innerWidth,
        controls: [...document.querySelectorAll(".reader-tools > a, .reader-tools > button")].filter((node) => getComputedStyle(node).display !== "none").map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      }));
      assert(layout.overflow <= 1, `Horizontal overflow at ${width}/${theme}`);
      assert(layout.controls.every((control) => control.width >= 44 && control.height >= 44), `Small touch target at ${width}/${theme}`);
      assert(layout.firstGroup >= 0 && layout.firstGroup < height, `First comparison outside viewport at ${width}/${theme}: ${layout.firstGroup}`);
      measurements.push({ width, height, theme, firstGroup: Math.round(layout.firstGroup) });
      await browser.screenshot({ path: `artifacts/contributor-review-${width}-${theme}.png`, animations: "disabled" });
      await browser.locator(".reader-tools [data-feedback]").click();
      assert(await browser.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "Feedback modal overflow");
      await browser.keyboard.press("Escape");
    }
  }
  assert(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  return { checks: "mapping, history, reload, review-only search, hidden matches, feedback, clipboard denial, mobile/themes", measurements };
  } finally { await browser.close(); }
}
