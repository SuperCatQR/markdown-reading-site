import { entryKey, isDraft, partLabel, partName, sourceLabel, statusLabel, workKey } from "./core/content.js";
import { routeHref } from "./core/router.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function icon(name) {
  const paths = { search: "M10.8 4.5a6.3 6.3 0 1 0 4.2 11l4 4", moon: "M20 15.3A8.3 8.3 0 0 1 8.7 4 8.3 8.3 0 1 0 20 15.3Z", sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0", arrow: "M5 12h14m-6-6 6 6-6 6", close: "M6 6l12 12M18 6 6 18" };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.search}"></path></svg>`;
}

export function appHeader({ route, theme }) {
  return `<header class="app-header"><a class="brand" href="#/library" aria-label="档案室资料库"><span class="brand-mark">读</span><span>档案室</span></a><nav class="app-nav" aria-label="主要导航"><a href="#/library"${["library", "search"].includes(route.name) ? " aria-current=\"page\"" : ""}>资料库</a><a href="#/recent"${route.name === "recent" ? " aria-current=\"page\"" : ""}>最近阅读</a></nav><button class="icon-button theme-button" type="button" data-action="theme" aria-label="切换深浅主题">${icon(theme === "dark" ? "sun" : "moon")}</button></header>`;
}

function statusChip(entry) {
  return `<span class="status-chip status-${escapeHtml(isDraft(entry) ? entry.reviewStatus : "published")}">${escapeHtml(statusLabel(entry))}</span>`;
}

function partResult(entry, hits, repository, { query = "", maxHits = 1 } = {}) {
  const firstHit = hits?.[0];
  const href = routeHref("read", { editionId: entry.editionId, block: firstHit?.id });
  const minutes = repository.summaries?.[entryKey(entry)]?.minutes || "";
  return `<li class="result-part"><a href="${href}" class="result-part-link"><span class="part-badge">${escapeHtml(partLabel(entry))}</span><span class="part-name">${escapeHtml(partName(entry))}</span><span class="result-action">阅读${firstHit ? "命中段落" : "正文"} ${icon("arrow")}</span></a><div class="result-part-meta">${statusChip(entry)}${minutes ? `<span>${minutes} 分钟</span>` : ""}</div>${firstHit ? `<p class="hit-excerpt">${highlight(firstHit.text, query)}</p>` : entry.summary ? `<p class="hit-excerpt">${escapeHtml(entry.summary)}</p>` : ""}${hits?.length > maxHits ? `<details class="more-hits"><summary>其余 ${hits.length - maxHits} 个命中段落</summary><ul>${hits.slice(maxHits).map((hit) => `<li><a href="${routeHref("read", { editionId: entry.editionId, block: hit.id })}">${highlight(hit.text, query)}</a></li>`).join("")}</ul></details>` : ""}</li>`;
}

function highlight(text, query) {
  const terms = String(query || "").trim().split(/\s+/u).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(text);
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return escapeHtml(text).replace(pattern, "<mark>$1</mark>");
}

function resultGroup(group, repository, query) {
  const parts = query ? group.parts.slice(0, 2) : group.parts.slice(0, group.parts.length > 1 ? 1 : 2);
  const remaining = Math.max(0, group.parts.length - parts.length);
  return `<article class="result-group"><header class="result-group-header"><span class="result-index">${escapeHtml(String(group.index).padStart(2, "0"))}</span><div><h2><a href="${routeHref("read", { editionId: parts[0]?.entry.editionId || group.parts[0].editionId, block: parts[0]?.hits?.[0]?.id })}">${escapeHtml(group.title)}</a></h2><p>${escapeHtml(sourceLabel(group.parts[0].entry))} · ${query ? `命中 ${group.parts.length} 个分 P` : `${group.parts.length} 个分 P`}</p></div></header><ol class="result-parts">${parts.map(({ entry, hits }) => partResult(entry, hits, repository, { query })).join("")}</ol>${remaining ? `<details class="more-parts"><summary>展开其余 ${remaining} 个命中分 P</summary><ol class="result-parts">${group.parts.slice(parts.length).map(({ entry, hits }) => partResult(entry, hits, repository, { query })).join("")}</ol></details>` : ""}</article>`;
}

function filters(route, entries) {
  const tags = [...new Set(entries.flatMap((entry) => entry.sourceMetadata?.tags || []))].sort((a, b) => a.localeCompare(b, "zh-Hans"));
  return `<div class="library-filters"><label class="compact-control"><span>范围</span><select data-filter="view"><option value="all"${route.view === "all" ? " selected" : ""}>全部内容</option><option value="drafts"${route.view === "drafts" ? " selected" : ""}>未发布</option><option value="published"${route.view === "published" ? " selected" : ""}>已发布</option></select></label>${tags.length ? `<label class="compact-control"><span>主题</span><select data-filter="tag"><option value=""${!route.tag ? " selected" : ""}>全部主题</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}"${route.tag === tag ? " selected" : ""}>${escapeHtml(tag)}</option>`).join("")}</select></label>` : ""}<details class="search-options"><summary>查找方式</summary><div class="search-mode-options"><label><input type="radio" name="search-mode" value="general"${route.mode === "general" ? " checked" : ""}>综合</label><label><input type="radio" name="search-mode" value="phrase"${route.mode === "phrase" ? " checked" : ""}>原句</label><label><input type="radio" name="search-mode" value="keywords"${route.mode === "keywords" ? " checked" : ""}>关键词</label></div></details></div>`;
}

