import { entryKey, searchRoute, directoryRoute, continuousRoute, groupVideos, isDraft } from "./manuscripts.js";
import { escapeHtml, footer, viewLabels } from "./ui.js";
import { partMarkup, searchControls } from "./directory-view.js";

export function videoMarkup(entries, { bvid, view, query, mode }, summaries) {
  const group = groupVideos(entries.map((entry) => ({ entry })))[0];
  const first = group.parts[0].entry;
  const indices = [...new Set(entries.map((entry) => entry.pageIndex))].sort((a, b) => a - b);
  const gaps = indices.slice(1).flatMap((part, i) => part - indices[i] > 1 ? [`P${indices[i] + 2}${part - indices[i] > 2 ? `–P${part}` : ""}`] : []);
  const counts = { all: entries.length, published: entries.filter((entry) => !isDraft(entry)).length, drafts: entries.filter(isDraft).length };
  const availableKinds = ["published", "drafts"].filter((kind) => counts[kind]);
  const selectedKinds = availableKinds.filter((kind) => view === "all" || view === kind);
  const categoryLabel = view === "all" && availableKinds.length === 1
    ? availableKinds[0] === "drafts" ? "公开预览" : "已发布" : viewLabels[view];
  const continuousKinds = selectedKinds.filter((kind) => counts[kind] > 1);
  const searchOpen = query.trim() || (mode && mode !== "general");
  const minutes = (kind) => entries.filter((entry) => isDraft(entry) === (kind === "drafts")).reduce((total, entry) => total + summaries[entryKey(entry)].minutes, 0);
  return `<main id="main-content" class="page-shell video-overview" tabindex="-1"><a class="back-link" href="${directoryRoute(view)}">返回${viewLabels[view]}目录</a>
    <header class="video-overview-heading"><p class="eyebrow">视频总览</p><h1>${escapeHtml(first.title)}</h1><div class="video-overview-meta"><span>已收录 ${indices.length} 个分 P · ${entries.length} 篇稿件</span><a href="${escapeHtml(first.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bvid)} ↗</a>${availableKinds.map((kind) => `<span>${kind === "drafts" ? "公开预览" : "发布稿"}约 ${minutes(kind)} 分钟阅读</span>`).join("")}</div></header>
    ${counts.drafts ? '<p class="video-status-note">公开预览不代表审核通过或正式发布，稿件状态逐篇标注。</p>' : ""}
    <details class="video-source-details"><summary>来源标签与收录详情</summary><div class="article-tags">${[...new Set(entries.flatMap((entry) => entry.tags))].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><p>只列出本站已收录部分，不代表视频完整目录。${indices[0] > 0 ? `P1${indices[0] > 1 ? `–P${indices[0]}` : ""} 未收录。` : ""}${gaps.length ? `编号间隔：${gaps.join("、")} 未收录。` : ""}同一分 P 的发布稿与预览分别保留。</p></details>
    <div class="video-reading-tools"><h2>分 P 阅读</h2><details class="video-category"${availableKinds.length > 1 || !selectedKinds.length ? " open" : ""}><summary>稿件类别 · ${categoryLabel}</summary><nav class="video-versions" aria-label="视频稿件类别">${Object.entries(viewLabels).map(([kind, label]) => `<a href="${escapeHtml(searchRoute({ bvid, view: kind, query, mode }))}"${view === kind ? ' aria-current="page"' : ""}>${label}<span>${counts[kind]}</span></a>`).join("")}</nav></details></div>
    ${continuousKinds.length ? `<div class="continuous-entry" aria-label="连续阅读入口">${continuousKinds.map((kind) => `<a href="${escapeHtml(continuousRoute(bvid, kind))}">连续阅读${kind === "drafts" ? "公开预览" : "已发布稿"} · ${counts[kind]} 个分 P →</a>`).join("")}</div>` : ""}
    <details class="video-search"${searchOpen ? " open" : ""}><summary>在此视频中查找</summary><div class="search-box"><label class="search-label" for="search">在此视频中查找</label><input id="search" type="search" maxlength="300" value="${escapeHtml(query)}" placeholder="在此视频中查找" autocomplete="off"><button id="clear-search" class="clear-search" type="button" aria-label="清空搜索"${query ? "" : " hidden"}>×</button></div>${searchControls({ mode })}</details>
    <p id="result-count" class="result-count" role="status"></p>
    <div id="directory-results" aria-busy="true"></div>${footer("视频总览")}</main>`;
}

export function videoResults(matches, current, summaries) {
  if (!matches.length) return `<section class="empty-state"><h2>${current.query.trim() ? "本视频没有匹配的稿件" : "此类别暂无收录稿件"}</h2><p>${current.query.trim() ? "试试其他原句或关键词。" : "其他稿件类别可在上方查看。"}</p></section>`;
  const parts = groupVideos(matches)[0].parts;
  return `<section aria-label="已收录分 P"><ol class="video-parts">${parts.map((part) => partMarkup(part, current, summaries)).join("")}</ol></section>`;
}
