import { entryKey, isDraft, partLabel, partName, sourceLabel, statusLabel } from "./core/content.js";
import { routeHref } from "./core/router.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function icon(name) {
  const paths = { search: "M10.8 4.5a6.3 6.3 0 1 0 4.2 11l4 4", moon: "M20 15.3A8.3 8.3 0 0 1 8.7 4 8.3 8.3 0 1 0 20 15.3Z", sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0", arrow: "M5 12h14m-6-6 6 6-6 6", close: "M6 6l12 12M18 6 6 18" };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.search}"></path></svg>`;
}

export function appHeader({ route, theme }) {
  return `<header class="app-header"><button type="button" class="skip-link" data-action="skip-content">跳到内容</button><a class="brand" href="#/library" aria-label="档案室资料库"><span class="brand-mark">读</span><span>档案室</span></a><nav class="app-nav" aria-label="主要导航"><a href="#/library"${["library", "search"].includes(route.name) ? " aria-current=\"page\"" : ""}>资料库</a><a href="#/recent"${route.name === "recent" ? " aria-current=\"page\"" : ""}>最近阅读</a></nav><button class="icon-button theme-button" type="button" data-action="theme" aria-label="切换深浅主题">${icon(theme === "dark" ? "sun" : "moon")}</button></header>`;
}

function statusChip(entry) {
  return `<span class="status-chip status-${escapeHtml(isDraft(entry) ? entry.reviewStatus : "published")}">${escapeHtml(statusLabel(entry))}</span>`;
}

function partResult(entry, hits, repository, { query = "", maxHits = 1 } = {}) {
  const firstHit = hits?.[0];
  const href = routeHref("read", { editionId: entry.editionId, block: firstHit?.id });
  const minutes = repository.summaries?.[entryKey(entry)]?.minutes || "";
  return `<li class="result-part"><a href="${href}" class="result-part-link"><span class="part-badge">${escapeHtml(partLabel(entry))}</span><span class="part-name">${escapeHtml(partName(entry))}</span><span class="result-action">阅读${firstHit ? "命中段落" : "正文"} ${icon("arrow")}</span></a><div class="result-part-meta">${statusChip(entry)}${minutes ? `<span>${minutes} 分钟</span>` : ""}</div>${firstHit ? `<p class="hit-excerpt">${highlight(firstHit.text, query)}</p>` : entry.summary ? `<p class="hit-excerpt">${escapeHtml(entry.summary)}</p>` : ""}${hits?.length > maxHits ? `<details class="more-hits"><summary>其余 ${hits.length - maxHits} 个${query ? "命中 " : ""}段落</summary><ul>${hits.slice(maxHits).map((hit) => `<li><a href="${routeHref("read", { editionId: entry.editionId, block: hit.id })}">${highlight(hit.text, query)}</a></li>`).join("")}</ul></details>` : ""}</li>`;
}

export function highlight(text, query) {
  const value = String(text ?? "");
  const terms = String(query || "").trim().split(/\s+/u).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(value);
  const pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
  let cursor = 0;
  let html = "";
  for (const match of value.matchAll(pattern)) {
    html += `${escapeHtml(value.slice(cursor, match.index))}<mark>${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(value.slice(cursor));
}

function resultGroup(group, repository, query) {
  const ordered = [...group.parts].sort((a, b) => (a.entry.partIndex - b.entry.partIndex) || Number(isDraft(a.entry)) - Number(isDraft(b.entry)));
  // Search previews use relevance for the first two P, while expansion remains
  // in the source's P order. A stable P-index tie break keeps the result
  // deterministic when multiple passages receive the same score.
  const preview = query
    ? [...ordered].sort((a, b) => (Number(b.score || 0) - Number(a.score || 0))
      || (a.entry.partIndex - b.entry.partIndex) || Number(isDraft(a.entry)) - Number(isDraft(b.entry))).slice(0, 2)
    : ordered.slice(0, ordered.length > 1 ? 1 : 2);
  const selected = new Set(preview.map(({ entry }) => entry.editionId));
  const remainingParts = ordered.filter(({ entry }) => !selected.has(entry.editionId));
  return `<article class="result-group"><header class="result-group-header"><span class="result-index">${escapeHtml(String(group.index).padStart(2, "0"))}</span><div><h2><a href="${routeHref("read", { editionId: preview[0]?.entry.editionId || ordered[0].entry.editionId, block: preview[0]?.hits?.[0]?.id })}">${escapeHtml(group.title)}</a></h2><p>${sourceLink(ordered[0].entry)} · ${query ? `命中 ${group.parts.length} 个分 P` : `${group.parts.length} 个分 P`}</p></div></header><ol class="result-parts">${preview.map(({ entry, hits }) => partResult(entry, hits, repository, { query })).join("")}</ol>${remainingParts.length ? `<details class="more-parts"><summary>展开其余 ${remainingParts.length} 个${query ? "命中 " : ""}分 P</summary><ol class="result-parts">${remainingParts.map(({ entry, hits }) => partResult(entry, hits, repository, { query })).join("")}</ol></details>` : ""}</article>`;
}

function sourceLink(entry) {
  const platform = entry.platform === "youtube" ? "YouTube" : "哔哩哔哩";
  const href = entry.sourceUrl || (entry.platform === "youtube"
    ? `https://www.youtube.com/watch?v=${entry.externalVideoId}`
    : `https://www.bilibili.com/video/${entry.externalVideoId}/?p=${entry.partIndex + 1}`);
  return `${escapeHtml(platform)} · <a class="source-id-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.externalVideoId)}</a>`;
}

function filters(route, entries) {
  const tags = [...new Set(entries.flatMap((entry) => entry.sourceMetadata?.tags || []))].sort((a, b) => a.localeCompare(b, "zh-Hans"));
  return `<div class="library-filters"><label class="compact-control"><span>范围</span><select data-filter="view"><option value="all"${route.view === "all" ? " selected" : ""}>全部内容</option><option value="drafts"${route.view === "drafts" ? " selected" : ""}>未发布</option><option value="published"${route.view === "published" ? " selected" : ""}>已发布</option></select></label>${tags.length ? `<label class="compact-control"><span>主题</span><select data-filter="tag"><option value=""${!route.tag ? " selected" : ""}>全部主题</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}"${route.tag === tag ? " selected" : ""}>${escapeHtml(tag)}</option>`).join("")}</select></label>` : ""}<label class="compact-control"><span>排序</span><select data-filter="sort"${!route.query || route.mode !== "general" ? ' disabled title="综合查找有结果时可按标题相关性排序"' : ''}><option value="relevance"${(route.sort || "relevance") === "relevance" ? " selected" : ""}>正文证据优先</option><option value="title"${route.sort === "title" ? " selected" : ""}>标题相关优先</option></select></label><details class="search-options" open><summary>查找方式</summary><div class="search-mode-options" aria-label="查找方式"><label><input type="radio" name="search-mode" value="general"${route.mode === "general" ? " checked" : ""}>综合</label><label><input type="radio" name="search-mode" value="phrase"${route.mode === "phrase" ? " checked" : ""}>原句</label><label><input type="radio" name="search-mode" value="keywords"${route.mode === "keywords" ? " checked" : ""}>关键词</label></div><p class="tool-help">${route.mode === "keywords" ? "所有关键词须在同一篇正文中出现，可以分布于不同段落。" : route.mode === "phrase" ? "只查找正文中的连续原句，忽略大小写和多余空格。" : "比较正文证据、标题、摘要和来源标签。"}</p></details></div>`;
}

