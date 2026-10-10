import { workKey, partIndex } from "./source-identity.js";
import { partGapsMarkup } from "./reading-outline.js";
import { adjacentParts, continuousRoute, directoryRoute, readerSearchRoute, isDraft } from "./manuscripts.js";
import { escapeHtml, viewLabels } from "./ui.js";

export function readerToolsMarkup(route, { entries, returnView = route.view }) {
  const entry = route.entry;
  if (!entry) return "";
  const { parts } = adjacentParts(entry, entries);
  const partHref = (part) => route.kind === "continuous"
    ? continuousRoute(workKey(part), route.view, part.editionId)
    : readerSearchRoute(part, route.videoSearch || {}, route.mode === "review");
  return `<nav class="reader-tools" aria-label="阅读工具"><a class="reader-directory-link" href="${directoryRoute(returnView)}" aria-label="返回${viewLabels[returnView]}目录">← 目录</a>
    ${parts.length > 1 ? `<details class="reader-part-menu"><summary aria-label="切换分 P"><span class="reader-current-label">P${partIndex(entry) + 1}</span><span aria-hidden="true">⌄</span></summary><div class="reader-parts-popover">${partGapsMarkup(parts)}<ol>${parts.map((part) => `<li><a data-edition="${part.editionId}" href="${escapeHtml(partHref(part))}"${part.editionId === entry.editionId ? ' aria-current="page"' : ""}>P${partIndex(part) + 1}</a></li>`).join("")}</ol><a class="reader-flow-link" href="${escapeHtml(route.kind === "continuous" ? readerSearchRoute(entry) : continuousRoute(workKey(entry), isDraft(entry) ? "drafts" : "published", entry.editionId))}">${route.kind === "continuous" ? "返回当前 P 单篇阅读" : "从当前 P 连续阅读"} →</a></div></details>` : `<span class="reader-current-label">P${partIndex(entry) + 1}</span>`}
    <button id="reader-find" type="button" aria-label="${route.mode === 'review' ? '查找当前校验参照' : '打开视频内查找'}">查找</button><button id="reader-outline" type="button" aria-label="打开文章或段落导览" hidden>导览</button><button id="reader-settings" type="button" aria-label="调整阅读排版">排版</button></nav><details class="reader-identity"><summary aria-label="当前篇目与核验工具"><span class="reader-title-preview">${escapeHtml(entry.title)}</span><span class="reader-title-mobile">篇目</span></summary><div class="reader-identity-popover"><strong class="reader-current-title">${escapeHtml(entry.title)}</strong><p>当前 <span class="reader-current-label">P${partIndex(entry) + 1}</span></p><a class="reader-mode-link" href="${escapeHtml(readerSearchRoute(entry, route.videoSearch || {}, route.mode !== 'review'))}">${route.mode === 'review' ? '正文' : '核对'}</a><button type="button" data-feedback aria-label="反馈当前段落">纠错</button></div></details>`;
}

export function visibleReadingEntry(app, entries, topOffset) {
  const articles = [...app.querySelectorAll('.reading-article[data-edition], .continuous-part[data-edition]')];
  const article = articles.find((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top <= topOffset && bounds.bottom > topOffset;
  }) || articles.find((element) => element.getBoundingClientRect().bottom > topOffset);
  return entries.find((entry) => entry.editionId === article?.dataset.edition);
}

export function readingToolPosition(app, offset) {
  for (const block of app.querySelectorAll(".prose [id]")) {
    // Closed disclosures may still report cached descendant rectangles. Their
    // paragraphs cannot be a reading position until the disclosure is opened.
    if (block.closest("details:not([open])")) continue;
    const rect = block.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > offset && rect.top < window.innerHeight) {
      return { target: block, fraction: Math.max(0, Math.min(1, (offset - rect.top) / rect.height)) };
    }
  }
  return null;
}

export function restoreReadingToolPosition(position, offset) {
  if (!position?.target.isConnected) return false;
  const rect = position.target.getBoundingClientRect();
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + rect.height * position.fraction - offset), behavior: "instant" });
  const hadTabindex = position.target.hasAttribute("tabindex");
  if (!hadTabindex) position.target.setAttribute("tabindex", "-1");
  position.target.focus({ preventScroll: true });
  if (!hadTabindex) position.target.addEventListener("blur", () => position.target.removeAttribute("tabindex"), { once: true });
  return true;
}

