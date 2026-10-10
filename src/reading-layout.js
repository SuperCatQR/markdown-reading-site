import { partLabel, partName } from "./source-identity.js";
import { adjacentParts, searchRoute, isDraft, entryDate } from "./manuscripts.js";
import { escapeHtml } from "./ui.js";
import { partGapsMarkup, readingOutlineMarkup } from "./reading-outline.js";
import { provenanceMarkup } from "./reader-details.js";
import { readerVideoMarkup } from "./video-view.js";
import { readerPartRoute } from "./reading-routes.js";

export function partsListMarkup(route, entries) {
  if (!route.entry) return "";
  const { parts } = adjacentParts(route.entry, entries);
  return `<nav class="reader-parts-list" aria-label="同视频分 P 目录"><p class="reader-parts-scope">${isDraft(route.entry) ? "公开预览" : "已发布"} · 已收录 ${parts.length} 篇</p><ol>${parts.map((entry) => `<li><a data-reader-part data-edition="${entry.editionId}" href="${escapeHtml(readerPartRoute(entry, route))}"${entry.editionId === route.entry.editionId ? ' aria-current="page"' : ""}><span class="part-number">${partLabel(entry)}</span><span>${escapeHtml(entry.sourceMetadata?.partTitle || "分段标题未提供")}</span></a></li>`).join("")}</ol>${partGapsMarkup(parts)}</nav>`;
}

export function readerSidebarMarkup(route, entries) {
  return `<aside class="reader-sidebar" aria-label="当前视频目录"><h2>同视频目录</h2><p class="reader-sidebar-title">${escapeHtml(route.entry?.title || route.videoKey)}</p>${partsListMarkup(route, entries)}</aside>`;
}

export function readerPanelsMarkup(route, entries) {
  const search = route.videoSearch || { view: route.view };
  return `<dialog id="reader-panel" class="reader-panel" aria-labelledby="reader-panel-title"><header class="reader-panel-heading"><h2 id="reader-panel-title">阅读工具</h2><button type="button" data-reader-panel-close aria-label="关闭工具并返回阅读">关闭</button></header><div class="reader-panel-content">${readerVideoMarkup(entries, search)}<section class="reader-review-search" data-reader-panel="review" hidden></section><section data-reader-panel="parts" hidden>${partsListMarkup(route, entries)}</section></div></dialog>`;
}

// Each loaded part owns its source and guide. The active panel moves these
// existing nodes into its independent scroll container; it never copies prose.
export function readerPartToolsMarkup(entry, prepared, { review = false, returnView = "all", pageUrl, issueUrl } = {}) {
  const date = entryDate(entry);
  return `<div class="reader-tool-stash" hidden><section data-reader-panel="source" data-edition="${entry.editionId}" hidden><p class="panel-part-name">${escapeHtml(partName(entry))}</p><p><time datetime="${date}">${isDraft(entry) ? "编辑版本创建于" : "正式发布于"} ${date}</time></p><div class="reading-actions"><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">原视频 · ${partLabel(entry)} ↗</a><button class="copy-markdown" type="button">复制 Markdown</button><button type="button" data-feedback>反馈这一段</button></div>${provenanceMarkup(entry, { review, pageUrl, issueUrl, includeVersion: true, expanded: true })}${entry.sourceMetadata.tags.length ? `<h3>原视频主题</h3><div class="article-tags" aria-label="探索原视频主题标签">${entry.sourceMetadata.tags.map((tag) => `<a href="${escapeHtml(searchRoute({ view: returnView, tag }))}">${escapeHtml(tag)}</a>`).join("")}</div>` : ""}</section><section data-reader-panel="outline" data-edition="${entry.editionId}" hidden>${readingOutlineMarkup(prepared, "本文目录", { panel: true })}</section></div>`;
}
