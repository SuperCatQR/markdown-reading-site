// Run against the current frontend with real content:
// playwright-cli -s=reader-layout run-code --filename=scripts/check-refactor-reader-layout-browser.js
async (page) => {
  const base = await page.evaluate(() => location.origin);
  const browser = page.context().browser();
  const singleEdition = '0e6bb3b8a12d493d90fbb6f707161526';
  const multiEdition = '0724ad88f2f34abea2924007462b7f7b';
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const metrics = [];
  const errors = [];
  for (const viewportWidth of [320, 390, 900, 901, 1440, 2048]) {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: 900 }, reducedMotion: 'reduce' });
    try {
      const target = await context.newPage();
      target.on('pageerror', (error) => errors.push(error.message));
      for (const [kind, edition] of [['single', singleEdition], ['multi', multiEdition]]) {
        await target.goto(`${base}/#/library`);
        await target.locator('.primary-search').waitFor({ state: 'visible' });
        await target.goto(`${base}/#/read/${edition}`);
        await target.locator('.reader-prose').waitFor({ state: 'visible' });
        for (const preferredWidth of [620, 760, 920]) {
          await target.evaluate((width) => localStorage.setItem('reader-refactor-preferences-v1', JSON.stringify({ theme: 'light', size: 17, width })), preferredWidth);
          await target.reload();
          await target.locator('.reader-prose').waitFor({ state: 'visible' });
          const layout = await target.evaluate(() => {
            const prose = document.querySelector('.reader-prose').getBoundingClientRect();
            return { width: prose.width, x: prose.x, overflow: document.documentElement.scrollWidth > innerWidth, sidebar: !!document.querySelector('.reader-layout > .reader-parts') };
          });
          const available = viewportWidth <= 900 ? viewportWidth - 32 : Math.min(1280, viewportWidth - 48) - (kind === 'multi' ? 266 : 0);
          const expected = Math.min(preferredWidth, available);
          assert(Math.abs(layout.width - expected) < 1, `Wrong body width: ${JSON.stringify({ kind, viewportWidth, preferredWidth, expected, ...layout })}`);
          assert(!layout.overflow, `Reader overflows at ${viewportWidth}/${kind}`);
          assert(layout.sidebar === (kind === 'multi'), `Wrong directory presence for ${kind}`);
          if (kind === 'single') assert(Math.abs(layout.x - (viewportWidth - layout.width) / 2) < 1, 'Single reader is not centered');
          metrics.push({ kind, viewportWidth, preferredWidth, bodyWidth: layout.width });
        }
        if (kind === 'multi') {
          await target.getByRole('button', { name: '目录', exact: true }).click();
          const drawerParts = target.locator('.tool-drawer .reader-parts');
          await drawerParts.waitFor({ state: 'visible' });
          assert(await drawerParts.locator('a').count() > 1, 'Directory drawer has no part links');
          assert(await drawerParts.evaluate((node) => getComputedStyle(node).position) === 'static', 'Drawer directory still uses sticky sidebar positioning');
          await target.getByRole('button', { name: '关闭', exact: true }).click();
        }
      }
    } finally {
      await context.close();
    }
  }
  assert(!errors.length, `Browser errors: ${errors.join('; ')}`);
  return { checks: metrics.length, errors, metrics };
}
