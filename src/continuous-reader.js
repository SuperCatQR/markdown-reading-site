import { partIndex, partLabel, partName } from "./source-identity.js";
import { prepareDocument } from "./document.js";
import { continuousRoute, entryKey } from "./manuscripts.js";
import { escapeHtml, statusBadge, footer, viewLabels } from "./ui.js";
import { originNoticeMarkup } from "./reader-details.js";
import { copyMarkdown, focusDocumentHash } from "./browser-document.js";
import { readerSidebarMarkup, readerPanelsMarkup, readerPartToolsMarkup } from "./reading-layout.js";
import { seriesMarkup, seriesAdjacentMarkup } from "./series-view.js";

const sources = new Map();
const partMarkupCache = new Map();
const partId = (entry) => `part-${entry.editionId}`;

export function continuousPartMarkup(entry, source) {
  const prepared = prepareDocument(source, { idPrefix: `${partId(entry)}-`, titleLevel: 2 });
  const { title, body } = prepared;
  return `<article class="continuous-part" id="${partId(entry)}" tabindex="-1" data-edition="${entry.editionId}"><header class="reading-heading"><div class="reading-status"><span class="current-part">${partLabel(entry)}</span>${statusBadge(entry)}</div>${title || `<h2>${escapeHtml(entry.title)}</h2>`}
    ${originNoticeMarkup(entry)}<p class="reading-meta">${escapeHtml(partName(entry))}</p></header>
    ${readerPartToolsMarkup(entry, prepared)}<div class="prose">${body}</div></article>`;
}

