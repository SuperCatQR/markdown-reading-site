import { focusDocumentHash } from "./browser-document.js";

export function bindReviewSearch(app, quote = "") {
  const controller = new AbortController();
  const panel = app.querySelector('[data-reader-panel="review"]');
  panel.setAttribute("aria-label", "查找当前校验参照");
  panel.innerHTML = '<form><label for="review-query">参照内查找</label><input id="review-query" type="search" maxlength="4000" placeholder="原文、整理稿、疑点…"><button type="submit">查找</button></form><div><output aria-live="polite">输入原句或词语</output><p class="review-hit-excerpt" hidden></p><button type="button" data-review-read hidden>阅读此命中</button><button type="button" data-review-prev aria-label="上一个参照命中" disabled>上一处</button><button type="button" data-review-next aria-label="下一个参照命中" disabled>下一处</button><button type="button" data-review-close>返回阅读处</button></div>';
  const input = panel.querySelector("input");
  const output = panel.querySelector("output");
  let matches = [], current = -1, savedDetails, keepMatch = false;
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
    const excerpt = panel.querySelector(".review-hit-excerpt");
    excerpt.hidden = panel.querySelector("[data-review-read]").hidden = !matches.length;
    excerpt.textContent = matches[current]?.textContent.slice(0, 240) || "";
  }
  function search() {
    clean(); const query = input.value.trim();
    matches = query ? blocks.filter((block) => block.textContent.includes(query)) : [];
    show(0);
  }
  function open(value) {
    app.dispatchEvent(new CustomEvent("reader-panel-request", { detail: { kind: "review" } }));
    if (value !== undefined) input.value = value;
    input.focus({ preventScroll: true });
    if (value) search();
  }
  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-review-find-quote]")) open(quote);
  }, { signal: controller.signal });
  panel.addEventListener("submit", (event) => { event.preventDefault(); search(); }, { signal: controller.signal });
  input.addEventListener("input", () => {
    panel.querySelectorAll("[data-review-prev], [data-review-next]").forEach((button) => { button.disabled = true; });
    panel.querySelector("[data-review-read]").hidden = true;
    panel.querySelector(".review-hit-excerpt").hidden = true;
    output.textContent = "按查找确认新查询";
  }, { signal: controller.signal });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-review-prev]")) show(current - 1);
    if (event.target.closest("[data-review-next]")) show(current + 1);
    if (event.target.closest("[data-review-close]")) app.querySelector('[data-reader-panel-close]').click();
    if (event.target.closest("[data-review-read]") && matches[current]) {
      keepMatch = true;
      app.dispatchEvent(new CustomEvent("reader-panel-dismiss", { detail: { restorePosition: false } }));
      focusDocumentHash(`#${matches[current].id}`);
    }
  }, { signal: controller.signal });
  app.addEventListener("reader-panel-open", (event) => {
    if (event.detail.kind !== "review") return;
    savedDetails = [...app.querySelectorAll(".prose details")].map((node) => [node, node.open]);
  }, { signal: controller.signal });
  app.addEventListener("reader-panel-close", (event) => {
    if (event.detail.kind !== "review") return;
    if (keepMatch) { keepMatch = false; return; }
    clean();
    for (const [node, wasOpen] of savedDetails || []) node.open = wasOpen;
  }, { signal: controller.signal });
  return { destroy() { controller.abort(); clean(); } };
}
