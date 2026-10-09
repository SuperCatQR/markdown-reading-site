import { adjacentParts, continuousRoute, directoryRoute, readerSearchRoute } from "./manuscripts.js";
import { escapeHtml, viewLabels } from "./ui.js";

export function readerToolsMarkup(route, { entries, returnView = route.view }) {
  const entry = route.entry;
  if (!entry) return "";
  const { parts } = adjacentParts(entry, entries);
  const partHref = (part) => route.kind === "continuous"
    ? continuousRoute(part.bvid, route.view, part.editionId)
    : readerSearchRoute(part, route.videoSearch || {}, route.mode === "review");
  return `<nav class="reader-tools" aria-label="阅读工具"><a class="reader-directory-link" href="${directoryRoute(returnView)}" aria-label="返回${viewLabels[returnView]}目录">← 目录</a>
    ${parts.length > 1 ? `<details class="reader-part-menu"><summary aria-label="切换分 P"><span class="reader-current-label">P${entry.pageIndex + 1}</span><span aria-hidden="true">⌄</span></summary><ol>${parts.map((part) => `<li><a data-edition="${part.editionId}" href="${escapeHtml(partHref(part))}"${part.editionId === entry.editionId ? ' aria-current="page"' : ""}>P${part.pageIndex + 1}</a></li>`).join("")}</ol></details>` : `<span class="reader-current-label">P${entry.pageIndex + 1}</span>`}
    <button id="reader-find" type="button" aria-label="打开视频内查找">查找</button><button id="reader-outline" type="button" aria-label="打开本文目录" hidden>本文</button></nav>`;
}

export function visibleReadingEntry(app, entries, topOffset) {
  const articles = [...app.querySelectorAll('.reading-article[data-edition], .continuous-part[data-edition]')];
  const article = articles.find((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top <= topOffset && bounds.bottom > topOffset;
  }) || articles.find((element) => element.getBoundingClientRect().bottom > topOffset);
  return entries.find((entry) => entry.editionId === article?.dataset.edition);
}

export function bindReaderTools({ app, route, entries }) {
  const header = app.querySelector(".reader-header");
  if (!header) return { update() {}, destroy() {} };
  const events = new AbortController();
  let frame;
  let current = route.entry;
  const offset = () => header.getBoundingClientRect().bottom + 12;
  const currentArticle = () => app.querySelector(`[data-edition="${current?.editionId}"].continuous-part, [data-edition="${current?.editionId}"].reading-article`);

  function update() {
    current = visibleReadingEntry(app, entries, offset()) || route.entry;
    header.querySelectorAll(".reader-current-label").forEach((label) => { label.textContent = `P${current.pageIndex + 1}`; });
    header.querySelectorAll(".reader-part-menu a").forEach((link) => {
      if (link.dataset.edition === current.editionId) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    header.querySelector("#reader-outline").hidden = !currentArticle()?.querySelector(".table-of-contents");
  }

  function openAndFocus(disclosure, target) {
    if (!disclosure) return;
    disclosure.open = true;
    target?.focus({ preventScroll: true });
    disclosure.scrollIntoView({ block: "start", behavior: "instant" });
  }

  header.addEventListener("click", (event) => {
    if (event.target.closest("#reader-find")) {
      const disclosure = app.querySelector(".reader-video-search");
      if (disclosure) openAndFocus(disclosure, disclosure.querySelector("#video-query"));
    }
    if (event.target.closest("#reader-outline")) {
      const disclosure = currentArticle()?.querySelector(".table-of-contents");
      openAndFocus(disclosure, disclosure?.querySelector("summary"));
    }
  }, { signal: events.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = header.querySelector("details[open]");
    if (open) { open.open = false; open.querySelector("summary").focus(); }
  }, { signal: events.signal });
  document.addEventListener("click", (event) => {
    header.querySelectorAll("details[open]").forEach((details) => { if (!details.contains(event.target)) details.open = false; });
  }, { signal: events.signal });
  window.addEventListener("scroll", () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = null; update(); });
  }, { passive: true, signal: events.signal });
  update();
  return { update, destroy() { events.abort(); if (frame) cancelAnimationFrame(frame); } };
}
