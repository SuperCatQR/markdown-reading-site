import { workKey, partIndex, sourceTags, validWorkKey } from "./identity.js";

export const REVIEW_LABELS = Object.freeze({
  "pending-review": "待审核", "in-review": "审核中", "changes-requested": "待修改",
  rejected: "未采用", approved: "已审核 · 未发布",
});

export const isDraft = (entry) => entry?.manuscriptType === "publication-draft";
export const entryKey = (entry) => `${entry.manuscriptType}:${entry.editionId}`;
export const statusLabel = (entry) => isDraft(entry)
  ? entry.reviewStatus === "approved" ? REVIEW_LABELS.approved : `${REVIEW_LABELS[entry.reviewStatus] || "未完成"} · 未发布`
  : "已审核 · 已发布";
export const entryDate = (entry) => new Date((isDraft(entry) ? entry.createdAt : entry.publishedAt) * 1000).toISOString().slice(0, 10);

export function groupVideos(matches) {
  const groups = new Map();
  for (const match of matches) {
    const key = workKey(match.entry);
    if (!groups.has(key)) groups.set(key, { videoKey: key, title: match.entry.title, parts: [] });
    groups.get(key).parts.push(match);
  }
  for (const group of groups.values()) group.parts.sort((a, b) => partIndex(a.entry) - partIndex(b.entry) || Number(isDraft(a.entry)) - Number(isDraft(b.entry)));
  return [...groups.values()];
}
