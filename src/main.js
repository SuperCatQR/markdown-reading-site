import { workKey, partLabel } from "./source-identity.js";
import { sourceTagStats, bindDirectoryDiscovery, bindDirectoryPopovers, openDirectorySection } from "./discovery-controls.js";
import { visibleQuery } from "./query-state.js";
import { bindReadingPreferences, readingPreferencesMarkup } from "./reading-preferences.js";
import catalog from "../content/catalog.json";
import draftCatalog from "../draft-content/catalog.json";
import summaries from "virtual:reader-summaries";
import searchUrls from "virtual:reader-search-urls";
import originSnapshots from "virtual:reader-origins";
import { seriesSnapshots } from "virtual:reader-series";
import { isDraft, sortReaderEntries, resolveReaderRoute, directoryRoute, searchRoute, readerSearchRoute, videoEntry, continuousRoute } from "./manuscripts.js";
import { searchEntries, sortingHelp, searchModes } from "./search.js";
import { createSearchLoader, measureSearchStage, showSearchWaiting } from "./search-loader.js";
import { browserStorage, createDirectoryStore, sanitizeDirectoryState, sanitizeSearchOrigin } from "./directory-state.js";
import { header, footer, themeIconMarkup, viewLabels } from "./ui.js";
import { directoryMarkup, directoryResults, searchHelp } from "./directory-view.js";
import { copyMarkdown, focusDocumentHash } from "./browser-document.js";
import { readerToolsMarkup, bindReaderTools } from "./reader-tools.js";
import { createReadingHistoryBrowser } from "./reading-history-browser.js";
import { contributionVersion } from "./contribution-version.js";
import "./site.css";
import "./reader-experience.css";
import "./directory-experience.css";
import "./followup-reading.css";
import "./contributor-experience.css";
import "./visitor-experience.css";
import "./reading-layout.css";

const bodyFiles = {
  ...import.meta.glob("../content/articles/part-*/publish.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../draft-content/drafts/edition-*/preview.md", { eager: true, query: "?url", import: "default" }),
};
const reviewFiles = {
  ...import.meta.glob("../content/articles/part-*/review.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../draft-content/drafts/edition-*/review.md", { eager: true, query: "?url", import: "default" }),
};
const loadSearchData = createSearchLoader(searchUrls);
const documentCache = new Map();
const withOrigins = (catalog, origins) => {
  const indexed = new Map((origins?.entries || []).map((origin) => [origin.editionId, origin]));
  return catalog.articles.map((entry) => indexed.has(entry.editionId) ? { ...entry, origin: indexed.get(entry.editionId) } : entry);
};
const publicationEntries = withOrigins(catalog, originSnapshots.published);
const draftEntries = withOrigins(draftCatalog, originSnapshots.drafts);
const entriesByView = {
  all: sortReaderEntries([...publicationEntries, ...draftEntries]),
  published: sortReaderEntries(publicationEntries),
  drafts: sortReaderEntries(draftEntries),
};
const counts = Object.fromEntries(Object.entries(entriesByView).map(([view, entries]) => [view, entries.length]));
const app = document.querySelector("#app");
bindReadingPreferences(app);
bindDirectoryPopovers(app);
const siteRoot = import.meta.env.BASE_URL;
const issueUrl = "https://github.com/SuperCatQR/markdown-reading-site/issues/new";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const preferences = browserStorage("localStorage");
const savedTheme = preferences.getItem("reading-theme");
const directories = createDirectoryStore(browserStorage("sessionStorage"));
const state = {
  theme: ["light", "dark"].includes(savedTheme) ? savedTheme : themeMedia.matches ? "dark" : "light",
  followsSystemTheme: !["light", "dark"].includes(savedTheme),
  route: null,
  directory: null,
  composingSearch: false,
};
let renderVersion = 0;
let resultsVersion = 0;
let searchTimer;
let continuousReader;
let continuousScrollTimer;
let readerTools;
let layoutRestoreEvents;
let activeReaderVideo;
let contributionPanel;
let reviewSearch;
let contributors;
let searchToolsObserver;
let readingToolScroll = null;
const readingHistory = createReadingHistoryBrowser({ app, entries: entriesByView.all, getRoute: () => state.route,
  getTopOffset: () => Math.max(app.querySelector(".site-header")?.getBoundingClientRect().bottom || 0,
    app.querySelector("#reader-search-navigation:not([hidden])")?.getBoundingClientRect().bottom || 0) + 12,
});
app.addEventListener("reading-tool-open", (event) => {
  if (readingToolScroll === null) readingToolScroll = event.detail?.scroll ?? window.scrollY;
});
for (const name of ["reading-tool-return", "reading-tool-abandon"]) app.addEventListener(name, () => { readingToolScroll = null; });
app.addEventListener("reading-tool-navigate", () => {
  // Leave the prior reading position available to saveLocation during the
  // navigation click; explicit same-page targets resume normal saving next frame.
  requestAnimationFrame(() => { readingToolScroll = null; });
});

