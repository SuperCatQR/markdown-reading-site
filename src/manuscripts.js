export const REVIEW_LABELS = Object.freeze({
  "pending-review": "待审核", "in-review": "审核中", "changes-requested": "待修改",
  rejected: "未采用", approved: "已审核 · 未发布",
});

export const isDraft = (entry) => entry.manuscriptType === "publication-draft";
export const entryKey = (entry) => `${entry.manuscriptType}:${entry.editionId}`;
export const entryRoute = (entry) => isDraft(entry) ? `?draft=${entry.editionId}` : `?read=${encodeURIComponent(entry.slug)}`;
export const entryDate = (entry) => new Date((isDraft(entry) ? entry.createdAt : entry.publishedAt) * 1000).toISOString().slice(0, 10);

export function createReaderIndex(entries, sourceForEntry) {
  const sorted = [...entries].sort((a, b) => (isDraft(b) ? b.createdAt : b.publishedAt)
    - (isDraft(a) ? a.createdAt : a.publishedAt) || a.videoPartId - b.videoPartId);
  const search = new Map(sorted.map((entry) => [entryKey(entry),
    `${entry.title} ${entry.summary} ${entry.tags.join(" ")} ${sourceForEntry(entry) || ""}`.toLocaleLowerCase("zh-Hans")]));
  return { entries: sorted, filter({ query, tag }) {
    const text = query.trim().toLocaleLowerCase("zh-Hans");
    return sorted.filter((entry) => (tag === "全部" || entry.tags.includes(tag))
      && search.get(entryKey(entry)).includes(text));
  } };
}

export function resolveReaderRoute(search, publication, drafts) {
  const params = new URLSearchParams(search);
  if (params.has("review") || (params.has("read") && params.has("draft"))) return { kind: "missing" };
  if (params.has("draft")) {
    const id = params.get("draft");
    return /^[0-9a-f]{32}$/.test(id) ? { kind: "article", view: "drafts", entry: drafts.find((entry) => entry.editionId === id) } : { kind: "missing" };
  }
  if (params.has("read")) return { kind: "article", view: "published", entry: publication.find((entry) => entry.slug === params.get("read")) };
  return { kind: "directory", view: params.get("view") === "drafts" ? "drafts" : "published" };
}

export function buildIssueUrl(entry, pageUrl, issueUrl) {
  const draft = isDraft(entry);
  const label = draft ? "未发布稿件" : "发布稿";
  const body = [`## ${label}`, "", `- 稿件: \`${entry.slug}\``,
    ...(draft ? [`- 审核状态: ${REVIEW_LABELS[entry.reviewStatus]}`] : [`- 发布 ID: \`${entry.releaseId}\``]),
    `- 编辑版本: \`${entry.editionId}\``, `- AI 修订: \`${entry.aiRevisionId}\``,
    `- 完整内容 SHA-256: \`${entry.contentSha256}\``,
    `- 稿件链接: ${new URL(entryRoute(entry), pageUrl).href}`, `- 原视频: ${entry.sourceUrl}`,
    "", "## 建议修改", "", "请指出段落或原句，写明建议内容与理由。", ""].join("\n");
  return `${issueUrl}?${new URLSearchParams({template:"review.md",title:`[${label}修改建议] ${entry.title}`,body}).toString()}`;
}
