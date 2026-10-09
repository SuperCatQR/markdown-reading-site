import { entryRoute, isDraft, readerSearchRoute } from "./manuscripts.js";
import { searchEntries, searchModes } from "./search.js";
import { measureSearchStage, showSearchWaiting } from "./search-loader.js";
import { searchHelp } from "./directory-view.js";
import { videoResults } from "./video-view.js";

export function bindReaderVideo({ app, route, entries, summaries, loadSearchData, isCurrent, persistSearch }) {
  const root = app.querySelector(".reader-video-search");
  const input = root.querySelector("#video-query");
  const category = root.querySelector("#video-search-view");
  const results = root.querySelector("#video-results");
  const count = root.querySelector("#video-result-count");
  const current = { query: input.value, mode: route.videoSearch?.mode || "general", view: category.value, tag: "全部", passages: [] };
  const saved = history.state?.videoSearch;
  if (saved?.editionId === route.entry.editionId && saved.query === current.query && saved.mode === current.mode && saved.view === current.view && Array.isArray(saved.passages)) current.passages = saved.passages;
  let version = 0;
  let timer;
  let composing = false;

  function save() {
    if (persistSearch) persistSearch({ ...current });
    else history.replaceState({ ...history.state, videoSearch: { editionId: route.entry.editionId, query: current.query, mode: current.mode, view: current.view, passages: current.passages } }, "", `${readerSearchRoute(route.entry, current, route.mode === "review")}${location.hash}`);
    app.querySelectorAll(".parts-navigation a:not(.continuous-link), .reader-part-menu a, .document-tabs a").forEach((link) => {
      const params = new URLSearchParams(new URL(link.href).search);
      const entry = entries.find((entry) => params.get("draft") === entry.editionId || params.get("read") === entry.slug || params.get("review") === entry.editionId);
      if (entry) link.setAttribute("href", readerSearchRoute(entry, current, params.has("review")));
    });
  }

  function showMatches(matches, request) {
    results.innerHTML = videoResults(matches, request, summaries);
    results.querySelectorAll("a").forEach((link) => {
      const url = new URL(link.href);
      const entry = entries.find((entry) => url.search === entryRoute(entry));
      if (entry) link.setAttribute("href", `${readerSearchRoute(entry, request)}${url.hash}`);
    });
  }

  async function search(persist = true) {
    const requestVersion = ++version;
    if (!isCurrent()) return;
    const request = { ...current };
    if (persist || route.videoSearch) save();
    root.querySelector("#clear-video-query").hidden = !request.query;
    const candidates = entries.filter((entry) => request.view === "all" || isDraft(entry) === (request.view === "drafts"));
    count.hidden = !request.query.trim();
    if (!request.query.trim()) {
      const choosingVersion = request.view !== route.view && entries.some((entry) => isDraft(entry) !== isDraft(route.entry));
      if (!candidates.length || choosingVersion) showMatches(candidates.map((entry) => ({ entry, match: null })), request);
      else results.innerHTML = "";
      results.setAttribute("aria-busy", "false");
      return;
    }
    results.setAttribute("aria-busy", "true");
    count.textContent = "正在加载搜索资料…";
    const currentRequest = () => isCurrent() && requestVersion === version;
    const stopWaiting = showSearchWaiting(results, { isCurrent: currentRequest, cancelId: "cancel-video-search" });
    const started = performance.now();
    try {
      const index = await loadSearchData(request.view);
      if (!isCurrent() || requestVersion !== version) return;
      const start = performance.now();
      const matches = searchEntries(candidates, request, index);
      measureSearchStage("compute", start, { view: request.view, scope: "video" });
      const renderStart = performance.now();
      showMatches(matches, request);
      measureSearchStage("render", renderStart, { view: request.view, scope: "video", matches: matches.length });
      count.textContent = `${matches.length} / ${candidates.length} 篇稿件`;
      measureSearchStage("total", started, { view: request.view, scope: "video" });
    } catch {
      if (!isCurrent() || requestVersion !== version) return;
      count.textContent = "搜索未完成";
      results.innerHTML = '<div class="search-feedback" role="alert"><p>正文搜索索引加载失败，请检查网络后重试。</p><button class="reset-button" type="button" id="retry-video-search">重新搜索</button></div>';
    } finally { stopWaiting(); }
    if (currentRequest()) results.setAttribute("aria-busy", "false");
  }

  function update() {
    ++version;
    current.query = input.value;
    current.passages = [];
    clearTimeout(timer);
    if (!composing) {
      save();
      timer = setTimeout(search, 120);
    }
  }
  input.addEventListener("input", update);
  input.addEventListener("compositionstart", () => { composing = true; ++version; clearTimeout(timer); });
  input.addEventListener("compositionend", () => { composing = false; update(); });
  category.addEventListener("change", () => { current.view = category.value; clearTimeout(timer); search(); });
  root.querySelectorAll('[name="search-mode"]').forEach((radio) => radio.addEventListener("change", () => {
    current.mode = radio.value;
    root.querySelector("#search-help").textContent = searchHelp(radio.value);
    const label = root.querySelector(".search-mode-current");
    if (label) label.textContent = searchModes[radio.value];
    if (radio.value !== "general") root.querySelector("#advanced-search").open = true;
    clearTimeout(timer);
    search();
  }));
  root.addEventListener("click", (event) => {
    if (event.target.closest("#retry-video-search")) search();
    if (event.target.closest("#clear-video-query, #cancel-video-search")) {
      input.value = current.query = "";
      current.passages = [];
      clearTimeout(timer);
      input.focus();
      search();
    }
  });
  root.addEventListener("toggle", (event) => {
    if (!event.target.matches(".passage-disclosure")) return;
    current.passages = [...root.querySelectorAll(".passage-disclosure[open]")].map((details) => details.dataset.entry);
    if (isCurrent()) save();
  }, true);
  return search(false);
}
