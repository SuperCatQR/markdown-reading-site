import { entryRoute } from "./manuscripts.js";
import { bilibiliId, partLabel } from "./source-identity.js";
import { escapeHtml } from "./ui.js";

const positionsOf = (item) => [...item.members.map((member) => ({ ...member, missing: false })), ...item.knownMissing.map((member) => ({ ...member, missing: true }))].sort((a, b) => a.ordinal - b.ordinal);
const availableParts = (member, entry, entries) => member.entries.map((binding) => entries.find((candidate) => candidate.manuscriptType === entry.manuscriptType && candidate.editionId === binding.editionId && candidate.slug === binding.slug && candidate.contentSha256 === binding.contentSha256 && candidate.artifactSha256 === binding.artifactSha256)).filter(Boolean);

export function seriesAdjacentMarkup(entry, series = [], entries = []) {
  if (!entry) return "";
  return series.filter((item) => item.members.some((member) => member.bvid === bilibiliId(entry))).map((item) => {
    const positions = positionsOf(item), index = positions.findIndex((member) => member.bvid === bilibiliId(entry));
    const links = [[positions[index - 1], "prev", "上一视频"], [positions[index + 1], "next", "下一视频"]].map(([member, relation, label]) => {
      if (!member) return "";
      if (member.missing) return `<span>${label} · 编辑确认缺失：${escapeHtml(member.label)}</span>`;
      const first = availableParts(member, entry, entries)[0];
      return first ? `<a rel="${relation}" href="${escapeHtml(entryRoute(first))}">${label} · ${escapeHtml(member.label)}</a>` : `<span>${label} · ${escapeHtml(member.label)}：当前稿件类别暂无收录</span>`;
    }).filter(Boolean);
    return links.length ? `<nav class="series-adjacent" aria-label="${escapeHtml(item.title)}系列前后视频"><span>系列 · ${escapeHtml(item.title)}</span>${links.join("")}</nav>` : "";
  }).join("");
}

export function seriesMarkup(entry, series = [], entries = []) {
  if (!entry) return "";
  const confirmed = series.filter((item) => item.members.some((member) => member.bvid === bilibiliId(entry)));
  return confirmed.map((item) => {
    const current = item.members.find((member) => member.bvid === bilibiliId(entry));
    const positions = positionsOf(item);
    const rows = positions.map((member) => {
      if (member.missing) return `<li class="series-missing"><span>第 ${member.ordinal} 部 · ${escapeHtml(member.label)}</span><p>编辑确认缺失：${escapeHtml(member.note)}</p></li>`;
      const available = availableParts(member, entry, entries);
      return `<li${member.bvid === bilibiliId(entry) ? ' aria-current="true"' : ""}><span>第 ${member.ordinal} 部 · ${escapeHtml(member.label)}${member.bvid === bilibiliId(entry) ? " · 当前视频" : ""}</span>${available.length ? `<div class="series-parts">${available.map((part) => `<a href="${escapeHtml(entryRoute(part))}"${part.editionId === entry.editionId ? ' aria-current="page"' : ""}>${partLabel(part)}</a>`).join("")}</div>` : '<p>当前稿件类别暂无收录，系列顺序保留。</p>'}</li>`;
    }).join("");
    return `<details class="reading-series"><summary>系列 · ${escapeHtml(item.title)} · 第 ${current.ordinal} 部</summary><p>系列关系与阅读顺序已经编辑确认。<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看依据 ↗</a></p><p>${escapeHtml(item.evidence)}</p><nav aria-label="${escapeHtml(item.title)}系列阅读顺序"><ol>${rows}</ol></nav></details>`;
  }).join("");
}
