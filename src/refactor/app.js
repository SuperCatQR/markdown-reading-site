import { createContentRepository } from './services/content-repository.js';
import { createSearchService } from './services/search-service.js';
import { createLocalState, DEFAULT_PREFERENCES } from './services/local-state.js';
import { createNavigationSession } from './services/navigation-session.js';
import { createFeedbackState } from './services/feedback-state.js';
import { navigate, parseRoute, routeHref } from './core/router.js';
import { isDraft, workKey } from './core/content.js';
import { searchEntries, entryKey } from '../../packages/content-core/index.js';
import { createReaderSession, readingLocation, readerPositionForRoute, restoreReadingLocation } from './features/reader-session.js';
import { createToolController } from './features/tool-controller.js';
import { createDocumentActionsController, currentDocumentSource } from './features/document-actions.js';
import { libraryPage, recentPage, readerPage, readerToolPanel, escapeHtml } from './views.js';
import './styles.css';

export function mountRefactorApp(root = document.querySelector('#app')) {
  const repository = createContentRepository(), search = createSearchService(repository), state = createLocalState();
  const navigation = createNavigationSession(), tools = createToolController(root), feedback = createFeedbackState();
  let route = parseRoute(), currentHash = location.hash || '#/library', controller = new AbortController(), task = 0;
  let initialRender = true;
  const documentReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  let reader, resultLimit = 32, readerQuery = '', readerResults = [], timer, toolTask = 0;
  let feedbackDraft = {}, feedbackStatus = '', feedbackContext = null, currentTool = '';
  let feedbackModule, selectedPassage, searchLoading = false, searchError = '', hitIndex = -1, searchScope = 'video', searchTask = 0, pendingReaderSearch;
  const documentActions = createDocumentActionsController({ root, getDocument() {
    if (!reader?.entry) return { entry: null };
    const position = readingLocation(root), entry = repository.findEdition(position?.editionId) || reader?.entry;
    return { entry, source: currentDocumentSource(reader, { editionId: entry.editionId }), mode: route.name, anchor: position?.anchor || '', baseUrl: location.href };
  } });
  const subscriptions = new AbortController();
  history.scrollRestoration = 'manual';
  function preferences() {
    const value = state.preferences;
    document.documentElement.dataset.refactorTheme = value.theme;
    document.documentElement.style.setProperty('--reader-size', `${value.size}px`);
    document.documentElement.style.setProperty('--reader-width', `${value.width}px`);
    document.documentElement.style.setProperty('--reader-line-height', value.lineHeight);
    document.documentElement.style.setProperty('--reader-font', value.font === 'sans' ? '"Microsoft YaHei", system-ui, sans-serif' : 'Georgia, "Noto Serif SC", "Songti SC", serif');
    document.querySelector('meta[name="theme-color"]').content = value.theme === 'dark' ? '#17191b' : '#f7f5f1';
  }
  function title(value) { document.title = `${value} · 档案室`; }
  function storageNotice() {
    if (state.status.saved) return;
    const notice = root.querySelector('[data-storage-notice]') || document.createElement('p');
    notice.dataset.storageNotice = ''; notice.className = 'storage-notice'; notice.setAttribute('role', 'status');
    notice.textContent = '当前浏览器无法保存阅读状态；本次设置仍可使用，关闭页面后可能丢失。';
    if (!notice.isConnected) root.querySelector('main')?.prepend(notice);
  }
  function savePosition(updateUrl = true) {
    if (!reader || !['read', 'verify'].includes(route.name) || !root.querySelector('.reader-prose')) return;
    const value = readingLocation(root);
    if (!value) return;
    reader.setCurrent(value.editionId);
    navigation.saveReader(route.name, value.editionId, value);
    if (route.name === 'read') { state.remember(reader.entry, value.anchor, value.offset); storageNotice(); }
    if (updateUrl && route.name === 'read') {
      const canonicalRoute = { ...route };
      delete canonicalRoute.flow;
      route = { ...canonicalRoute, editionId: value.editionId, block: value.anchor };
      history.replaceState(history.state, '', routeHref('read', route)); currentHash = location.hash;
      root.querySelectorAll('.reader-parts a').forEach((link) => { const current = link.getAttribute('href')?.includes(value.editionId); link.classList.toggle('current', current); if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
      title(reader.entry.title);
      const identity = root.querySelector('.reader-identity');
      if (identity) { identity.querySelector('span').textContent = reader.entry.title; identity.querySelector('strong').textContent = `P${reader.entry.partIndex + 1} · ${reader.entry.sourceMetadata?.partTitle || '分段标题未提供'}`; identity.title = `${reader.entry.title} · ${identity.querySelector('strong').textContent}`; }
    }
  }
  function capture(updateUrl = true) {
    if (['library', 'search'].includes(route.name)) navigation.capture(currentHash, root, resultLimit);
    savePosition(updateUrl); clearTimeout(timer);
  }
  function missing(message = '这个页面不存在') {
    title(message);
    root.innerHTML = `<header class="app-header"><a class="brand" href="#/library">档案室</a></header><main class="page empty-state" id="main-content"><h1>${escapeHtml(message)}</h1><p>链接参数无效，或内容不在当前快照中。</p><a class="button-link" href="#/library">返回资料库</a></main>`;
  }
  function documentError(error) {
    root.innerHTML = `<header class="reader-header"><a class="reader-back" href="${escapeHtml(navigation.returnHref)}">返回资料库</a></header><main class="page empty-state" id="main-content"><h1>稿件暂时未能加载</h1><p role="alert">${escapeHtml(error.message)}</p><p>请重试，当前稿件的审核与发布状态没有改变。</p><button class="button-link" data-action="retry-document">重新加载</button></main>`;
  }
  function viewArgs(entry = reader?.entry, prepared = reader?.prepared) {
    const opposite = route.name === 'read' ? 'verify' : 'read';
    return { route, repository, entry, parts: reader?.parts || [], prepared, theme: state.preferences.theme, review: route.name === 'verify', returnHref: navigation.returnHref,
      locationHref: routeHref(opposite, { editionId: entry?.editionId }) };
  }
  async function render(next = parseRoute()) {
    const reload = initialRender && documentReload; initialRender = false;
    const token = ++task;
    const pending = pendingReaderSearch; pendingReaderSearch = null;
    controller.abort(); controller = new AbortController(); const signal = controller.signal;
    tools.close({ restoreFocus: false }); toolTask++; searchTask++; feedbackContext = null; selectedPassage = null; readerResults = []; readerQuery = ''; searchLoading = false; searchError = ''; hitIndex = -1; searchScope = 'video';
    route = next; currentHash = location.hash || '#/library'; reader = null; preferences();
    if (['library', 'search'].includes(route.name)) {
      title(route.name === 'search' ? `搜索：${route.query}` : '文字资料库'); resultLimit = navigation.page(currentHash)?.limit || 32;
      const args = () => ({ route, repository, state, theme: state.preferences.theme, history: state.history, limit: resultLimit });
      root.innerHTML = libraryPage({ ...args(), groups: [], loading: true });
      try {
        const result = await search.search(route, { signal }); if (token !== task || signal.aborted) return;
        root.innerHTML = libraryPage({ ...args(), groups: result.groups }); navigation.restore(currentHash, root);
      } catch (error) { if (token === task && !signal.aborted) root.innerHTML = libraryPage({ ...args(), groups: [], error: error.message }); }
      return;
    }
    if (route.name === 'recent') { title('最近阅读'); root.innerHTML = recentPage({ route, repository, state, theme: state.preferences.theme }); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    if (!['read', 'verify'].includes(route.name)) return missing();
    const entry = repository.findEdition(route.editionId); if (!entry) return missing('没有找到这篇稿件'); title(entry.title);
    reader = createReaderSession(repository, route); const session = reader;
    root.innerHTML = `<header class="reader-header"><a class="reader-back" href="${escapeHtml(navigation.returnHref)}">返回资料库</a><span>正在加载稿件</span></header><main class="page"><div class="loading-state">正在加载…</div></main>`;
    try {
      const item = await session.load(entry, signal); if (token !== task || signal.aborted) return;
      root.innerHTML = readerPage(viewArgs(item.entry, item.prepared));
      const local = route.name === 'read' ? state.progress(entry) : null;
      const position = readerPositionForRoute(route, { saved: navigation.reader(route.name, entry.editionId), local, reload });
      if (position) restoreReadingLocation(root, position); else window.scrollTo({ top: 0, behavior: 'instant' });
      if (route.name === 'read') savePosition();
      if (pending && pending.editionId === entry.editionId && pending.manuscriptType === entry.manuscriptType && pending.work === workKey(entry) && pending.mode === route.name) { readerQuery = pending.query; readerResults = pending.results; hitIndex = pending.index; searchScope = pending.scope; if (pending.open) await showTool('find'); }
    } catch (error) { if (token === task && !signal.aborted) documentError(error); }
  }
  function feedbackOptions(draft = feedbackDraft) {
    return { ...draft, ...feedbackContext };
  }
  async function showTool(name, { preserveFeedback = false } = {}) {
    if (!reader?.entry) return;
    savePosition(false);
    const token = ++toolTask; currentTool = name;
    let feedbackMarkup = '';
    if (name === 'feedback') {
      if (!preserveFeedback || !feedbackContext) {
        const position = readingLocation(root), entry = repository.findEdition(position?.editionId) || reader.entry;
        const pageUrl = new URL(routeHref(route.name, { editionId: entry.editionId, block: position?.anchor }), location.href).href;
        feedbackContext = { entry, pageUrl, mode: route.name === 'verify' ? 'review' : 'body' };
        feedbackDraft = feedback.read(entry, feedbackContext.mode); feedbackStatus = '';
      }
      let module;
      try { module = await import('./features/feedback.js'); }
      catch { if (token === toolTask) tools.show(readerToolPanel({ ...viewArgs(), tool: name, error: '建议工具暂时无法加载，正文可以继续阅读。请刷新后重试。' })); return; }
      if (token !== toolTask) return;
      feedbackModule = module;
      const options = feedbackOptions();
      const validated = module.validateFeedbackDraft(feedbackDraft);
      const text = validated.valid ? module.feedbackText(options) : '';
      feedbackMarkup = module.feedbackPanel({ entry: feedbackContext.entry, review: feedbackContext.mode === 'review', draft: feedbackDraft, status: feedbackStatus, pageUrl: feedbackContext.pageUrl, selectionAvailable: selectedPassage?.editionId === feedbackContext.entry.editionId, draftStatus: feedback.status.saved ? '建议草稿仅暂存在当前标签页。' : '当前浏览器无法暂存建议，请复制完整文本保存。', issueHref: validated.valid ? module.feedbackIssueHref(options) : '', text, errors: feedbackStatus ? validated.errors : [] });
    }
    tools.show(readerToolPanel({ ...viewArgs(), tool: name, searchQuery: readerQuery, searchResults: readerResults, searchLoading, searchError, searchIndex: hitIndex, searchScope, preferences: state.preferences, feedbackMarkup }));
  }
  function closeTool(options) { toolTask++; tools.close(options); }
  function jumpBlock(link, { keepTool = false } = {}) {
    const editionId = link.dataset.editionId || reader.entry.editionId, anchor = link.dataset.readerBlock;
    const index = readerResults.findIndex((hit) => hit.entry.editionId === editionId && hit.id === anchor); if (index >= 0) hitIndex = index;
    if (!keepTool || !reader.documents.has(editionId)) closeTool({ restoreReading: false });
    if (!reader.documents.has(editionId)) { if (index >= 0) pendingReaderSearch = { editionId, manuscriptType: reader.entry.manuscriptType, work: workKey(reader.entry), mode: route.name, query: readerQuery, results: readerResults, index, scope: searchScope, open: keepTool }; location.hash = routeHref(route.name, { editionId, block: anchor }); return; }
    restoreReadingLocation(root, { editionId, anchor }); reader.setCurrent(editionId); const canonicalRoute = { ...route }; delete canonicalRoute.flow; route = { ...canonicalRoute, editionId, block: anchor };
    if (keepTool && tools.open) tools.restoreReading({ editionId, anchor, offset: 0 });
    history.replaceState(history.state, '', routeHref(route.name, route)); currentHash = location.hash; savePosition();
  }
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.matches('[data-reader-block]') && reader) { event.preventDefault(); return jumpBlock(target); }
    if (target.dataset.tool) { event.preventDefault(); return showTool(target.dataset.tool); }
    const action = target.dataset.action;
    if (action === 'skip-content') { const main = root.querySelector('main'); main?.setAttribute('tabindex', '-1'); main?.focus({ preventScroll: true }); main?.scrollIntoView({ behavior: 'instant', block: 'start' }); return; }
    if (['copy-paragraph-link', 'copy-markdown', 'download-markdown'].includes(action)) return documentActions.perform(action === 'copy-paragraph-link' ? 'copy-link' : action);
    if (action === 'reset-preferences') { const position = readingLocation(root); state.updatePreferences({ ...DEFAULT_PREFERENCES, theme: state.preferences.theme }); preferences(); tools.restoreReading(position); storageNotice(); return showTool('settings'); }
    if (action === 'feedback-selection' && selectedPassage?.editionId === feedbackContext?.entry.editionId) {
      feedbackContext = { ...feedbackContext, pageUrl: new URL(routeHref(route.name, { editionId: selectedPassage.editionId, block: selectedPassage.anchor }), location.href).href };
      feedbackDraft = { ...feedbackDraft, quote: selectedPassage.quote, context: selectedPassage.context };
      feedback.write(feedbackContext.entry, feedbackContext.mode, feedbackDraft);
      return showTool('feedback', { preserveFeedback: true });
    }
    if (['previous-hit', 'next-hit'].includes(action) && readerResults.length) { hitIndex = Math.max(0, Math.min(readerResults.length - 1, hitIndex + (action === 'previous-hit' ? -1 : 1))); const hit = readerResults[hitIndex]; jumpBlock({ dataset: { editionId: hit.entry.editionId, readerBlock: hit.id } }, { keepTool: true }); if (tools.open) return showTool('find'); return; }
    if (action === 'close-tool') return closeTool();
    if (action === 'retry-tool') return showTool(currentTool);
    if (action === 'theme') { const position = readingLocation(root); state.updatePreferences({ theme: state.preferences.theme === 'dark' ? 'light' : 'dark' }); preferences(); if (position) restoreReadingLocation(root, position); storageNotice(); return; }
    if (action === 'retry-document' || action === 'retry-search') return render(route);
    if (action === 'load-more') { navigation.capture(currentHash, root, resultLimit + 32); return render(route); }
    if (target.dataset.removeHistory) { state.remove(target.dataset.removeHistory); return render(route); }
    if (action === 'clear-history') { state.clear(); return render(route); }
    if (action === 'copy-feedback' && reader) {
      const session = reader, token = ++toolTask, options = feedbackOptions({ ...feedbackDraft });
      const module = await import('./features/feedback.js');
      if (token !== toolTask || reader !== session || !tools.open) return;
      try { await navigator.clipboard.writeText(module.feedbackText(options)); feedbackStatus = '已复制；尚未提交建议。'; }
      catch { feedbackStatus = '复制失败，请在下方选中并复制建议文本。'; }
      if (token !== toolTask || reader !== session || !tools.open) return;
      return showTool('feedback', { preserveFeedback: true });
    }
    if (target.getAttribute('href')?.startsWith('#/')) capture();
  }, { signal: subscriptions.signal });
  root.addEventListener('submit', async (event) => {
    const form = event.target;
    if (form.matches('[data-search-form]')) { event.preventDefault(); capture(); return navigate('search', { q: form.elements.q.value.trim(), view: route.view || 'all', mode: route.mode || 'general', tag: route.tag, sort: route.sort }); }
    if (form.matches('[data-reader-search]')) {
      event.preventDefault(); const session = reader, token = ++searchTask; readerQuery = form.elements.q.value.trim(); searchScope = form.elements.scope?.value || 'video'; readerResults = []; hitIndex = -1; searchError = ''; searchLoading = true;
      await showTool('find'); if (token !== searchTask || session !== reader) return;
      const update = () => { if (tools.open && currentTool === 'find') return showTool('find'); };
      try {
        if (route.name === 'verify') {
          const matches = searchEntries([session.entry], { query: readerQuery, tag: '全部', mode: 'phrase' }, { [entryKey(session.entry)]: session.prepared.blocks });
          readerResults = matches.flatMap(({ entry, matches: hits }) => hits.map((hit) => ({ ...hit, entry })));
          searchLoading = false; return update();
        }
        const result = await search.search({ query: readerQuery, mode: 'general', view: isDraft(session.entry) ? 'drafts' : 'published', scope: { video: workKey(session.entry), editionId: form.elements.scope?.value === 'article' ? session.entry.editionId : undefined } }, { signal: controller.signal });
        if (token !== searchTask || session !== reader) return;
        readerResults = result.groups.flatMap((group) => group.parts.flatMap(({ entry, hits }) => hits.map((hit) => ({ ...hit, entry })))); searchLoading = false; return update();
      } catch (error) { if (token !== searchTask || controller.signal.aborted) return; searchLoading = false; searchError = error.message; return update(); }
    }
    if (form.matches('[data-feedback-form]') && feedbackContext) { event.preventDefault(); feedbackDraft = Object.fromEntries(new FormData(form)); feedback.write(feedbackContext.entry, feedbackContext.mode, feedbackDraft); feedbackStatus = '建议已整理。复制文本或打开 GitHub 后确认提交。'; return showTool('feedback', { preserveFeedback: true }); }
  }, { signal: subscriptions.signal });
  root.addEventListener('input', (event) => {
    const form = event.target.closest('[data-feedback-form]');
    if (!form || !feedbackContext) return;
    toolTask++;
    feedbackDraft = Object.fromEntries(new FormData(form));
    const saved = feedback.write(feedbackContext.entry, feedbackContext.mode, feedbackDraft);
    feedbackStatus = saved.ok ? '' : saved.reason === 'invalid-draft' ? '内容超出上限，原输入仍保留，请缩短后再整理。' : '当前浏览器无法暂存建议，请复制完整文本保存。';
    const notice = root.querySelector('[data-feedback-status]'); if (notice) notice.textContent = feedbackStatus;
    const validated = feedbackModule.validateFeedbackDraft(feedbackDraft);
    for (const [field, count] of Object.entries(feedbackModule.feedbackFieldCounts(feedbackDraft))) { const node = root.querySelector(`[data-feedback-count="${field}"]`); if (node) node.textContent = `${count} / 4000 字符`; const input = form.elements[field]; if (input) { if (validated.errors[field]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } const error = root.querySelector(`#feedback-${field}-error`); if (error) { error.textContent = validated.errors[field] || ''; error.hidden = !validated.errors[field]; } }
    const validation = root.querySelector('[data-feedback-validation]'); if (validation) validation.textContent = validated.valid ? '内容已完整，可以整理预览或复制完整建议。' : Object.values(validated.errors).join(' ');
    const draftNotice = root.querySelector('[data-feedback-draft-status]'); if (draftNotice) draftNotice.textContent = saved.ok ? '建议草稿已暂存在当前标签页。' : feedbackStatus;
    const copy = root.querySelector('[data-action="copy-feedback"]'); if (copy) { copy.disabled = !validated.valid; copy.setAttribute('aria-disabled', String(!validated.valid)); }
    const preview = root.querySelector('[data-feedback-output]'); if (preview) preview.value = validated.valid ? feedbackModule.feedbackText(feedbackOptions()) : '';
    const issue = root.querySelector('[data-feedback-issue]'); if (issue) { issue.hidden = true; issue.removeAttribute('href'); }
  }, { signal: subscriptions.signal });
  root.addEventListener('pointerup', () => {
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), element = selection.anchorNode?.parentElement, article = element?.closest('.reader-article'), block = element?.closest('[data-block-id]');
    if (!article || !root.contains(article) || !article.contains(range.startContainer) || !article.contains(range.endContainer)) return;
    const quote = selection.toString().trim(); if (!quote || quote.length > 4000) return;
    const context = block?.textContent?.trim() || '';
    selectedPassage = { editionId: article.dataset.editionId, anchor: block?.dataset.blockId || '', quote, context: context.length <= 4000 ? context : '' };
  }, { signal: subscriptions.signal });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.preference) { const position = readingLocation(root); state.updatePreferences({ [target.dataset.preference]: target.dataset.preference === 'font' ? target.value : Number(target.value) }); preferences(); tools.restoreReading(position); storageNotice(); return; }
    const filter = target.dataset.filter;
    if (filter || target.name === 'search-mode') { capture(); navigate(route.name === 'search' || target.name === 'search-mode' ? 'search' : 'library', { q: route.query, view: filter === 'view' ? target.value : route.view, tag: filter === 'tag' ? target.value : route.tag, mode: target.name === 'search-mode' ? target.value : route.mode, sort: filter === 'sort' ? target.value : route.sort }); }
  }, { signal: subscriptions.signal });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && tools.open) { event.preventDefault(); closeTool(); } else tools.keyboard(event); }, { signal: subscriptions.signal });
  window.addEventListener('hashchange', () => {
    const next = parseRoute(); capture(false);
    if (reader && next.name === route.name && reader.documents.has(next.editionId)) { route = next; currentHash = location.hash; closeTool({ restoreReading: false }); restoreReadingLocation(root, { editionId: next.editionId, anchor: next.block }); reader.setCurrent(next.editionId); savePosition(); return; }
    feedbackDraft = {}; feedbackStatus = ''; render(next);
  }, { signal: subscriptions.signal });
  window.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(savePosition, 250); }, { passive: true, signal: subscriptions.signal });
  window.addEventListener('pagehide', () => capture(), { signal: subscriptions.signal });
  render(route);
  return { render, repository, search, state, dispose() { capture(); task++; toolTask++; controller.abort(); subscriptions.abort(); tools.dispose(); } };
}