function updateSearchToolsHeight() {
  const toolbar = app.querySelector("#reader-search-navigation");
  const height = toolbar && !toolbar.hidden ? toolbar.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty("--search-tools-height", `${height}px`);
}
app.addEventListener("search-navigation-change", () => {
  updateSearchToolsHeight();
  const toolbar = app.querySelector("#reader-search-navigation");
  searchToolsObserver?.disconnect();
  if (toolbar) { searchToolsObserver = new ResizeObserver(updateSearchToolsHeight); searchToolsObserver.observe(toolbar); }
});

// Search results above the prose can change its position after the body is ready.
// Repeat the chosen restoration only while the reader has not taken control.
function finishReadingLayout(ready, version, restore) {
  layoutRestoreEvents?.abort();
  const events = new AbortController();
  layoutRestoreEvents = events;
  let interrupted = false;
  for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) window.addEventListener(type, () => { interrupted = true; }, { passive: true, signal: events.signal });
  ready.then(() => {
    events.abort();
    if (version !== renderVersion || interrupted) return;
    restore();
    updateReadingProgress();
  });
}

function pageHeader(options = {}) {
  const route = state.route;
  const returnView = Object.hasOwn(viewLabels, history.state?.directory?.view) ? history.state.directory.view : route?.view;
  const tools = route?.entry && ["article", "continuous"].includes(route.kind)
    ? readerToolsMarkup(route, { entries: entriesByView.all, returnView, returnSection: history.state?.directory?.section, searchOrigin: sanitizeSearchOrigin(history.state?.searchOrigin, workKey(route.entry)) }) : "";
  return header({ view: route?.view, theme: state.theme, counts, siteRoot, readerTools: tools, section: location.hash.slice(1), ...options }) + (tools ? readingPreferencesMarkup() : "");
}

function tagsForView(view) {
  return ["全部", ...sourceTagStats(entriesByView[view]).map(({ tag }) => tag)];
}

function isSearchPage() { return state.route?.kind === "directory"; }

function directoryKey() { return state.route.view; }

function saveDirectory() {
  if (!isSearchPage() || !state.directory) return;
  state.directory.scroll = window.scrollY;
  directories.write(directoryKey(), state.directory);
  history.replaceState({ ...history.state, directory: { ...state.directory, view: state.route.view, videoKey: state.route.videoKey, section: location.hash === "#recent-reading" ? "recent-reading" : "" } }, "", searchRoute({ ...state.directory, view: state.route.view, videoKey: state.route.videoKey }) + location.hash);
}

function saveLocation() {
  readingHistory.flush();
  if (isSearchPage()) saveDirectory();
  else if (state.route?.kind === "article") history.replaceState({ ...history.state, articleScroll: readingToolScroll ?? window.scrollY }, "");
  else if (state.route?.kind === "continuous") {
    const continuous = continuousReader?.snapshot();
    if (continuous) history.replaceState({ ...history.state, continuous: { ...continuous, scroll: readingToolScroll ?? continuous.scroll } }, "");
  }
}

function loadDocument(url) {
  if (!documentCache.has(url)) {
    documentCache.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error("Document unavailable");
      return response.text();
    }).catch((error) => { documentCache.delete(url); throw error; }));
  }
  return documentCache.get(url);
}

