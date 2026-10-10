// Browser measurement of the real long-title, multipart and search-arrival cases.
// playwright-cli -s=followup-layout --raw run-code --filename=scripts/check-followup-layout-browser.js
async page => {
  const baseline = page.url().includes(':4184/');
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const samples = [
    { id: '1a8e79034ff148c78e7df5a6f1859b90', label: 'long-single' },
    { id: 'b8f430d510ab42d8a5298db0e4c98ebe', label: 'multipart' },
    { id: '20b3456f06f64577850122410d980c81', label: 'unconscious-middle' },
  ];
  const contexts = [];
  const metrics = [];
  const errors = [];
  let stage = 'reader matrix';
  const assert = (value, message) => { if (!value) throw Error(message); };
  const ready = target => target.locator('.reading-article > .prose').waitFor();
  const measure = async (target, sample, theme, width, resume) => {
    const result = await target.evaluate(() => {
      const prose = document.querySelector('.reading-article > .prose');
      const paragraph = prose.querySelector('p');
      const bounds = paragraph.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
      return { paragraphTop: bounds.top, visibleLines: Math.max(0, Math.min(bounds.height, innerHeight - bounds.top) / lineHeight), lineHeight,
        hasResume: !!document.querySelector('.reading-resume'), title: document.querySelector('.reading-heading h1').textContent,
        tags: [...document.querySelectorAll('.article-tags a')].map(node => node.textContent),
        headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        status: document.querySelector('.reading-status').textContent,
        actions: [...document.querySelectorAll('.reading-actions > *')].map(node => ({ text: node.textContent, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })) };
    });
    assert(!result.overflow, `Reader overflow ${sample.label}/${width}/${theme}`);
    if (!baseline && width === 390 && !resume) assert(result.visibleLines >= 2.95, `Less than three first-passage lines: ${JSON.stringify(result)}`);
    assert(result.status.includes('未发布'), 'Preview state disappeared');
    metrics.push({ sample: sample.label, edition: sample.id, width, theme, resume, ...result });
  };
  try {
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
      const context = await page.context().browser().newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, colorScheme: theme, reducedMotion: 'reduce' });
      contexts.push(context);
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      for (const sample of samples) {
        await target.goto(`${base}?draft=${sample.id}`);
        await ready(target);
        await target.evaluate(theme => { document.documentElement.dataset.theme = theme; window.scrollTo({ top: 0, behavior: 'instant' }); }, theme);
        await measure(target, sample, theme, width, false);
        if (!baseline && width === 390 && theme === 'light') {
          const expectedTags = sample.label === 'long-single' ? ['哲学', '经验主义', '现象学', '先验主义', '胡塞尔', '直觉主义']
            : sample.label === 'multipart' ? ['哲学', '哲学史', '现象学', '胡塞尔'] : ['哲学', '心理', '人文', '意识', '无意识', '弗洛伊德', '精神分析', '拉康'];
          const disclosure = target.locator('.article-themes');
          assert(!(await disclosure.evaluate(node => node.open)), 'Themes are not initially folded');
          await disclosure.locator('summary').focus();
          await target.keyboard.press('Enter');
          const actualTags = await target.locator('.article-tags a').allTextContents();
          assert(JSON.stringify(actualTags) === JSON.stringify(expectedTags), 'Source tags disappeared or changed');
          assert(await target.locator('.article-tags a').first().isVisible(), 'Tags inaccessible by keyboard');
          const actualLinks = await target.locator('.article-tags a').evaluateAll(nodes => nodes.map(node => ({ tag: node.textContent, encoded: new URL(node.href).searchParams.get('tag') })));
          assert(actualLinks.every(link => link.tag === link.encoded), 'Theme links changed source encoding');
          await disclosure.locator('summary').click();
          const sourceUrl = await target.evaluate(() => performance.getEntriesByType('resource').find(resource => /\/preview-[^/]+\.md/.test(resource.name)).name);
          const raw = await (await target.request.get(sourceUrl)).text();
          await target.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window.copiedSource = text; return Promise.resolve(); } } }));
          await target.locator('.copy-markdown').click();
          assert(await target.evaluate(source => window.copiedSource === source, raw), 'Copy Markdown changed the frozen source');
          const firstHeading = raw.match(/^#\s+(.+)$/m)?.[1].trim().replace(/\\([\p{P}\p{S}])/gu, '$1');
          const renderedTitle = await target.locator('.reading-heading h1').textContent();
          assert(firstHeading && renderedTitle === firstHeading, `Full original Markdown title changed: ${JSON.stringify({ firstHeading, renderedTitle, sourceUrl })}`);
          assert(await target.locator('.reading-actions a').getAttribute('href').then(href => href.includes('bilibili.com/video/')), 'Original video link disappeared');
          await target.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        }
        if (width === 390 && theme === 'light') await target.screenshot({ path: `artifacts/followup-${baseline ? 'before' : 'after'}-${sample.label}.png`, animations: 'disabled' });
        // Create a real record from an actual body passage and reopen in a fresh tab.
        if (width === 390) {
          await target.locator('.reading-article > .prose > p').nth(3).evaluate(node => window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - 90, behavior: 'instant' }));
          await target.locator('.reader-directory-link').click();
          await target.locator('#directory-results[aria-busy="false"]').waitFor();
          const reopened = await context.newPage();
          await reopened.goto(`${base}?draft=${sample.id}`);
          await ready(reopened);
          await reopened.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          await measure(reopened, sample, theme, width, true);
          assert(await reopened.locator('.reading-resume').count() === 1, 'Real previous reading did not create a resume option');
          await reopened.close();
        }
      }
      await context.close();
    }
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    contexts.push(context);
    const target = await context.newPage();
    stage = 'scoped arrival';
    await target.goto(`${base}?draft=20b3456f06f64577850122410d980c81&vq=${encodeURIComponent('无意识')}&vview=drafts#hit=passage-2&q=${encodeURIComponent('无意识')}`);
    await target.locator('.search-arrival').waitFor();
    await target.locator('#video-results[aria-busy="false"]').waitFor({ state: 'attached' });
    const arrivalMetrics = async target => target.evaluate(() => ({ top: document.querySelector('.search-arrival').getBoundingClientRect().top, bottom: document.querySelector('.search-arrival').getBoundingClientRect().bottom,
      headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom, targetTop: document.querySelector('.search-passage').getBoundingClientRect().top,
      fixedBottom: Math.max(...[...document.querySelectorAll('.site-header, #reader-search-navigation:not([hidden])')].map(node => node.getBoundingClientRect().bottom)),
      highlight: [...document.querySelectorAll('.search-passage mark')].map(node => node.textContent), role: document.querySelector('.search-arrival').getAttribute('role'), focused: document.activeElement.classList.contains('search-passage'), overflow: document.documentElement.scrollWidth > innerWidth }));
    const arrival = await arrivalMetrics(target);
    const arrivals = [{ route: 'scoped', ...arrival }];
    const assertArrival = result => {
      assert(result.top >= result.fixedBottom, `Search arrival behind fixed tools: ${JSON.stringify(result)}`);
      assert(result.targetTop + 1 >= result.bottom && result.top < 844, `Confirmation is not followed by target passage in view: ${JSON.stringify(result)}`);
      assert(result.focused && result.role === 'status' && result.highlight.length, 'Search target focus, status or highlight lost');
      assert(!result.overflow, 'Search arrival overflows');
    };
    if (!baseline) {
      await target.locator('#reader-search-navigation:not([hidden])').waitFor();
      assertArrival(await arrivalMetrics(target));
      for (const route of ['direct', 'global']) {
        stage = `${route} arrival`;
        await target.goto(`${base}?draft=20b3456f06f64577850122410d980c81${route === 'global' ? '&vq=' + encodeURIComponent('无意识') + '&vview=drafts' : ''}#hit=passage-2&q=${encodeURIComponent('无意识')}`);
        await target.locator('.search-arrival').waitFor();
        if (route === 'global') await target.locator('#reader-search-navigation:not([hidden])').waitFor();
        const result = await arrivalMetrics(target);
        assertArrival(result);
        arrivals.push({ route, ...result });
      }
      stage = '200% arrival reflow';
      await target.evaluate(() => {
        const sizes = [...document.querySelectorAll('body *')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
        sizes.forEach(([node, size]) => { node.style.fontSize = `${size * 2}px`; });
      });
      await target.addStyleTag({ content: '.search-arrival { font-size: 28px !important; line-height: 1.7 !important; }' });
      // Use the actual same-document result link, exercising the site's click
      // route and position saving rather than browser-native hash navigation.
      await target.locator('#video-results .passage-link').first().evaluate(link => link.click());
      await target.waitForFunction(() => document.querySelector('.search-passage')?.id === 'passage-1');
      await target.waitForFunction(() => document.querySelector('.search-arrival')?.getBoundingClientRect().top < innerHeight);
      const reflowArrival = await arrivalMetrics(target);
      assertArrival(reflowArrival);
      arrivals.push({ route: '200%-text', ...reflowArrival });
      // Reflow at 200% text without changing the viewport width. Body, controls
      // and wrapping arrival notice all use their actual computed font sizes.
      await target.goto(`${base}?draft=b8f430d510ab42d8a5298db0e4c98ebe`);
      stage = '200% reflow';
      await ready(target);
      await target.evaluate(() => {
        const sizes = [...document.querySelectorAll('body *')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
        sizes.forEach(([node, size]) => { node.style.fontSize = `${size * 2}px`; });
      });
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text reflow overflows reader');
      await target.locator('.article-themes > summary').click();
      assert(await target.locator('.article-tags a').last().isVisible(), '200% text hides full theme set');
      await target.locator('.reading-parts > summary').click();
      assert(await target.locator('.reading-parts .continuous-link').isVisible(), '200% text loses multipart reading control');
      const flow = await target.locator('.reading-parts .continuous-link').getAttribute('href');
      stage = 'continuous arrival';
      await target.goto(`${base}${flow}#hit=part-b8f430d510ab42d8a5298db0e4c98ebe-passage-1&q=${encodeURIComponent('胡塞尔')}`);
      await target.locator('.search-arrival').waitFor();
      await target.locator('#reader-search-navigation:not([hidden])').waitFor();
      const continuous = await arrivalMetrics(target);
      assertArrival(continuous);
      arrivals.push({ route: 'continuous', ...continuous });
      await target.screenshot({ path: 'artifacts/followup-arrival-continuous.png', animations: 'disabled' });
      stage = 'later P continuous arrival';
      await target.goto(`${base}?platform=bilibili&video=BV1KK4y1g7TA&view=drafts&flow=continuous&part=ce914a6683254132b62e57d0ca2a0871#hit=part-ce914a6683254132b62e57d0ca2a0871-passage-1&q=${encodeURIComponent('场域')}`);
      await target.locator('.search-arrival').waitFor();
      await target.locator('#reader-search-navigation:not([hidden])').waitFor();
      const laterPart = await arrivalMetrics(target);
      assertArrival(laterPart);
      assert(await target.locator('.search-passage').evaluate(node => node.closest('article').dataset.edition) === 'ce914a6683254132b62e57d0ca2a0871', 'Later P landed in the wrong source');
      arrivals.push({ route: 'continuous-P2', ...laterPart });
    }
    assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`);
    return { passed: true, mode: baseline ? 'baseline' : 'acceptance', metrics, arrivals };
  } catch (error) { throw Error(`${stage}: ${error.message}`); } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
}
