import { partName } from "./source-identity.js";
import { prepareDocument } from "./document.js";
import { prepareReviewDocument } from "./review-document.js";
import { isDraft, readerSearchRoute, directoryRoute, adjacentParts } from "./manuscripts.js";
import { estimateReadingMinutes } from "./reading-time.js";
import { escapeHtml, statusBadge, viewLabels, footer } from "./ui.js";
import { originNoticeMarkup } from "./reader-details.js";
import { readerSidebarMarkup, readerPanelsMarkup, readerPartToolsMarkup } from "./reading-layout.js";
import { seriesMarkup, seriesAdjacentMarkup } from "./series-view.js";

function partsNavigation(entry, entries, mode, search) {
  const { parts, previous, next } = adjacentParts(entry, entries);
  if (parts.length < 2) return "";
  const link = (part, label, relation) => part
    ? `<a rel="${relation}" href="${escapeHtml(readerSearchRoute(part, search, mode === "review"))}">${label} · ${escapeHtml(partName(part))}</a>`
    : `<span>${relation === "prev" ? "这是首个已收录部分" : "已到最后一个收录部分"}</span>`;
  return `<nav class="parts-navigation" aria-label="相邻分 P"><div class="parts-adjacent">${link(previous, "← 上一部分", "prev")}${link(next, "下一部分 →", "next")}</div></nav>`;
}

export function readerMarkup(entry, mode, source, { entries, videoEntries = entries, videoSearch, returnView, pageUrl, issueUrl, series = [], preparedReview }) {
  const review = mode === "review";
  const route = { kind: "article", entry, view: isDraft(entry) ? "drafts" : "published", mode, videoSearch };
  const prepared = review ? preparedReview || prepareReviewDocument(source) : prepareDocument(source);
  const { title, body } = prepared;
  return `<div class="reading-progress" aria-hidden="true"><span></span></div><div class="reader-layout">${readerSidebarMarkup(route, entries)}<main id="main-content" class="reading-shell" tabindex="-1">
    <article class="reading-article${review ? ' review-article' : ''}" data-edition="${entry.editionId}"><header class="reading-heading">
      <div class="reading-status">${statusBadge(entry)}${review ? '<span>AI 初稿的固定校验参照</span>' : isDraft(entry) ? '<span>未经正式发布，信息待核验</span>' : ""}</div>
      ${originNoticeMarkup(entry, review)}${title || `<h1>${escapeHtml(entry.title)}</h1>`}
      <div class="reading-meta"><span class="current-part">${escapeHtml(partName(entry))}</span><span>${estimateReadingMinutes(source)} 分钟阅读</span></div>
      ${entry.summary && !review ? `<p class="reading-summary">${escapeHtml(entry.summary)}</p>` : ""}</header>
      ${readerPartToolsMarkup(entry, prepared, { review, returnView, pageUrl, issueUrl })}${seriesMarkup(entry, series, entries)}
      ${review ? '<p class="review-help">当前为固定校验参照，按段核对原文、整理稿与疑点。顶部「参照查找」仅搜索本份参照。</p><div id="review-arrival" role="status"></div>' : ''}
      <div class="prose">${body}</div>${review ? `<details class="review-raw"><summary>查看完整 Markdown 原文</summary><textarea readonly aria-label="完整校验参照 Markdown">${escapeHtml(source)}</textarea></details>` : ''}
      <div class="reading-end"><p>本部分读完了。</p>${partsNavigation(entry, entries, mode, videoSearch)}${!review ? seriesAdjacentMarkup(entry, series, entries) : ""}<a class="back-link" href="${directoryRoute(returnView)}">返回${viewLabels[returnView]}目录</a></div>
    </article>${footer(viewLabels[route.view])}</main></div>${readerPanelsMarkup(route, videoEntries.filter((candidate) => candidate.platform === entry.platform && candidate.externalVideoId === entry.externalVideoId))}`;
}