async function syncDirectoryResults(restoreScroll = null) {
  const version = ++resultsVersion;
  const routeVersion = renderVersion;
  const view = state.route.view;
  const results = app.querySelector("#directory-results");
  const resultCount = app.querySelector("#result-count");
  if (!results || !resultCount) return;
  const current = { ...state.directory };
  saveDirectory();
  const isCurrent = () => version === resultsVersion && routeVersion === renderVersion;
  let stopWaiting = () => {};
  const started = performance.now();
  results.setAttribute("aria-busy", "true");
  app.querySelector("#clear-search").hidden = !current.query;
  updateSortingControls();
  try {
    let index = {};
    if (current.query.trim()) {
      resultCount.hidden = false;
      resultCount.textContent = "正在加载搜索资料…";
      stopWaiting = showSearchWaiting(results, { isCurrent });
      index = await loadSearchData(view, null, { ...current, entries: entriesByView[view], isCurrent });
    }
    if (!isCurrent()) return;
    const entries = entriesByView[view];
    let start = performance.now();
    const matches = searchEntries(entries, current, index);
    measureSearchStage("compute", start, { view, scope: "directory" });
    start = performance.now();
    const result = directoryResults(matches, { ...current, counts, view }, summaries);
    measureSearchStage("markup", start, { view, scope: "directory", matches: matches.length });
    start = performance.now();
    results.innerHTML = result.html;
    resultCount.innerHTML = `<strong>${result.count}</strong> 个视频 · <strong>${matches.length}</strong> / ${counts[view]} 篇`;
    results.setAttribute("aria-busy", "false");
    measureSearchStage("dom", start, { view, scope: "directory" });
    measureSearchStage("total", started, { view, scope: "directory" });
    if (restoreScroll !== null) window.scrollTo({ top: restoreScroll, behavior: "instant" });
    saveDirectory();
  } catch {
    if (!isCurrent()) return;
    results.setAttribute("aria-busy", "false");
    resultCount.textContent = "搜索未完成";
    results.innerHTML = '<section class="search-feedback" role="alert"><p>正文搜索索引加载失败，请检查网络后重试。</p><button class="reset-button" type="button" id="retry-search">重新搜索</button></section>';
  } finally { stopWaiting(); }
}

function updateSortingControls() {
  const sort = app.querySelector("#search-sort");
  if (sort) { sort.value = state.directory.sort; sort.disabled = state.directory.mode !== "general"; }
  const sortLabel = app.querySelector(".directory-search-options .search-sort");
  if (sortLabel) sortLabel.hidden = !state.directory.query.trim();
  const explanation = app.querySelector(".sorting-explanation");
  if (explanation) explanation.hidden = !state.directory.query.trim();
  const help = app.querySelector("#sort-help");
  if (help) help.textContent = sortingHelp(state.directory.mode, state.directory.sort, state.directory.query);
  const mode = app.querySelector(".search-mode-current");
  if (mode) mode.textContent = searchModes[state.directory.mode];
  const label = app.querySelector(".search-sort-current");
  if (label) { label.textContent = "标题相关优先"; label.hidden = state.directory.sort !== "title" || state.directory.mode !== "general"; }
  const advanced = app.querySelector("#advanced-search");
  if (advanced && state.directory.mode !== "general") advanced.open = true;
}

function updateSearch(value) {
  ++resultsVersion;
  state.directory.query = visibleQuery(value);
  if (!state.composingSearch && !value.trim()) app.querySelector("#search").value = "";
  state.directory.visibleCount = 24;
  state.directory.passages = [];
  clearTimeout(searchTimer);
  if (!state.composingSearch) searchTimer = setTimeout(() => syncDirectoryResults(), 120);
}