export function libraryPage({ route, repository, groups, theme, state, history = [], loading = false, error = "", limit = 20 }) {
  const entries = repository.list(route.view || "all");
  const query = route.query || "";
  const resumeRecord = history.find((record) => state?.reconcile?.(record, repository.all)?.status === "valid");
  const primary = resumeRecord && repository.findEdition(resumeRecord.editionId);
  const visibleGroups = groups.slice(0, limit);
  const intro = route.name === "search"
    ? `<section class="search-page-heading"><p class="eyebrow">全站搜索</p><h1>搜索文字资料</h1><p>按标题、概念或正文查找，结果保留真实分 P 和命中段落。</p></section>`
    : "";
  const resume = route.name === "search" ? "" : primary ? `<aside class="resume-strip"><div><span class="eyebrow">继续阅读</span><strong>${escapeHtml(primary.title)}</strong><span>${escapeHtml(partLabel(primary))} · ${escapeHtml(statusLabel(primary))}</span></div><a class="text-link" href="${routeHref("read", { editionId: primary.editionId })}">继续上次阅读 ${icon("arrow")}</a></aside>` : "";
  const clearSearch = query ? `<a class="clear-search" href="${routeHref(route.name, { view: route.view, mode: route.mode, tag: route.tag, sort: route.sort })}">清除查找</a>` : "";
  return `${appHeader({ route, theme })}<main class="page ${route.name === "search" ? "search-page" : "library-page"}" id="main-content">${intro}<form class="primary-search" data-search-form><label for="global-search">查找文字资料</label><div class="search-field"><span>${icon("search")}</span><input id="global-search" name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索标题、概念或正文" autocomplete="off"><button type="submit">搜索</button></div>${clearSearch}</form>${filters(route, entries)}${resume}<section class="results-section" aria-live="polite" aria-busy="${loading ? "true" : "false"}"><div class="results-heading"><div><p class="eyebrow">${query ? "搜索结果" : "全部内容"}</p><h2>${query ? `与“${escapeHtml(query)}”相关` : "按视频浏览"}</h2></div><span class="result-total">${loading ? "正在查找…" : error ? "查找失败" : `${groups.length} 个视频`}</span></div>${error ? `<div class="inline-error" role="alert"><p>${escapeHtml(error)}</p><button type="button" data-action="retry-search">重新查找</button></div>` : loading ? `<div class="loading-state" role="status" aria-live="polite">${query ? '正在读取搜索索引…' : '正在整理资料库…'}<span></span><span></span><span></span></div>` : groups.length ? visibleGroups.map((group, index) => resultGroup({ ...group, index: index + 1 }, repository, query)).join("") + (groups.length > limit ? `<button class="load-more button-link" type="button" data-action="load-more">再显示 ${Math.min(32, groups.length - limit)} 个视频</button>` : "") : `<div class="empty-state"><h3>${query ? "没有找到匹配内容" : route.view === "published" ? "暂无正式发布内容" : "暂无可阅读内容"}</h3><p>${query ? "尝试换一个概念，或改用综合查找。" : route.view === "published" ? "当前没有正式发布稿。公开预览保留真实审核状态，可先阅读未发布内容。" : "公开快照准备好后，内容会出现在这里。"}</p>${route.view === "published" && !query ? `<a class="button-link" href="${routeHref("library", { view: "drafts" })}">阅读公开预览 ${icon("arrow")}</a>` : ""}</div>`}</section></main>`;
}

