import { partIndex } from "./source-identity.js";
import { groupVideos, isDraft } from "./manuscripts.js";
import { escapeHtml, viewLabels } from "./ui.js";
import { partMarkup, searchControls } from "./directory-view.js";
import { visibleQuery } from "./query-state.js";
import { partGapsMarkup } from "./reading-outline.js";

export function readerVideoMarkup(entries, { query = "", mode = "general", view }) {
  const counts = { all: entries.length, published: entries.filter((entry) => !isDraft(entry)).length, drafts: entries.filter(isDraft).length };
  const indices = [...new Set(entries.map((entry) => partIndex(entry)))].sort((a, b) => a - b);
  const sourceScope = entries[0]?.platform === "youtube" ? "单视频来源。" : `已收录 ${indices.length} 个分 P，不代表视频完整目录。`;
  return `<section class="reader-video-search" data-reader-panel="search" hidden><h3>在此视频中查找</h3>
    <div class="search-box"><label class="search-label" for="video-query">在此视频中查找</label><input id="video-query" type="search" maxlength="300" value="${escapeHtml(visibleQuery(query))}" placeholder="在此视频中查找" autocomplete="off" aria-describedby="search-help"><button class="clear-search" id="clear-video-query" type="button" aria-label="清空视频内搜索"${visibleQuery(query) ? "" : " hidden"}>×</button></div>
    <label class="video-search-category">搜索范围<select id="video-search-view" aria-describedby="video-search-scope">${Object.entries(viewLabels).map(([kind, label]) => `<option value="${kind}"${view === kind ? " selected" : ""}>${label} · ${counts[kind]}</option>`).join("")}</select></label><p id="video-search-scope" class="search-help">仅筛选查找结果，不切换当前正文或稿件版本。</p>
    ${searchControls({ mode })}<p class="search-help">仅查找本视频已收录稿件的正文与元数据，校验参照不参与搜索。${sourceScope}</p>${partGapsMarkup(entries)}
    <p id="video-result-count" class="result-count" role="status" hidden></p><div id="video-results" aria-busy="false"></div></section>`;
}

export function videoResults(matches, current, summaries) {
  if (!matches.length) return `<section class="empty-state"><h2>${current.query.trim() ? "本视频没有匹配的稿件" : "此类别暂无收录稿件"}</h2><p>${current.query.trim() ? "试试其他原句或关键词。" : "其他稿件类别可在上方查看。"}</p></section>`;
  const parts = groupVideos(matches)[0].parts;
  return `<section aria-label="视频内查找结果"><ol class="video-parts">${parts.map((part) => partMarkup(part, current, summaries)).join("")}</ol></section>`;
}