export function libraryPage({ route, repository, groups, theme, history, loading = false, error = "", limit = 32 }) {
  const entries = repository.list(route.view || "all");
  const query = route.query || "";
  const videos = new Set(entries.map(workKey)).size;
  const primary = history[0] && repository.findEdition(history[0].editionId);
  const visibleGroups = groups.slice(0, limit);
  const intro = route.name === "search"
    ? `<section class="search-page-heading"><p class="eyebrow">全站搜索</p><h1>搜索文字资料</h1><p>按标题、概念或正文查找，结果保留真实分 P 和命中段落。</p></section>`
    : `<section class="library-intro"><p class="eyebrow">文字资料库</p><h1>找到一讲，顺着读下去。</h1><p>把视频讲解整理成可搜索、可连续阅读的文字资料。先找内容，再按自己的速度阅读；来源和稿件状态在需要时展开核验。</p><div class="library-stats"><strong>${videos.toLocaleString("zh-CN")}</strong> 个视频 <span aria-hidden="true">·</span> <strong>${entries.length.toLocaleString("zh-CN")}</strong> 篇稿件</div></section>`;
  const resume = route.name === "search" ? "" : primary ? `<aside class="resume-strip"><div><span class="eyebrow">继续阅读</span><strong>${escapeHtml(primary.title)}</strong><span>${escapeHtml(partLabel(primary))} · ${escapeHtml(statusLabel(primary))}</span></div><a class="text-link" href="${routeHref("read", { editionId: primary.editionId, block: history[0].anchor })}">继续上次阅读 ${icon("arrow")}</a></aside>` : "";
  return `${appHeader({ route, theme })}<main class="page ${route.name === "search" ? "search-page" : "library-page"}" id="main-content">${intro}<form class="primary-search" data-search-form><label for="global-search">查找文字资料</label><div class="search-field"><span>${icon("search")}</span><input id="global-search" name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索标题、概念或正文" autocomplete="off"><button type="submit">搜索</button></div></form>${filters(route, entries)}${resume}<section class="results-section" aria-live="polite"><div class="results-heading"><div><p class="eyebrow">${query ? "搜索结果" : "全部内容"}</p><h2>${query ? `与“${escapeHtml(query)}”相关` : "按视频浏览"}</h2></div><span class="result-total">${loading ? "正在查找…" : error ? "查找失败" : `${groups.length} 个视频`}</span></div>${error ? `<div class="inline-error" role="alert"><p>${escapeHtml(error)}</p><button type="button" data-action="retry-search">重新查找</button></div>` : loading ? `<div class="loading-state"><span></span><span></span><span></span></div>` : groups.length ? visibleGroups.map((group, index) => resultGroup({ ...group, index: index + 1 }, repository, query)).join("") + (groups.length > limit ? `<button class="load-more button-link" type="button" data-action="load-more">再显示 ${Math.min(32, groups.length - limit)} 个视频</button>` : "") : `<div class="empty-state"><h3>${query ? "没有找到匹配内容" : "暂无可阅读内容"}</h3><p>${query ? "尝试换一个概念，或改用综合查找。" : "公开快照准备好后，内容会出现在这里。"}</p></div>`}</section></main>`;
}

