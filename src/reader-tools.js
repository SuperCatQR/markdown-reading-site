import { partName } from "./source-identity.js";
import { adjacentParts, directoryRoute, readerSearchRoute, searchRoute } from "./manuscripts.js";
import { readerPartRoute, readerFormatRoute } from "./reading-routes.js";
import { escapeHtml, viewLabels } from "./ui.js";
import { visibleReadingEntry } from "./reading-position.js";
import { bindReaderPanels } from "./reader-panels.js";
export { visibleReadingEntry, readingToolPosition, restoreReadingToolPosition } from "./reading-position.js";

export function readerReturnTarget(route, returnView, origin, section) {
  if (!origin && section === "recent-reading") return { href: `${directoryRoute(returnView)}#recent-reading`, label: "返回最近阅读", global: false };
  return origin ? { href: searchRoute({ ...origin.directory, view: origin.view }), label: "返回全站搜索结果", global: true }
    : { href: directoryRoute(returnView), label: `返回${viewLabels[returnView]}目录`, global: false };
}

export function readerToolsMarkup(route, { entries, returnView = route.view, searchOrigin, returnSection }) {
  const entry = route.entry;
  if (!entry) return "";
  const target = readerReturnTarget(route, returnView, searchOrigin, returnSection);
  const parts = adjacentParts(entry, entries).parts;
  const review = route.mode === "review";
  const bodyHref = route.kind === "continuous" ? readerPartRoute(entry, route) : readerSearchRoute(entry, route.videoSearch);
  const reviewHref = readerSearchRoute(entry, route.videoSearch, true);
  return `<div class="reader-location"><a class="reader-directory-link"${target.global ? ' data-return-global' : ''} href="${escapeHtml(target.href)}">← ${target.label}</a><div class="reader-identity"><span class="reader-title-preview" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span><strong class="reader-current-name">${escapeHtml(partName(entry))}</strong></div></div>
    <div class="reader-toolbar"><nav class="document-tabs" aria-label="稿件视图"><a class="reader-mode-link" data-reader-mode="body" href="${escapeHtml(bodyHref)}"${!review ? ' aria-current="page"' : ''}>正文</a><a class="reader-mode-link" data-reader-mode="review" href="${escapeHtml(reviewHref)}"${review ? ' aria-current="page"' : ''}>校验参照</a></nav>
    ${parts.length > 1 ? `<nav class="reader-formats" aria-label="阅读方式"><a data-reader-format="single" href="${escapeHtml(readerFormatRoute(entry, route, false))}"${route.kind !== "continuous" ? ' aria-current="page"' : ''}>单篇</a><a data-reader-format="continuous" href="${escapeHtml(readerFormatRoute(entry, route, true))}"${route.kind === "continuous" ? ' aria-current="page"' : ''}>${review ? "连续正文" : "连续阅读"}</a></nav>` : '<span class="reader-single-format">单篇阅读</span>'}
    <nav class="reader-tools" aria-label="阅读工具"><button type="button" id="reader-parts" data-reader-panel-open="parts" aria-controls="reader-panel" aria-expanded="false">分 P 目录</button><button id="reader-find" type="button" data-reader-panel-open="${review ? 'review' : 'search'}" aria-controls="reader-panel" aria-expanded="false" aria-label="${review ? '查找当前校验参照' : '打开视频内查找'}">${review ? '参照查找' : '视频查找'}</button><button id="reader-outline" type="button" data-reader-panel-open="outline" aria-controls="reader-panel" aria-expanded="false" hidden>导览</button><button type="button" id="reader-source" data-reader-panel-open="source" aria-controls="reader-panel" aria-expanded="false">来源</button><button id="reader-settings" type="button">排版</button><button type="button" data-feedback>反馈</button></nav></div>`;
}

export function bindReaderTools({ app, route, entries, onCurrent = () => {} }) {
  const header = app.querySelector(".reader-header");
  if (!header) return { update() {}, destroy() {} };
  const events = new AbortController();
  let frame, current = route.entry;
  const offset = () => Math.max(header.getBoundingClientRect().bottom, app.querySelector("#reader-search-navigation:not([hidden])")?.getBoundingClientRect().bottom || 0) + 12;
  const panels = bindReaderPanels({ app, getCurrent: () => current, offset });
  function update() {
    current = visibleReadingEntry(app, entries, offset()) || route.entry;
    onCurrent(current);
    header.querySelector(".reader-title-preview").textContent = current.title;
    header.querySelector(".reader-title-preview").title = current.title;
    header.querySelector(".reader-current-name").textContent = partName(current);
    app.querySelectorAll("[data-reader-part]").forEach((link) => {
      const part = entries.find((candidate) => candidate.editionId === link.dataset.edition);
      if (part) link.href = readerPartRoute(part, route);
      if (link.dataset.edition === current.editionId) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const outline = app.querySelector(`[data-reader-panel="outline"][data-edition="${current.editionId}"]`);
    header.querySelector("#reader-outline").hidden = !outline?.textContent.trim();
    header.querySelectorAll("[data-reader-format]").forEach((link) => { link.href = readerFormatRoute(current, route, link.dataset.readerFormat === "continuous", route.videoSearch || {}, location.hash); });
    header.querySelectorAll("[data-reader-mode]").forEach((link) => {
      if (route.mode === "review" && link.hasAttribute("data-review-return")) return;
      link.href = link.dataset.readerMode === "body" && route.kind === "continuous" ? readerPartRoute(current, route) : readerSearchRoute(current, route.videoSearch, link.dataset.readerMode === "review");
    });
  }
  window.addEventListener("scroll", () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = null; update(); });
  }, { passive: true, signal: events.signal });
  app.addEventListener("reader-search-change", (event) => { route.videoSearch = event.detail; update(); }, { signal: events.signal });
  window.addEventListener("hashchange", update, { signal: events.signal });
  const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--reader-header-height", `${header.getBoundingClientRect().height}px`));
  observer.observe(header);
  update();
  return { update, destroy() { events.abort(); observer.disconnect(); panels.destroy(); if (frame) cancelAnimationFrame(frame); } };
}
