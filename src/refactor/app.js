import { createContentRepository } from './services/content-repository.js';
import { createSearchService } from './services/search-service.js';
import { createLocalState } from './services/local-state.js';
import { createNavigationSession } from './services/navigation-session.js';
import { createFeedbackState } from './services/feedback-state.js';
import { navigate, parseRoute, routeHref } from './core/router.js';
import { isDraft, workKey } from './core/content.js';
import { searchEntries, entryKey } from '../../packages/content-core/index.js';
import { createReaderSession, readingLocation, restoreReadingLocation } from './features/reader-session.js';
import { createToolController } from './features/tool-controller.js';
import { libraryPage, recentPage, readerPage, readerArticle, readerToolPanel, escapeHtml } from './views.js';
import './styles.css';

export function mountRefactorApp(root = document.querySelector('#app')) {
  const repository = createContentRepository(), search = createSearchService(repository), state = createLocalState();
  const navigation = createNavigationSession(), tools = createToolController(root), feedback = createFeedbackState();
  let route = parseRoute(), currentHash = location.hash || '#/library', controller = new AbortController(), task = 0;
  let reader, resultLimit = 32, readerQuery = '', readerResults = [], timer, toolTask = 0;
  let feedbackDraft = {}, feedbackStatus = '', currentTool = '';
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
    navigation.saveReader(route.name, value.editionId, { ...value, flow: route.flow });
    if (route.name === 'read') { state.remember(reader.entry, value.anchor, value.offset); storageNotice(); }
    if (updateUrl && route.flow && route.name === 'read') {
      route = { ...route, editionId: value.editionId, block: value.anchor };
      history.replaceState(history.state, '', routeHref('read', { ...route, flow: true })); currentHash = location.hash;
      root.querySelectorAll('.reader-parts a').forEach((link) => link.classList.toggle('current', link.getAttribute('href')?.includes(value.editionId)));
      title(reader.entry.title);
      const identity = root.querySelector('.reader-identity');
      if (identity) { identity.querySelector('span').textContent = reader.entry.title; identity.querySelector('strong').textContent = `P${reader.entry.partIndex + 1} · ${reader.entry.sourceMetadata?.partTitle || ''}`; }
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
    const opposite = route.name === 'read' ? 'verify' : 'read', position = navigation.reader(opposite, entry?.editionId);
    return { route, repository, entry, parts: reader?.parts || [], prepared, theme: state.preferences.theme, review: route.name === 'verify', returnHref: navigation.returnHref,
      locationHref: routeHref(opposite, { editionId: entry?.editionId, flow: opposite === 'read' && (position?.flow || route.flow) }) };
  }
  async function render(next = parseRoute()) {
    const token = ++task;
    controller.abort(); controller = new AbortController(); const signal = controller.signal;
    tools.close({ restoreFocus: false }); toolTask++; readerResults = []; readerQuery = '';
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
      const position = route.block ? { editionId: entry.editionId, anchor: route.block } : navigation.reader(route.name, entry.editionId) || (local?.status === 'valid' ? local.record : null);
      if (position) restoreReadingLocation(root, position); else window.scrollTo({ top: 0, behavior: 'instant' });
      if (route.name === 'read') savePosition();
    } catch (error) { if (token === task && !signal.aborted) documentError(error); }
  }
  function feedbackOptions(draft = feedbackDraft) {
    const position = readingLocation(root);
    const pageUrl = new URL(routeHref(route.name, { editionId: reader.entry.editionId, flow: route.flow, block: position?.anchor }), location.href).href;
    return { ...draft, entry: reader.entry, pageUrl, mode: route.name === 'verify' ? 'review' : 'body' };
  }
  async function showTool(name) {
    if (!reader?.entry) return;
    const token = ++toolTask; currentTool = name;
    let feedbackMarkup = '';
    if (name === 'feedback') {
      feedbackDraft = feedback.read(reader.entry, route.name === 'verify' ? 'review' : 'body');
      let module;
      try { module = await import('./features/feedback.js'); }
      catch { if (token === toolTask) tools.show(readerToolPanel({ ...viewArgs(), tool: name, error: '建议工具暂时无法加载，正文可以继续阅读。请刷新后重试。' })); return; }
      if (token !== toolTask) return;
      const options = feedbackOptions();
      const validated = module.validateFeedbackDraft(feedbackDraft);
      const text = validated.valid ? module.feedbackText(options) : '';
      feedbackMarkup = module.feedbackPanel({ entry: reader.entry, review: route.name === 'verify', draft: feedbackDraft, status: feedbackStatus, issueHref: validated.valid ? module.feedbackIssueHref(options) : '', text, errors: feedbackStatus ? validated.errors : [] });
    }
    tools.show(readerToolPanel({ ...viewArgs(), tool: name, searchQuery: readerQuery, searchResults: readerResults, preferences: state.preferences, feedbackMarkup }));
  }
  function closeTool() { toolTask++; tools.close(); }
  async function appendNext(button) {
    const session = reader, token = task; if (!session?.next || route.name !== 'read') return;
    if (session.documents.size >= 20) { capture(); navigate('read', { editionId: session.next.editionId, flow: true }); return; }
    button.disabled = true; button.textContent = '正在加载下一 P…';
    try {
      const item = await session.append(controller.signal); if (!item || token !== task) return;
      root.querySelector('.reader-article:last-child [data-action="load-next"]')?.remove();
      root.querySelector('.reader-page').insertAdjacentHTML('beforeend', readerArticle(viewArgs(item.entry, item.prepared)));
      restoreReadingLocation(root, { editionId: item.entry.editionId, anchor: '' });
      session.setCurrent(item.entry.editionId); savePosition();
    } catch (error) {
      if (token !== task || controller.signal.aborted) return;
      button.disabled = false; button.textContent = '重新加载下一 P';
      const notice = button.parentElement.querySelector('[role="alert"]') || document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = error.message; button.parentElement.append(notice);
    }
  }
  function jumpBlock(link) {
    const editionId = link.dataset.editionId || reader.entry.editionId, anchor = link.dataset.readerBlock;
    closeTool();
    if (!reader.documents.has(editionId)) { location.hash = routeHref(route.name, { editionId, block: anchor, flow: route.flow }); return; }
    restoreReadingLocation(root, { editionId, anchor }); reader.setCurrent(editionId); route = { ...route, editionId, block: anchor };
    history.replaceState(history.state, '', routeHref(route.name, route)); currentHash = location.hash; savePosition();
  }
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.matches('[data-reader-block]') && reader) { event.preventDefault(); return jumpBlock(target); }
    if (target.dataset.tool) { event.preventDefault(); return showTool(target.dataset.tool); }
    const action = target.dataset.action;
    if (action === 'close-tool') return closeTool();
    if (action === 'retry-tool') return showTool(currentTool);
    if (action === 'theme') { const position = readingLocation(root); state.updatePreferences({ theme: state.preferences.theme === 'dark' ? 'light' : 'dark' }); preferences(); if (position) restoreReadingLocation(root, position); storageNotice(); return; }
    if (action === 'load-next') return appendNext(target);
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
      return showTool('feedback');
    }
    if (target.getAttribute('href')?.startsWith('#/')) capture();
  }, { signal: subscriptions.signal });
  root.addEventListener('submit', async (event) => {
    const form = event.target;
    if (form.matches('[data-search-form]')) { event.preventDefault(); capture(); return navigate('search', { q: form.elements.q.value.trim(), view: route.view || 'all', mode: route.mode || 'general', tag: route.tag, sort: route.sort }); }
    if (form.matches('[data-reader-search]')) {
      event.preventDefault(); const session = reader, token = ++toolTask; readerQuery = form.elements.q.value.trim();
      try {
        if (route.name === 'verify') {
          const matches = searchEntries([session.entry], { query: readerQuery, tag: '全部', mode: 'phrase' }, { [entryKey(session.entry)]: session.prepared.blocks });
          readerResults = matches.flatMap(({ entry, matches: hits }) => hits.map((hit) => ({ ...hit, entry })));
          return showTool('find');
        }
        const result = await search.search({ query: readerQuery, mode: 'general', view: isDraft(session.entry) ? 'drafts' : 'published', scope: { video: workKey(session.entry), editionId: form.elements.scope?.value === 'article' ? session.entry.editionId : undefined } }, { signal: controller.signal });
        if (token !== toolTask || session !== reader || !tools.open) return;
        readerResults = result.groups.flatMap((group) => group.parts.flatMap(({ entry, hits }) => hits.map((hit) => ({ ...hit, entry })))); return showTool('find');
      } catch (error) { if (token !== toolTask || controller.signal.aborted) return; const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = error.message; form.append(notice); }
    }
    if (form.matches('[data-feedback-form]')) { event.preventDefault(); feedbackDraft = Object.fromEntries(new FormData(form)); feedback.write(reader.entry, route.name === 'verify' ? 'review' : 'body', feedbackDraft); feedbackStatus = '建议已整理。复制文本或打开 GitHub 后确认提交。'; return showTool('feedback'); }
  }, { signal: subscriptions.signal });
  root.addEventListener('input', (event) => { const form = event.target.closest('[data-feedback-form]'); if (form) { feedbackDraft = Object.fromEntries(new FormData(form)); const saved = feedback.write(reader.entry, route.name === 'verify' ? 'review' : 'body', feedbackDraft); feedbackStatus = saved.ok ? '' : '当前浏览器无法暂存建议，请复制完整文本保存。'; const notice = root.querySelector('[data-feedback-status]'); if (notice) notice.textContent = feedbackStatus; } }, { signal: subscriptions.signal });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.preference) { const position = readingLocation(root); state.updatePreferences({ [target.dataset.preference]: target.dataset.preference === 'font' ? target.value : Number(target.value) }); preferences(); restoreReadingLocation(root, position); storageNotice(); return; }
    const filter = target.dataset.filter;
    if (filter || target.name === 'search-mode') { capture(); navigate(route.name === 'search' || target.name === 'search-mode' ? 'search' : 'library', { q: route.query, view: filter === 'view' ? target.value : route.view, tag: filter === 'tag' ? target.value : route.tag, mode: target.name === 'search-mode' ? target.value : route.mode, sort: filter === 'sort' ? target.value : route.sort }); }
  }, { signal: subscriptions.signal });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && tools.open) { event.preventDefault(); closeTool(); } else tools.keyboard(event); }, { signal: subscriptions.signal });
  window.addEventListener('hashchange', () => {
    const next = parseRoute(); capture(false);
    if (reader && next.name === route.name && next.flow === route.flow && reader.documents.has(next.editionId)) { route = next; currentHash = location.hash; closeTool(); restoreReadingLocation(root, { editionId: next.editionId, anchor: next.block }); reader.setCurrent(next.editionId); savePosition(); return; }
    feedbackDraft = {}; feedbackStatus = ''; render(next);
  }, { signal: subscriptions.signal });
  window.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(savePosition, 250); }, { passive: true, signal: subscriptions.signal });
  window.addEventListener('pagehide', () => capture(), { signal: subscriptions.signal });
  render(route);
  return { render, repository, search, state, dispose() { capture(); controller.abort(); subscriptions.abort(); tools.close({ restoreFocus: false }); } };
}
