import catalog from "../content/catalog.json";
import draftCatalog from "../draft-content/catalog.json";
import { isDraft, entryRoute, entryDate, REVIEW_LABELS, createReaderIndex, resolveReaderRoute, buildIssueUrl } from "./manuscripts.js";
import { markdown } from "./markdown.js";
import { estimateReadingMinutes } from "./reading-time.js";
import "./site.css";

const markdownFiles = import.meta.glob("../content/articles/part-*/publish.md", {
  eager: true, query: "?raw", import: "default",
});
const draftFiles = import.meta.glob("../draft-content/drafts/edition-*/preview.md", {
  eager: true, query: "?raw", import: "default",
});
const app = document.querySelector("#app");
const siteRoot = import.meta.env.BASE_URL;
const ISSUE_URL = "https://github.com/SuperCatQR/markdown-reading-site/issues/new";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const savedTheme = localStorage.getItem("reading-theme");
const state = {
  view: "published",
  query: "",
  tag: "全部",
  theme: savedTheme || (themeMedia.matches ? "dark" : "light"),
  followsSystemTheme: !savedTheme,
  composingSearch: false,
};
const indices = {
  published: createReaderIndex(catalog.articles, getArticleSource),
  drafts: createReaderIndex(draftCatalog.articles, getArticleSource),
};
const currentEntries = () => indices[state.view].entries;
const viewLabel = () => state.view === "drafts" ? "未发布稿件" : "发布稿";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function getArticleSource(entry) {
  return isDraft(entry) ? draftFiles[`../draft-content/${entry.file}`] : markdownFiles[`../content/${entry.file}`];
}

function getIssueUrl(entry) {
  return buildIssueUrl(entry, location.href, ISSUE_URL);
}

function filteredArticles() { return indices[state.view].filter(state); }

function draftNotice() {
  return `<aside class="draft-notice" aria-label="未发布说明"><strong>未经正式发布，信息待核验</strong><p>这里展示当前编辑版本，内容可能继续修改。审核状态与正式发布分别记录。</p></aside>`;
}

function manuscriptTabs() {
  return `<nav class="manuscript-tabs" aria-label="稿件分类"><a href="${siteRoot}"${state.view === "published" ? ' aria-current="page"' : ""}>已发布 <span>${catalog.articles.length}</span></a><a href="?view=drafts"${state.view === "drafts" ? ' aria-current="page"' : ""}>未发布 <span>${draftCatalog.articles.length}</span></a></nav>`;
}

function directoryResults(entries) {
  return entries.length ? `<section class="article-list" aria-label="${viewLabel()}列表">${entries.map((entry, index) => {
    const date = entryDate(entry);
    return `<article class="article-row"><span class="row-number">${String(index + 1).padStart(2, "0")}</span><div class="article-main"><div class="article-title-line"><a class="article-title" href="${entryRoute(entry)}">${escapeHtml(entry.title)}</a>${isDraft(entry) ? `<span class="draft-state" data-status="${entry.reviewStatus}">${REVIEW_LABELS[entry.reviewStatus]}</span>` : ""}</div><p class="article-summary">${escapeHtml(entry.summary)}</p><div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><time class="article-date" datetime="${date}"><span>${isDraft(entry) ? "创建" : "发布"}</span>${date.replaceAll("-", ".")}</time><span class="article-open" aria-hidden="true">↗</span></article>`;
  }).join("")}</section>` : `<section class="empty-state"><div class="empty-index">01 <span>—</span> 00</div><h2>${currentEntries().length ? "没有找到匹配的稿件" : state.view === "drafts" ? "暂无未发布稿件" : "暂无已发布稿件"}</h2><p>${currentEntries().length ? "试试其他关键词，或清除主题筛选。" : state.view === "drafts" ? "当前编辑版本导入后，会显示在这里。" : "正式发布的稿件导入后，会显示在这里。"}</p>${currentEntries().length ? `<button class="reset-button" type="button" id="reset-filters">清除筛选</button>` : ""}</section>`;
}

