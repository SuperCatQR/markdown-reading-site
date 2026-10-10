import { entryKey, isDraft, readerSearchRoute } from "./manuscripts.js";
import { matchHash, parseMatchHash, normalizeSearch } from "./search.js";
import { escapeHtml } from "./ui.js";

// Traverse source parts, then the actual body-block order. Relevance ranking is
// useful for results; it must not reorder the passages while reading a video.
export function passageNavigation(matches, manuscriptType) {
  const seen = new Set();
  return matches.filter(({ entry }) => entry.manuscriptType === manuscriptType)
    .sort((a, b) => a.entry.pageIndex - b.entry.pageIndex)
    .flatMap(({ entry, matches: blocks = [] }) => blocks.flatMap((match) => {
      const key = `${entryKey(entry)}:${match.id}`;
      if (!match.id || seen.has(key)) return [];
      seen.add(key);
      return [{ entry, match }];
    }));
}

export function passageNavigationState(passages, entry, hash) {
  const hit = parseMatchHash(hash);
  const current = hit ? passages.findIndex((passage) =>
    (entryKey(passage.entry) === entryKey(entry) && passage.match.id === hit.id)
      || hit.id === `part-${passage.entry.editionId}-${passage.match.id}`) : -1;
  return { current, total: passages.length, previous: current > 0 ? passages[current - 1] : null,
    next: current >= 0 && current + 1 < passages.length ? passages[current + 1] : null };
}

export function passageNavigationMarkup(state, request) {
  const link = (passage, label, direction) => passage
    ? `<a class="search-hit-step" data-search-hit="${direction}" href="${escapeHtml(`${readerSearchRoute(passage.entry, request)}${matchHash(passage.match, request.query, request.mode)}`)}" aria-label="${label}：P${passage.entry.pageIndex + 1} 正文命中">${label}</a>`
    : `<span class="search-hit-boundary" aria-disabled="true">${label}</span>`;
  return `<nav class="search-hit-navigation" aria-label="搜索命中导航">${link(state.previous, "上一处", "previous")}<span class="search-hit-position" role="status" aria-live="polite">${state.current + 1} / ${state.total}</span>${link(state.next, "下一处", "next")}<details class="search-hit-actions"><summary aria-label="搜索阅读操作">操作</summary><div><p>按当前${isDraft({ manuscriptType: request.manuscriptType }) ? "公开预览" : "已发布"}稿件的 P 与正文段落顺序浏览。</p><button type="button" data-search-results>返回查找结果</button><button type="button" data-search-end data-reading-tool-return>结束逐处查找</button></div></details></nav>`;
}

export function createSearchNavigation({ app, route, getRequest, isCurrent }) {
  const events = new AbortController();
  let passages = [];
  let ready = false;
  const host = app.querySelector("#reader-search-navigation");
  const dispatch = (name) => app.dispatchEvent(new CustomEvent(name, { bubbles: true }));

  function render() {
    if (!host || !isCurrent()) return;
    const state = passageNavigationState(passages, route.entry, location.hash);
    const hit = parseMatchHash(location.hash);
    const request = getRequest();
    const expected = state.current >= 0 ? parseMatchHash(matchHash(passages[state.current].match, request.query, request.mode)) : null;
    const active = ready && route.mode !== "review" && state.current >= 0 && expected
      && normalizeSearch(hit.query) === normalizeSearch(expected.query);
    host.hidden = !active;
    host.innerHTML = active ? passageNavigationMarkup(state, { ...getRequest(), manuscriptType: route.entry.manuscriptType }) : "";
    app.dispatchEvent(new CustomEvent("search-navigation-change", { detail: { active }, bubbles: true }));
  }
  function clearHighlights() {
    for (const node of app.querySelectorAll(".search-passage")) {
      node.classList.remove("search-passage");
      node.querySelectorAll("mark").forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent)));
      node.normalize();
    }
    app.querySelectorAll(".search-arrival").forEach((node) => node.remove());
  }
  function end() {
    if (parseMatchHash(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    clearHighlights();
    render();
  }
  app.addEventListener("click", (event) => {
    if (!isCurrent()) return;
    if (event.target.closest(".search-hit-step, #video-results .passage-link")) {
      if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) dispatch("reading-tool-navigate");
    }
    if (event.target.closest("[data-search-results]")) {
      dispatch("reading-tool-open");
      const disclosure = app.querySelector(".reader-video-search");
      if (disclosure) {
        disclosure.open = true;
        disclosure.scrollIntoView({ behavior: "instant", block: "start" });
        disclosure.querySelector("#video-query")?.focus({ preventScroll: true });
      }
    }
    if (event.target.closest("[data-search-end]")) {
      const arrival = parseMatchHash(location.hash);
      const paragraph = arrival ? document.getElementById(arrival.id) : null;
      end();
      paragraph?.focus({ preventScroll: true });
      // reader-tools handles data-reading-tool-return and its prior body anchor.
    }
  }, { capture: true, signal: events.signal });
  window.addEventListener("hashchange", render, { signal: events.signal });
  return {
    pending() { ready = false; render(); },
    end,
    update(matches) { passages = passageNavigation(matches, route.entry.manuscriptType); ready = true; render(); },
    destroy() { events.abort(); if (host?.isConnected) { host.hidden = true; host.innerHTML = ""; } },
  };
}