function renderDirectory() {
  const view = state.route.view;
  const tags = tagsForView(view);
  const queryTag = state.route.searchState?.tag;
  if (queryTag && !tags.includes(queryTag)) tags.push(queryTag);
  const saved = history.state?.directory;
  state.directory = saved?.view === view && saved.videoKey === state.route.videoKey ? sanitizeDirectoryState(saved, tags) : directories.read(directoryKey(), tags);
  if (state.route.searchState) state.directory = sanitizeDirectoryState({ ...state.directory, ...state.route.searchState }, tags);
  state.composingSearch = false;
  if (location.hash === "#recent-reading") {
    app.innerHTML = pageHeader({ directory: true }) + `<main id="main-content" class="page-shell recent-page" tabindex="-1"><div class="page-heading"><h1>最近阅读</h1><p class="intro">继续当前浏览器保存的正文位置。这里仅展示阅读记录。</p></div><div id="recent-reading" data-recent-view="full"></div>${footer("最近阅读")}</main>`;
    readingHistory.renderRecent(app.querySelector("#recent-reading"));
    document.title = "最近阅读 · 档案室";
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const scroll = state.directory.scroll;
  const options = {
    ...state.directory, view, tags, counts, tagStats: sourceTagStats(entriesByView[view]), videoCount: new Set(entriesByView[view].map((entry) => workKey(entry))).size,
  };
  app.innerHTML = pageHeader({ directory: true }) + directoryMarkup(options);
  const recentHost = document.createElement("div");
  recentHost.id = "recent-reading";
  app.querySelector("#directory-results").before(recentHost);
  readingHistory.renderRecent(recentHost);
  document.title = `${viewLabels[view]} · 视频文字资料库 · 档案室`;
  document.querySelector('meta[name="description"]').content = "搜索视频讲解的文字整理稿，按分 P 阅读、复习并回看来源。公开预览逐篇标注审核状态。";
  const input = app.querySelector("#search");
  input.setAttribute("aria-describedby", "search-help");
  input.addEventListener("input", () => updateSearch(input.value));
  input.addEventListener("compositionstart", () => { state.composingSearch = true; ++resultsVersion; clearTimeout(searchTimer); });
  input.addEventListener("compositionend", () => { state.composingSearch = false; updateSearch(input.value); });
  app.querySelectorAll('[name="search-mode"]').forEach((radio) => radio.addEventListener("change", () => {
    state.directory.mode = radio.value;
    state.directory.visibleCount = 24;
    state.directory.passages = [];
    app.querySelector("#search-help").textContent = searchHelp(radio.value);
    clearTimeout(searchTimer);
    syncDirectoryResults();
  }));
  app.querySelector("#search-sort")?.addEventListener("change", (event) => {
    state.directory.sort = event.target.value;
    state.directory.visibleCount = 24;
    state.directory.passages = [];
    clearTimeout(searchTimer);
    syncDirectoryResults();
  });
  bindDirectoryDiscovery(app, options.tagStats);
  app.querySelector("#publication-filter").addEventListener("change", (event) => {
    saveLocation();
    const view = event.target.value;
    history.pushState({ directory: { ...state.directory, view, scroll: 0 } }, "", searchRoute({ ...state.directory, view }));
    renderCurrentRoute({ focus: true });
  });
  syncDirectoryResults(scroll).then(() => openDirectorySection(app, location.hash.slice(1)));
}

function messagePage(title, message, { missing = false, retry = false } = {}) {
  app.innerHTML = pageHeader({ unknown: missing }) + `<main id="main-content" class="page-shell" tabindex="-1"><section class="empty-state" ${retry ? 'role="alert"' : 'role="status"'}><h1>${title}</h1><p>${message}</p>${retry ? '<button class="reset-button" type="button" id="retry-document">重新加载</button>' : `<a class="reset-button" href="${directoryRoute("all")}">返回内容目录</a>`}</section>${footer("文字资料库")}</main>`;
  document.title = `${title} · 档案室`;
}

async function renderCurrentRoute({ focus = false } = {}) {
  readingHistory.suspend();
  readingToolScroll = null;
  readerTools?.destroy();
  readerTools = null;
  activeReaderVideo?.destroy();
  activeReaderVideo = null;
  contributionPanel?.destroy(); contributionPanel = null;
  reviewSearch?.destroy(); reviewSearch = null;
  searchToolsObserver?.disconnect();
  document.documentElement.style.setProperty("--search-tools-height", "0px");
  layoutRestoreEvents?.abort();
  const version = ++renderVersion;
  clearTimeout(continuousScrollTimer);
  continuousScrollTimer = null;
  continuousReader = null;
  ++resultsVersion;
  clearTimeout(searchTimer);
  state.route = resolveReaderRoute(location.search, publicationEntries, draftEntries);
  // A validated provider scope opens its first manuscript directly.
  if (state.route.kind === "video") {
    const scoped = state.route;
    const entry = videoEntry(entriesByView.all, scoped.videoKey, scoped.view) || videoEntry(entriesByView.all, scoped.videoKey);
    history.replaceState(history.state, "", `${readerSearchRoute(entry, { ...scoped.searchState, view: scoped.view })}${location.hash}`);
    state.route = resolveReaderRoute(location.search, publicationEntries, draftEntries);
  }
  const route = state.route;
  document.documentElement.dataset.reading = String(!!route.entry && ["article", "continuous"].includes(route.kind));
  if (route.kind === "missing" || (route.kind === "article" && !route.entry)) {
    const video = new URLSearchParams(location.search).has("video");
    messagePage(video ? "没有找到这个视频" : "没有找到这篇稿件", "内容可能尚未导入、已更新或撤回，或链接参数无效。", { missing: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (route.kind === "directory") {
    renderDirectory();
    if (focus) app.querySelector("main").focus({ preventScroll: true });
    return;
  }
  state.directory = null;
  try { contributors = await import("./contributor-browser.js"); }
  catch {
    if (version === renderVersion) messagePage("阅读工具加载失败", "请检查网络后重试。", { retry: true });
    return;
  }
  if (version !== renderVersion) return;
  if (route.kind === "continuous") {
    let createContinuousReader;
    try { ({ createContinuousReader } = await import("./continuous-reader.js")); }
    catch {
      if (version === renderVersion) messagePage("阅读页面加载失败", "请检查网络后重试。", { retry: true });
      return;
    }
    if (version !== renderVersion) return;
    const savedContinuous = history.state?.continuous;
    continuousReader = createContinuousReader({
      app, route, pageHeader, saved: savedContinuous, focus, series: seriesSnapshots[route.view] || [], seriesEntries: entriesByView[route.view],
      videoEntries: entriesByView.all.filter((entry) => workKey(entry) === route.videoKey),
      isCurrent: () => version === renderVersion,
      loadBody: (entry) => {
        const url = bodyFiles[`../${isDraft(entry) ? "draft-content" : "content"}/${entry.file}`];
        if (!url) return Promise.reject(new Error("Document not in snapshot"));
        return loadDocument(url);
      },
      onReady: () => { saveLocation(); updateReadingProgress(); },
    });
    document.title = `${route.entries[0]?.title || route.videoKey} · 连续阅读 · 档案室`;
    document.querySelector('meta[name="description"]').content = "按来源顺序连续阅读视频整理稿，逐篇查看来源与审核状态。";
    await continuousReader.render();
    if (version !== renderVersion) return;
    readerTools = bindReaderTools({ app, route, entries: entriesByView.all, onCurrent: (entry) => continuousReader.setCurrent(entry) });
    contributionPanel = contributors.bindContributionPanel({ app, route, entries: entriesByView.all, issueUrl });
    const localPosition = readingHistory.ready({ historyRestored: continuousReader.didRestore() || new URLSearchParams(location.search).has("part") });
    const historyScroll = continuousReader.didRestore() ? savedContinuous.scroll : null;
    if (route.entry && app.querySelector(".reader-video-search")) {
      const { bindReaderVideo } = await import("./reader-video.js");
      if (version !== renderVersion) return;
      const currentReader = continuousReader;
      const videoSearchReady = bindReaderVideo({
        app, route: { ...route, mode: "continuous", videoSearch: currentReader.searchState() },
        entries: entriesByView.all.filter((entry) => workKey(entry) === route.videoKey), summaries, loadSearchData,
        isCurrent: () => version === renderVersion,
        persistSearch: (value) => { currentReader.setSearch(value); saveLocation(); },
      });
      activeReaderVideo = videoSearchReady;
      readerTools.update();
      finishReadingLayout(videoSearchReady, version, () => {
        if (localPosition) localPosition.restore();
        else if (Number.isFinite(historyScroll)) {
          if (location.hash) focusDocumentHash(location.hash, { scroll: false });
          window.scrollTo({ top: historyScroll, behavior: "instant" });
        }
        else if (location.hash) focusDocumentHash(location.hash);
      });
    }
    return;
  }
  const entry = route.entry;
  const folder = isDraft(entry) ? "draft-content" : "content";
  const files = route.mode === "review" ? reviewFiles : bodyFiles;
  const file = route.mode === "review" ? entry.reviewFile : entry.file;
  const url = files[`../${folder}/${file}`];
  if (!url) {
    messagePage("没有找到这篇稿件", "对应文件未包含在当前快照中。", { missing: true });
    return;
  }
  app.innerHTML = pageHeader() + `<main id="main-content" class="reading-shell" tabindex="-1"><div class="document-loading" role="status" aria-busy="true"><p>正在加载 ${partLabel(entry)}${route.mode === "review" ? "校验参照" : "正文"}…</p><div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div></div></main>`;
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    const [source, { readerMarkup }] = await Promise.all([loadDocument(url), import("./reader-view.js")]);
    if (version !== renderVersion) return;
    const returnView = Object.hasOwn(viewLabels, history.state?.directory?.view) ? history.state.directory.view : route.view;
    const reviewDocument = route.mode === "review" ? contributors.prepareReviewDocument(source) : null;
    app.innerHTML = pageHeader() + readerMarkup(entry, route.mode, source, {
      entries: entriesByView[route.view], videoEntries: entriesByView.all, videoSearch: route.videoSearch, returnView, pageUrl: location.href, issueUrl, series: seriesSnapshots[route.view] || [], preparedReview: reviewDocument,
      returnContinuous: history.state?.continuous?.videoKey === workKey(entry) && history.state.continuous.view === route.view
        ? continuousRoute(workKey(entry), route.view, history.state.continuous.current) : null,
    });
    document.title = `${entry.title} · ${partLabel(entry)}${route.mode === "review" ? " · 校验参照" : ""} · 档案室`;
    document.querySelector('meta[name="description"]').content = entry.summary || `${entry.title}，${partLabel(entry)}。${entry.attribution}`;
    app.querySelector(".copy-markdown").addEventListener("click", (event) => copyMarkdown(source, event.currentTarget));
    const { bindReaderVideo } = await import("./reader-video.js");
    if (version !== renderVersion) return;
    const videoSearchReady = bindReaderVideo({ app, route: route.mode === "review" ? { ...route, videoSearch: undefined } : route, entries: entriesByView.all.filter((candidate) => workKey(candidate) === workKey(entry)), summaries, loadSearchData, isCurrent: () => version === renderVersion });
    activeReaderVideo = videoSearchReady;
    if (focus) app.querySelector("main").focus({ preventScroll: true });
    if (Number.isFinite(history.state?.articleScroll)) {
      if (location.hash) focusDocumentHash(location.hash, { scroll: false });
      window.scrollTo({ top: history.state.articleScroll, behavior: "instant" });
    }
    else if (location.hash) focusDocumentHash(location.hash);
    const context = history.state?.reviewContext;
    const restoreContribution = () => {
      if (route.mode === "review") {
        return contributors.applyReviewArrival(app, entry, reviewDocument, context, { scroll: !location.hash && !Number.isFinite(history.state?.articleScroll) });
      }
      if (Number.isFinite(history.state?.articleScroll)) return false;
      return contributors.restoreContributionPosition(app, entry, context);
    };
    const contributionRestored = restoreContribution();
    if (reviewDocument) reviewSearch = contributors.bindReviewSearch(app, context?.version === contributionVersion(entry) ? context.quote : "");
    contributionPanel = contributors.bindContributionPanel({ app, route, entries: entriesByView.all, issueUrl, passages: reviewDocument?.passages || [] });
    readerTools = bindReaderTools({ app, route, entries: entriesByView.all });
    const localPosition = readingHistory.ready({ historyRestored: Number.isFinite(history.state?.articleScroll) || contributionRestored });
    finishReadingLayout(videoSearchReady, version, () => {
      if (localPosition) localPosition.restore();
      else if (Number.isFinite(history.state?.articleScroll)) {
        if (location.hash) focusDocumentHash(location.hash, { scroll: false });
        window.scrollTo({ top: history.state.articleScroll, behavior: "instant" });
      }
      else if (!restoreContribution() && location.hash) focusDocumentHash(location.hash);
    });
    updateReadingProgress();
  } catch {
    if (version === renderVersion) messagePage("稿件加载失败", "请检查网络后重试，或返回目录阅读其他内容。", { retry: true });
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === "dark" ? "#191817" : "#faf9f7";
  app.querySelectorAll(".theme-toggle").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.theme === "dark"));
    button.querySelector(".theme-icon").innerHTML = themeIconMarkup(state.theme);
    button.querySelector("span:last-child").textContent = state.theme === "dark" ? "浅色模式" : "深色模式";
  });
}