function syncDirectoryResults() {
  const entries = filteredArticles();
  const results = app.querySelector("#directory-results");
  const resultCount = app.querySelector("#result-count");
  if (!results || !resultCount) return;
  results.innerHTML = directoryResults(entries);
  resultCount.innerHTML = `<strong>${entries.length}</strong> / ${currentEntries().length} 篇${viewLabel()}`;
  const clearButton = app.querySelector("#clear-search");
  if (clearButton) clearButton.hidden = !state.query;
  app.querySelector("#reset-filters")?.addEventListener("click", () => {
    state.query = "";
    state.tag = "全部";
    renderDirectory();
  });
}

function header() {
  const themeIcon = themeIconMarkup();
  return `<header class="site-header">
    <a class="wordmark" href="${siteRoot}" aria-label="档案室首页"><span class="wordmark-mark">读</span><span>档案室</span></a>
    <nav class="top-nav" aria-label="主导航"><a class="active" href="${siteRoot}">稿件</a></nav>
    <button class="theme-toggle" type="button" aria-label="切换深浅主题" aria-pressed="${state.theme === "dark"}"><span class="theme-icon">${themeIcon}</span><span>${state.theme === "dark" ? "浅色模式" : "深色模式"}</span></button>
  </header>`;
}

function themeIconMarkup() {
  return state.theme === "dark"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"></path></svg>`;
}

