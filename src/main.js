import catalog from "../content/catalog.json";
import draftCatalog from "../draft-content/catalog.json";
import summaries from "virtual:reader-summaries";
import searchUrls from "virtual:reader-search-urls";
import { isDraft, sortReaderEntries, sourceTagsByFrequency, resolveReaderRoute, directoryRoute, searchRoute, videoRoute, continuousRoute } from "./manuscripts.js";
import { searchEntries } from "./search.js";
import { browserStorage, createDirectoryStore, sanitizeDirectoryState } from "./directory-state.js";
import { header, footer, themeIconMarkup, viewLabels } from "./ui.js";
import { directoryMarkup, directoryResults, searchHelp } from "./directory-view.js";
import { videoMarkup, videoResults } from "./video-view.js";
import { copyMarkdown, focusDocumentHash } from "./browser-document.js";
import "./site.css";

const bodyFiles = {
  ...import.meta.glob("../content/articles/part-*/publish.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../draft-content/drafts/edition-*/preview.md", { eager: true, query: "?url", import: "default" }),
};
const reviewFiles = {
  ...import.meta.glob("../content/articles/part-*/review.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../draft-content/drafts/edition-*/review.md", { eager: true, query: "?url", import: "default" }),
};
const searchCache = new Map();
const documentCache = new Map();
const entriesByView = {
  all: sortReaderEntries([...catalog.articles, ...draftCatalog.articles]),
  published: sortReaderEntries(catalog.articles),
  drafts: sortReaderEntries(draftCatalog.articles),
};
const counts = Object.fromEntries(Object.entries(entriesByView).map(([view, entries]) => [view, entries.length]));
const app = document.querySelector("#app");
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

function pageHeader(options = {}) {
  return header({ view: state.route?.view, theme: state.theme, counts, siteRoot, ...options });
}

function tagsForView(view) {
  return ["全部", ...sourceTagsByFrequency(entriesByView[view])];
}

function isSearchPage() { return ["directory", "video"].includes(state.route?.kind); }

function scopedEntries() {
  return state.route.kind === "video" ? entriesByView[state.route.view].filter((entry) => entry.bvid === state.route.bvid) : entriesByView[state.route.view];
}

function directoryKey() { return `${state.route.view}${state.route.bvid ? `:${state.route.bvid}` : ""}`; }

function saveDirectory() {
  if (!isSearchPage() || !state.directory) return;
  state.directory.scroll = window.scrollY;
  directories.write(directoryKey(), state.directory);
  history.replaceState({ ...history.state, directory: { ...state.directory, view: state.route.view, bvid: state.route.bvid } }, "", searchRoute({ ...state.directory, view: state.route.view, bvid: state.route.bvid }));
}

function saveLocation() {
  if (isSearchPage()) saveDirectory();
  else if (state.route?.kind === "article") history.replaceState({ ...history.state, articleScroll: window.scrollY }, "");
  else if (state.route?.kind === "continuous") {
    const continuous = continuousReader?.snapshot();
    if (continuous) history.replaceState({ ...history.state, continuous }, "");
  }
}

