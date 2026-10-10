import { entryKey, entryRoute, readerSearchRoute, groupVideos } from "./manuscripts.js";
import { contextSnippet, matchHash, searchModes, searchTerms, sortingHelp } from "./search.js";
import { escapeHtml, highlightText, statusBadge, viewLabels, footer } from "./ui.js";

export function searchControls({ mode = "general", sort = "body", directory = false }) {
  return `<details class="advanced-search" id="advanced-search"${mode !== "general" || (directory && sort !== "body") ? " open" : ""}><summary>高级查找<span class="search-mode-current">${searchModes[mode] || searchModes.general}</span>${directory ? `<span class="search-sort-current"${sort === "body" || mode !== "general" ? " hidden" : ""}>标题相关优先</span>` : ""}</summary>
    <fieldset class="search-modes"><legend>查找方式</legend>${Object.entries(searchModes).map(([value, label]) => `<label><input type="radio" name="search-mode" value="${value}"${mode === value ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset><p class="search-help" id="search-help">${searchHelp(mode)}</p>
    ${directory ? `<label class="search-sort" for="search-sort">结果排序<select id="search-sort" aria-describedby="sort-help"${mode !== "general" ? " disabled" : ""}><option value="body"${sort === "body" ? " selected" : ""}>正文证据优先</option><option value="title"${sort === "title" ? " selected" : ""}>标题相关优先</option></select></label>` : ""}</details>`;
}

export function searchHelp(mode) {
  return mode === "keywords" ? "用空格分隔关键词；所有词须出现在同一篇正文，可分散于不同段落。同段命中更多关键词的结果优先。"
    : mode === "phrase" ? "按连续原句查找正文，忽略连续空白；标点不同可能无法命中。"
    : "查找标题、摘要、原视频标签和正文；正文命中可直接打开对应段落。";
}

export function directoryMarkup({ view, query, tag, tags, counts, videoCount, mode, sort = "body" }) {
  const intro = view === "all" ? "视频讲解的文字资料，供阅读、查找与复习。"
    : view === "drafts" ? "公开预览的编辑版本，未经正式发布，信息待核验。" : "经过准确版本审核并正式发布的文字资料。";
  const status = counts.all === 0 ? "暂无公开内容"
    : counts.published === 0 ? "目前为公开预览"
    : counts.drafts === 0 ? "全部正式发布" : "发布稿与公开预览";
  return `<main id="main-content" class="page-shell directory-shell" tabindex="-1">
    <div class="page-heading"><h1>${view === "all" ? "视频讲解，慢慢读。" : viewLabels[view]}</h1><p class="intro">${intro}</p></div>
    <div class="library-overview"><p><strong>${videoCount}</strong> 个视频 · <strong>${counts[view]}</strong> 篇稿件</p><details class="library-status"><summary>${status}<span aria-hidden="true"> ⌄</span></summary><div class="library-status-body"><p>${counts.published === 0 ? "正式发布内容暂为空。" : `正式发布 ${counts.published} 篇。`}${counts.drafts ? `公开预览 ${counts.drafts} 篇；未发布稿逐篇标注审核状态，公开预览不代表审核通过。审核通过与正式发布分别记录。` : ""}</p><p>按视频聚合，分 P 保留来源顺序；来源与整理说明在各篇稿件中核验。</p></div></details></div>
    <section class="directory-tools" aria-label="稿件筛选">
      <div class="search-box"><label class="search-label" for="search">搜索${viewLabels[view]}</label><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" maxlength="300" placeholder="搜索概念、标题或正文" value="${escapeHtml(query)}" autocomplete="off" /><button id="clear-search" type="button" class="clear-search" aria-label="清空搜索"${query ? "" : " hidden"}>×</button><kbd>/</kbd></div>
      <details class="filter-menu" id="tag-filter-menu"><summary aria-label="按主题筛选" aria-controls="tag-filter-popover" aria-expanded="false"><span class="filter-label">按主题筛选</span><span class="filter-current">${escapeHtml(tag)}</span><span class="filter-chevron" aria-hidden="true">⌄</span></summary>
      <div class="filter-popover" id="tag-filter-popover"><label class="filter-search"><span class="search-label">搜索主题</span><span aria-hidden="true">⌕</span><input id="tag-search" type="search" placeholder="搜索主题标签" autocomplete="off" /></label><div class="filter-options">${tags.map((item) => `<button class="tag-option${tag === item ? " selected" : ""}" type="button" aria-pressed="${tag === item}" data-tag="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div><p class="filter-hint">主题来自原视频标签，保留源名称，不推断分类。</p></div></details>
      <p class="result-count" id="result-count" role="status"></p>
    </section>
    ${searchControls({ mode, sort, directory: true })}<p class="search-help directory-order" id="sort-help">${sortingHelp(mode, sort, query)}</p><div id="directory-results" aria-busy="true"></div>${footer(viewLabels[view])}</main>`;
}

function resultRoute(entry, match, request) {
  return request.query?.trim() ? `${readerSearchRoute(entry, request)}${matchHash(match, request.query, request.mode)}` : entryRoute(entry);
}

function passageMarkup(entry, match, query, mode, view, directory) {
  const terms = mode === "keywords" ? match.terms : [query];
  const snippets = [...new Set(terms.map((term) => contextSnippet(match.text, term)))];
  return `<li><a class="passage-link"${directory ? " data-directory-search" : ""} href="${escapeHtml(resultRoute(entry, match, { query, mode, view }))}">${snippets.map((snippet) => `<span>${highlightText(snippet, terms)}</span>`).join("")}<span class="passage-action">阅读命中段落 →</span></a></li>`;
}

export function partMarkup({ entry, match, matches = [] }, { query = "", mode = "general", view, passages = [], directory = false }, summaries) {
  const summary = summaries[entryKey(entry)];
  const excerpt = match ? contextSnippet(match.text, query) : entry.summary;
  const label = match?.label || "编辑摘要";
  const evidence = matches.map((hit) => passageMarkup(entry, hit, query, mode, view, directory));
  const firstBody = matches.find((hit) => hit.id) || (match?.id ? match : null);
  return `<li class="video-part"><div class="part-heading"><a class="part-link"${directory && query.trim() ? " data-directory-search" : ""} href="${escapeHtml(resultRoute(entry, firstBody, { query, mode, view }))}"><span class="part-number">P${entry.pageIndex + 1}</span><span>${match ? `阅读命中${match.id ? "段落" : "稿件"}` : "阅读正文"} →</span></a>${statusBadge(entry)}<span class="part-minutes">${summary.minutes} 分钟阅读</span></div>
    ${evidence.length ? `<p class="match-summary">${mode === "keywords" ? "全部关键词命中" : mode === "phrase" ? "原句匹配" : "正文命中"} · ${evidence.length} 个段落</p><ul class="passage-list">${evidence.slice(0, 2).join("")}</ul>${evidence.length > 2 ? `<details class="passage-disclosure" data-entry="${entryKey(entry)}"${passages.includes(entryKey(entry)) ? " open" : ""}><summary>其余 ${evidence.length - 2} 个命中段落</summary><ul class="passage-list">${evidence.slice(2).join("")}</ul></details>` : ""}` : excerpt ? `<p class="part-excerpt"><span class="excerpt-label">${label}</span>${highlightText(excerpt, searchTerms(query, mode))}</p>` : ""}</li>`;
}

export function directoryResults(matches, { view, query, visibleCount, expanded, counts, mode, passages }, summaries) {
  const groups = groupVideos(matches);
  if (!groups.length) {
    const hasContent = counts[view] > 0;
    return { count: 0, html: `<section class="empty-state"><h2>${hasContent ? "没有找到匹配的稿件" : view === "published" ? "暂无已发布稿件" : "暂无可阅读内容"}</h2><p>${hasContent ? "试试其他关键词，或清除主题筛选。" : view === "published" && counts.drafts ? "正式发布内容暂为空，可以先阅读明确标注状态的公开预览。" : "公开内容准备好后，会显示在这里。"}</p>${hasContent ? `<button class="reset-button" id="reset-filters" type="button">清除筛选</button>` : view === "published" && counts.drafts ? `<a class="reset-button" href="?view=drafts">阅读公开预览 →</a>` : ""}</section>` };
  }
  return { count: groups.length, html: `<section class="video-list" aria-label="${viewLabels[view]}视频列表">${groups.slice(0, visibleCount).map((group, index) => {
    const distinctParts = new Set(group.parts.map(({ entry }) => entry.pageIndex)).size;
    const body = `<ol class="video-parts">${group.parts.map((part) => partMarkup(part, { query, mode, view, passages, directory: true }, summaries)).join("")}</ol>`;
    const firstBodyPart = group.parts.find((part) => part.matches?.some((hit) => hit.id) || part.match?.id);
    const titlePart = firstBodyPart || group.parts[0];
    const titleMatch = titlePart.matches?.find((hit) => hit.id) || (titlePart.match?.id ? titlePart.match : null);
    const quantities = query.trim() ? `命中 ${distinctParts} 个分 P · ${group.parts.length} 篇稿件`
      : distinctParts > 1 ? `已收录 ${distinctParts} 个分 P${group.parts.length > distinctParts ? ` · ${group.parts.length} 个版本` : ""}`
      : group.parts.length > 1 ? `同一分 P · ${group.parts.length} 个版本` : "";
    const disclosure = distinctParts > 1 ? `查看 ${distinctParts} 个分 P 与稿件状态` : `查看 ${group.parts.length} 个版本与稿件状态`;
    return `<article class="video-group"><header class="video-heading"><span class="video-number">${String(index + 1).padStart(2, "0")}</span><div><h2><a${query.trim() ? " data-directory-search" : ""} href="${escapeHtml(resultRoute(titlePart.entry, titleMatch, { query, mode, view }))}">${highlightText(group.title, searchTerms(query, mode))}</a></h2><p class="video-meta"><a href="${escapeHtml(group.parts[0].entry.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开原视频 ${escapeHtml(group.bvid)}">原视频<span class="source-bvid">${escapeHtml(group.bvid)}</span></a>${quantities ? `<span>${quantities}</span>` : ""}</p></div></header>
      ${group.parts.length > 1 && !query.trim() ? `<details class="parts-disclosure" data-video="${group.bvid}"${expanded.includes(group.bvid) ? " open" : ""}><summary>${disclosure}</summary>${body}</details>` : body}</article>`;
  }).join("")}</section>${groups.length > visibleCount ? `<button class="load-more" type="button" id="load-more">再显示 ${Math.min(24, groups.length - visibleCount)} 个视频 · 还有 ${groups.length - visibleCount} 个</button>` : ""}` };
}