export function recentPage({ route, repository, state, theme }) {
  const records = state.history.map((record) => ({ record, entry: repository.findEdition(record.editionId) })).filter(({ entry }) => entry);
  return `${appHeader({ route, theme })}<main class="page recent-page" id="main-content"><section class="section-heading"><p class="eyebrow">个人状态</p><h1>最近阅读</h1><p>阅读位置只保存在当前浏览器。内容更新或撤回后，旧位置会明确标记为不可恢复。</p></section>${records.length ? `<ol class="recent-list">${records.map(({ record, entry }) => `<li><div><span class="eyebrow">${escapeHtml(partName(entry))} · ${escapeHtml(statusLabel(entry))}</span><strong>${escapeHtml(entry.title)}</strong><time>${new Date(record.readAt).toLocaleDateString("zh-CN")}</time></div><div class="recent-actions"><a href="${routeHref("read", { editionId: entry.editionId, block: record.anchor })}">继续阅读 ${icon("arrow")}</a><button type="button" data-remove-history="${escapeHtml(entry.editionId)}">删除</button></div></li>`).join("")}</ol><button class="quiet-button" type="button" data-action="clear-history">清空阅读记录</button>` : `<div class="empty-state"><h2>还没有阅读记录</h2><p>打开一篇正文，下一次回来时会从这里继续。</p><a class="button-link" href="#/library">浏览资料库 ${icon("arrow")}</a></div>`}</main>`;
}