async function loadSearchData(view) {
  if (view === "all") {
    const indices = await Promise.all([loadSearchData("published"), loadSearchData("drafts")]);
    return Object.assign({}, ...indices);
  }
  if (!searchCache.has(view)) {
    const promise = fetch(searchUrls[view]).then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    }).catch((error) => {
      searchCache.delete(view);
      throw error;
    });
    searchCache.set(view, promise);
  }
  return searchCache.get(view);
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
  if (state.route.kind === "video") app.querySelectorAll(".video-versions a").forEach((link) => {
    const view = new URL(link.href).searchParams.get("view");
    link.setAttribute("href", searchRoute({ ...current, bvid: state.route.bvid, view }));
  });
  saveDirectory();
  const isCurrent = () => version === resultsVersion && routeVersion === renderVersion;
  results.setAttribute("aria-busy", "true");
  app.querySelector("#clear-search").hidden = !current.query;
  try {
    let index = {};
    if (current.query.trim()) {
      resultCount.textContent = "正在搜索正文…";
      if (!results.children.length) results.innerHTML = '<p class="search-feedback" role="status">正在加载正文搜索索引…</p>';
      index = await loadSearchData(view);
    }
    if (!isCurrent()) return;
    const entries = scopedEntries();
    const matches = searchEntries(entries, current, index);
    if (state.route.kind === "video") {
      results.innerHTML = videoResults(matches, current, summaries);
      resultCount.innerHTML = `<strong>${matches.length}</strong> / ${entries.length} 篇稿件`;
    } else {
      const result = directoryResults(matches, { ...current, counts, view }, summaries);
      results.innerHTML = result.html;
      resultCount.innerHTML = `<strong>${result.count}</strong> 个视频 · <strong>${matches.length}</strong> / ${counts[view]} 篇`;
    }
    results.setAttribute("aria-busy", "false");
    if (restoreScroll !== null) window.scrollTo({ top: restoreScroll, behavior: "instant" });
    saveDirectory();
  } catch {
    if (!isCurrent()) return;
    results.setAttribute("aria-busy", "false");
    resultCount.textContent = "搜索未完成";
    results.innerHTML = '<section class="search-feedback" role="alert"><p>正文搜索索引加载失败，请检查网络后重试。</p><button class="reset-button" type="button" id="retry-search">重新搜索</button></section>';
  }
}

function updateSearch(value) {
  ++resultsVersion;
  state.directory.query = value;
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
  state.directory = saved?.view === view && saved.bvid === state.route.bvid ? sanitizeDirectoryState(saved, tags) : directories.read(directoryKey(), tags);
  if (state.route.searchState) state.directory = sanitizeDirectoryState({ ...state.directory, ...state.route.searchState }, tags);
  if (state.route.kind === "video") state.directory.tag = "全部";
  state.composingSearch = false;
  const scroll = state.directory.scroll;
  const options = {
    ...state.directory, view, tags, counts, videoCount: new Set(entriesByView[view].map((entry) => entry.bvid)).size,
  };
  const videoEntries = entriesByView.all.filter((entry) => entry.bvid === state.route.bvid);
  app.innerHTML = pageHeader({ directory: state.route.kind === "directory" }) + (state.route.kind === "video"
    ? videoMarkup(videoEntries, { ...options, bvid: state.route.bvid }, summaries) : directoryMarkup(options));
  document.title = `${state.route.kind === "video" ? `${videoEntries[0].title} · 视频总览` : `${viewLabels[view]} · 视频文字资料库`} · 档案室`;
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
  app.querySelector("#tag-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("zh-Hans");
    app.querySelectorAll(".tag-option").forEach((option) => { option.hidden = !!query && !option.dataset.tag.toLocaleLowerCase("zh-Hans").includes(query); });
  });
  app.querySelector("#tag-filter-menu")?.addEventListener("toggle", (event) => {
    event.target.querySelector("summary").setAttribute("aria-expanded", String(event.target.open));
  });
  syncDirectoryResults(scroll);
}

function messagePage(title, message, { missing = false, retry = false } = {}) {
  app.innerHTML = pageHeader({ unknown: missing }) + `<main id="main-content" class="page-shell" tabindex="-1"><section class="empty-state" ${retry ? 'role="alert"' : 'role="status"'}><h1>${title}</h1><p>${message}</p>${retry ? '<button class="reset-button" type="button" id="retry-document">重新加载</button>' : `<a class="reset-button" href="${directoryRoute("all")}">返回内容目录</a>`}</section>${footer("文字资料库")}</main>`;
  document.title = `${title} · 档案室`;
}

