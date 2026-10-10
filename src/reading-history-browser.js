import { workKey, partIndex, partLabel } from "./source-identity.js";
import { continuousRoute, entryRoute } from "./manuscripts.js";
import { escapeHtml } from "./ui.js";
import {
  READING_HISTORY_KEY, createReadingHistoryStore, readingHistoryStorage,
  readingRecordId, recordFromEntry, reconcileReadingRecord,
} from "./reading-history.js";

const normalizedText = (node) => (node.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 160);
const proseBlocks = (article) => [...article.querySelectorAll(".prose [id]")];
const partPrefix = (edition) => `part-${edition}-`;
const notices = {
  unavailable: "当前浏览器无法保存阅读位置；阅读仍可继续。请检查浏览器存储设置或可用空间。",
  corrupt: "当前浏览器的阅读记录已损坏，暂未继续保存。可清空记录后重新开始。",
  unsupported: "当前浏览器的阅读记录格式无法识别，暂未继续保存。可清空记录后重新开始。",
};

export function visibleReadingPosition(app, entries, { topOffset = 0, viewportHeight = globalThis.innerHeight } = {}) {
  for (const article of app.querySelectorAll("article[data-edition]")) {
    const entry = entries.find((candidate) => candidate.editionId === article.dataset.edition);
    if (!entry) continue;
    for (const block of proseBlocks(article)) {
      const rect = block.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= topOffset || rect.top >= viewportHeight) continue;
      const prefix = partPrefix(entry.editionId);
      return {
        entry, anchor: block.id.startsWith(prefix) ? block.id.slice(prefix.length) : block.id,
        offset: Math.max(0, Math.min(1, (topOffset - rect.top) / rect.height)), text: normalizedText(block),
      };
    }
  }
  return null;
}

export function readingRecordHref(record, entry) {
  const continuous = record.readingMode === "continuous";
  const route = continuous
    ? continuousRoute(workKey(entry), entry.manuscriptType === "publication" ? "published" : "drafts", entry.editionId)
    : entryRoute(entry);
  return `${route}#${encodeURIComponent(`${continuous ? partPrefix(entry.editionId) : ""}${record.anchor}`)}`;
}

export function recentReadingMarkup({ records, status }, entries) {
  if (!records.length && status === "ok") return "";
  const recordMarkup = (record, primary = false) => {
    const current = reconcileReadingRecord(record, entries);
    const detail = current.status === "available" ? "继续上次正文位置"
      : current.status === "updated" ? "内容已更新，旧位置不可恢复" : "稿件已撤回或不在当前快照中，位置不可恢复";
    const title = escapeHtml(current.entry?.title || record.title);
    const titleMarkup = primary
      ? `<details class="recent-reading-title"><summary><strong>${title}</strong><span class="recent-title-expand" aria-hidden="true">展开</span><span class="recent-title-collapse" aria-hidden="true">收起</span></summary></details>`
      : `<strong>${title}</strong>`;
    const action = current.status === "available" && status === "ok"
      ? `<a href="${escapeHtml(readingRecordHref(record, current.entry))}" data-reading-resume="${escapeHtml(record.id)}">继续阅读 →</a>`
      : current.status === "updated" ? `<a href="${escapeHtml(entryRoute(current.entry))}">从新版开始 →</a>` : "";
    return `<${primary ? 'div class="recent-reading-primary"' : "li"}><div><span class="recent-reading-part">${primary ? "上次读到 · " : ""}${partLabel(record)} · ${record.manuscriptType === "publication" ? "已发布" : "公开预览"}</span>${titleMarkup}${current.status !== "available" ? `<p>${detail}</p>` : ""}${primary ? "" : action}</div>${primary ? action : `<button type="button" class="reset-button" data-reading-delete="${escapeHtml(record.id)}" aria-label="删除 ${escapeHtml(record.title)} 的阅读记录">删除</button>`}</${primary ? "div" : "li"}>`;
  };
  // The latest record stays visible, including its invalidation state. Do not
  // silently promote an older valid record when the reader's latest has changed.
  const primary = records[0] ? recordMarkup(records[0], true) : "";
  return `<section class="recent-reading" aria-label="最近阅读">${primary}${status !== "ok" ? `<p role="status">${escapeHtml(notices[status] || notices.unavailable)}</p>` : ""}<details class="recent-reading-management"${status !== "ok" ? " open" : ""}><summary>查看全部 ${records.length} 篇与管理记录</summary><ol>${records.map((record) => recordMarkup(record)).join("")}</ol><div class="recent-reading-heading"><button type="button" class="reset-button" data-reading-clear>清空记录</button></div><p class="reading-history-help">保存在当前浏览器，最多保留 20 篇，180 天后到期。校验参照不覆盖正文位置。</p></details><p class="reading-history-result" role="status"></p></section>`;
}

