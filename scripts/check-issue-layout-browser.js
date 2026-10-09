// Run against a built Pages preview with real content:
// playwright-cli -s=layout-issues run-code --filename=scripts/check-issue-layout-browser.js
async (page) => {
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const browser = page.context().browser();
  const assert = (value, message) => { if (!value) throw Error(message); };
  const directoryReady = (target) => target.waitForFunction(() => document.querySelector('#directory-results')?.getAttribute('aria-busy') === 'false');
  const articleReady = (target) => target.locator('.reading-article > .prose').waitFor();
  const settledFonts = (target) => target.evaluate(() => document.fonts.ready);
  const pageErrors = [];
  const metrics = [];
  const metadata = (target, selectors) => target.evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter((node) => node.getBoundingClientRect().height > 0).map((node) => ({ selector, size: parseFloat(getComputedStyle(node).fontSize), text: node.textContent.trim().slice(0, 70) }))), selectors);
  const contexts = [];
  let longHref;
  let longTitle;
  let edition;

  try {
    for (const width of [320, 390, 1440]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, colorScheme: theme, reducedMotion: 'reduce' });
        contexts.push(context);
        await context.addInitScript((theme) => localStorage.setItem('reading-theme', theme), theme);
        const target = await context.newPage();
        target.on('pageerror', (error) => pageErrors.push(error.message));
        await target.goto(base);
        await directoryReady(target);
        await settledFonts(target);
        // The app's saved preference is authoritative; apply the desired theme
        // before comparing layouts, without interacting with a closed site menu.
        await target.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
        const home = await target.evaluate(() => {
          const title = document.querySelector('.video-heading h2');
          const action = document.querySelector('.video-group .part-link, .video-group .parts-disclosure > summary');
          return { title: title.textContent, titleTop: title.getBoundingClientRect().top, titleBottom: title.getBoundingClientRect().bottom, actionBottom: action.getBoundingClientRect().bottom, overflow: document.documentElement.scrollWidth > innerWidth, advancedOpen: document.querySelector('#advanced-search').open };
        });
        assert(!home.overflow, `Home overflows ${width}/${theme}`);
        assert(home.titleBottom < (width === 1440 ? 900 : 844) && home.actionBottom < (width === 1440 ? 900 : 844), `First title or reading entry is outside first screen: ${JSON.stringify(home)}`);
        assert(!home.advancedOpen, 'Default advanced search is expanded');
        assert(await target.locator('#sort-help').isVisible(), 'Current ordering is hidden with advanced settings');
        const homeMetadata = await metadata(target, ['.draft-state', '.part-minutes', '.video-meta', '.result-count', '.filter-label', '.top-nav a']);
        assert(homeMetadata.every((item) => item.size >= 13), `Home metadata too small: ${JSON.stringify(homeMetadata.filter(item => item.size < 13))}`);
        const sourceLink = target.locator('.video-meta a').first();
        assert((await sourceLink.textContent()).includes('原视频'), 'Source link uses an opaque ID without reader language');
        assert(/^https:\/\/www\.bilibili\.com\/video\/BV/.test(await sourceLink.getAttribute('href')), 'Source no longer points to the frozen video');
        if (width === 390) await target.screenshot({ path: `artifacts/issue-home-mobile-${theme}.png`, animations: 'disabled' });
        await target.locator('#advanced-search > summary').focus();
        await target.keyboard.press('Enter');
        assert(await target.getByRole('radio', { name: '正文原句', exact: true }).isVisible(), 'Keyboard cannot unfold advanced search');
        await target.getByRole('radio', { name: '正文原句', exact: true }).check();
        await directoryReady(target);
        assert(await target.locator('.search-mode-current').textContent() === '正文原句', 'Selected mode summary is stale');
        assert(await target.locator('#search-sort').isDisabled(), 'Phrase search incorrectly permits title sorting');
        const sharedMode = target.url();
        await target.goto(sharedMode);
        await directoryReady(target);
        assert(await target.locator('#advanced-search').getAttribute('open') !== null, 'Shared nondefault search mode remained hidden');
        await target.getByRole('radio', { name: '综合搜索', exact: true }).check();
        await directoryReady(target);
        longHref = await target.locator('.video-heading h2 a').first().getAttribute('href');
        longTitle = await target.locator('.video-heading h2 a').first().textContent();
        await target.locator('.video-heading h2 a').first().click();
        await articleReady(target);
        await settledFonts(target);
        await target.evaluate((theme) => { document.documentElement.dataset.theme = theme; window.scrollTo({ top: 0, behavior: 'instant' }); }, theme);
        edition = await target.locator('.reading-article').getAttribute('data-edition');
        const reader = await target.evaluate(() => ({ title: document.querySelector('.reading-heading h1').textContent, firstParagraphTop: document.querySelector('.reading-article > .prose > p')?.getBoundingClientRect().top, headerHeight: document.querySelector('.reader-header').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth, provenanceOpen: document.querySelector('.provenance').open, hasBodyHeadings: !!document.querySelector('.reading-article > .prose h2, .reading-article > .prose h3, .reading-article > .prose h4'), hasToc: !!document.querySelector('.table-of-contents') }));
        assert(reader.title === longTitle, 'The frozen long title was shortened');
        assert(!reader.overflow, `Reader overflows ${width}/${theme}`);
        assert(reader.headerHeight <= 72 && reader.headerHeight === 64, `Reading header is not compact: ${reader.headerHeight}`);
        assert(!reader.provenanceOpen, 'Detailed provenance is unnecessarily expanded');
        assert(Number.isFinite(reader.firstParagraphTop), 'Real first paragraph missing');
        assert(reader.firstParagraphTop < (width === 1440 ? 900 : 1100), `First paragraph is still too far below the heading: ${JSON.stringify(reader)}`);
        assert(reader.hasToc === reader.hasBodyHeadings, 'An empty or invented article outline appears');
        if (!reader.hasToc) assert(await target.locator('#reader-outline').isHidden(), 'Outline tool appears without headings');
        const readerMetadata = await metadata(target, ['.reading-status', '.draft-state', '.reading-meta > span', '.reading-meta > time', '.reading-meta a', '.reading-meta button', '.article-tags a', '.reader-current-label']);
        assert(readerMetadata.every((item) => item.size >= 13), `Reader metadata too small: ${JSON.stringify(readerMetadata.filter(item => item.size < 13))}`);
        if (width === 390) await target.screenshot({ path: `artifacts/issue-reader-mobile-${theme}.png`, animations: 'disabled' });
        metrics.push({ width, theme, home, reader, metadataMinimum: Math.min(...homeMetadata.map(item => item.size), ...readerMetadata.map(item => item.size)) });
        await context.close();
      }
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    contexts.push(context);
    const target = await context.newPage();
    target.on('pageerror', (error) => pageErrors.push(error.message));
    await target.goto(`${base}${longHref}`);
    await articleReady(target);
    // Keyboard access to source, edition, immutable content hash and review.
    await target.locator('.provenance > summary').focus();
    await target.keyboard.press('Enter');
    assert(await target.locator('.provenance-content').isVisible(), 'Keyboard cannot unfold provenance');
    await target.locator('.release-details > summary').focus();
    await target.keyboard.press('Enter');
    const identities = await target.locator('.release-details dd').allTextContents();
    assert(identities.includes(edition), 'Exact edition inaccessible in source details');
    assert(identities.some((value) => /^[a-f0-9]{64}$/.test(value)), 'Exact content hash inaccessible');
    assert(await target.locator('.provenance .issue-link').isVisible(), 'Version-bound correction link inaccessible');
    const issueHref = await target.locator('.provenance .issue-link').getAttribute('href');
    assert(await target.evaluate(({ issueHref, edition }) => new URL(issueHref).searchParams.get('body').includes(edition), { issueHref, edition }), 'Correction link lost exact edition');
    await target.getByRole('link', { name: '校验参照稿件', exact: true }).click();
    await articleReady(target);
    await target.locator('.provenance > summary').focus();
    await target.keyboard.press('Enter');
    assert(await target.locator('.review-reference-notice').isVisible(), 'Reference meaning inaccessible');
    await target.locator('.release-details > summary').click();
    assert((await target.locator('.release-details').textContent()).includes('校验参照文件 SHA-256'), 'Reference file hash inaccessible');

    // A direct article's tag starts a new exploration in its own category.
    await target.goto(`${base}${longHref}`);
    await articleReady(target);
    await target.evaluate(() => sessionStorage.setItem('reading-directory-drafts', JSON.stringify({ query: '旧词', mode: 'keywords', sort: 'title', tag: '全部' })));
    const tag = await target.locator('.article-tags a').first().textContent();
    const tagHref = await target.locator('.article-tags a').first().getAttribute('href');
    const tagParams = await target.evaluate((tagHref) => Object.fromEntries(new URL(tagHref, location.href).searchParams), tagHref);
    assert(tagParams.view === 'drafts' && tagParams.tag === tag && tagParams.q === '', 'Direct tag link has wrong category or retained an old search');
    assert(tagHref.includes(encodeURIComponent(tag)), 'Source tag was not URL encoded');
    await target.locator('.article-tags a').first().click();
    await directoryReady(target);
    assert(await target.locator('.filter-current').textContent() === tag, 'Clicked tag selection lost');
    assert(await target.locator('#search').inputValue() === '', 'Old query restricted new theme exploration');
    await target.locator('.video-heading h2 a').first().click();
    await articleReady(target);
    await target.locator('.reader-directory-link').click();
    await directoryReady(target);
    assert(await target.locator('.filter-current').textContent() === tag, 'Theme exploration lost when returning to directory');

    // Reading tools stay available in the middle and identify actual visible P.
    await target.goto(`${base}?video=BV1dA411T7xD&view=drafts`);
    await articleReady(target);
    await target.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }));
    await target.locator('#reader-find').click();
    assert(await target.locator('.reader-video-search').getAttribute('open') !== null, 'Middle find did not open video search');
    assert(await target.locator('#video-query').evaluate((input) => document.activeElement === input), 'Middle find did not focus query');
    await target.locator('.reader-part-menu > summary').click();
    const toolParts = await target.locator('.reader-part-menu a').allTextContents();
    assert(toolParts.join(',') === Array.from({ length: 13 }, (_, index) => `P${index + 1}`).join(','), 'Sticky tools use wrong P order or category');
    assert(await target.locator('.reader-part-menu a').evaluateAll((links) => links.every(link => new URL(link.href).searchParams.has('draft'))), 'Sticky tools mixed categories');
    await target.keyboard.press('Escape');
    await target.getByRole('link', { name: '从此 P 连续阅读 →', exact: true }).first().click();
    await target.locator('.continuous-part').waitFor();
    await target.locator('.continuous-feedback a[rel="next"]').click();
    await target.waitForFunction(() => document.querySelectorAll('.continuous-part').length === 2);
    const loaded = target.locator('.continuous-part');
    const scrollToPart = async (index, expected) => {
      await loaded.nth(index).locator('.prose > p').first().evaluate((paragraph) => window.scrollTo({ top: paragraph.getBoundingClientRect().top + window.scrollY - 74, behavior: 'instant' }));
      await target.waitForFunction((expected) => document.querySelector('.reader-tools .reader-current-label')?.textContent === expected, expected);
    };
    await scrollToPart(1, 'P2');
    await scrollToPart(0, 'P1');
    assert(await target.evaluate(() => new URL(location.href).searchParams.get('part')) !== await loaded.first().getAttribute('data-edition'), 'Test did not create different routed and visible P');
    assert(await target.locator('.reader-part-menu a[aria-current]').textContent() === 'P1', 'Active menu item did not follow visible earlier P');

    // Text enlargement uses a snapshot of computed sizes, so inherited sizes
    // do not compound. This checks 200% text reflow, not a device zoom claim.
    const zoomMetrics = [];
    for (const [route, width] of [[base, 390], [`${base}${longHref}`, 390], [`${base}?video=BV1dA411T7xD&view=drafts`, 320]]) {
      await target.goto(route);
      if (route === base) await directoryReady(target); else await articleReady(target);
      await target.setViewportSize({ width, height: 844 });
      await target.evaluate(() => {
        const sizes = [...document.querySelectorAll('body, body *')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
        for (const [node, size] of sizes) node.style.fontSize = `${size * 2}px`;
      });
      const zoom = await target.evaluate(() => {
        const tools = [...document.querySelectorAll('.reader-tools > *, .reader-site-menu > summary')].filter(node => !node.hidden);
        const boxes = tools.map(node => node.getBoundingClientRect());
        const header = document.querySelector('.site-header').getBoundingClientRect();
        return { page: document.querySelector('.reading-article') ? 'reader' : 'home', overflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth, contentWidth: document.documentElement.scrollWidth, headerHeight: header.height, toolsWithinHeader: boxes.every(box => box.top >= header.top && box.bottom <= header.bottom && box.left >= 0 && box.right <= innerWidth) };
      });
      assert(!zoom.overflow, `200% text overflows: ${JSON.stringify(zoom)}`);
      assert(zoom.toolsWithinHeader, `200% text reading controls overlap the header bounds: ${JSON.stringify(zoom)}`);
      zoomMetrics.push(zoom);
    }
    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join('\n')}`);
    return { passed: true, metrics, checks: ['first screen title and reading action', 'real long title first paragraph', '13px metadata', '64px reading tools', 'keyboard provenance and exact identities', 'version-bound review and correction', 'encoded source themes and return state', 'shared advanced mode', 'middle video find focus', 'actual visible continuous P'], textEnlargement: zoomMetrics };
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
}
