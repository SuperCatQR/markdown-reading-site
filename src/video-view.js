import { entryKey, searchRoute, directoryRoute, continuousRoute, groupVideos, isDraft } from "./manuscripts.js";
import { escapeHtml, footer, viewLabels } from "./ui.js";
import { partMarkup, searchControls } from "./directory-view.js";

export function videoMarkup(entries, { bvid, view, query, mode }, summaries) {
  const group = groupVideos(entries.map((entry) => ({ entry })))[0];
  const first = group.parts[0].entry;
  const indices = [...new Set(entries.map((entry) => entry.pageIndex))].sort((a, b) => a - b);
  const gaps = indices.slice(1).flatMap((part, i) => part - indices[i] > 1 ? [`P${indices[i] + 2}${part - indices[i] > 2 ? `–P${part}` : ""}`] : []);
  const counts = { all: entries.length, published: entries.filter((entry) => !isDraft(entry)).length, drafts: entries.filter(isDraft).length };
  const minutes = (kind) => entries.filter((entry) => isDraft(entry) === (kind === "drafts")).reduce((total, entry) => total + summaries[entryKey(entry)].minutes, 0);
  return `<main id="main-content" class="page-shell video-overview" tabindex="-1"><a class="back-link" href="${directoryRoute(view)}">返回${viewLabels[view]}目录</a>
    <header class="video-overview-heading"><p class="eyebrow">视频总览 · ${escapeHtml(bvid)}</p><h1>${escapeHtml(first.title)}</h1><div class="article-tags">${[...new Set(entries.flatMap((entry) => entry.tags))].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><p class="video-overview-meta">已收录 ${indices.length} 个分 P · ${entries.length} 篇稿件<a href="${escapeHtml(first.sourceUrl)}" target="_blank" rel="noopener noreferrer">原视频 ↗</a></p><p class="search-scope">${counts.published ? `发布稿约 ${minutes("published")} 分钟阅读；` : ""}${counts.drafts ? `公开预览约 ${minutes("drafts")} 分钟阅读。` : ""}</p></header>
    <aside class="library-notice">只列出本站已收录部分，不代表视频完整目录。${indices[0] > 0 ? `P1${indices[0] > 1 ? `–P${indices[0]}` : ""} 未收录。` : ""}${gaps.length ? `编号间隔：${gaps.join("、")} 未收录。` : ""}公开预览不代表审核通过；同一分 P 的发布稿与预览分别保留。</aside>
    <nav class="video-versions" aria-label="视频稿件类别">${Object.entries(viewLabels).map(([kind, label]) => `<a href="${escapeHtml(searchRoute({ bvid, view: kind, query, mode }))}"${view === kind ? ' aria-current="page"' : ""}>${label}<span>${counts[kind]}</span></a>`).join("")}</nav>
    <div class="continuous-entry" aria-label="连续阅读入口">${["published", "drafts"].filter((kind) => view === "all" || view === kind).map((kind) => counts[kind] ? `<a href="${escapeHtml(continuousRoute(bvid, kind))}">连续阅读${kind === "drafts" ? "公开预览" : "已发布稿"} · ${counts[kind]} 个分 P →</a>` : `<span>此视频暂无${kind === "drafts" ? "公开预览" : "已发布稿"}，无法开启此类别的连续阅读。</span>`).join("")}</div>
    <section class="video-search" aria-label="在此视频中查找"><div class="search-box"><label class="search-label" for="search">在此视频中查找</label><input id="search" type="search" maxlength="300" value="${escapeHtml(query)}" placeholder="在此视频中查找" autocomplete="off"><button id="clear-search" class="clear-search" type="button" aria-label="清空搜索"${query ? "" : " hidden"}>×</button></div>${searchControls({ mode, scoped: true })}<p id="result-count" class="result-count" role="status"></p></section>
    <div id="directory-results" aria-busy="true"></div>${footer("视频总览")}</main>`;
}

export function videoResults(matches, current, summaries) {
  if (!matches.length) return `<section class="empty-state"><h2>${current.query.trim() ? "本视频没有匹配的稿件" : "此类别暂无收录稿件"}</h2><p>${current.query.trim() ? "试试其他原句或关键词。" : "其他稿件类别可在上方查看。"}</p></section>`;
  const parts = groupVideos(matches)[0].parts;
  return `<section aria-label="已收录分 P"><ol class="video-parts">${parts.map((part) => partMarkup(part, current, summaries)).join("")}</ol></section>`;
}
