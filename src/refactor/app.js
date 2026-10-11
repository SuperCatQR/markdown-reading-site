import { prepareReviewDocument } from "../../packages/content-core/index.js";
import { createContentRepository } from "./services/content-repository.js";
import { createSearchService } from "./services/search-service.js";
import { createLocalState } from "./services/local-state.js";
import { navigate, parseRoute, routeHref } from "./core/router.js";
import { isDraft, partsFor, prepareBlocks } from "./core/content.js";
import { libraryPage, recentPage, readerPage, escapeHtml } from "./views.js";
import "./styles.css";

export function mountRefactorApp(root = document.querySelector("#app")) {
  const repository = createContentRepository();
  const search = createSearchService(repository);
  const state = createLocalState();
  let route = parseRoute();
  let theme = state.preferences.theme === "dark" ? "dark" : "light";
  let readerTool = "";
  let readerPrepared;
  let readerEntry;
  let readerSearchResults = [];
  let renderToken = 0;
  let resultLimit = 32;
  let resultRouteKey = "";
  let saveTimer;

  function applyTheme() {
    document.documentElement.dataset.refactorTheme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#17191b" : "#f7f5f1";
    const preferences = state.preferences;
    document.documentElement.style.setProperty("--reader-size", `${preferences.size}px`);
    document.documentElement.style.setProperty("--reader-width", `${preferences.width}px`);
  }

  function renderMissing(message = "这个页面不存在") {
    root.innerHTML = `<header class="app-header"><a class="brand" href="#/library"><span class="brand-mark">读</span><span>档案室</span></a></header><main class="page empty-state" id="main-content"><h1>${escapeHtml(message)}</h1><p>链接可能已经失效，或内容不在当前快照中。</p><a class="button-link" href="#/library">返回资料库</a></main>`;
  }

  async function renderLibrary(current) {
    const token = ++renderToken;
    const currentKey = JSON.stringify([current.name, current.query, current.view, current.mode, current.tag, current.sort]);
    if (currentKey !== resultRouteKey) { resultRouteKey = currentKey; resultLimit = 32; }
    root.innerHTML = libraryPage({ route: current, repository, groups: [], theme, history: state.history, loading: true, limit: resultLimit });
    try {
      const result = await search.search(current);
      if (token !== renderToken) return;
      root.innerHTML = libraryPage({ route: current, repository, groups: result.groups, theme, history: state.history, limit: resultLimit });
    } catch (error) {
      if (token !== renderToken) return;
      root.innerHTML = libraryPage({ route: current, repository, groups: [], theme, history: state.history, error: error.message || "搜索未完成", limit: resultLimit });
    }
  }

  async function renderReader(current) {
    const entry = repository.findEdition(current.editionId);
    if (!entry) return renderMissing("没有找到这篇稿件");
    const token = ++renderToken;
    readerEntry = entry;
    root.innerHTML = `<header class="reader-header reader-loading"><a class="reader-back" href="#/library">返回资料库</a><span>正在加载 ${escapeHtml(entry.title)}</span></header><main class="page reader-loading-page"><div class="loading-state"><span></span><span></span><span></span></div></main>`;
    try {
      const source = current.name === "verify" ? await repository.loadReview(entry) : await repository.loadBody(entry);
      if (token !== renderToken) return;
      readerPrepared = current.name === "verify" ? prepareReviewDocument(source) : prepareBlocks(source);
      const parts = partsFor(entry, repository.list(isDraft(entry) ? "drafts" : "published"));
      root.innerHTML = readerPage({ route: current, repository, entry, parts, prepared: readerPrepared, theme, review: current.name === "verify", tool: readerTool, searchResults: readerSearchResults });
      applyReaderPosition(current);
      state.remember(entry, current.block || "");
      bindReaderSettings();
    } catch (error) {
      if (token !== renderToken) return;
      renderMissing(error.message || "稿件加载失败");
    }
  }

  function applyReaderPosition(current) {
    const target = current.block && root.querySelector(`#${CSS.escape(current.block)}`);
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }

  function bindReaderSettings() {
    root.querySelectorAll("[data-preference]").forEach((select) => {
      select.value = String(state.preferences[select.dataset.preference]);
      select.addEventListener("change", () => {
        state.updatePreferences({ [select.dataset.preference]: Number(select.value) });
        applyTheme();
      });
    });
  }

  function savePosition() {
    if (!readerEntry || !root.querySelector(".reader-prose")) return;
    const visible = [...root.querySelectorAll(".reader-prose [id]")].find((block) => block.getBoundingClientRect().bottom > 90);
    if (visible) state.remember(readerEntry, visible.id);
  }

  async function render(current = route) {
    route = current;
    applyTheme();
    if (current.name === "library" || current.name === "search") return renderLibrary(current);
    if (current.name === "recent") { root.innerHTML = recentPage({ route: current, repository, state, theme }); return; }
    if (current.name === "read" || current.name === "verify") return renderReader(current);
    renderMissing();
  }

  function submitSearch(form) {
    navigate("search", { q: form.elements.q.value.trim(), view: route.view || "all", mode: route.mode || "general", tag: route.tag || "" });
  }

  root.addEventListener("click", (event) => {
    const readerBlock = event.target.closest("[data-reader-block]");
    if (readerBlock && readerEntry) {
      event.preventDefault();
      const blockId = readerBlock.dataset.readerBlock;
      const target = root.querySelector(`#${CSS.escape(blockId)}`);
      if (target) {
        target.scrollIntoView({ block: "start" });
        history.replaceState(history.state, "", routeHref(route.name, { editionId: readerEntry.editionId, flow: route.flow, block: blockId }));
        state.remember(readerEntry, blockId);
      }
      return;
    }
    const themeButton = event.target.closest('[data-action="theme"]');
    if (themeButton) { theme = theme === "dark" ? "light" : "dark"; state.updatePreferences({ theme }); applyTheme(); render(route); return; }
    const tool = event.target.closest("[data-tool]");
    if (tool && readerEntry) { readerTool = tool.dataset.tool; render(route); return; }
    if (event.target.closest('[data-action="close-tool"]')) { readerTool = ""; render(route); return; }
    const remove = event.target.closest("[data-remove-history]");
    if (remove) { state.remove(remove.dataset.removeHistory); render(route); return; }
    if (event.target.closest('[data-action="clear-history"]')) { state.clear(); render(route); return; }
    if (event.target.closest('[data-action="load-more"]')) { resultLimit += 32; render(route); return; }
    if (event.target.closest('[data-action="retry-search"]')) render(route);
  });
  root.addEventListener("submit", (event) => {
    if (event.target.matches("[data-search-form]")) { event.preventDefault(); submitSearch(event.target); }
    if (event.target.matches("[data-reader-search]")) {
      event.preventDefault();
      const query = event.target.elements.q.value.trim().toLocaleLowerCase("zh-Hans");
      readerSearchResults = (readerPrepared?.blocks || []).filter((block) => String(block.text || "").toLocaleLowerCase("zh-Hans").includes(query)).slice(0, 20);
      readerTool = "find";
      render(route);
    }
  });
  root.addEventListener("change", (event) => {
    const filter = event.target.closest('[data-filter="view"]');
    if (filter) navigate(route.name === "search" ? "search" : "library", { q: route.query, view: filter.value, mode: route.mode, tag: route.tag });
    const tag = event.target.closest('[data-filter="tag"]');
    if (tag) navigate(route.name === "search" ? "search" : "library", { q: route.query, view: route.view, mode: route.mode, tag: tag.value });
    const mode = event.target.closest('[name="search-mode"]');
    if (mode) navigate("search", { q: route.query, view: route.view, mode: mode.value, tag: route.tag });
  });
  window.addEventListener("hashchange", () => { readerTool = ""; readerSearchResults = []; render(parseRoute()); });
  window.addEventListener("scroll", () => { clearTimeout(saveTimer); saveTimer = setTimeout(savePosition, 250); }, { passive: true });
  window.addEventListener("pagehide", savePosition);
  render(route);
  return { render, repository, search, state };
}