export function recentPage({ route, repository, state, theme, records: suppliedRecords }) {
  const records = suppliedRecords || state.history.map((record) => state.reconcile(record, repository.all));
  const storageMessages = { 'storage-unavailable': '当前浏览器无法使用本地存储，阅读记录仅在本次打开时保留。', 'storage-write-failed': '阅读记录保存失败；当前页面仍可使用，关闭后可能无法恢复。', 'storage-corrupted': '部分本地记录无法读取，已忽略损坏的数据。' };
  const storageNotice = state.status?.reason ? `<p class="storage-notice" role="status">${escapeHtml(storageMessages[state.status.reason] || '阅读记录暂时无法保存。')}</p>` : '';
  return `${appHeader({ route, theme })}<main class="page recent-page" id="main-content"><section class="section-heading"><p class="eyebrow">个人状态</p><h1>最近阅读</h1><p>阅读位置只保存在当前浏览器。内容更新或撤回后，旧位置会明确标记为不可恢复。</p></section>${storageNotice}${records.length ? `<ol class="recent-list">${records.map((item) => {
    const record = item.record || item;
    const entry = item.entry || repository.findEdition(record.editionId);
    const available = entry && item.status === 'valid';
    const removalId = record.id || record.recordId || record.editionId;
    const recordedAt = record.readAt ?? record.updatedAt ?? record.lastReadAt;
    const title = entry?.title || record.title || '旧稿件';
    const status = available ? statusLabel(entry) : entry ? '版本已变更 · 旧位置不可恢复' : '内容已撤回或不在当前快照中';
    return `<li${available ? '' : ' class="recent-unavailable"'}><div><span class="eyebrow">${escapeHtml(entry ? partName(entry) : record.partName || `P${(record.partIndex ?? record.part ?? 0) + 1}`)} · ${escapeHtml(status)}</span><strong>${escapeHtml(title)}</strong>${recentDate(recordedAt)}${available ? '' : `<p class="record-status">${escapeHtml(item.status === 'stale' ? '稿件版本与记录不同，旧位置不用于当前正文。' : '旧版本已不可读取，记录保留供你确认或删除。')}</p>`}</div><div class="recent-actions">${available ? `<a href="${routeHref('read', { editionId: entry.editionId })}">继续阅读 ${icon('arrow')}</a>` : entry ? `<a href="${routeHref('read', { editionId: entry.editionId })}">从当前版本开始 ${icon('arrow')}</a>` : ''}<button type="button" data-remove-history="${escapeHtml(removalId)}">删除</button></div></li>`;
  }).join('')}</ol><button class="quiet-button" type="button" data-action="clear-history">清空阅读记录</button>` : `<div class="empty-state"><h2>还没有阅读记录</h2><p>打开一篇正文，下一次回来时会从这里继续。</p><a class="button-link" href="#/library">浏览资料库 ${icon('arrow')}</a></div>`}</main>`;
}

