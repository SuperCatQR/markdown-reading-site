import { prepareDocument } from "./document.js";
import { continuousRoute, entryRoute, reviewRoute, entryKey, videoRoute } from "./manuscripts.js";
import { escapeHtml, draftNotice, footer, viewLabels } from "./ui.js";
import { provenanceMarkup, versionDetailsMarkup } from "./reader-details.js";
import { copyMarkdown } from "./browser-document.js";

const sources = new Map();
const partMarkupCache = new Map();
const partId = (entry) => `part-${entry.editionId}`;

export function continuousPartMarkup(entry, source) {
  const { title, body, headings } = prepareDocument(source, { idPrefix: `${partId(entry)}-`, titleLevel: 2 });
  const toc = headings.filter(({ level }) => level > 1);
  return `<article class="continuous-part" id="${partId(entry)}" tabindex="-1" data-edition="${entry.editionId}"><header class="reading-heading"><p class="current-part">P${entry.pageIndex + 1}</p>${title || `<h2>${escapeHtml(entry.title)}</h2>`}
    <div class="reading-meta"><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">原视频 · P${entry.pageIndex + 1} ↗</a><a href="${entryRoute(entry)}">单篇正文</a><a href="${reviewRoute(entry)}">校验参照稿件</a><button class="copy-markdown" type="button">复制 Markdown</button></div>${provenanceMarkup(entry)}${versionDetailsMarkup(entry)}</header>
    ${toc.length ? `<details class="table-of-contents"><summary>本部分目录</summary><ol>${toc.map(({ id, text }) => `<li><a href="#${encodeURIComponent(id)}">${escapeHtml(text)}</a></li>`).join("")}</ol></details>` : ""}<div class="prose">${body}</div></article>`;
}

export function createContinuousReader({ app, route, pageHeader, loadBody, saved, isCurrent, focus, onReady }) {
  const sameFlow = saved?.bvid === route.bvid && saved?.view === route.view;
  const savedIds = sameFlow && Array.isArray(saved.loaded) ? saved.loaded : [];
  const loaded = route.entries.filter((entry) => savedIds.includes(entry.editionId) && sources.has(entryKey(entry)));
  const restore = sameFlow && saved.current === route.entry?.editionId && savedIds.length === loaded.length && Number.isFinite(saved.scroll);
  let ready = false;

  function partMarkup(entry) {
    const key = entryKey(entry);
    if (!partMarkupCache.has(key)) partMarkupCache.set(key, continuousPartMarkup(entry, sources.get(key)));
    return partMarkupCache.get(key);
  }

  function snapshot() {
    return ready ? { bvid: route.bvid, view: route.view, current: route.entry?.editionId, loaded: loaded.map((entry) => entry.editionId), scroll: window.scrollY } : null;
  }

  function draw({ loading = false, error = false } = {}) {
    const currentIndex = route.entries.indexOf(route.entry);
    const next = route.entries[currentIndex + 1];
    const returnEntry = loaded.includes(route.entry) ? route.entry : loaded.at(-1) || route.entry;
    app.innerHTML = pageHeader() + `<div class="reading-progress" aria-hidden="true"><span></span></div><main id="main-content" class="reading-shell continuous-shell" tabindex="-1"><a class="back-link" href="${returnEntry ? entryRoute(returnEntry) : videoRoute(route.bvid, route.view)}">返回单篇阅读</a><header class="continuous-heading"><p class="eyebrow">连续阅读 · ${viewLabels[route.view]}</p><h1>${escapeHtml(route.entries[0]?.title || route.bvid)}</h1><p>当前类别收录 ${route.entries.length} 篇稿件 · 仅包含已收录的分 P</p>${route.view === "drafts" ? draftNotice() : ""}</header>
      <nav class="continuous-directory" aria-label="连续阅读分 P 目录"><ol>${route.entries.map((entry) => `<li><a href="${continuousRoute(route.bvid, route.view, entry.editionId)}"${entry === route.entry ? ' aria-current="page"' : ""}>P${entry.pageIndex + 1}${loaded.includes(entry) ? '<span class="sr-only"> · 已加载</span>' : ""}</a></li>`).join("")}</ol></nav>
      <div class="continuous-stream">${loaded.map(partMarkup).join("")}</div>
      <div class="continuous-feedback"${loading ? ' role="status" aria-busy="true"' : error ? ' role="alert"' : ' role="status"'}>${loading ? `<p>正在加载 P${route.entry.pageIndex + 1} 正文…</p>` : error ? `<p>P${route.entry.pageIndex + 1} 加载失败，已加载的正文仍可阅读。</p><button class="reset-button" type="button" id="retry-document">重新加载</button>` : !route.entry ? '<p>此类别暂无收录稿件，可返回单篇阅读切换查找类别。</p>' : next ? `<a class="reset-button" rel="next" href="${continuousRoute(route.bvid, route.view, next.editionId)}">加载下一部分 · P${next.pageIndex + 1} →</a>` : '<p>已到当前类别最后一个收录分 P。可通过上方目录阅读其他部分。</p>'}</div>${footer(viewLabels[route.view])}</main>`;
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
        loaded.sort((a, b) => a.pageIndex - b.pageIndex);
      } catch {
        if (!isCurrent()) return;
        draw({ error: true });
        ready = true;
        app.querySelector("#retry-document").focus({ preventScroll: true });
        onReady();
        return;
      }
    }
    if (!isCurrent()) return;
    draw();
    ready = true;
    if (restore) window.scrollTo({ top: saved.scroll, behavior: "instant" });
    else if (location.hash) {
      try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragments leave the reader usable. */ }
    }
    else if (route.entry && new URLSearchParams(location.search).has("part")) app.querySelector(`#${partId(route.entry)}`).focus();
    else if (focus) app.querySelector("main").focus({ preventScroll: true });
    onReady();
  }
  return { render, snapshot };
}
