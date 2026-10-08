import catalog from "../content/catalog.json";
import { markdown } from "./markdown.js";
import { estimateReadingMinutes } from "./reading-time.js";
import "./site.css";

const markdownFiles = import.meta.glob("../content/articles/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const reviewFiles = import.meta.glob("../content/reviews/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const app = document.querySelector("#app");
const siteRoot = import.meta.env.BASE_URL;
const ISSUE_URL = "https://github.com/SuperCatQR/markdown-reading-site/issues/new";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const savedTheme = localStorage.getItem("reading-theme");
const state = {
  query: "",
  tag: "全部",
  theme: savedTheme || (themeMedia.matches ? "dark" : "light"),
  followsSystemTheme: !savedTheme,
  composingSearch: false,
};
const catalogEntries = Array.isArray(catalog)
  ? catalog.filter((entry) => entry && typeof entry === "object"
    && typeof entry.slug === "string" && typeof entry.title === "string"
    && typeof entry.date === "string" && typeof entry.summary === "string"
    && typeof entry.file === "string" && Array.isArray(entry.tags)
    && entry.tags.every((tag) => typeof tag === "string"))
  : [];
const REVIEW_LABELS = {
  "pending-review": "待审核",
  "in-review": "审核中",
  "changes-requested": "待修改",
  approved: "已通过",
  published: "已发布",
  rejected: "未采用",
  withdrawn: "已撤回",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function getArticleSource(entry) {
  return markdownFiles[`../content/articles/${entry.file}`];
}

function getReviewSource(entry) {
  return entry.reviewFile ? reviewFiles[`../content/reviews/${entry.reviewFile}`] : undefined;
}

function isSafeExternalUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function getIssueUrl(entry) {
  if (entry.issueUrl) return entry.issueUrl;
  const body = [
    "## 阅读稿",
    "",
    `- 稿件: \`${entry.slug}\``,
    `- 修订 ID: \`${entry.revisionId || "未登记"}\``,
    `- 原视频: ${entry.sourceUrl || "未登记"}`,
    "",
    "## 建议修改",
    "",
    "请指出段落或原句，写明建议内容与理由。",
    "",
  ].join("\n");
  return `${ISSUE_URL}?${new URLSearchParams({
    template: "review.md",
    title: `[阅读稿审核] ${entry.title}`,
    body,
  }).toString()}`;
}

function articleText(entry) {
  const source = getArticleSource(entry) || "";
  const review = getReviewSource(entry) || "";
  return `${entry.title} ${entry.summary} ${entry.tags.join(" ")} ${source} ${review}`.toLocaleLowerCase("zh-Hans");
}

const sortedCatalog = [...catalogEntries].sort((a, b) => b.date.localeCompare(a.date));
const searchIndex = new Map(sortedCatalog.map((entry) => [entry.slug, articleText(entry)]));

function filteredArticles() {
  return sortedCatalog
    .filter((entry) => state.tag === "全部" || entry.tags.includes(state.tag))
    .filter((entry) => searchIndex.get(entry.slug).includes(state.query.trim().toLocaleLowerCase("zh-Hans")));
}

function directoryResults(entries) {
  return entries.length ? `<section class="article-list" aria-label="阅读稿列表">${entries.map((entry, index) => `<article class="article-row"><span class="row-number">${String(index + 1).padStart(2, "0")}</span><div class="article-main"><div class="article-title-line"><a class="article-title" href="?read=${encodeURIComponent(entry.slug)}">${escapeHtml(entry.title)}</a>${entry.reviewStatus ? `<span class="review-state state-${escapeHtml(entry.reviewStatus)}">${REVIEW_LABELS[entry.reviewStatus]}</span>` : ""}</div><p class="article-summary">${escapeHtml(entry.summary)}</p><div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><time class="article-date" datetime="${escapeHtml(entry.date)}"><span>更新</span>${escapeHtml(entry.date.replaceAll("-", "."))}</time><span class="article-open" aria-hidden="true">↗</span></article>`).join("")}</section>` : `<section class="empty-state"><div class="empty-index">01 <span>—</span> 00</div><h2>${catalogEntries.length ? "没有找到匹配的稿件" : "还没有导入阅读稿"}</h2><p>${catalogEntries.length ? "试试其他关键词，或清除主题筛选。" : "从主项目导入数据库中的阅读稿后，会显示在这里。"}</p>${catalogEntries.length ? `<button class="reset-button" type="button" id="reset-filters">清除筛选</button>` : ""}</section>`;
}

function syncDirectoryResults() {
  const entries = filteredArticles();
  const results = app.querySelector("#directory-results");
  const resultCount = app.querySelector("#result-count");
  if (!results || !resultCount) return;
  results.innerHTML = directoryResults(entries);
  resultCount.innerHTML = `<strong>${entries.length}</strong> / ${catalogEntries.length} 篇阅读稿`;
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
    <nav class="top-nav" aria-label="主导航"><a class="active" href="${siteRoot}">阅读稿</a></nav>
    <button class="theme-toggle" type="button" aria-label="切换深浅主题" aria-pressed="${state.theme === "dark"}"><span class="theme-icon">${themeIcon}</span><span>${state.theme === "dark" ? "浅色模式" : "深色模式"}</span></button>
  </header>`;
}

function themeIconMarkup() {
  return state.theme === "dark"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"></path></svg>`;
}

function renderDirectory() {
  const tags = ["全部", ...new Set(catalogEntries.flatMap((entry) => entry.tags))];
  const entries = filteredArticles();
  app.innerHTML = `${header()}
    <main class="page-shell">
      <div class="page-heading">
        <div><p class="eyebrow">READING EDITIONS <span> / </span> 阅读稿</p><h1>阅读稿</h1></div>
        <p class="intro">待审核稿件与正式发布的阅读稿。</p>
      </div>
      <aside class="content-notice" aria-label="稿件说明"><strong>测试内容</strong><span>当前目录中的稿件均为测试用，内容和状态尚不稳定，后续会删除。</span></aside>
      <section class="directory-tools" aria-label="稿件筛选">
        <label class="search-box"><span class="search-label">搜索阅读稿</span><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标题、正文或标签" value="${escapeHtml(state.query)}" autocomplete="off" /><button id="clear-search" class="clear-search" type="button" aria-label="清空搜索"${state.query ? "" : " hidden"}>×</button><kbd>/</kbd></label>
        <details class="filter-menu" id="tag-filter-menu">
          <summary aria-label="按主题筛选" aria-controls="tag-filter-popover" aria-expanded="false"><span class="filter-label">主题</span><span class="filter-current">${escapeHtml(state.tag)}</span><span class="filter-chevron" aria-hidden="true">⌄</span></summary>
          <div class="filter-popover" id="tag-filter-popover">
            <label class="filter-search"><span class="search-label">搜索主题</span><span aria-hidden="true">⌕</span><input id="tag-search" type="search" placeholder="筛选主题" autocomplete="off" /></label>
            <div class="filter-options" role="listbox" aria-label="主题选项">${tags.map((tag) => `<button class="tag-option${state.tag === tag ? " selected" : ""}" type="button" role="option" aria-selected="${state.tag === tag}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}${state.tag === tag ? `<span aria-hidden="true">✓</span>` : ""}</button>`).join("")}</div>
            <p class="filter-hint">${tags.length - 1} 个主题</p>
          </div>
        </details>
        <p class="result-count" id="result-count"><strong>${entries.length}</strong> / ${catalogEntries.length} 篇阅读稿</p>
      </section>
      <div id="directory-results" aria-live="polite">${directoryResults(entries)}</div>
      <footer class="site-footer"><span>档案室 · 阅读稿</span><span>只读发布 · ${new Date().getFullYear()}</span></footer>
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

function renderArticle(entry, mode = "reading") {
  if (!entry) return renderNotFound();
  const isReview = mode === "review";
  const source = isReview ? getReviewSource(entry) : getArticleSource(entry);
  if (typeof source !== "string") return renderNotFound();
  const headings = [];
  const tokens = markdown.parse(source, {});
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "heading_open") continue;
    const inline = tokens[index + 1];
    const heading = inline?.content || "";
    const slug = `${slugHeading(heading)}-${headings.length + 1}`;
    tokens[index].attrSet("id", slug);
    headings.push({ slug, heading, level: Number(tokens[index].tag.slice(1)) });
  }
  const body = markdown.renderer.render(tokens, markdown.options, {});
  const viewSwitch = `<nav class="view-switch" aria-label="稿件视图"><a class="${isReview ? "" : "active"}" href="?read=${encodeURIComponent(entry.slug)}">阅读稿</a>${entry.reviewFile ? `<a class="${isReview ? "active" : ""}" href="?review=${encodeURIComponent(entry.slug)}">审核稿</a>` : ""}</nav>`;
  const contentNotice = `<aside class="content-notice" aria-label="稿件说明"><strong>测试内容</strong><span>当前稿件仅供测试，内容和状态尚不稳定，后续会删除。</span></aside>`;
  const reviewNotice = isReview ? `<aside class="review-notice"><strong>公开审核稿</strong><span>这里包含审核上下文与待核对内容，发现问题可直接提交 Issue。</span></aside>` : "";
  const issueUrl = getIssueUrl(entry);
  const sourceLink = isSafeExternalUrl(entry.sourceUrl) ? `<a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开原视频 <span aria-hidden="true">↗</span></a>` : "";
  app.innerHTML = `${header()}<div class="reading-progress" aria-hidden="true"><span></span></div><main class="reading-shell">
    <a class="back-link" href="${siteRoot}">返回全部阅读稿</a>
    <article class="reading-article"><header class="reading-heading">${viewSwitch}${contentNotice}${reviewNotice}<div class="review-heading-row"><div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${entry.reviewStatus ? `<span class="review-state state-${escapeHtml(entry.reviewStatus)}">${REVIEW_LABELS[entry.reviewStatus]}</span>` : ""}</div><h1>${escapeHtml(entry.title)}${isReview ? " · 审核稿" : ""}</h1><p class="reading-summary">${escapeHtml(entry.summary)}</p><div class="reading-meta"><time datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date.replaceAll("-", "."))}</time><span>${estimateReadingMinutes(source)} 分钟阅读</span>${sourceLink}<button class="copy-markdown" type="button">复制 Markdown</button></div><a class="issue-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${entry.issueUrl?.includes("/issues/new") || !entry.issueUrl ? "提交 Issue 建议修改" : "查看关联 Issue"} <span aria-hidden="true">→</span></a></header>
      ${headings.length ? `<nav class="table-of-contents" aria-label="文章目录"><h2>本文目录</h2><ol>${headings.map(({ slug, heading, level }) => `<li class="toc-level-${level}"><a href="#${encodeURIComponent(slug)}">${escapeHtml(heading)}</a></li>`).join("")}</ol></nav>` : ""}
      <div class="prose">${body}</div>
    </article><footer class="site-footer"><span>档案室 · 阅读稿</span><a href="#top" onclick="window.scrollTo({top:0,behavior:'smooth'});return false">回到顶部</a></footer>
  </main>`;
  app.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
  app.querySelector(".copy-markdown").addEventListener("click", (event) => copyMarkdown(source, event.currentTarget));
  updateReadingProgress();
}

function renderNotFound() {
  app.innerHTML = `${header()}<main class="page-shell"><section class="empty-state"><div class="empty-index">404 <span>—</span> ?</div><h1>没有找到这篇阅读稿</h1><p>它可能尚未发布，或地址已经更新。</p><a class="reset-button" href="${siteRoot}">返回稿件目录</a></section></main>`;
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
  const params = new URLSearchParams(location.search);
  const reviewSlug = params.get("review");
  const articleSlug = params.get("read");
  const selectedSlug = reviewSlug || articleSlug;
  const selectedEntry = catalogEntries.find((entry) => entry.slug === selectedSlug);
  selectedSlug ? (selectedEntry ? renderArticle(selectedEntry, reviewSlug ? "review" : "reading") : renderNotFound()) : renderDirectory();
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
