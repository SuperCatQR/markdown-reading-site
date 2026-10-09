import { prepareDocument } from "./document.js";
import { isDraft, entryRoute, reviewRoute, entryDate, directoryRoute, adjacentParts, buildIssueUrl } from "./manuscripts.js";
import { estimateReadingMinutes } from "./reading-time.js";
import { escapeHtml, statusBadge, draftNotice, reviewNotice, documentTabs, viewLabels, footer } from "./ui.js";

function provenance(entry) {
  return `<section class="provenance" aria-label="来源与整理说明"><div><span>当前稿件</span>${statusBadge(entry)}</div>
    <p><strong>整理方式</strong>${escapeHtml(entry.attribution)}</p>${entry.editorNote ? `<p><strong>编辑说明</strong>${escapeHtml(entry.editorNote)}</p>` : ""}
    <p class="verification-scope">审核与发布说明稿件的处理状态，不代表对视频中全部观点的学术认证。</p></section>`;
}

function partsNavigation(entry, entries, mode) {
  const { parts, previous, next } = adjacentParts(entry, entries);
  const route = mode === "review" ? reviewRoute : entryRoute;
  return `<nav class="parts-navigation" aria-label="同视频分 P 导航"><div class="parts-position"><strong>当前 P${entry.pageIndex + 1}</strong><span>同视频${isDraft(entry) ? "公开预览" : "已发布"} · 收录 ${parts.length} 个分 P</span></div>
    <ol>${parts.map((part) => `<li><a href="${route(part)}"${part.editionId === entry.editionId ? ' aria-current="page"' : ""}>P${part.pageIndex + 1}</a></li>`).join("")}</ol><div class="parts-adjacent">${previous ? `<a rel="prev" href="${route(previous)}">← 上一部分 · P${previous.pageIndex + 1}</a>` : `<span>这是首个已收录分 P</span>`}${next ? `<a rel="next" href="${route(next)}">下一部分 · P${next.pageIndex + 1} →</a>` : `<span>已到最后一个收录分 P</span>`}</div></nav>`;
}

export function readerMarkup(entry, mode, source, { entries, returnView, pageUrl, issueUrl }) {
  const review = mode === "review";
  const { title, body, headings } = prepareDocument(source);
  const toc = headings.filter(({ level }) => level > 1);
  const date = entryDate(entry);
  const draft = isDraft(entry);
  return `<div class="reading-progress" aria-hidden="true"><span></span></div><main id="main-content" class="reading-shell" tabindex="-1">
    <div class="reading-navigation"><a class="back-link" href="${directoryRoute(returnView)}">返回${viewLabels[returnView]}目录</a>${documentTabs(entry, mode)}</div>
    <article class="reading-article"><header class="reading-heading">${review ? reviewNotice() : ""}${draft ? draftNotice() : ""}
      <div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${title || `<h1>${escapeHtml(entry.title)}</h1>`}
      <div class="reading-meta"><span class="current-part">P${entry.pageIndex + 1}</span><time datetime="${date}">${review ? "关联稿件" : draft ? "创建于" : "发布于"} ${date.replaceAll("-", ".")}</time><span>${estimateReadingMinutes(source)} 分钟阅读</span><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">原视频 · ${escapeHtml(entry.bvid)} / P${entry.pageIndex + 1} ↗</a><button class="copy-markdown" type="button">复制 Markdown</button></div>
      ${entry.summary && !review ? `<p class="reading-summary">${escapeHtml(entry.summary)}</p>` : ""}${provenance(entry)}
      <details class="release-details"><summary>${review ? "校验参照版本" : draft ? "编辑版本" : "发布版本"}</summary><dl>${draft ? "" : `<dt>Release</dt><dd>${entry.releaseId}</dd>`}<dt>Edition</dt><dd>${entry.editionId}</dd><dt>AI Revision</dt><dd>${entry.aiRevisionId}</dd><dt>关联编辑内容 SHA-256</dt><dd>${entry.contentSha256}</dd>${review ? `<dt>校验参照文件 SHA-256</dt><dd>${entry.reviewArtifactSha256}</dd>` : ""}</dl></details>
      <a class="issue-link" href="${escapeHtml(buildIssueUrl(entry, pageUrl, issueUrl, mode))}" target="_blank" rel="noopener noreferrer">建议修改 →</a></header>
      ${partsNavigation(entry, entries, mode)}
      ${toc.length ? `<nav class="table-of-contents" aria-label="文章目录"><h2>本文目录</h2><ol>${toc.map(({ id, text, level }) => `<li class="toc-level-${level}"><a href="#${encodeURIComponent(id)}">${escapeHtml(text)}</a></li>`).join("")}</ol></nav>` : ""}
      <div class="prose">${body}</div><div class="reading-end"><p>本部分读完了，继续下一部分或回到目录。</p>${partsNavigation(entry, entries, mode)}<a class="back-link" href="${directoryRoute(returnView)}">返回${viewLabels[returnView]}目录</a></div>
    </article>${footer(viewLabels[draft ? "drafts" : "published"])}</main>`;
}
