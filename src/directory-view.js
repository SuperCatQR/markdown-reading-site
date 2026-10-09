import { entryKey, entryRoute, directoryRoute, videoRoute, groupVideos } from "./manuscripts.js";
import { contextSnippet, matchHash, searchModes, searchTerms } from "./search.js";
import { escapeHtml, highlightText, statusBadge, viewLabels, draftNotice, footer } from "./ui.js";

export function searchControls({ mode = "general" }) {
  return `<fieldset class="search-modes"><legend>查找方式</legend>${Object.entries(searchModes).map(([value, label]) => `<label><input type="radio" name="search-mode" value="${value}"${mode === value ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset><p class="search-help" id="search-help">${searchHelp(mode)}</p>`;
}

export function searchHelp(mode) {
  return mode === "keywords" ? "用空格分隔关键词；所有词须出现在同一篇正文，可分散于不同段落。同段命中更多关键词的结果优先。"
    : mode === "phrase" ? "按连续原句查找正文，忽略连续空白；标点不同可能无法命中。"
    : "查找标题、摘要、来源标签和正文，正文命中优先。";
}

export function directoryMarkup({ view, query, tag, tags, counts, videoCount, mode }) {
  const intro = view === "all" ? "把视频讲解读成文字，找到概念，顺着分 P 复习，回看原始来源。"
    : view === "drafts" ? "已公开预览的编辑版本，供阅读、核验与提出修改建议。" : "经过准确版本审核并正式发布的稿件，保留整理说明与视频来源。";
  return `<main id="main-content" class="page-shell" tabindex="-1">
    <div class="page-heading"><div><p class="eyebrow">阅读 · 查找 · 复习 · 核验</p><h1>${view === "all" ? "视频讲解，慢慢读。" : viewLabels[view]}</h1></div><p class="intro">${intro}</p></div>
    <div class="library-overview"><p><strong>${videoCount}</strong> 个视频 · <strong>${counts[view]}</strong> 篇稿件<span>按视频聚合，分 P 保留原顺序</span></p><a href="${directoryRoute(view === "drafts" ? "published" : "drafts")}">${view === "drafts" ? `已发布 ${counts.published} 篇` : `公开预览 ${counts.drafts} 篇`} →</a></div>
    ${view === "drafts" ? draftNotice() : view === "all" && counts.drafts ? `<aside class="library-notice" aria-label="内容状态说明">${counts.published === 0 ? "正式发布内容暂为空；目前可以阅读公开预览。" : "这里同时展示正式发布稿与公开预览。"}未发布稿逐篇标注审核状态，公开预览不代表审核通过。</aside>` : ""}
    <section class="directory-tools" aria-label="稿件筛选">
      <div class="search-box"><label class="search-label" for="search">搜索${viewLabels[view]}</label><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" maxlength="300" placeholder="搜索概念、标题或正文" value="${escapeHtml(query)}" autocomplete="off" /><button id="clear-search" type="button" class="clear-search" aria-label="清空搜索"${query ? "" : " hidden"}>×</button><kbd>/</kbd></div>
      <details class="filter-menu" id="tag-filter-menu"><summary aria-label="按主题筛选" aria-controls="tag-filter-popover" aria-expanded="false"><span class="filter-label">来源标签</span><span class="filter-current">${escapeHtml(tag)}</span><span class="filter-chevron" aria-hidden="true">⌄</span></summary>
      <div class="filter-popover" id="tag-filter-popover"><label class="filter-search"><span class="search-label">搜索主题</span><span aria-hidden="true">⌕</span><input id="tag-search" type="search" placeholder="筛选来源标签" autocomplete="off" /></label><div class="filter-options">${tags.map((item) => `<button class="tag-option${tag === item ? " selected" : ""}" type="button" aria-pressed="${tag === item}" data-tag="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div><p class="filter-hint">保留原视频标签，不推断分类</p></div></details>
      <p class="result-count" id="result-count" role="status"></p>
    </section>
    ${searchControls({ mode })}<div id="directory-results" aria-busy="true"></div>${footer(viewLabels[view])}</main>`;
}

function passageMarkup(entry, match, query, mode) {
  const terms = mode === "keywords" ? match.terms : [query];
  const snippets = [...new Set(terms.map((term) => contextSnippet(match.text, term)))];
  return `<li><a class="passage-link" href="${entryRoute(entry)}${matchHash(match, query, mode)}">${snippets.map((snippet) => `<span>${highlightText(snippet, terms)}</span>`).join("")}<span class="passage-action">阅读命中段落 →</span></a></li>`;
}

export function partMarkup({ entry, match, matches = [] }, { query = "", mode = "general", passages = [] }, summaries) {
  const summary = summaries[entryKey(entry)];
  const excerpt = match ? contextSnippet(match.text, query) : entry.summary;
  const label = match?.label || "编辑摘要";
  const evidence = matches.map((hit) => passageMarkup(entry, hit, query, mode));
  return `<li class="video-part"><div class="part-heading"><a class="part-link" href="${entryRoute(entry)}${matchHash(match, query, mode)}"><span class="part-number">P${entry.pageIndex + 1}</span><span>${match ? `阅读命中${match.id ? "段落" : "稿件"}` : "阅读正文"} →</span></a>${statusBadge(entry)}<span class="part-minutes">${summary.minutes} 分钟阅读</span></div>
    ${evidence.length ? `<p class="match-summary">${mode === "keywords" ? "全部关键词命中" : mode === "phrase" ? "原句匹配" : "正文命中"} · ${evidence.length} 个段落</p><ul class="passage-list">${evidence.slice(0, 2).join("")}</ul>${evidence.length > 2 ? `<details class="passage-disclosure" data-entry="${entryKey(entry)}"${passages.includes(entryKey(entry)) ? " open" : ""}><summary>其余 ${evidence.length - 2} 个命中段落</summary><ul class="passage-list">${evidence.slice(2).join("")}</ul></details>` : ""}` : excerpt ? `<p class="part-excerpt"><span class="excerpt-label">${label}</span>${highlightText(excerpt, searchTerms(query, mode))}</p>` : ""}</li>`;
}

export function directoryResults(matches, { view, query, visibleCount, expanded, counts, mode, passages }, summaries) {
  const groups = groupVideos(matches);
  if (!groups.length) {
    const hasContent = counts[view] > 0;
    return { count: 0, html: `<section class="empty-state"><h2>${hasContent ? "没有找到匹配的稿件" : view === "published" ? "暂无已发布稿件" : "暂无可阅读内容"}</h2><p>${hasContent ? "试试其他关键词，或清除来源标签筛选。" : view === "published" && counts.drafts ? "正式发布内容暂为空，可以先阅读明确标注状态的公开预览。" : "公开内容准备好后，会显示在这里。"}</p>${hasContent ? `<button class="reset-button" id="reset-filters" type="button">清除筛选</button>` : view === "published" && counts.drafts ? `<a class="reset-button" href="?view=drafts">阅读公开预览 →</a>` : ""}</section>` };
  }
  return { count: groups.length, html: `<section class="video-list" aria-label="${viewLabels[view]}视频列表">${groups.slice(0, visibleCount).map((group, index) => {
    const distinctParts = new Set(group.parts.map(({ entry }) => entry.pageIndex)).size;
    const body = `<ol class="video-parts">${group.parts.map((part) => partMarkup(part, { query, mode, passages }, summaries)).join("")}</ol>`;
    return `<article class="video-group"><header class="video-heading"><span class="video-number">${String(index + 1).padStart(2, "0")}</span><div><h2><a href="${videoRoute(group.bvid, view)}">${highlightText(group.title, searchTerms(query, mode))}</a></h2><p class="video-meta"><a href="${escapeHtml(group.parts[0].entry.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开原视频 ${escapeHtml(group.bvid)}">${escapeHtml(group.bvid)}</a><span>${query.trim() ? "命中" : "已收录"} ${distinctParts} 个分 P · ${group.parts.length} 篇稿件</span></p></div></header>
      ${group.parts.length > 1 && !query.trim() ? `<details class="parts-disclosure" data-video="${group.bvid}"${expanded.includes(group.bvid) ? " open" : ""}><summary>查看 ${distinctParts} 个分 P 与稿件状态</summary>${body}</details>` : body}</article>`;
  }).join("")}</section>${groups.length > visibleCount ? `<button class="load-more" type="button" id="load-more">再显示 ${Math.min(24, groups.length - visibleCount)} 个视频 · 还有 ${groups.length - visibleCount} 个</button>` : ""}` };
}