function readerHref(name, params, locationHref) {
  if (typeof locationHref === 'function') return locationHref(name, params);
  if (typeof locationHref === 'string' && locationHref) return locationHref;
  return routeHref(name, params);
}

function returnContext(href) {
  if (href.startsWith('#/search')) {
    const query = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('q');
    return query ? `返回“${query}”的搜索结果` : '返回搜索结果';
  }
  return '返回资料库';
}

function recentDate(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const age = Math.max(0, now - date.valueOf());
  const relative = age < 60000 ? '刚刚' : age < 3600000 ? `${Math.floor(age / 60000)} 分钟前` : age < 86400000 ? `${Math.floor(age / 3600000)} 小时前` : `${Math.floor(age / 86400000)} 天前`;
  const actual = date.toLocaleString('zh-CN', { hour12: false });
  return `<time datetime="${date.toISOString()}" title="${escapeHtml(actual)}">${age < 7 * 86400000 ? relative : actual} · ${age < 7 * 86400000 ? escapeHtml(actual) : '上次阅读'}</time>`;
}

function modeLinks({ route, entry, parts, review, locationHref }) {
  const opposite = readerHref(review ? 'read' : 'verify', { editionId: entry.editionId, block: review ? route.bodyBlock || '' : '' }, locationHref);
  return `<nav class="reader-view-links" aria-label="稿件视图"><span>${review ? '校验参照' : '单篇正文'}</span><a class="reader-mode" href="${escapeHtml(opposite)}">${review ? '返回正文' : '核验参照'}</a></nav>`;
}

