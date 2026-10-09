export const REVIEW_LABELS = Object.freeze({
  "pending-review": "待审核", "in-review": "审核中", "changes-requested": "待修改",
  rejected: "未采用", approved: "已审核 · 未发布",
});

export const isDraft = (entry) => entry.manuscriptType === "publication-draft";
export const entryKey = (entry) => `${entry.manuscriptType}:${entry.editionId}`;
export const entryRoute = (entry) => isDraft(entry) ? `?draft=${entry.editionId}` : `?read=${encodeURIComponent(entry.slug)}`;
export const reviewRoute = (entry) => `?review=${entry.editionId}`;
export const entryDate = (entry) => new Date((isDraft(entry) ? entry.createdAt : entry.publishedAt) * 1000).toISOString().slice(0, 10);
export const directoryRoute = (view) => view === "all" ? "?view=all" : `?view=${view}`;
export const statusLabel = (entry) => isDraft(entry)
  ? entry.reviewStatus === "approved" ? REVIEW_LABELS.approved : `${REVIEW_LABELS[entry.reviewStatus]} · 未发布`
  : "已审核 · 已发布";

export function groupVideos(matches) {
  const groups = new Map();
  for (const match of matches) {
    const { entry } = match;
    if (!groups.has(entry.bvid)) groups.set(entry.bvid, { bvid: entry.bvid, title: entry.title, parts: [] });
    groups.get(entry.bvid).parts.push(match);
  }
  for (const group of groups.values()) {
    group.parts.sort((a, b) => a.entry.pageIndex - b.entry.pageIndex || Number(isDraft(a.entry)) - Number(isDraft(b.entry)));
  }
  return [...groups.values()];
}

export function adjacentParts(entry, entries) {
  const parts = entries.filter((candidate) => candidate.bvid === entry.bvid && candidate.manuscriptType === entry.manuscriptType)
    .sort((a, b) => a.pageIndex - b.pageIndex);
  const index = parts.findIndex((candidate) => entryKey(candidate) === entryKey(entry));
  return { parts, previous: parts[index - 1], next: parts[index + 1] };
}

export function sortReaderEntries(entries) {
  return [...entries].sort((a, b) => (isDraft(b) ? b.createdAt : b.publishedAt)
    - (isDraft(a) ? a.createdAt : a.publishedAt) || a.videoPartId - b.videoPartId);
}

export function resolveReaderRoute(search, publication, drafts) {
  const params = new URLSearchParams(search);
  const allowed = ["view", "read", "draft", "review"];
  if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)) return { kind: "missing" };
  const selectors = ["read", "draft", "review"].filter((key) => params.has(key));
  if (selectors.length > 1 || (selectors.length && params.has("view"))
      || (params.has("view") && !["all", "published", "drafts"].includes(params.get("view")))) return { kind: "missing" };
  if (params.has("review")) {
    const id = params.get("review");
    if (!/^[0-9a-f]{32}$/.test(id)) return { kind: "missing" };
    const matches = [...publication, ...drafts].filter((entry) => entry.editionId === id);
    if (matches.length !== 1) return { kind: "missing" };
    const entry = matches[0];
    return { kind: "article", view: isDraft(entry) ? "drafts" : "published", mode: "review", entry };
  }
  if (params.has("draft")) {
    const id = params.get("draft");
    return /^[0-9a-f]{32}$/.test(id) ? { kind: "article", view: "drafts", mode: "body", entry: drafts.find((entry) => entry.editionId === id) } : { kind: "missing" };
  }
  if (params.has("read")) return { kind: "article", view: "published", mode: "body", entry: publication.find((entry) => entry.slug === params.get("read")) };
  return { kind: "directory", view: params.get("view") || "all" };
}

export function buildIssueUrl(entry, pageUrl, issueUrl, mode = "body") {
  const draft = isDraft(entry);
  const review = mode === "review";
  const label = review ? "校验参照稿件" : draft ? "未发布稿件" : "发布稿";
  const body = [`## ${label}`, "", `- 稿件: \`${entry.slug}\``,
    ...(draft ? [`- 审核状态: ${REVIEW_LABELS[entry.reviewStatus]}`] : [`- 发布 ID: \`${entry.releaseId}\``]),
    `- 编辑版本: \`${entry.editionId}\``, `- AI 修订: \`${entry.aiRevisionId}\``,
    `- 完整内容 SHA-256: \`${entry.contentSha256}\``,
    ...(review ? [`- 校验参照文件 SHA-256: \`${entry.reviewArtifactSha256}\``] : []),
    `- 稿件链接: ${new URL(review ? reviewRoute(entry) : entryRoute(entry), pageUrl).href}`, `- 原视频: ${entry.sourceUrl}`,
    "", "## 建议修改", "", "请指出段落或原句，写明建议内容与理由。", ""].join("\n");
  return `${issueUrl}?${new URLSearchParams({template:"review.md",title:`[${label}修改建议] ${entry.title}`,body}).toString()}`;
}
