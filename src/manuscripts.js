import { workKey, partIndex, validWorkKey } from "./source-identity.js";
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
export const videoRoute = (bvid, view = "all") => `?video=${encodeURIComponent(bvid)}&view=${view}`;
export const continuousRoute = (bvid, view, editionId) => `?${new URLSearchParams({ video: bvid, view, flow: "continuous", ...(editionId ? { part: editionId } : {}) })}`;

export function readerSearchRoute(entry, { query = "", mode = "general", view } = {}, review = false) {
  const params = new URLSearchParams(review ? reviewRoute(entry) : entryRoute(entry));
  if (query) params.set("vq", query);
  if (mode !== "general") params.set("vm", mode);
  if (view) params.set("vview", view);
  return `?${params}`;
}

export function videoEntry(entries, bvid, view = "all") {
  return entries.filter((entry) => workKey(entry) === bvid && (view === "all" || isDraft(entry) === (view === "drafts")))
    .sort((a, b) => partIndex(a) - partIndex(b) || Number(isDraft(a)) - Number(isDraft(b)))[0];
}

export function searchRoute({ view, bvid, query = "", mode = "general", tag = "全部", sort = "body" }) {
  const params = new URLSearchParams({ ...(bvid ? { video: bvid } : {}), view });
  params.set("q", query);
  if (mode !== "general") params.set("mode", mode);
  if (tag !== "全部") params.set("tag", tag);
  if (sort !== "body") params.set("sort", sort);
  return `?${params}`;
}
export const statusLabel = (entry) => isDraft(entry)
  ? entry.reviewStatus === "approved" ? REVIEW_LABELS.approved : `${REVIEW_LABELS[entry.reviewStatus]} · 未发布`
  : "已审核 · 已发布";

export function groupVideos(matches) {
  const groups = new Map();
  for (const match of matches) {
    const { entry } = match;
    if (!groups.has(workKey(entry))) groups.set(workKey(entry), { bvid: workKey(entry), title: entry.title, parts: [] });
    groups.get(workKey(entry)).parts.push(match);
  }
  for (const group of groups.values()) {
    group.parts.sort((a, b) => partIndex(a.entry) - partIndex(b.entry) || Number(isDraft(a.entry)) - Number(isDraft(b.entry)));
  }
  return [...groups.values()];
}

export function adjacentParts(entry, entries) {
  const parts = entries.filter((candidate) => workKey(candidate) === workKey(entry) && candidate.manuscriptType === entry.manuscriptType)
    .sort((a, b) => partIndex(a) - partIndex(b));
  const index = parts.findIndex((candidate) => entryKey(candidate) === entryKey(entry));
  return { parts, previous: parts[index - 1], next: parts[index + 1] };
}

export function sortReaderEntries(entries) {
  return [...entries].sort((a, b) => (isDraft(b) ? b.createdAt : b.publishedAt)
    - (isDraft(a) ? a.createdAt : a.publishedAt) || a.videoPartId - b.videoPartId);
}

export function sourceTagsByFrequency(entries) {
  const counts = new Map();
  for (const entry of entries) for (const tag of entry.tags) {
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
}

export function resolveReaderRoute(search, publication, drafts) {
  const params = new URLSearchParams(search);
  const allowed = ["view", "read", "draft", "review", "video", "q", "mode", "tag", "sort", "flow", "part", "vq", "vm", "vview"];
  if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)) return { kind: "missing" };
  const selectors = ["read", "draft", "review"].filter((key) => params.has(key));
  if (selectors.length > 1 || (selectors.length && ["view", "video", "q", "mode", "tag", "sort", "flow", "part"].some((key) => params.has(key)))
      || (params.has("mode") && !["general", "phrase", "keywords"].includes(params.get("mode")))
      || (params.has("sort") && (!["body", "title"].includes(params.get("sort")) || params.has("video")))
      || (params.get("q")?.length > 300)
      || (params.has("view") && !["all", "published", "drafts"].includes(params.get("view")))
      || (["vq", "vm", "vview"].some((key) => params.has(key)) && !selectors.length)
      || (params.get("vq")?.length > 300)
      || (params.has("vm") && !["general", "phrase", "keywords"].includes(params.get("vm")))
      || (params.has("vview") && !["all", "published", "drafts"].includes(params.get("vview")))) return { kind: "missing" };
  const videoSearch = ["vq", "vm", "vview"].some((key) => params.has(key))
    ? { videoSearch: { query: params.get("vq") || "", mode: params.get("vm") || "general", view: params.get("vview") || "all" } } : {};
  if (params.has("review")) {
    const id = params.get("review");
    if (!/^[0-9a-f]{32}$/.test(id)) return { kind: "missing" };
    const matches = [...publication, ...drafts].filter((entry) => entry.editionId === id);
    if (matches.length !== 1) return { kind: "missing" };
    const entry = matches[0];
    return { kind: "article", view: isDraft(entry) ? "drafts" : "published", mode: "review", entry, ...videoSearch };
  }
  if (params.has("draft")) {
    const id = params.get("draft");
    return /^[0-9a-f]{32}$/.test(id) ? { kind: "article", view: "drafts", mode: "body", entry: drafts.find((entry) => entry.editionId === id), ...videoSearch } : { kind: "missing" };
  }
  if (params.has("read")) return { kind: "article", view: "published", mode: "body", entry: publication.find((entry) => entry.slug === params.get("read")), ...videoSearch };
  const view = params.get("view") || "all";
  const bvid = params.get("video");
  if (params.has("video") && (!validWorkKey(bvid) || ![...publication, ...drafts].some((entry) => workKey(entry) === bvid))) return { kind: "missing" };
  if (params.has("flow") || params.has("part")) {
    if (params.get("flow") !== "continuous" || !bvid || !["published", "drafts"].includes(view)
        || ["q", "mode", "tag", "sort"].some((key) => params.has(key))) return { kind: "missing" };
    const entries = (view === "drafts" ? drafts : publication).filter((entry) => workKey(entry) === bvid).sort((a, b) => partIndex(a) - partIndex(b));
    const id = params.get("part");
    if (params.has("part") && (!/^[0-9a-f]{32}$/.test(id) || !entries.some((entry) => entry.editionId === id))) return { kind: "missing" };
    return { kind: "continuous", bvid, view, entries, entry: id ? entries.find((entry) => entry.editionId === id) : entries[0] };
  }
  const tag = params.get("tag");
  if (params.has("tag") && (bvid || (tag !== "全部" && ![...publication, ...drafts].some((entry) => entry.tags.includes(tag))))) return { kind: "missing" };
  const searchState = ["q", "mode", "tag", "sort"].some((key) => params.has(key))
    ? { query: params.get("q") || "", mode: params.get("mode") || "general", tag: params.get("tag") || "全部", ...(!bvid ? { sort: params.get("sort") || "body" } : {}) } : undefined;
  return { kind: bvid ? "video" : "directory", view, ...(bvid ? { bvid } : {}), ...(searchState ? { searchState } : {}) };
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