function partNavigation({ entry, parts, route, review = false, className = 'reader-parts' }) {
  return `<aside class="${className}" aria-label="同视频目录"><p class="eyebrow">同视频目录 · ${parts.length} 个 P</p><ol>${parts.map((part) => `<li><a class="${part.editionId === entry.editionId ? 'current' : ''}"${part.editionId === entry.editionId ? ' aria-current="page"' : ''} href="${routeHref(review ? 'verify' : 'read', { editionId: part.editionId })}"><span>${escapeHtml(partLabel(part))}</span><span>${escapeHtml(part.sourceMetadata?.partTitle || '分段标题未提供')}</span></a></li>`).join('')}</ol></aside>`;
}

export function readerArticle({ route, repository, entry, parts = [entry], prepared, review = false, returnHref = '#/library', locationHref }) {
  const index = parts.findIndex((part) => part.editionId === entry.editionId);
  const previous = parts[index - 1];
  const next = parts[index + 1];
  const titleMarkup = prepared.title || `<h1>${escapeHtml(entry.title)}</h1>`;
  const readingMinutes = repository.summaries?.[entryKey(entry)]?.minutes || '';
  const nextControl = next ? `<a href="${routeHref(review ? 'verify' : 'read', { editionId: next.editionId })}">下一部分 · ${escapeHtml(partLabel(next))} ${icon('arrow')}</a>` : '';
  return `<article class="reader-article" data-edition-id="${escapeHtml(entry.editionId)}" data-reader-mode="${review ? 'review' : 'body'}"><header class="reader-title"><div class="reader-status">${statusChip(entry)}${review ? '<span>固定 AI 基线参照</span>' : isDraft(entry) ? '<span>公开预览 · 未正式发布</span>' : ''}</div>${titleMarkup}<p>${escapeHtml(partName(entry))}${readingMinutes ? ` · ${readingMinutes} 分钟阅读` : ''}</p>${modeLinks({ route, entry, parts, review, locationHref })}</header>${review ? `<p class="review-note">校验参照关联当前 AI 修订，保留原文、整理稿、疑点和回看链接。它是 AI 初稿基线，不能作为当前人工稿件已获批准或正式发布的凭据。</p>` : ''}<div class="reader-prose">${prepared.body}</div><footer class="reader-end"><span>本部分读完了。</span>${previous ? `<a href="${routeHref(review ? 'verify' : 'read', { editionId: previous.editionId })}">上一部分 · ${escapeHtml(partLabel(previous))}</a>` : ''}${nextControl}<a href="${escapeHtml(returnHref)}" aria-label="${escapeHtml(returnContext(returnHref))}">${escapeHtml(returnContext(returnHref))}</a></footer></article>`;
}

export function readerPage({ route, repository, entry, parts = [entry], prepared, theme, review = false, returnHref = '#/library', locationHref }) {
  const nav = `<header class="reader-header"><button type="button" class="skip-link" data-action="skip-content">跳到正文</button><a class="reader-back" href="${escapeHtml(returnHref)}" aria-label="${escapeHtml(returnContext(returnHref))}">${icon('arrow')} <span>返回</span></a><div class="reader-identity" title="${escapeHtml(`${entry.title} · ${partName(entry)}`)}"><span>${escapeHtml(entry.title)}</span><strong>${escapeHtml(partName(entry))}</strong></div><nav class="reader-actions" aria-label="阅读操作">${parts.length > 1 ? '<button type="button" data-tool="parts">目录</button>' : ''}<button type="button" data-tool="find">查找</button><button type="button" data-tool="more">更多</button></nav><button class="icon-button theme-button" type="button" data-action="theme" aria-label="切换深浅主题">${icon(theme === 'dark' ? 'sun' : 'moon')}</button></header>`;
  const sidebar = parts.length > 1 ? partNavigation({ entry, parts, route, review }) : '';
  return `${nav}<div class="reader-layout">${sidebar}<main class="page reader-page" id="main-content">${readerArticle({ route, repository, entry, parts, prepared, review, returnHref, locationHref })}</main></div><div id="reader-tools"></div>`;
}

