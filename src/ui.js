import { entryRoute, reviewRoute, isDraft, directoryRoute, statusLabel } from "./manuscripts.js";
import { textSegments } from "./search.js";

export const viewLabels = { all: "全部内容", published: "已发布", drafts: "未发布" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function highlightText(text, query) {
  return textSegments(text, query).map((part) => part.match ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text)).join("");
}

export function themeIconMarkup(theme) {
  return theme === "dark"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"></path></svg>`;
}

export function header({ view, theme, counts, directory = false, unknown = false, siteRoot, readerTools = "", section = "" }) {
  const current = !unknown && directory ? section : null;
  const categories = `<nav class="top-nav" aria-label="内容导航"><a href="${directoryRoute("all")}"${current !== null && !["topics", "recent-reading"].includes(current) ? ' aria-current="page"' : ""}>内容列表</a><a href="${directoryRoute("all")}#topics" data-directory-section="topics"${current === "topics" ? ' aria-current="page"' : ""}>主题</a><a href="${directoryRoute("all")}#recent-reading" data-directory-section="recent-reading"${current === "recent-reading" ? ' aria-current="page"' : ""}>最近阅读</a></nav>`;
  const themeButton = `<button class="theme-toggle" type="button" aria-label="切换深浅主题" aria-pressed="${theme === "dark"}"><span class="theme-icon">${themeIconMarkup(theme)}</span><span>${theme === "dark" ? "浅色模式" : "深色模式"}</span></button>`;
  return `<a class="skip-link" href="#main-content">跳到内容</a><header class="site-header${readerTools ? " reader-header" : ""}">
    ${readerTools ? `${readerTools}<div class="reader-site-links">${categories}${themeButton}</div><details class="reader-site-menu"><summary aria-label="站点分类与主题">站点</summary><div class="reader-site-popover"><a class="wordmark" href="${siteRoot}" aria-label="档案室首页"><span class="wordmark-mark">读</span><span>档案室</span></a>${categories}${themeButton}</div></details>` : `<a class="wordmark" href="${siteRoot}" aria-label="档案室首页"><span class="wordmark-mark">读</span><span>档案室</span></a>${categories}${themeButton}`}
  </header>${readerTools ? '<aside id="reader-search-navigation" hidden></aside>' : ""}`;
}

export function statusBadge(entry) {
  return `<span class="draft-state" data-status="${isDraft(entry) ? entry.reviewStatus : "published"}">${statusLabel(entry)}</span>`;
}

export function draftNotice() {
  return `<aside class="draft-notice" aria-label="未发布说明"><strong>未经正式发布，信息待核验</strong><p>这里展示已公开预览的编辑版本，内容可能继续修改。审核通过与正式发布分别记录，请结合来源使用。</p></aside>`;
}

export function reviewNotice() {
  return `<aside class="review-reference-notice" aria-label="校验参照说明"><strong>AI 初稿的固定校验参照</strong><p>这份稿件保留原文、整理稿、疑点、候选、依据和回看链接。当前编辑正文可能已有后续修改。“未经人工复核”描述基线生成时的情况，关联稿件的当前审核状态另行显示；这份参照不构成人工审核记录。</p></aside>`;
}

export function documentTabs(entry, mode) {
  return `<nav class="document-tabs" aria-label="稿件视图"><a href="${entryRoute(entry)}"${mode === "body" ? ' aria-current="page"' : ""}>正文</a><a href="${reviewRoute(entry)}"${mode === "review" ? ' aria-current="page"' : ""}>校验参照稿件</a></nav>`;
}

export function footer(label) {
  return `<footer class="site-footer"><span>档案室 · ${escapeHtml(label)}</span><a href="#top">回到顶部</a></footer>`;
}
