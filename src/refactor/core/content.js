import { prepareDocument } from "../../../packages/content-core/index.js";

export const viewNames = Object.freeze({ all: "全部内容", drafts: "未发布", published: "已发布" });

export function isDraft(entry) {
  return entry?.manuscriptType === "publication-draft";
}

export function entryKey(entry) {
  return `${entry.manuscriptType}:${entry.editionId}`;
}

export function workKey(entry) {
  return `${entry.platform}.${entry.externalVideoId}`;
}

export function partLabel(entry) {
  return entry.platform === "youtube" ? "单视频" : `P${entry.partIndex + 1}`;
}

export function partIndex(entry) {
  return entry.partIndex;
}

export function partTitle(entry) {
  return entry.sourceMetadata?.partTitle || "";
}

export function partName(entry) {
  return `${partLabel(entry)}${partTitle(entry) ? ` · ${partTitle(entry)}` : ""}`;
}

export function statusLabel(entry) {
  if (!isDraft(entry)) return "已审核 · 已发布";
  return entry.reviewStatus === "approved" ? "已审核 · 未发布" : `${({
    "pending-review": "待审核", "in-review": "审核中", "changes-requested": "待修改", rejected: "未采用",
  })[entry.reviewStatus] || "未完成"} · 未发布`;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const dateA = isDraft(a) ? a.createdAt : a.publishedAt;
    const dateB = isDraft(b) ? b.createdAt : b.publishedAt;
    return dateB - dateA || a.videoPartId - b.videoPartId;
  });
}

export function groupEntries(entries) {
  const groups = new Map();
  for (const entry of sortEntries(entries)) {
    const key = workKey(entry);
    if (!groups.has(key)) groups.set(key, { key, title: entry.title, parts: [] });
    groups.get(key).parts.push(entry);
  }
  for (const group of groups.values()) group.parts.sort((a, b) => a.partIndex - b.partIndex || Number(isDraft(a)) - Number(isDraft(b)));
  return [...groups.values()];
}

export function partsFor(entry, entries) {
  return entries.filter((candidate) => workKey(candidate) === workKey(entry) && candidate.manuscriptType === entry.manuscriptType)
    .sort((a, b) => a.partIndex - b.partIndex);
}

export function prepareBlocks(source) {
  const prepared = prepareDocument(source);
  return { ...prepared, blocks: prepared.blocks || [] };
}

export function minutesFor(entry, summaries) {
  return summaries[entryKey(entry)]?.minutes || "";
}

export function sourceLabel(entry) {
  return `${entry.platform === "youtube" ? "YouTube" : "哔哩哔哩"} · ${entry.externalVideoId}`;
}