export function readerToolPanel({ tool, route = {}, entry, parts = [entry], prepared = {}, searchResults = [], searchQuery = '', preferences = {}, review = false, feedbackMarkup = '', loading = false, error = '', locationHref, searchLoading = false, searchError = '', searchIndex = -1, searchScope = 'video' }) {
  const labels = { parts: '同视频目录', find: review ? '查找当前参照' : '查找当前视频', more: '阅读工具', source: '来源与版本', outline: '本文导览', settings: '阅读排版', feedback: '修改建议' };
  if (!Object.hasOwn(labels, tool)) return '';
  let content = '';
  if (loading) content = '<p class="tool-help" role="status">正在准备工具…</p>';
  else if (error) content = `<div class="inline-error" role="alert"><p>${escapeHtml(error)}</p><button type="button" data-action="retry-tool">重试</button></div>`;
  else if (tool === 'parts') content = parts.length > 1 ? partNavigation({ entry, parts, route, review, className: 'reader-tool-parts' }) : '<p>当前视频只有一个 P。</p>';
  else if (tool === 'find') content = `<form data-reader-search aria-busy="${searchLoading ? 'true' : 'false'}"><label class="visually-hidden" for="reader-search-input">${review ? '查找当前参照' : '查找当前视频'}</label><input id="reader-search-input" name="q" type="search" value="${escapeHtml(searchQuery)}" placeholder="输入概念或原句"><button type="submit">查找</button>${!review ? `<label class="compact-control"><span>范围</span><select name="scope"><option value="video"${searchScope === 'video' ? ' selected' : ''}>当前视频全部 P</option><option value="article"${searchScope === 'article' ? ' selected' : ''}>当前 P</option></select></label>` : ''}</form><p class="tool-help">${review ? '只查找当前准确版本的校验参照，不混入正文命中。' : searchScope === 'article' ? '只查找当前 P 的正文。' : '只查找当前视频中同稿件类别的正文。'}</p><p role="status" aria-live="polite">${searchLoading ? '正在查找…' : searchQuery ? `找到 ${searchResults.length} 处命中` : '输入词语开始查找。'}</p>${searchError ? `<p role="alert">${escapeHtml(searchError)}</p>` : ''}${searchResults.length ? `<div class="reader-hit-navigation"><button type="button" data-action="previous-hit"${searchIndex <= 0 ? ' disabled' : ''}>上一处</button><span>${searchIndex >= 0 ? `${searchIndex + 1} / ${searchResults.length}` : `${searchResults.length} 处`}</span><button type="button" data-action="next-hit"${searchIndex >= searchResults.length - 1 ? ' disabled' : ''}>下一处</button></div>` : ''}<ol class="reader-search-results">${searchResults.map((hit) => { const part = hit.entry || entry; return `<li><a href="${routeHref(review ? 'verify' : 'read', { editionId: part.editionId, block: hit.id })}" data-edition-id="${escapeHtml(part.editionId)}" data-reader-block="${escapeHtml(hit.id)}"><span>${escapeHtml(partLabel(part))}</span>${highlight(String(hit.text || '').slice(0, 160), searchQuery)}</a></li>`; }).join('')}</ol>`;
  else if (tool === 'more') content = `<button type="button" data-tool="source">来源与版本</button><button type="button" data-tool="outline">本文导览</button><button type="button" data-tool="settings">阅读排版</button><button type="button" data-tool="feedback">纠错 / 反馈</button><a href="${escapeHtml(readerHref(review ? 'read' : 'verify', { editionId: entry.editionId }, locationHref))}">${review ? '返回正文' : '打开核验参照'}</a><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开原视频</a><button type="button" data-action="copy-paragraph-link">复制当前段落链接</button><button type="button" data-action="copy-markdown">复制${review ? '参照' : '正文'} Markdown</button><button type="button" data-action="download-markdown">下载${review ? '参照' : '正文'} Markdown</button><p data-document-action-status role="status" aria-live="polite"></p><textarea data-document-action-output readonly hidden aria-label="可手动复制的内容"></textarea>`;
  else if (tool === 'source') content = sourcePanel(entry);
  else if (tool === 'outline') content = outlinePanel(prepared, entry, route, review);
  else if (tool === 'settings') content = settingsPanel(preferences);
  else if (tool === 'feedback') content = feedbackMarkup || '<p class="tool-help" role="status">正在准备建议表单…</p>';
  return `<aside class="tool-drawer" data-tool-drawer data-reader-tool="${escapeHtml(tool)}" role="dialog" aria-modal="true" aria-labelledby="reader-tool-title" tabindex="-1"><header class="tool-panel-heading"><h2 id="reader-tool-title">${labels[tool]}</h2><button type="button" class="drawer-close" data-action="close-tool" aria-label="关闭${labels[tool]}">关闭</button></header><section class="tool-sheet${tool === 'settings' ? ' settings-sheet' : ''}">${content}</section></aside>`;
}

