// Run against an isolated site using test/fixtures/source-description-v2.
// playwright-cli run-code --filename=scripts/check-source-description-browser.js
async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const base = new URL(page.url()).origin;
  const catalog = await page.request.get(`${base}/content/catalog.json`).then((response) => response.json());
  const article = catalog.articles[0];
  const browser = page.context().browser();
  const metrics = [];
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    try {
      const target = await context.newPage();
      const errors = [];
      target.on('pageerror', (error) => errors.push(error.message));
      await target.goto(`${base}/#/read/${article.editionId}`);
      await target.getByRole('button', { name: '更多', exact: true }).click();
      await target.getByRole('button', { name: '来源与版本', exact: true }).click();
      const description = target.locator('.source-description');
      await description.waitFor({ state: 'visible' });
      assert(await description.textContent() === article.sourceMetadata.description.replace(/\r\n/g, '\n'), 'Description bytes changed beyond HTML newline normalization');
      assert(await description.evaluate((node) => getComputedStyle(node).whiteSpace) === 'pre-wrap', 'Description loses line breaks');
      assert(await description.locator('a,script,img').count() === 0, 'Description is interpreted as markup');
      await target.getByText('来源简介补充证据', { exact: true }).click();
      const evidence = target.locator('.source-version-details').filter({ has: target.getByText('来源简介补充证据', { exact: true }) });
      assert((await evidence.locator('pre').textContent()).includes('archive-video-details-projection'), 'Description evidence hidden or incorrect');
      assert((await target.locator('.source-facts dt').allTextContents()).includes('编辑摘要'), 'Editorial summary is not separate');
      const overflow = await target.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert(!overflow, `Source panel horizontally overflows at ${width}px`);
      assert(!errors.length, errors.join('; '));
      metrics.push({ width, overflow, errors });
    } finally {
      await context.close();
    }
  }
  return { metrics };
}
