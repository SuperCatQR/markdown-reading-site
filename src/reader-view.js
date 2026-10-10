import { readingOutlineMarkup, partGapsMarkup } from "./reading-outline.js";
import { prepareDocument } from "./document.js";
import { prepareReviewDocument } from "./review-document.js";
import { isDraft, entryRoute, reviewRoute, entryDate, directoryRoute, continuousRoute, adjacentParts, searchRoute } from "./manuscripts.js";
import { estimateReadingMinutes } from "./reading-time.js";
import { escapeHtml, statusBadge, documentTabs, viewLabels, footer } from "./ui.js";
import { provenanceMarkup } from "./reader-details.js";
import { readerVideoMarkup } from "./video-view.js";
import { seriesMarkup, seriesAdjacentMarkup } from "./series-view.js";

function partsNavigation(entry, entries, mode) {
  const { parts, previous, next } = adjacentParts(entry, entries);
  if (parts.length < 2) return "";
  const route = mode === "review" ? reviewRoute : entryRoute;
  return `<nav class="parts-navigation" aria-label="同视频分 P 导航"><div class="parts-position"><strong>当前 P${entry.pageIndex + 1}</strong><span>同视频${isDraft(entry) ? "公开预览" : "已发布"} · 收录 ${parts.length} 个分 P</span></div>
    ${partGapsMarkup(parts)}<ol>${parts.map((part) => `<li><a href="${route(part)}"${part.editionId === entry.editionId ? ' aria-current="page"' : ""}>P${part.pageIndex + 1}</a></li>`).join("")}</ol><div class="parts-adjacent">${previous ? `<a rel="prev" href="${route(previous)}">← 上一个已收录部分 · P${previous.pageIndex + 1}</a>` : `<span>这是首个已收录分 P</span>`}${next ? `<a rel="next" href="${route(next)}">下一个已收录部分 · P${next.pageIndex + 1} →</a>` : `<span>已到最后一个收录分 P</span>`}<a class="continuous-link" href="${continuousRoute(entry.bvid, isDraft(entry) ? "drafts" : "published", entry.editionId)}">从此 P 连续阅读 →</a></div></nav>`;
}

export function readerMarkup(entry, mode, source, { entries, videoEntries = entries, videoSearch, returnView, pageUrl, issueUrl, returnContinuous, series = [], preparedReview }) {
  const review = mode === "review";
  const prepared = review ? preparedReview || prepareReviewDocument(source) : prepareDocument(source);
  const { title, body } = prepared;
  const date = entryDate(entry);
  const draft = isDraft(entry);
  const parts = adjacentParts(entry, entries).parts;
  return `<div class="reading-progress" aria-hidden="true"><span></span></div><main id="main-content" class="reading-shell" tabindex="-1">
    ${returnContinuous ? `<a class="video-return" href="${escapeHtml(returnContinuous)}">返回连续阅读 →</a>` : ""}
    <article class="reading-article${review ? ' review-article' : ''}" data-edition="${entry.editionId}"><header class="reading-heading">
      <div class="reading-status">${statusBadge(entry)}${review ? '<span>AI 初稿的固定校验参照</span>' : draft ? '<span>未经正式发布，信息待核验</span>' : ""}</div>
      ${title || `<h1>${escapeHtml(entry.title)}</h1>`}
      <div class="reading-meta"><span class="current-part">P${entry.pageIndex + 1}</span><span>${estimateReadingMinutes(source)} 分钟阅读</span></div>
      ${entry.summary && !review ? `<p class="reading-summary">${escapeHtml(entry.summary)}</p>` : ""}
      <details class="reading-information"><summary>来源、稿件信息与校验</summary><p class="reading-information-date"><time datetime="${date}">${review ? "关联稿件" : draft ? "创建于" : "发布于"} ${date.replaceAll("-", ".")}</time></p>${documentTabs(entry, mode)}<div class="reading-actions"><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="原视频 ${escapeHtml(entry.bvid)} P${entry.pageIndex + 1}">原视频 ↗</a><button class="copy-markdown" type="button">复制 Markdown</button><button type="button" data-feedback>反馈这一段</button></div>
      <div class="reading-extra-controls">${entry.tags.length ? `<details class="article-themes"><summary><span>主题 · ${escapeHtml(entry.tags.slice(0, 2).join("、"))}</span><span>${entry.tags.length} 个</span></summary><div class="article-tags" aria-label="探索原视频主题标签">${entry.tags.map((tag) => `<a href="${escapeHtml(searchRoute({ view: returnView, tag }))}" aria-label="按主题筛选：${escapeHtml(tag)}">${escapeHtml(tag)}</a>`).join("")}</div></details>` : ""}
      ${provenanceMarkup(entry, { review, pageUrl, issueUrl, includeVersion: true })}</div>${parts.length === 1 ? partGapsMarkup(parts) : ""}</details></header>
      ${parts.length > 1 ? `<details class="reading-parts"><summary>同视频分 P · ${parts.length} 篇</summary>${partsNavigation(entry, entries, mode)}</details>` : ""}
      ${seriesMarkup(entry, series, entries)}
      ${readerVideoMarkup(videoEntries.filter((candidate) => candidate.bvid === entry.bvid), review ? { view: draft ? "drafts" : "published" } : videoSearch || { view: draft ? "drafts" : "published" })}
      ${review ? '<p class="review-help">按段核对原文、整理稿与疑点。顶部「查找」仅搜索本份参照；视频内查找仍只搜索正文。</p><div id="review-arrival" role="status"></div>' : ''}
      ${readingOutlineMarkup(prepared)}
      <div class="prose">${body}</div>${review ? `<details class="review-raw"><summary>查看完整 Markdown 原文</summary><textarea readonly aria-label="完整校验参照 Markdown">${escapeHtml(source)}</textarea></details>` : ''}<div class="reading-end"><p>本部分读完了${adjacentParts(entry, entries).parts.length > 1 ? "，继续下一部分或回到目录。" : "，可返回目录阅读其他内容。"}</p>${partsNavigation(entry, entries, mode)}${!review ? seriesAdjacentMarkup(entry, series, entries) : ""}<a class="back-link" href="${directoryRoute(returnView)}">返回${viewLabels[returnView]}目录</a></div>
    </article>${footer(viewLabels[draft ? "drafts" : "published"])}</main>`;
}