function updateReadingProgress() {
  const progress = app.querySelector(".reading-progress span");
  if (!progress) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0})`;
}

function directoryAction(target) {
  if (!isSearchPage()) return;
  if (target.closest("#retry-search")) return syncDirectoryResults();
  const tag = target.closest(".tag-option");
  if (tag) {
    state.directory.tag = tag.dataset.tag;
    state.directory.visibleCount = 24;
    app.querySelector(".filter-current").textContent = state.directory.tag;
    app.querySelectorAll(".tag-option").forEach((option) => {
      const selected = option.dataset.tag === tag.dataset.tag;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    app.querySelector("#tag-filter-menu").open = false;
    app.querySelector("#tag-filter-menu summary").focus();
    return syncDirectoryResults();
  }
  if (target.closest("#clear-search, #cancel-search, #reset-filters")) {
    if (target.closest("#reset-filters")) {
      state.directory.mode = "general";
      state.directory.sort = "body";
      state.directory.passages = [];
      state.directory.expanded = [];
      app.querySelectorAll('[name="search-mode"]').forEach((radio) => { radio.checked = radio.value === "general"; });
      app.querySelector("#search-help").textContent = searchHelp("general");
      app.querySelector("#advanced-search").open = false;
      state.directory.tag = "全部";
      app.querySelector(".filter-current").textContent = "全部";
      app.querySelectorAll(".tag-option").forEach((option) => {
        const selected = option.dataset.tag === "全部";
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
    }
    state.directory.query = "";
    state.directory.visibleCount = 24;
    const input = app.querySelector("#search");
    input.value = "";
    input.focus();
    clearTimeout(searchTimer);
    return syncDirectoryResults();
  }
  if (target.closest("#load-more")) {
    const scroll = window.scrollY;
    state.directory.visibleCount += 24;
    return syncDirectoryResults(scroll).then(() => {
      app.querySelector("#load-more")?.focus({ preventScroll: true });
    });
  }
}

function navigateWithoutReload(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a");
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  if (url.hash && url.search === location.search) {
    event.preventDefault();
    saveLocation();
    if (state.route?.kind === "directory" && ["#recent-reading", "#topics"].includes(url.hash)) {
      history.pushState({ ...history.state }, "", `${url.pathname}${url.search}${url.hash}`);
      renderCurrentRoute({ focus: true });
      return;
    }
    const nextState = { ...history.state };
    delete nextState.articleScroll;
    if (nextState.continuous) {
      nextState.continuous = { ...nextState.continuous };
      delete nextState.continuous.scroll;
    }
    history.pushState(nextState, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const version = renderVersion;
    requestAnimationFrame(() => {
      if (version !== renderVersion) return;
      focusDocumentHash(location.hash);
      const targetHash = location.hash;
      requestAnimationFrame(() => {
        if (version === renderVersion && location.hash === targetHash) saveLocation();
      });
    });
    return;
  }
  event.preventDefault();
  saveLocation();
  const directory = history.state?.directory;
  const continuous = history.state?.continuous;
  const videoSearch = history.state?.videoSearch;
  const destination = resolveReaderRoute(url.search, publicationEntries, draftEntries);
  const capturedContext = contributors?.captureReviewContext(app, state.route, destination);
  const priorContext = history.state?.reviewContext;
  const reviewContext = capturedContext || (destination.entry && priorContext?.version === contributionVersion(destination.entry) ? priorContext : null);
  const previousOrigin = sanitizeSearchOrigin(history.state?.searchOrigin, state.route?.entry ? workKey(state.route.entry) : null);
  let searchOrigin = null;
  let returnDirectory = directory;
  if (isSearchPage() && state.directory?.query.trim() && link.hasAttribute("data-directory-search") && destination.entry
      && destination.videoSearch?.query === state.directory.query && destination.videoSearch.mode === state.directory.mode
      && destination.videoSearch.view === state.route.view) {
    searchOrigin = sanitizeSearchOrigin({ kind: "directory-search", videoKey: workKey(destination.entry),
      view: state.route.view, directory: state.directory }, workKey(destination.entry));
  } else if (link.hasAttribute("data-return-global") && previousOrigin && destination.kind === "directory") {
    returnDirectory = { ...previousOrigin.directory, view: previousOrigin.view };
  } else if (link.hasAttribute("data-preserve-search") && state.directory) {
    returnDirectory = { ...state.directory, view: destination.view, scroll: 0 };
  } else if (previousOrigin && destination.entry && workKey(destination.entry) === previousOrigin.videoKey
      && link.matches(".search-hit-step, #video-results a, .parts-navigation a, [data-reader-part], [data-reader-format], .document-tabs a, .reader-mode-link, .review-return")) {
    searchOrigin = previousOrigin;
  }
  history.pushState({ ...(returnDirectory ? { directory: returnDirectory } : {}), ...(continuous ? { continuous } : {}),
    ...(videoSearch ? { videoSearch } : {}), ...(searchOrigin ? { searchOrigin } : {}), ...(reviewContext ? { reviewContext } : {}) }, "", `${url.pathname}${url.search}${url.hash}`);
  renderCurrentRoute({ focus: true });
}

applyTheme();
history.scrollRestoration = "manual";
document.addEventListener("click", (event) => {
  if (event.target.closest(".theme-toggle")) {
    state.theme = state.theme === "dark" ? "light" : "dark";
    state.followsSystemTheme = false;
    preferences.setItem("reading-theme", state.theme);
    applyTheme();
  }
  if (event.target.closest("#retry-document")) renderCurrentRoute();
  directoryAction(event.target);
  navigateWithoutReload(event);
});
app.addEventListener("toggle", (event) => {
  if (!event.target.matches(".parts-disclosure, .passage-disclosure") || !isSearchPage()) return;
  state.directory.expanded = [...app.querySelectorAll(".parts-disclosure[open]")].map((details) => details.dataset.video);
  state.directory.passages = [...app.querySelectorAll(".passage-disclosure[open]")].map((details) => details.dataset.entry);
  saveDirectory();
}, true);
window.addEventListener("popstate", () => renderCurrentRoute({ focus: true }));
// Native hash traversal also emits popstate. Route rendering restores its saved
// position; only the explicit same-document click above saves a new hash target.
window.addEventListener("pagehide", saveLocation);
document.addEventListener("scroll", () => {
  updateReadingProgress();
  if (state.route?.kind === "continuous" && !continuousScrollTimer) continuousScrollTimer = setTimeout(() => {
    continuousScrollTimer = null;
    if (state.route?.kind === "continuous") saveLocation();
  }, 150);
}, { passive: true });
window.addEventListener("resize", updateReadingProgress);
document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  const editable = active?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "SUMMARY", "BUTTON"].includes(active?.tagName);
  if (event.key === "/" && !editable && !app.querySelector('dialog[open]') && app.querySelector("#search, #video-query")) {
    event.preventDefault();
    if (app.querySelector("#reader-find")) app.querySelector("#reader-find").click();
    else app.querySelector("#search, #video-query").focus();
  }
});
themeMedia.addEventListener("change", (event) => {
  if (!state.followsSystemTheme) return;
  state.theme = event.matches ? "dark" : "light";
  applyTheme();
});
renderCurrentRoute();