function renderDirectory() {
  const tags = ["全部", ...new Set(currentEntries().flatMap((entry) => entry.tags))];
  const entries = filteredArticles();
  app.innerHTML = `${header()}
    <main class="page-shell">
      <div class="page-heading">
        <div><p class="eyebrow">${state.view === "drafts" ? "DRAFT EDITIONS" : "PUBLISHED EDITIONS"} <span> / </span> ${viewLabel()}</p><h1>${viewLabel()}</h1></div>
        <p class="intro">${state.view === "drafts" ? "当前编辑版本，供阅读与提出修改建议。" : "经过准确版本审核并正式发布的稿件。"}</p>
      </div>
      ${manuscriptTabs()}
      ${state.view === "drafts" ? draftNotice() : ""}
      <section class="directory-tools" aria-label="稿件筛选">
        <label class="search-box"><span class="search-label">搜索${viewLabel()}</span><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标题、正文或标签" value="${escapeHtml(state.query)}" autocomplete="off" /><button id="clear-search" class="clear-search" type="button" aria-label="清空搜索"${state.query ? "" : " hidden"}>×</button><kbd>/</kbd></label>
        <details class="filter-menu" id="tag-filter-menu">
          <summary aria-label="按主题筛选" aria-controls="tag-filter-popover" aria-expanded="false"><span class="filter-label">主题</span><span class="filter-current">${escapeHtml(state.tag)}</span><span class="filter-chevron" aria-hidden="true">⌄</span></summary>
          <div class="filter-popover" id="tag-filter-popover">
            <label class="filter-search"><span class="search-label">搜索主题</span><span aria-hidden="true">⌕</span><input id="tag-search" type="search" placeholder="筛选主题" autocomplete="off" /></label>
            <div class="filter-options" role="listbox" aria-label="主题选项">${tags.map((tag) => `<button class="tag-option${state.tag === tag ? " selected" : ""}" type="button" role="option" aria-selected="${state.tag === tag}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}${state.tag === tag ? `<span aria-hidden="true">✓</span>` : ""}</button>`).join("")}</div>
            <p class="filter-hint">${tags.length - 1} 个主题</p>
          </div>
        </details>
        <p class="result-count" id="result-count"><strong>${entries.length}</strong> / ${currentEntries().length} 篇${viewLabel()}</p>
      </section>
      <div id="directory-results" aria-live="polite">${directoryResults(entries)}</div>
      <footer class="site-footer"><span>档案室 · ${viewLabel()}</span><span>只读发布 · ${new Date().getFullYear()}</span></footer>
    </main>`;

  app.querySelector("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    if (state.composingSearch) return;
    syncDirectoryResults();
  });
  app.querySelector("#search").addEventListener("compositionstart", () => { state.composingSearch = true; });
  app.querySelector("#search").addEventListener("compositionend", (event) => {
    state.composingSearch = false;
    state.query = event.target.value;
    syncDirectoryResults();
  });
  app.querySelector("#clear-search").addEventListener("click", () => {
    state.query = "";
    const input = app.querySelector("#search");
    input.value = "";
    syncDirectoryResults();
    input.focus();
  });
  app.querySelector("#tag-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("zh-Hans");
    app.querySelectorAll(".tag-option").forEach((option) => {
      option.hidden = query && !option.dataset.tag.toLocaleLowerCase("zh-Hans").includes(query);
    });
  });
  app.querySelectorAll(".tag-option").forEach((option) => option.addEventListener("click", () => {
    state.tag = option.dataset.tag;
    renderDirectory();
  }));
  app.querySelector("#tag-filter-menu").addEventListener("toggle", (event) => {
    event.target.querySelector("summary")?.setAttribute("aria-expanded", String(event.target.open));
  });
  app.querySelector("#reset-filters")?.addEventListener("click", () => {
    state.query = "";
    state.tag = "全部";
    renderDirectory();
  });
  app.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
}

function slugHeading(text) {
  return text.toLocaleLowerCase("zh-Hans").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
}

async function copyMarkdown(source, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(source);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = source;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
      textarea.remove();
    }
    button.textContent = "已复制 Markdown";
    button.classList.add("copied");
    window.setTimeout(() => {
      button.textContent = "复制 Markdown";
      button.classList.remove("copied");
    }, 1800);
  } catch {
    button.textContent = "复制失败，请手动复制";
    window.setTimeout(() => { button.textContent = "复制 Markdown"; }, 2200);
  }
}

function renderArticle(entry) {
  const source = entry && getArticleSource(entry);
  if (typeof source !== "string") return renderNotFound();
  const tokens = markdown.parse(source, {});
  const headings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "heading_open") continue;
    const heading = tokens[index + 1]?.content || "";
    const slug = `${slugHeading(heading)}-${headings.length + 1}`;
    tokens[index].attrSet("id", slug);
    headings.push({ slug, heading, level: Number(tokens[index].tag.slice(1)) });
  }
  // Render the complete frozen document, with its opening title displayed once.
  const hasOpeningTitle = tokens[0]?.type === "heading_open" && tokens[0].tag === "h1";
  const title = hasOpeningTitle ? markdown.renderer.render(tokens.slice(0, 3), markdown.options, {}) : "";
  const body = markdown.renderer.render(hasOpeningTitle ? tokens.slice(3) : tokens, markdown.options, {});
  const toc = headings.filter(({ level }) => level > 1);
  const date = entryDate(entry);
  const draft = isDraft(entry);
  app.innerHTML = `${header()}<div class="reading-progress" aria-hidden="true"><span></span></div><main class="reading-shell"><a class="back-link" href="${draft ? "?view=drafts" : siteRoot}">返回全部${draft ? "未发布稿件" : "发布稿"}</a>
    ${manuscriptTabs()}
    <article class="reading-article"><header class="reading-heading">${draft ? draftNotice() : ""}<div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${draft ? `<p class="draft-status">${REVIEW_LABELS[entry.reviewStatus]}</p>` : ""}${title}
      <div class="reading-meta"><time datetime="${date}">${draft ? "创建于" : "发布于"} ${date.replaceAll("-", ".")}</time><span>${estimateReadingMinutes(source)} 分钟阅读</span><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.bvid)} · P${entry.pageIndex + 1} <span aria-hidden="true">↗</span></a><button class="copy-markdown" type="button">复制 Markdown</button></div>
      <details class="release-details"><summary>${draft ? "编辑版本" : "发布版本"}</summary><dl>${draft ? "" : `<dt>Release</dt><dd>${entry.releaseId}</dd>`}<dt>Edition</dt><dd>${entry.editionId}</dd><dt>AI Revision</dt><dd>${entry.aiRevisionId}</dd><dt>内容 SHA-256</dt><dd>${entry.contentSha256}</dd></dl></details>
      <a class="issue-link" href="${escapeHtml(getIssueUrl(entry))}" target="_blank" rel="noopener noreferrer">建议修改 <span aria-hidden="true">→</span></a></header>
      ${toc.length ? `<nav class="table-of-contents" aria-label="文章目录"><h2>本文目录</h2><ol>${toc.map(({ slug, heading, level }) => `<li class="toc-level-${level}"><a href="#${encodeURIComponent(slug)}">${escapeHtml(heading)}</a></li>`).join("")}</ol></nav>` : ""}
      <div class="prose">${body}</div>
    </article><footer class="site-footer"><span>档案室 · ${viewLabel()}</span><a href="#top" onclick="window.scrollTo({top:0,behavior:'smooth'});return false">回到顶部</a></footer></main>`;
  app.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
  app.querySelector(".copy-markdown").addEventListener("click", (event) => copyMarkdown(source, event.currentTarget));
  updateReadingProgress();
}

function renderNotFound() {
  app.innerHTML = `${header()}<main class="page-shell"><section class="empty-state"><div class="empty-index">404 <span>—</span> ?</div><h1>没有找到这篇稿件</h1><p>它可能尚未导入，或已更新、撤回。</p><a class="reset-button" href="${siteRoot}">返回稿件目录</a></section></main>`;
  app.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  state.followsSystemTheme = false;
  localStorage.setItem("reading-theme", state.theme);
  applyTheme();
  updateThemeToggle();
}

function updateThemeToggle() {
  app.querySelectorAll(".theme-toggle").forEach((button) => {
    button.setAttribute("aria-pressed", String(state.theme === "dark"));
    button.querySelector(".theme-icon").innerHTML = themeIconMarkup();
    button.querySelector("span:last-child").textContent = state.theme === "dark" ? "浅色模式" : "深色模式";
  });
}

function renderCurrentRoute() {
  const route = resolveReaderRoute(location.search, catalog.articles, draftCatalog.articles);
  if (route.kind === "missing") return renderNotFound();
  if (state.view !== route.view) { state.query = ""; state.tag = "全部"; state.composingSearch = false; }
  state.view = route.view;
  route.kind === "article" ? renderArticle(route.entry) : renderDirectory();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === "dark" ? "#191817" : "#faf9f7";
}

function updateReadingProgress() {
  const progress = document.querySelector(".reading-progress span");
  if (!progress) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
  progress.style.transform = `scaleX(${ratio})`;
}

function focusSearchShortcut(event) {
  const activeElement = document.activeElement;
  const isEditable = activeElement?.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT", "SUMMARY", "BUTTON"].includes(activeElement?.tagName);
  if (event.key === "/" && !isEditable) {
    event.preventDefault();
    app.querySelector("#search")?.focus();
  }
}

function navigateWithoutReload(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a");
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
  if (url.hash && url.search === window.location.search) return;
  event.preventDefault();
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  renderCurrentRoute();
  window.scrollTo({ top: 0, behavior: "auto" });
}

applyTheme();
document.addEventListener("click", navigateWithoutReload);
window.addEventListener("popstate", () => {
  renderCurrentRoute();
  window.scrollTo({ top: 0, behavior: "auto" });
});
document.addEventListener("keydown", focusSearchShortcut);
document.addEventListener("scroll", updateReadingProgress, { passive: true });
themeMedia.addEventListener("change", (event) => {
  if (!state.followsSystemTheme) return;
  state.theme = event.matches ? "dark" : "light";
  applyTheme();
  updateThemeToggle();
});
renderCurrentRoute();