export function readerPage({ route, repository, entry, parts, prepared, theme, tool = "", review = false, searchResults = [] }) {
  const isContinuous = route.flow && parts.length > 1;
  const titleMarkup = prepared.title || `<h1>${escapeHtml(entry.title)}</h1>`;
  const readingMinutes = repository.summaries?.[entryKey(entry)]?.minutes || "";
  const nav = `<header class="reader-header"><a class="reader-back" href="#/library">${icon("arrow")} <span>资料库</span></a><div class="reader-identity"><span>${escapeHtml(entry.title)}</span><strong>${escapeHtml(partName(entry))}</strong></div><nav class="reader-actions" aria-label="阅读操作"><a class="reader-mode${review ? " active" : ""}" href="${routeHref(review ? "verify" : "read", { editionId: entry.editionId, flow: isContinuous })}">${review ? "核验参照" : "正文"}</a>${parts.length > 1 ? `<a class="reader-mode${isContinuous ? " active" : ""}" href="${routeHref("read", { editionId: entry.editionId, flow: !isContinuous })}">${isContinuous ? "单篇阅读" : "连续阅读"}</a>` : ""}<button type="button" data-tool="parts"${parts.length < 2 ? " hidden" : ""}>目录</button><button type="button" data-tool="find">查找</button><button type="button" data-tool="more">更多</button></nav><button class="icon-button theme-button" type="button" data-action="theme" aria-label="切换深浅主题">${icon(theme === "dark" ? "sun" : "moon")}</button></header>`;
  const partNav = parts.length > 1 ? `<aside class="reader-parts"><p class="eyebrow">同视频目录 · ${parts.length} 个 P</p><ol>${parts.map((part) => `<li><a class="${part.editionId === entry.editionId ? "current" : ""}" href="${routeHref("read", { editionId: part.editionId, flow: isContinuous })}"><span>${escapeHtml(partLabel(part))}</span><span>${escapeHtml(partTitleOrFallback(part))}</span></a></li>`).join("")}</ol></aside>` : "";
  const details = tool === "parts" ? `<section class="tool-sheet"><h2>同视频目录</h2>${partNav || "<p>当前视频只有一个 P。</p>"}</section>` : tool === "find" ? `<section class="tool-sheet"><h2>查找当前正文</h2><form data-reader-search><input name="q" type="search" placeholder="输入词语"><button>查找</button></form><ol class="reader-search-results">${searchResults.map((hit) => `<li><a href="#${escapeHtml(hit.id)}" data-reader-block="${escapeHtml(hit.id)}">${escapeHtml(hit.text.slice(0, 90))}</a></li>`).join("")}</ol></section>` : tool === "more" ? `<section class="tool-sheet"><h2>阅读工具</h2><button type="button" data-tool="source">来源与版本</button><button type="button" data-tool="outline">本文导览</button><button type="button" data-tool="settings">排版</button><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开原视频</a></section>` : tool === "source" ? `<section class="tool-sheet"><h2>来源与版本</h2>${sourcePanel(entry)}</section>` : tool === "outline" ? `<section class="tool-sheet"><h2>本文导览</h2>${outlinePanel(prepared)}</section>` : tool === "settings" ? `<section class="tool-sheet settings-sheet"><h2>排版</h2><label>字号<select data-preference="size"><option value="17">17 px</option><option value="19">19 px</option><option value="21">21 px</option></select></label><label>行宽<select data-preference="width"><option value="620">窄</option><option value="760">标准</option><option value="920">宽</option></select></label></section>` : "";
  return `${nav}<div class="reader-layout">${partNav}<main class="page reader-page" id="main-content"><article class="reader-article"><header class="reader-title"><div class="reader-status">${statusChip(entry)}${review ? "<span>固定校验参照</span>" : isDraft(entry) ? "<span>公开预览 · 未经正式发布</span>" : ""}</div>${titleMarkup}<p>${escapeHtml(partName(entry))}${readingMinutes ? ` · ${readingMinutes} 分钟阅读` : ""}</p></header>${review ? `<p class="review-note">当前为固定校验参照。它保留原文、整理稿、疑点和回看链接，当前稿件审核状态另行显示。</p>` : ""}<div class="reader-prose">${prepared.body}</div><footer class="reader-end"><span>本部分读完了。</span>${parts.length > 1 ? `<a href="${routeHref("read", { editionId: entry.editionId, flow: true })}">进入连续阅读 ${icon("arrow")}</a>` : ""}<a href="#/library">返回资料库</a></footer></article></main></div>${details ? `<aside class="tool-drawer" data-tool-drawer>${details}<button type="button" class="drawer-close" data-action="close-tool">关闭</button></aside>` : ""}`;
}

function partTitleOrFallback(entry) { return entry.sourceMetadata?.partTitle || "分段标题未提供"; }

function sourcePanel(entry) {
  return `<dl class="source-facts"><dt>稿件状态</dt><dd>${escapeHtml(statusLabel(entry))}</dd><dt>原视频</dt><dd><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(entry))}</a></dd><dt>来源标题</dt><dd>${escapeHtml(entry.sourceMetadata.title)}</dd><dt>来源作者</dt><dd>${escapeHtml(entry.sourceMetadata.creatorName || "未知")}</dd><dt>整理方式</dt><dd>${escapeHtml(entry.attribution)}</dd><dt>Edition</dt><dd><code>${escapeHtml(entry.editionId)}</code></dd><dt>正文 SHA-256</dt><dd><code>${escapeHtml(entry.contentSha256)}</code></dd></dl>`;
}

function outlinePanel(prepared) {
  const blocks = prepared.blocks || [];
  if (!blocks.length) return "<p>当前正文没有可用的段落导览。</p>";
  return `<ol class="outline-list">${blocks.filter((_, index) => index < 30).map((block, index) => `<li><a href="#${escapeHtml(block.id)}" data-reader-block="${escapeHtml(block.id)}"><span>${index + 1}</span>${escapeHtml((block.text || "").slice(0, 64))}</a></li>`).join("")}</ol>`;
}
