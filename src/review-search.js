import { focusDocumentHash } from "./browser-document.js";
import { readingToolPosition, restoreReadingToolPosition } from "./reader-tools.js";
import { readingOffset } from "./contribution-navigation.js";

export function bindReviewSearch(app, quote = "") {
  const controller = new AbortController();
  const panel = document.createElement("section");
  panel.className = "review-search-tools"; panel.hidden = true; panel.setAttribute("aria-label", "查找当前校验参照");
  panel.innerHTML = '<form><label for="review-query">参照内查找</label><input id="review-query" type="search" maxlength="4000" placeholder="原文、整理稿、疑点…"><button type="submit">查找</button></form><div><output aria-live="polite">输入原句或词语</output><button type="button" data-review-prev aria-label="上一个参照命中" disabled>上一处</button><button type="button" data-review-next aria-label="下一个参照命中" disabled>下一处</button><button type="button" data-review-close>返回阅读处</button></div>';
  app.querySelector(".site-header").after(panel);
  const input = panel.querySelector("input");
  const output = panel.querySelector("output");
  let matches = [], current = -1, saved, savedScroll, savedDetails, anchorStyle, returnFrame;
  const blocks = [...app.querySelectorAll(".prose [id]")].filter((node) => ![...node.children].some((child) => child.id));
  function clean() {
    app.querySelectorAll(".review-match").forEach((node) => node.classList.remove("review-match"));
    app.querySelectorAll("mark[data-review-highlight]").forEach((node) => { const parent = node.parentNode; node.replaceWith(document.createTextNode(node.textContent)); parent.normalize(); });
  }
  function show(index) {
    clean();
    const query = input.value.trim();
    if (!matches.length) { current = -1; output.textContent = query ? "0 处命中 · 仅当前参照" : "输入原句或词语"; }
    else {
      current = (index + matches.length) % matches.length;
      const target = matches[current]; target.classList.add("review-match");
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const parts = node.textContent.split(query);
        if (parts.length < 2) continue;
        const fragment = document.createDocumentFragment();
        parts.forEach((part, i) => { if (i) { const mark = document.createElement("mark"); mark.dataset.reviewHighlight = ""; mark.textContent = query; fragment.append(mark); } fragment.append(document.createTextNode(part)); });
        node.replaceWith(fragment);
      }
      output.textContent = `${current + 1} / ${matches.length} 处命中 · 仅当前参照`;
      focusDocumentHash(`#${target.id}`);
    }
    panel.querySelectorAll("[data-review-prev], [data-review-next]").forEach((button) => { button.disabled = !matches.length; });
  }
  function search() {
    clean(); const query = input.value.trim();
    matches = query ? blocks.filter((block) => block.textContent.includes(query)) : [];
    show(0);
  }
  function open(value) {
    if (panel.hidden) {
      if (returnFrame) cancelAnimationFrame(returnFrame);
      if (anchorStyle === undefined) anchorStyle = app.style.overflowAnchor;
      app.style.overflowAnchor = "none";
      saved = readingToolPosition(app, readingOffset(app)); savedScroll = window.scrollY;
      if (saved) {
        const rect = saved.target.getBoundingClientRect();
        saved.fraction = (readingOffset(app) - rect.top) / rect.height;
      }
      savedDetails = [...app.querySelectorAll(".prose details")].map((node) => [node, node.open]);
    }
    panel.hidden = false;
    if (value !== undefined) input.value = value;
    input.focus({ preventScroll: true });
    if (value) search();
  }
  function close() {
    clean(); panel.hidden = true;
    for (const [node, wasOpen] of savedDetails || []) node.open = wasOpen;
    const restore = () => {
      if (!restoreReadingToolPosition(saved, readingOffset(app))) window.scrollTo({ top: savedScroll || 0, behavior: "instant" });
    };
    restore();
    returnFrame = requestAnimationFrame(() => { returnFrame = requestAnimationFrame(() => {
      restore(); returnFrame = null; app.style.overflowAnchor = anchorStyle || ""; anchorStyle = undefined;
    }); });
    if (!saved) app.querySelector("#reader-find").focus({ preventScroll: true });
  }
  app.addEventListener("click", (event) => {
    if (event.target.closest("#reader-find")) open();
    if (event.target.closest("[data-review-find-quote]")) open(quote);
  }, { signal: controller.signal });
  panel.addEventListener("submit", (event) => { event.preventDefault(); search(); }, { signal: controller.signal });
  input.addEventListener("input", () => {
    panel.querySelectorAll("[data-review-prev], [data-review-next]").forEach((button) => { button.disabled = true; });
    output.textContent = "按查找确认新查询";
  }, { signal: controller.signal });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-review-prev]")) show(current - 1);
    if (event.target.closest("[data-review-next]")) show(current + 1);
    if (event.target.closest("[data-review-close]")) close();
  }, { signal: controller.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden && !app.querySelector("dialog[open]")) { event.preventDefault(); close(); }
  }, { signal: controller.signal });
  return { destroy() { controller.abort(); if (returnFrame) cancelAnimationFrame(returnFrame); if (anchorStyle !== undefined) app.style.overflowAnchor = anchorStyle; clean(); panel.remove(); } };
}