const missingFact = (value) => value === null || value === undefined || value === '' ? '未提供' : String(value);
const sourceTime = (value) => {
  if (value === null || value === undefined) return '未知';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.valueOf()) ? '未知' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false });
};
const factMarkup = (label, value, code = false) => `<dt>${escapeHtml(label)}</dt><dd>${code ? `<code>${escapeHtml(missingFact(value))}</code>` : escapeHtml(missingFact(value))}</dd>`;

export function sourcePanel(entry) {
  const metadata = entry.sourceMetadata || {};
  const origin = entry.origin;
  const sourcePublished = metadata.sourcePublishedAt || metadata.pubdateUnix || null;
  const metadataEvidence = origin?.metadataEvidence ? `<details class="source-version-details"><summary>冻结元数据观测证据</summary><pre>${escapeHtml(JSON.stringify(origin.metadataEvidence, null, 2))}</pre></details>` : '';
  const originNames = { 'ai-generated-v2': '原生 AI v2 整理稿', 'preserved-legacy-body': '迁移保留的历史 AI 正文', 'edited-after-preservation': '迁移保留后经编辑的正文' };
  const provenance = origin ? `${factMarkup('来源归属', originNames[origin.kind] || origin.kind)}${factMarkup('AI 输入版本', origin.inputVersion)}${factMarkup('AI 模板版本', origin.aiTemplateVersion)}${factMarkup('冻结来源元数据 SHA-256', origin.sourceMetadataSha256, true)}${origin.kind === 'ai-generated-v2' ? '' : `${factMarkup('迁移策略', origin.policyVersion)}${factMarkup('迁移 ID', origin.importId, true)}${factMarkup('历史 AI 修订', origin.legacyAiRevisionId, true)}${factMarkup('历史编辑版本', origin.legacyEditionId, true)}${factMarkup('历史发布 ID', origin.legacyReleaseId, true)}${factMarkup('迁移基线正文 SHA-256', origin.baselineBodySha256, true)}${factMarkup('当前正文 SHA-256', origin.currentBodySha256, true)}${factMarkup('迁移时间', sourceTime(origin.importedAt))}${factMarkup('正文保留声明', origin.bodyPreserved === true ? '保留原正文' : origin.bodyPreserved === false ? '已编辑正文' : '未提供')}`}` : factMarkup('来源归属', '未提供来源声明');
  return `<p class="tool-help">审核状态说明稿件处理进度；正式发布是另一项事实。未知来源时间保留为未知，不以导入或编辑时间替代。</p><dl class="source-facts">${factMarkup('稿件状态', statusLabel(entry))}<dt>原视频</dt><dd><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(entry))}</a></dd>${factMarkup('来源标题', metadata.title)}${factMarkup('分段标题', metadata.partTitle)}${factMarkup('来源作者', metadata.creatorName)}${factMarkup('来源作者 ID', metadata.creatorId)}${factMarkup('源视频发布时间', sourceTime(sourcePublished))}${factMarkup('元数据观测时间', sourceTime(metadata.metadataObservedAt))}${factMarkup('源主题标签', metadata.tags?.length ? metadata.tags.join(' · ') : '未提供')}${factMarkup('整理方式', entry.attribution)}${factMarkup('编辑说明', entry.editorNote)}</dl><details class="source-version-details" open><summary>准确版本与文件证据</summary><dl class="source-facts">${factMarkup('稿件类别', entry.manuscriptType)}${factMarkup('内容版本', entry.contentVersion)}${factMarkup('平台', entry.platform)}${factMarkup('来源视频 ID', entry.externalVideoId, true)}${factMarkup('分 P 索引（从 0 起）', entry.partIndex)}${factMarkup('本地分 P ID', entry.videoPartId)}${factMarkup('编辑版本', entry.editionId, true)}${factMarkup('AI 修订', entry.aiRevisionId, true)}${factMarkup('完整内容 SHA-256', entry.contentSha256, true)}${factMarkup('正文文件 SHA-256', entry.artifactSha256, true)}${factMarkup('校验参照文件 SHA-256', entry.reviewArtifactSha256, true)}${entry.manuscriptType === 'publication' ? `${factMarkup('发布 ID', entry.releaseId, true)}${factMarkup('发布模板', entry.templateVersion)}${factMarkup('正式发布时间', sourceTime(entry.publishedAt))}` : factMarkup('编辑版本创建时间', sourceTime(entry.createdAt))}${provenance}</dl></details>${metadataEvidence}${origin?.metadataSupplement ? `<details class="source-version-details"><summary>分 P 标题补充证据</summary><pre>${escapeHtml(JSON.stringify(origin.metadataSupplement, null, 2))}</pre></details>` : ''}`;
}

