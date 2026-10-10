import { parseMatchHash, textSegments, searchTerms } from "./search.js";

const pendingAnchors = new WeakMap();

function pauseScrollAnchoring(shell) {
  if (!shell) return;
  const previous = pendingAnchors.get(shell);
  if (previous) cancelAnimationFrame(previous.frame);
  const pending = { style: previous?.style ?? shell.style.overflowAnchor, frame: null };
  shell.style.overflowAnchor = "none";
  pendingAnchors.set(shell, pending);
  // Highlight/notice changes and fixed-row reflow share this render. Let them
  // settle before enabling the browser's automatic anchor correction again.
  pending.frame = requestAnimationFrame(() => {
    pending.frame = requestAnimationFrame(() => {
      shell.style.overflowAnchor = pending.style;
      pendingAnchors.delete(shell);
    });
  });
}

export async function copyMarkdown(source, button) {
  let textarea;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source);
    else {
      textarea = document.createElement("textarea");
      textarea.value = source;
      textarea.setAttribute("readonly", "");
      textarea.className = "clipboard-fallback";
      document.body.append(textarea);
      textarea.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    }
    button.textContent = "已复制 Markdown";
  } catch {
    button.textContent = "复制失败，请手动复制";
  } finally {
    textarea?.remove();
    window.setTimeout(() => { button.textContent = "复制 Markdown"; }, 2000);
  }
}

export function focusDocumentHash(hash, { scroll = true } = {}) {
  const match = parseMatchHash(hash);
  let id;
  try { id = match?.id || decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (!target || !target.closest(".prose")) {
    if (!match && scroll) document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
    return;
  }
  pauseScrollAnchoring(target.closest(".reading-shell"));
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS") parent.open = true;
  }
  let arrival;
  if (match) {
    for (const notice of document.querySelectorAll(".search-arrival")) notice.remove();
    for (const passage of document.querySelectorAll(".search-passage")) passage.classList.remove("search-passage");
    for (const mark of document.querySelectorAll(".prose mark")) mark.replaceWith(document.createTextNode(mark.textContent));
    target.normalize();
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.parentElement.closest("mark, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const text = nodes.map((node) => node.textContent).join("");
    let position = 0;
    const ranges = textSegments(text, searchTerms(match.query, match.mode)).flatMap((segment) => {
      const start = position;
      position += segment.text.length;
      return segment.match ? [{ start, end: position }] : [];
    });
    let offset = 0;
    for (const node of nodes) {
      const start = offset;
      offset += node.textContent.length;
      const overlaps = ranges.filter((range) => range.start < offset && range.end > start);
      if (!overlaps.length) continue;
      const fragment = document.createDocumentFragment();
      let end = 0;
      for (const range of overlaps) {
        const from = Math.max(0, range.start - start);
        const to = Math.min(node.textContent.length, range.end - start);
        fragment.append(document.createTextNode(node.textContent.slice(end, from)));
        const mark = document.createElement("mark");
        mark.textContent = node.textContent.slice(from, to);
        fragment.append(mark);
        end = to;
      }
      fragment.append(document.createTextNode(node.textContent.slice(end)));
      node.replaceWith(fragment);
    }
    target.classList.add("search-passage");
    const notice = document.createElement("p");
    notice.className = "search-arrival";
    notice.setAttribute("role", "status");
    notice.textContent = `已定位正文命中：${match.query}`;
    target.before(notice);
    arrival = notice;
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  if (!match) {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  if (!scroll) return;
  // Locate the confirmation and passage together, using the actual fixed tools
  // rather than assuming their height. Large text can make the notice wrap.
  const fixedBottom = Math.max(...[...document.querySelectorAll(".site-header, #reader-search-navigation:not([hidden]), .review-search-tools:not([hidden])")]
    .map((node) => node.getBoundingClientRect().bottom), 0);
  const top = (arrival || target).getBoundingClientRect().top;
  window.scrollTo({ top: Math.max(0, window.scrollY + top - fixedBottom - 12), behavior: "instant" });
}
