import { sourceTags } from "./source-identity.js";
import { entryKey } from "./manuscripts.js";

export const normalizeSearch = (value) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hans");
export const searchModes = { general: "综合搜索", phrase: "正文原句", keywords: "正文关键词" };
export const searchSorts = { body: "正文证据优先", title: "标题相关优先" };
const normalizedBlocks = new WeakMap();

function normalizedBlock(block) {
  const cached = normalizedBlocks.get(block);
  if (cached?.source === block.text) return cached.text;
  const text = normalizeSearch(block.text);
  normalizedBlocks.set(block, { source: block.text, text });
  return text;
}

// Cache derived text in memory; never change the frozen index or its display text.
export function prepareSearchIndex(index) {
  for (const blocks of Object.values(index)) for (const block of blocks) normalizedBlock(block);
  return index;
}

export function sortingHelp(mode = "general", sort = "body", query = "") {
  if (!query.trim()) return "按稿件创建或发布时间从新到旧排列；同视频内按分 P 顺序，不代表课程学习顺序。";
  if (mode === "keywords") return "所有关键词须在同一篇正文出现；同段覆盖更多关键词的结果优先。同分保留目录顺序。";
  if (mode === "phrase") return "只收录正文原句命中；同分保留目录顺序。";
  return sort === "title" ? "标题包含搜索词的结果优先，其余按正文证据排序；同分保留目录顺序。视频以最相关分 P 排位，组内仍按 P 顺序。"
    : "正文命中优先于标题、摘要和标签；同分保留目录顺序。视频以最相关分 P 排位，组内仍按 P 顺序。";
}

export function searchTerms(query, mode = "general") {
  const normalized = normalizeSearch(query);
  return normalized ? [...new Set(mode === "keywords" ? normalized.split(" ") : [normalized])] : [];
}

function entryMatches(entry, terms, blocks, mode, sort) {
  if (!terms.length) return { match: null, matches: [], score: 0 };
  const matches = blocks.flatMap((block) => {
    const text = normalizedBlock(block);
    const found = terms.filter((term) => text.includes(term));
    return found.length ? [{ label: "正文命中", ...block, terms: found }] : [];
  });
  const covered = new Set(matches.flatMap((match) => match.terms));
  const titleFirst = mode === "general" && sort === "title" && normalizeSearch(entry.title).includes(terms[0]);
  if (covered.size === terms.length) {
    const together = Math.max(...matches.map((match) => match.terms.length));
    return { match: matches[0], matches, score: (titleFirst ? 200 : 100) + together / terms.length };
  }
  if (mode !== "general") return null;
  for (const [label, text] of [["标题", entry.title], ["摘要", entry.summary], ["来源标签", sourceTags(entry).join(" · ")]]) {
    if (normalizeSearch(text).includes(terms[0])) return { match: { label, text, id: null }, matches: [], score: titleFirst ? 200 : 1 };
  }
  return null;
}

export function searchEntries(entries, { query, tag, mode = "general", sort = "body" }, index = {}) {
  const terms = searchTerms(query, mode);
  return entries.flatMap((entry) => {
    if (tag !== "全部" && !sourceTags(entry).includes(tag)) return [];
    const result = entryMatches(entry, terms, index[entryKey(entry)] || [], mode, sort);
    return result ? [{ entry, ...result }] : [];
  }).sort((a, b) => b.score - a.score);
}

export function contextSnippet(text, query, radius = 65) {
  const first = matchingRanges(text, query)[0];
  const index = first?.start || 0;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, (first?.end || 0) + radius);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function matchingRanges(text, query) {
  const terms = (Array.isArray(query) ? query : [query]).map((term) => term.trim().replace(/\s+/gu, " ")).filter(Boolean);
  if (!terms.length) return [];
  const pattern = [...new Set(terms)].sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|");
  return [...text.matchAll(new RegExp(pattern, "giu"))].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

export function textSegments(text, query) {
  const segments = [];
  let end = 0;
  for (const range of matchingRanges(text, query)) {
    if (range.start > end) segments.push({ text: text.slice(end, range.start), match: false });
    segments.push({ text: text.slice(range.start, range.end), match: true });
    end = range.end;
  }
  if (end < text.length) segments.push({ text: text.slice(end), match: false });
  return segments;
}

export function matchHash(match, query, mode = "general") {
  const terms = mode === "keywords" ? match?.terms?.join(" ") || query.trim() : query.trim();
  return match?.id ? `#hit=${encodeURIComponent(match.id)}&q=${encodeURIComponent(terms)}${mode === "keywords" ? "&m=keywords" : ""}` : "";
}

export function parseMatchHash(hash) {
  if (!hash.startsWith("#hit=")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const id = params.get("hit");
  const query = params.get("q");
  if (params.getAll("hit").length !== 1 || params.getAll("q").length !== 1
      || params.getAll("m").length > 1 || (params.has("m") && params.get("m") !== "keywords")
      || [...params.keys()].some((key) => !["hit", "q", "m"].includes(key)) || !id || !query || query.length > 300) return null;
  return { id, query, ...(params.has("m") ? { mode: "keywords" } : {}) };
}