async function renderCurrentRoute({ focus = false } = {}) {
  const version = ++renderVersion;
  clearTimeout(continuousScrollTimer);
  continuousScrollTimer = null;
  continuousReader = null;
  ++resultsVersion;
  clearTimeout(searchTimer);
  state.route = resolveReaderRoute(location.search, catalog.articles, draftCatalog.articles);
  const route = state.route;
  if (route.kind === "missing" || (route.kind === "article" && !route.entry)) {
    const video = new URLSearchParams(location.search).has("video");
    messagePage(video ? "没有找到这个视频" : "没有找到这篇稿件", "内容可能尚未导入、已更新或撤回，或链接参数无效。", { missing: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (["directory", "video"].includes(route.kind)) {
    renderDirectory();
    if (focus) app.querySelector("main").focus({ preventScroll: true });
    return;
  }
  state.directory = null;
  if (route.kind === "continuous") {
    let createContinuousReader;
    try { ({ createContinuousReader } = await import("./continuous-reader.js")); }
    catch {
      if (version === renderVersion) messagePage("阅读页面加载失败", "请检查网络后重试。", { retry: true });
      return;
    }
    if (version !== renderVersion) return;
    continuousReader = createContinuousReader({
      app, route, pageHeader, saved: history.state?.continuous, focus,
      isCurrent: () => version === renderVersion,
      loadBody: (entry) => {
        const url = bodyFiles[`../${isDraft(entry) ? "draft-content" : "content"}/${entry.file}`];
        if (!url) return Promise.reject(new Error("Document not in snapshot"));
        return loadDocument(url);
      },
      onReady: () => { saveLocation(); updateReadingProgress(); },
    });
    document.title = `${route.entries[0]?.title || route.bvid} · 连续阅读 · 档案室`;
    document.querySelector('meta[name="description"]').content = "按分 P 连续阅读视频整理稿，逐篇查看来源与审核状态。";
    await continuousReader.render();
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
  app.innerHTML = pageHeader() + `<main id="main-content" class="reading-shell" tabindex="-1"><div class="document-loading" role="status" aria-busy="true"><p>正在加载 P${entry.pageIndex + 1}${route.mode === "review" ? "校验参照" : "正文"}…</p><div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div></div></main>`;
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    const [source, { readerMarkup }] = await Promise.all([loadDocument(url), import("./reader-view.js")]);
    if (version !== renderVersion) return;
    const returnView = Object.hasOwn(viewLabels, history.state?.directory?.view) ? history.state.directory.view : route.view;
    app.innerHTML = pageHeader() + readerMarkup(entry, route.mode, source, {
      entries: entriesByView[route.view], returnView, pageUrl: location.href, issueUrl,
      returnVideo: history.state?.directory?.bvid === entry.bvid ? searchRoute(history.state.directory) : videoRoute(entry.bvid),
      returnContinuous: history.state?.continuous?.bvid === entry.bvid && history.state.continuous.view === route.view
        ? continuousRoute(entry.bvid, route.view, history.state.continuous.current) : null,
    });
    document.title = `${entry.title} · P${entry.pageIndex + 1}${route.mode === "review" ? " · 校验参照" : ""} · 档案室`;
    document.querySelector('meta[name="description"]').content = entry.summary || `${entry.title}，P${entry.pageIndex + 1}。${entry.attribution}`;
    app.querySelector(".copy-markdown").addEventListener("click", (event) => copyMarkdown(source, event.currentTarget));
    if (focus) app.querySelector("main").focus({ preventScroll: true });
    if (Number.isFinite(history.state?.articleScroll)) window.scrollTo({ top: history.state.articleScroll, behavior: "instant" });
    else if (location.hash) focusDocumentHash(location.hash);
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
      const selected = option === tag;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    app.querySelector("#tag-filter-menu").open = false;
    app.querySelector("#tag-filter-menu summary").focus();
    return syncDirectoryResults();
  }
  if (target.closest("#clear-search, #reset-filters")) {
    if (target.closest("#reset-filters")) {
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
  if (url.hash && url.search === location.search) return;
  event.preventDefault();
  saveLocation();
  const directory = history.state?.directory;
  const continuous = history.state?.continuous;
  history.pushState({ ...(directory ? { directory } : {}), ...(continuous ? { continuous } : {}) }, "", `${url.pathname}${url.search}${url.hash}`);
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
window.addEventListener("hashchange", () => { if (state.route?.kind === "article") focusDocumentHash(location.hash); });
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
  if (event.key === "/" && !editable && app.querySelector("#search")) {
    event.preventDefault();
    app.querySelector("#search").focus();
  }
});
themeMedia.addEventListener("change", (event) => {
  if (!state.followsSystemTheme) return;
  state.theme = event.matches ? "dark" : "light";
  applyTheme();
});
renderCurrentRoute();
