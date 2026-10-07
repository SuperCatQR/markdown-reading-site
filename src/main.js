import catalog from "../content/catalog.json";
import { markdown } from "./markdown.js";
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
};
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

function filteredArticles() {
  return [...catalog]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((entry) => state.tag === "全部" || entry.tags.includes(state.tag))
    .filter((entry) => articleText(entry).includes(state.query.trim().toLocaleLowerCase("zh-Hans")));
}

function header() {
  return `<header class="site-header">
    <a class="wordmark" href="${siteRoot}" aria-label="档案室首页"><span class="wordmark-mark">读</span><span>档案室</span></a>
    <nav class="top-nav" aria-label="主导航"><a class="active" href="${siteRoot}">阅读稿</a></nav>
    <button class="theme-toggle" type="button" aria-label="切换深浅主题">${state.theme === "dark" ? "浅色模式" : "深色模式"}</button>
  </header>`;
}

function renderDirectory() {
  const tags = ["全部", ...new Set(catalog.flatMap((entry) => entry.tags))];
  const entries = filteredArticles();
  app.innerHTML = `${header()}
    <main class="page-shell">
      <div class="page-heading">
        <div><p class="eyebrow">READING EDITIONS <span> / </span> 阅读稿</p><h1>阅读稿</h1></div>
        <p class="intro">待审核稿件与正式发布的阅读稿。</p>
      </div>
      <section class="directory-tools" aria-label="稿件筛选">
        <label class="search-box"><span class="search-label">搜索阅读稿</span><input id="search" type="search" placeholder="搜索标题、正文或标签" value="${escapeHtml(state.query)}" autocomplete="off" /><kbd>/</kbd></label>
        <label class="filter-select"><span>主题</span><select id="tag-filter" aria-label="按主题筛选">${tags.map((tag) => `<option value="${escapeHtml(tag)}"${state.tag === tag ? " selected" : ""}>${escapeHtml(tag)}</option>`).join("")}</select></label>
        <p class="result-count">${entries.length} 篇阅读稿</p>
      </section>
      ${entries.length ? `<section class="article-list" aria-label="阅读稿列表">${entries.map((entry, index) => `<article class="article-row"><span class="row-number">${String(index + 1).padStart(2, "0")}</span><div class="article-main"><div class="article-title-line"><a class="article-title" href="?read=${encodeURIComponent(entry.slug)}">${escapeHtml(entry.title)}</a>${entry.reviewStatus ? `<span class="review-state state-${escapeHtml(entry.reviewStatus)}">${REVIEW_LABELS[entry.reviewStatus]}</span>` : ""}</div><p class="article-summary">${escapeHtml(entry.summary)}</p><div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><time class="article-date" datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date.replaceAll("-", "."))}</time></article>`).join("")}</section>` : `<section class="empty-state"><div class="empty-index">01 <span>—</span> 00</div><h2>${catalog.length ? "没有找到匹配的稿件" : "还没有导入阅读稿"}</h2><p>${catalog.length ? "试试其他关键词，或清除主题筛选。" : "从主项目导入数据库中的阅读稿后，会显示在这里。"}</p>${catalog.length ? `<button class="reset-button" type="button" id="reset-filters">清除筛选</button>` : ""}</section>`}
      <footer class="site-footer"><span>档案室 · 阅读稿</span><span>只读发布 · ${new Date().getFullYear()}</span></footer>
    </main>`;

  app.querySelector("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    const cursor = event.target.selectionStart;
    renderDirectory();
    const input = app.querySelector("#search");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  });
  app.querySelector("#tag-filter").addEventListener("change", (event) => {
    state.tag = event.target.value;
    renderDirectory();
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
  const reviewNotice = isReview ? `<aside class="review-notice"><strong>公开审核稿</strong><span>这里包含审核上下文与待核对内容，发现问题可直接提交 Issue。</span></aside>` : "";
  const issueUrl = getIssueUrl(entry);
  app.innerHTML = `${header()}<main class="reading-shell">
    <a class="back-link" href="${siteRoot}">返回全部阅读稿</a>
    <article class="reading-article"><header class="reading-heading">${viewSwitch}${reviewNotice}<div class="review-heading-row"><div class="article-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${entry.reviewStatus ? `<span class="review-state state-${escapeHtml(entry.reviewStatus)}">${REVIEW_LABELS[entry.reviewStatus]}</span>` : ""}</div><h1>${escapeHtml(entry.title)}${isReview ? " · 审核稿" : ""}</h1><p class="reading-summary">${escapeHtml(entry.summary)}</p><div class="reading-meta"><time datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date.replaceAll("-", "."))}</time><span>${Math.max(1, Math.ceil(source.trim().split(/\s+/).length / 400))} 分钟阅读</span><a href="${escapeHtml(entry.sourceUrl || "#")}" target="_blank" rel="noopener noreferrer">打开原视频</a></div><a class="issue-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${entry.issueUrl?.includes("/issues/new") || !entry.issueUrl ? "提交 Issue 建议修改" : "查看关联 Issue"}</a></header>
      ${headings.length ? `<nav class="table-of-contents" aria-label="文章目录"><h2>本文目录</h2><ol>${headings.map(({ slug, heading, level }) => `<li class="toc-level-${level}"><a href="#${encodeURIComponent(slug)}">${escapeHtml(heading)}</a></li>`).join("")}</ol></nav>` : ""}
      <div class="prose">${body}</div>
    </article><footer class="site-footer"><span>档案室 · 阅读稿</span><a href="#top" onclick="window.scrollTo({top:0,behavior:'smooth'});return false">回到顶部</a></footer>
  </main>`;
  app.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
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
  renderCurrentRoute();
}

function renderCurrentRoute() {
  const params = new URLSearchParams(location.search);
  const reviewSlug = params.get("review");
  const articleSlug = params.get("read");
  const selectedSlug = reviewSlug || articleSlug;
  const selectedEntry = catalog.find((entry) => entry.slug === selectedSlug);
  selectedSlug ? (selectedEntry ? renderArticle(selectedEntry, reviewSlug ? "review" : "reading") : renderNotFound()) : renderDirectory();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === "dark" ? "#171816" : "#f7f7f4";
}

function focusSearchShortcut(event) {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    app.querySelector("#search")?.focus();
  }
}

applyTheme();
document.addEventListener("keydown", focusSearchShortcut);
themeMedia.addEventListener("change", (event) => {
  if (!state.followsSystemTheme) return;
  state.theme = event.matches ? "dark" : "light";
  applyTheme();
  renderCurrentRoute();
});
renderCurrentRoute();