export function createReadingHistoryBrowser({
  app, entries, getRoute, getTopOffset = () => (app.querySelector(".site-header")?.getBoundingClientRect().bottom || 0) + 12,
  store = createReadingHistoryStore(readingHistoryStorage()), onChange = () => {},
}) {
  let active = false;
  let dirty = false;
  let timer;
  let pendingResume;
  let recentHost;
  let lastScrollAt;
  let inTool = false;
  let userScrolled = false;
  let toolGeneration = 0;
  const events = new AbortController();
  const options = { signal: events.signal };

  function showStorageNotice(reason) {
    if (!notices[reason]) return;
    const main = app.querySelector("main");
    if (!main) return;
    let notice = main.querySelector(".reading-history-notice");
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "reading-history-notice";
      notice.setAttribute("role", "status");
      main.prepend(notice);
    }
    if (notice.textContent !== notices[reason]) notice.textContent = notices[reason];
  }

  function renderRecent(host = recentHost) {
    recentHost = host;
    if (!host?.isConnected) return;
    const wasOpen = host.querySelector(".recent-reading-management")?.open;
    host.innerHTML = recentReadingMarkup(store.read(), entries);
    if (wasOpen && host.querySelector(".recent-reading-management")) host.querySelector(".recent-reading-management").open = true;
  }

  function capture(lastReadAt) {
    if (!active) return null;
    const position = visibleReadingPosition(app, entries, { topOffset: getTopOffset(), viewportHeight: window.innerHeight });
    return position ? recordFromEntry(position.entry, {
      ...position, readingMode: getRoute()?.kind === "continuous" ? "continuous" : "single", lastReadAt,
    }) : null;
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!active || !dirty) return;
    // The captured timestamp belongs to the scroll event, not the delayed flush:
    // an older tab must not overwrite a newer tab's intervening reading activity.
    const record = capture(lastScrollAt);
    dirty = false;
    if (!record) return;
    const result = store.write(record);
    if (!result.ok) showStorageNotice(result.reason);
    if (result.ok) onChange(record);
  }

  function restore(record) {
    const current = reconcileReadingRecord(record, entries);
    if (current.status !== "available") return false;
    const article = [...app.querySelectorAll("article[data-edition]")]
      .find((node) => node.dataset.edition === current.entry.editionId);
    if (!article) return false;
    const blocks = proseBlocks(article);
    const prefix = article.classList.contains("continuous-part") ? partPrefix(record.editionId) : "";
    let target = blocks.find((block) => block.id === `${prefix}${record.anchor}`);
    if (!target && record.text) {
      const matches = blocks.filter((block) => normalizedText(block) === record.text);
      if (matches.length === 1) target = matches[0];
    }
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + rect.height * record.offset - getTopOffset()), behavior: "instant" });
    const hadTabindex = target.hasAttribute("tabindex");
    if (!hadTabindex) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (!hadTabindex) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    return true;
  }

  function ready({ historyRestored = false } = {}) {
    ++toolGeneration;
    clearTimeout(timer);
    timer = null;
    dirty = false;
    inTool = false;
    const route = getRoute();
    active = route?.kind === "continuous" || (route?.kind === "article" && route.mode === "body");
    if (!active || !route.entry) { pendingResume = null; return; }
    const saved = store.read();
    if (saved.status !== "ok") showStorageNotice(saved.status);
    const record = saved.records.find((candidate) => candidate.id === readingRecordId(route.entry));
    if (pendingResume && pendingResume.id === record?.id && reconcileReadingRecord(record, entries).status === "available") {
      const resumeRecord = pendingResume;
      const resumed = restore(resumeRecord);
      pendingResume = null;
      if (resumed) return { restore: () => restore(resumeRecord) };
    }
    pendingResume = null;
    if (!record || location.hash || historyRestored) return;
    const current = reconcileReadingRecord(record, entries);
    const prompt = document.createElement("aside");
    prompt.className = "reading-resume";
    prompt.setAttribute("aria-label", "上次阅读位置");
    prompt.innerHTML = current.status === "available"
      ? '<p>当前浏览器保存了这篇正文的阅读位置。</p><button class="reset-button" type="button" data-reading-continue>继续上次位置</button><button class="reset-button" type="button" data-reading-dismiss>从这里开始</button>'
      : '<p>内容已更新，旧阅读位置不可恢复。可从新版开始。</p><button class="reset-button" type="button" data-reading-dismiss>从新版开始</button>';
    const heading = app.querySelector(".continuous-heading, .reading-heading");
    if (!heading) return;
    heading.before(prompt);
    prompt.querySelector("[data-reading-continue]")?.addEventListener("click", () => {
      prompt.remove();
      if (!restore(record)) {
        const message = document.createElement("p");
        message.setAttribute("role", "status");
        message.textContent = "未在当前正文中找到上次段落，可从此处继续阅读。";
        heading.before(message);
      }
    }, options);
    prompt.querySelector("[data-reading-dismiss]").addEventListener("click", () => prompt.remove(), options);
  }

  app.addEventListener("click", (event) => {
    const resume = event.target.closest("[data-reading-resume]");
    if (resume && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      pendingResume = store.read().records.find((record) => record.id === resume.dataset.readingResume);
    }
    const remove = event.target.closest("[data-reading-delete]");
    const clear = event.target.closest("[data-reading-clear]");
    if (!remove && !clear) return;
    const result = remove ? store.remove(remove.dataset.readingDelete) : store.clear();
    if (result.ok) {
      renderRecent();
      if (recentHost?.isConnected) {
        recentHost.setAttribute("tabindex", "-1");
        recentHost.focus({ preventScroll: true });
      }
    } else {
      const output = app.querySelector(".reading-history-result");
      if (output) output.textContent = "未能清理当前浏览器的记录，请检查存储设置后重试。";
    }
  }, options);
  window.addEventListener("scroll", () => {
    if (!active) return;
    if (inTool) {
      if (!userScrolled) return;
      const position = visibleReadingPosition(app, entries, { topOffset: getTopOffset(), viewportHeight: window.innerHeight });
      if (!position) return;
      const article = [...app.querySelectorAll("article[data-edition]")].find((node) => node.dataset.edition === position.entry.editionId);
      const block = proseBlocks(article).find((node) => node.id === position.anchor || node.id === `${partPrefix(position.entry.editionId)}${position.anchor}`);
      if (!block || block.getBoundingClientRect().top > getTopOffset() + 80) return;
      inTool = false;
      app.dispatchEvent(new CustomEvent("reading-tool-abandon"));
    }
    dirty = true;
    lastScrollAt = Date.now();
    if (!timer) timer = setTimeout(flush, 500);
  }, { ...options, passive: true });
  app.addEventListener("reading-tool-open", () => { ++toolGeneration; flush(); inTool = true; userScrolled = false; }, options);
  app.addEventListener("reading-tool-return", () => {
    const generation = ++toolGeneration;
    userScrolled = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation === toolGeneration && active) inTool = false;
    }));
  }, options);
  app.addEventListener("reading-tool-navigate", () => { ++toolGeneration; inTool = false; userScrolled = false; }, options);
  for (const type of ["wheel", "touchmove", "keydown"]) window.addEventListener(type, (event) => {
    if (type === "keydown" && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"].includes(event.key)) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
    userScrolled = true;
  }, { ...options, passive: true });
  window.addEventListener("pagehide", flush, options);
  window.addEventListener("storage", (event) => {
    if (event.key === READING_HISTORY_KEY || event.key === null) renderRecent();
  }, options);
  function suspend() { ++toolGeneration; flush(); active = false; }
  return { ready, flush, suspend, renderRecent, store, destroy() { suspend(); events.abort(); } };
}