function outlinePanel(prepared, entry, route, review) {
  const headings = prepared.headings || [];
  const blocks = prepared.blocks || [];
  const candidates = headings.length > 1 ? headings.filter((heading) => heading.level > 1) : [];
  const items = candidates.length ? candidates : blocks;
  if (!items.length) return '<p>当前正文没有可用的段落导览。</p>';
  const step = candidates.length ? 1 : Math.max(1, Math.ceil(items.length / 30));
  return `<p class="tool-help">${candidates.length ? '沿原文标题定位。' : '正文没有编辑章节；以下按原文段落顺序摘录，未生成新标题。'}</p><ol class="outline-list">${items.filter((_, index) => index % step === 0).map((block, index) => `<li><a href="${routeHref(review ? 'verify' : 'read', { editionId: entry.editionId, block: block.id })}" data-edition-id="${escapeHtml(entry.editionId)}" data-reader-block="${escapeHtml(block.id)}"><span>${index * step + 1}</span>${escapeHtml(String(block.text || '').slice(0, 64))}</a></li>`).join('')}</ol>`;
}

function settingsPanel(preferences) {
  const setting = (name, label, options) => `<label for="reader-preference-${name}">${label}<select id="reader-preference-${name}" data-preference="${name}">${options.map(([value, text]) => `<option value="${value}"${String(preferences[name]) === String(value) ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
  return setting('size', '字号', [[17, '17 px'], [19, '19 px'], [21, '21 px']]) + setting('lineHeight', '行距', [[1.65, '紧凑'], [1.8, '适中'], [1.95, '标准'], [2.1, '宽松']]) + setting('width', '行宽', [[620, '窄'], [760, '标准'], [920, '宽']]) + setting('font', '字体', [['serif', '宋体 / 衬线'], ['sans', '黑体 / 无衬线']]) + '<button type="button" class="quiet-button" data-action="reset-preferences">恢复默认排版</button><p class="tool-help">排版偏好只保存在当前浏览器。</p>';
}