export function bindReaderTools({ app, route, entries }) {
  const header = app.querySelector(".reader-header");
  if (!header) return { update() {}, destroy() {} };
  const events = new AbortController();
  let frame;
  let returnFrame;
  let anchorReleaseFrame;
  let savedAnchorStyle;
  let current = route.entry;
  let excursion;
  const offset = () => {
    const searchTools = app.querySelector("#reader-search-navigation");
    return Math.max(header.getBoundingClientRect().bottom,
      searchTools && !searchTools.hidden ? searchTools.getBoundingClientRect().bottom : 0) + 12;
  };
  const currentArticle = () => app.querySelector(`[data-edition="${current?.editionId}"].continuous-part, [data-edition="${current?.editionId}"].reading-article`);
  function cancelReturn() {
    if (returnFrame) cancelAnimationFrame(returnFrame);
    returnFrame = null;
    if (!excursion) releaseScrollAnchor();
  }
  function releaseScrollAnchor() {
    if (anchorReleaseFrame) cancelAnimationFrame(anchorReleaseFrame);
    anchorReleaseFrame = null;
    if (savedAnchorStyle !== undefined) {
      app.style.overflowAnchor = savedAnchorStyle;
      savedAnchorStyle = undefined;
    }
  }

  function update() {
    current = visibleReadingEntry(app, entries, offset()) || route.entry;
    header.querySelectorAll(".reader-current-title, .reader-title-preview").forEach((label) => { label.textContent = current.title; });
    header.querySelectorAll(".reader-current-label").forEach((label) => { label.textContent = `P${partIndex(current) + 1}`; });
    header.querySelectorAll(".reader-part-menu a").forEach((link) => {
      if (link.dataset.edition === current.editionId) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    header.querySelector("#reader-outline").hidden = !currentArticle()?.querySelector(".table-of-contents");
    const flow = header.querySelector(".reader-flow-link");
    if (flow) flow.href = route.kind === "continuous" ? readerSearchRoute(current) : continuousRoute(workKey(current), isDraft(current) ? "drafts" : "published", current.editionId);
    if (route.mode !== "review") header.querySelector(".reader-mode-link").href = readerSearchRoute(current, route.videoSearch || {}, true);
  }

  function openAndFocus(disclosure, target) {
    if (!disclosure) return;
    app.dispatchEvent(new CustomEvent("reading-tool-open", { detail: { disclosure, scroll: window.scrollY } }));
    disclosure.open = true;
    target?.focus({ preventScroll: true });
    disclosure.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function finishExcursion({ restore = true } = {}) {
    if (!excursion) return;
    const saved = excursion;
    excursion = null;
    saved.disclosure?.querySelector("[data-reading-tool-return]")?.remove();
    if (saved.disclosure?.tagName === "DETAILS") saved.disclosure.open = false;
    if (restore) {
      restoreReadingToolPosition(saved.position, offset());
      // Native details can defer their closed subtree's layout until paint.
      // Let both disclosures and the fixed row settle before saving resumes.
      if (returnFrame) cancelAnimationFrame(returnFrame);
      returnFrame = requestAnimationFrame(() => {
        returnFrame = requestAnimationFrame(() => {
          returnFrame = requestAnimationFrame(() => {
            returnFrame = null;
            if (!excursion) {
              restoreReadingToolPosition(saved.position, offset());
              app.dispatchEvent(new CustomEvent("reading-tool-return"));
              anchorReleaseFrame = requestAnimationFrame(() => { if (!excursion) releaseScrollAnchor(); });
            }
          });
        });
      });
    } else {
      releaseScrollAnchor();
      app.dispatchEvent(new CustomEvent("reading-tool-navigate"));
    }
  }

  app.addEventListener("reading-tool-open", (event) => {
    cancelReturn();
    if (anchorReleaseFrame) cancelAnimationFrame(anchorReleaseFrame);
    anchorReleaseFrame = null;
    if (savedAnchorStyle === undefined) savedAnchorStyle = app.style.overflowAnchor;
    // Disclosure removal and highlight cleanup change content above the saved
    // paragraph. Native scroll anchoring must not offset the explicit restore.
    app.style.overflowAnchor = "none";
    const disclosure = event.detail?.disclosure || app.querySelector(".reader-video-search");
    if (excursion && excursion.disclosure !== disclosure) {
      excursion.disclosure?.querySelector("[data-reading-tool-return]")?.remove();
      if (excursion.disclosure?.tagName === "DETAILS") excursion.disclosure.open = false;
      excursion.disclosure = disclosure;
    } else if (!excursion) {
      excursion = { position: readingToolPosition(app, offset()), disclosure };
    }
    if (disclosure && !disclosure.querySelector("[data-reading-tool-return]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reading-tool-return reset-button";
      button.dataset.readingToolReturn = "";
      button.textContent = "返回刚才阅读处";
      disclosure.append(button);
    }
  }, { signal: events.signal });
  app.addEventListener("reading-tool-abandon", () => { cancelReturn(); finishExcursion({ restore: false }); }, { signal: events.signal });
  app.addEventListener("reading-tool-navigate", () => {
    cancelReturn();
    if (excursion) finishExcursion({ restore: false });
  }, { signal: events.signal });
  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-reading-tool-return], #cancel-video-search")) finishExcursion();
    const link = event.target.closest("a[href]");
    if (link) cancelReturn();
    if (link?.closest(".reader-video-search, .table-of-contents, #reader-search-navigation") && link.hash) finishExcursion({ restore: false });
  }, { signal: events.signal, capture: true });
  app.addEventListener("toggle", (event) => {
    if (excursion?.disclosure === event.target && !event.target.open) finishExcursion();
  }, { signal: events.signal, capture: true });

  header.addEventListener("click", (event) => {
    if (event.target.closest("#reader-find")) {
      if (route.mode === "review") return;
      const disclosure = app.querySelector(".reader-video-search");
      if (disclosure) openAndFocus(disclosure, disclosure.querySelector("#video-query"));
    }
    if (event.target.closest("#reader-outline")) {
      const disclosure = currentArticle()?.querySelector(".table-of-contents");
      openAndFocus(disclosure, disclosure?.querySelector("summary"));
    }
  }, { signal: events.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || app.querySelector("dialog[open]")) return;
    if (excursion && (excursion.disclosure?.contains(document.activeElement) || event.target.closest?.("#reader-search-navigation"))) {
      event.preventDefault();
      finishExcursion();
      return;
    }
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
  return { update, destroy() { events.abort(); if (frame) cancelAnimationFrame(frame); cancelReturn(); releaseScrollAnchor(); } };
}