export function createContinuousReader({ app, route, pageHeader, loadBody, saved, isCurrent, focus, onReady, videoEntries = route.entries, series = [], seriesEntries = videoEntries }) {
  const requestedEntry = route.entry;
  const sameFlow = saved?.videoKey === route.videoKey && saved?.view === route.view;
  const savedIds = sameFlow && Array.isArray(saved.loaded) ? saved.loaded : [];
  const loaded = route.entries.filter((entry) => savedIds.includes(entry.editionId) && sources.has(entryKey(entry)));
  const restore = sameFlow && saved.current === route.entry?.editionId && savedIds.length === loaded.length && Number.isFinite(saved.scroll);
  let ready = false;
  const priorSearch = route.videoSearch || (sameFlow ? saved?.videoSearch : null);
  let videoSearch = {
    query: typeof priorSearch?.query === "string" ? priorSearch.query.slice(0, 300) : "",
    mode: ["general", "phrase", "keywords"].includes(priorSearch?.mode) ? priorSearch.mode : "general",
    view: ["all", "drafts", "published"].includes(priorSearch?.view) ? priorSearch.view : route.view,
    passages: Array.isArray(priorSearch?.passages) ? priorSearch.passages.filter((id) => typeof id === "string") : [],
  };

  function partMarkup(entry) {
    const key = entryKey(entry);
    if (!partMarkupCache.has(key)) partMarkupCache.set(key, continuousPartMarkup(entry, sources.get(key)));
    return partMarkupCache.get(key);
  }

  function snapshot() {
    return ready ? { videoKey: route.videoKey, view: route.view, current: route.entry?.editionId, loaded: loaded.map((entry) => entry.editionId), scroll: window.scrollY, videoSearch } : null;
  }

  function draw({ loading = false, error = false } = {}) {
    const currentIndex = route.entries.indexOf(loaded.at(-1) || route.entry);
    const next = route.entries[currentIndex + 1];
    app.innerHTML = pageHeader() + `<div class="reading-progress" aria-hidden="true"><span></span></div><div class="reader-layout">${readerSidebarMarkup({ ...route, videoSearch }, videoEntries)}<main id="main-content" class="reading-shell continuous-shell" tabindex="-1"><header class="continuous-heading"><p>连续阅读 · 当前类别收录 ${route.entries.length} 篇稿件${route.view === "drafts" ? " · 公开预览，未经正式发布" : ""}</p></header>
      ${seriesMarkup(route.entry, series, seriesEntries)}
      <div class="continuous-stream">${loaded.map(partMarkup).join("")}</div>
      <div class="continuous-feedback"${loading ? ' role="status" aria-busy="true"' : error ? ' role="alert"' : ' role="status"'}>${loading ? `<p>正在加载 ${partLabel(requestedEntry)} 正文…</p>` : error ? `<p>${partLabel(requestedEntry)} 加载失败，已加载的正文仍可阅读。</p><a class="reset-button" id="retry-continuous" href="${escapeHtml(continuousRoute(route.videoKey, route.view, requestedEntry.editionId, videoSearch))}">重新加载 ${partLabel(requestedEntry)}</a>` : !route.entry ? '<p>此类别暂无收录稿件。</p>' : next ? `<a class="reset-button" rel="next" href="${continuousRoute(route.videoKey, route.view, next.editionId, videoSearch)}">加载下一个已收录部分 · ${escapeHtml(partName(next))} →</a>` : '<p>已到当前类别最后一篇收录稿件。可通过同视频目录阅读其他部分。</p>'}</div>${seriesAdjacentMarkup(route.entry, series, seriesEntries)}${footer(viewLabels[route.view])}</main></div>${route.entry ? readerPanelsMarkup({ ...route, videoSearch }, videoEntries) : ""}`;
    for (const article of app.querySelectorAll(".continuous-part")) {
      const entry = loaded.find((candidate) => candidate.editionId === article.dataset.edition);
      article.querySelector(".copy-markdown").addEventListener("click", (event) => copyMarkdown(sources.get(entryKey(entry)), event.currentTarget));
    }
  }

  async function render() {
    draw({ loading: !!route.entry && !loaded.includes(route.entry) });
    if (!restore) window.scrollTo({ top: 0, behavior: "instant" });
    if (route.entry && !loaded.includes(route.entry)) {
      try {
        const source = await loadBody(route.entry);
        sources.set(entryKey(route.entry), source);
        if (!isCurrent()) return;
        loaded.push(route.entry);
        loaded.sort((a, b) => partIndex(a) - partIndex(b));
      } catch {
        if (!isCurrent()) return;
        draw({ error: true });
        ready = true;
        app.querySelector("#retry-continuous").focus({ preventScroll: true });
        onReady();
        return;
      }
    }
    if (!isCurrent()) return;
    draw();
    ready = true;
    if (restore) {
      if (location.hash) focusDocumentHash(location.hash, { scroll: false });
      window.scrollTo({ top: saved.scroll, behavior: "instant" });
    }
    else if (location.hash) focusDocumentHash(location.hash);
    else if (route.entry && new URLSearchParams(location.search).has("part")) {
      const target = app.querySelector(`#${partId(route.entry)}`);
      const offset = (app.querySelector(".reader-header")?.getBoundingClientRect().bottom || 0) + 12;
      window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset), behavior: "instant" });
      target.focus({ preventScroll: true });
    }
    else if (focus) app.querySelector("main").focus({ preventScroll: true });
    onReady();
  }
  function updateAddress() {
    const hit = location.hash;
    let hash = "";
    try { if (hit && decodeURIComponent(hit).includes(partId(route.entry))) hash = hit; } catch { /* Invalid fragments never identify a current passage. */ }
    history.replaceState(history.state, "", `${continuousRoute(route.videoKey, route.view, route.entry?.editionId, videoSearch)}${hash}`);
  }
  return { render, snapshot, didRestore: () => restore, searchState: () => videoSearch,
    setCurrent(entry) { if (route.entry !== entry) { route.entry = entry; updateAddress(); } },
    setSearch(value) { videoSearch = { query: value.query, mode: value.mode, view: value.view, passages: value.passages }; route.videoSearch = videoSearch; updateAddress(); },
  };
}
