import { contributionVersion, matchReviewPassages } from "./review-document.js";
import { readingToolPosition, restoreReadingToolPosition } from "./reader-tools.js";
import { parseMatchHash } from "./search.js";
import { focusDocumentHash } from "./browser-document.js";

export function readingOffset(app) { return Math.max(0, ...[...app.querySelectorAll(".site-header, #reader-search-navigation:not([hidden]), .review-search-tools:not([hidden])")].map((node) => node.getBoundingClientRect().bottom)) + 12; }

export function captureReviewContext(app, route, destination) {
  if (destination.mode !== "review" || route.mode === "review" || !destination.entry) return null;
  const article = app.querySelector(`article[data-edition="${destination.entry.editionId}"]`);
  if (!article) return null;
  const position = readingToolPosition(article, readingOffset(app));
  let hashId;
  try { hashId = parseMatchHash(location.hash)?.id || decodeURIComponent(location.hash.slice(1)); } catch { /* Invalid hash is not evidence. */ }
  const hashTarget = document.getElementById(hashId);
  // Prefer the paragraph actually on screen. A stale search hash must not pull
  // a contributor back to a passage they already scrolled away from.
  const offset = readingOffset(app);
  const hashBounds = article.contains(hashTarget) ? hashTarget.getBoundingClientRect() : null;
  const atHash = hashBounds && hashBounds.bottom > offset && hashBounds.top < offset + 200;
  const target = atHash ? hashTarget : position?.target;
  const bounds = target?.getBoundingClientRect();
  return { version: contributionVersion(destination.entry), bodyUrl: location.href,
    position: target ? { id: target.id, fraction: bounds.height ? (offset - bounds.top) / bounds.height : 0 } : null,
    quote: target?.textContent || "", fromContinuous: route.kind === "continuous" };
}

export function applyReviewArrival(app, entry, reference, context, { scroll = true } = {}) {
  if (!context) return false;
  if (context.version !== contributionVersion(entry)) {
    const host = app.querySelector("#review-arrival");
    if (host) host.textContent = "稿件版本已变化，请从当前正文重新选择核对位置。";
    return false;
  }
  const matches = matchReviewPassages(reference.passages, context.quote);
  const host = app.querySelector("#review-arrival");
  if (!host) return false;
  const back = document.createElement("a");
  // Only internally captured same-origin document URLs are accepted.
  let url;
  try { url = new URL(context.bodyUrl); } catch { return false; }
  if (url.origin !== location.origin || url.pathname !== location.pathname) return false;
  back.href = url.href; back.className = "review-return"; back.textContent = "返回刚才正文";
  app.querySelectorAll('.document-tabs a:not([aria-current]), .reader-mode-link').forEach((link) => { link.href = url.href; });
  host.replaceChildren(back);
  const notice = document.createElement("p");
  notice.textContent = matches.length === 1 ? "已定位与正文完全一致的整理稿。" : matches.length > 1
    ? "参照有多处相同整理稿，请选择核对位置。" : "未找到完全一致的整理稿；正文可能经过编辑，请查找原句后核对。";
  host.append(notice);
  if (matches.length === 1) {
    const target = document.getElementById(matches[0].id);
    target?.classList.add("review-correspondence");
    if (scroll) focusDocumentHash(`#${matches[0].id}`);
    return scroll;
  }
  for (const match of matches) {
    const link = document.createElement("a"); link.href = `#${match.id}`; link.textContent = match.heading; host.append(link);
  }
  if (context.quote) {
    const quote = document.createElement("blockquote"); quote.textContent = context.quote; host.append(quote);
    const button = document.createElement("button"); button.type = "button"; button.dataset.reviewFindQuote = ""; button.textContent = "在参照中查找原句"; host.append(button);
  }
  return false;
}

export function restoreContributionPosition(app, entry, context) {
  if (!context || context.version !== contributionVersion(entry) || context.bodyUrl !== location.href || !context.position) return false;
  const target = document.getElementById(context.position.id);
  if (!target?.closest(`article[data-edition="${entry.editionId}"] .prose`)) return false;
  return restoreReadingToolPosition({ target, fraction: context.position.fraction }, readingOffset(app));
}
