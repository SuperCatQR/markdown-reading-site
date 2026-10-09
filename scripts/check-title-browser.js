// playwright-cli -s=p0 run-code --filename=scripts/check-title-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext();
  const target = await context.newPage();
  const metrics = [];
  try {
    for (const mode of ["draft", "review"]) {
      await target.goto(`${base}?${mode}=29fcc4b3cc2045c1abecaad159d95420`);
      await target.locator(".reading-article .prose").waitFor();
      await target.evaluate(() => document.fonts.ready);
      for (const width of [1920, 1440, 1024, 768, 375]) {
        await target.setViewportSize({ width, height: 1080 });
        const result = await target.evaluate(() => {
          const title = document.querySelector(".reading-heading h1");
          const prose = document.querySelector(".reading-article > .prose");
          return { width: innerWidth, titleWidth: title.clientWidth, proseWidth: prose.clientWidth,
            lines: title.clientHeight / parseFloat(getComputedStyle(title).lineHeight),
            overflow: document.documentElement.scrollWidth > innerWidth,
            centered: Math.abs(prose.getBoundingClientRect().left + prose.clientWidth / 2 - innerWidth / 2) < 2 };
        });
        if (result.overflow || !result.centered) throw Error(`Invalid layout: ${JSON.stringify(result)}`);
        if (width >= 1024 && (result.proseWidth !== 760 || result.titleWidth < 960 || result.lines > 3.1)) throw Error(`Desktop measure regressed: ${JSON.stringify(result)}`);
        metrics.push({ mode, ...result });
        if (mode === "draft" && [1920, 375].includes(width)) await target.screenshot({ path: `artifacts/title-${width}-light.png` });
      }
    }
    await target.locator(".reader-site-menu > summary").click();
    await target.getByRole("button", { name: "切换深浅主题" }).click();
    await target.screenshot({ path: "artifacts/title-mobile-dark.png" });
    return { passed: true, metrics };
  } finally { await context.close(); }
}
