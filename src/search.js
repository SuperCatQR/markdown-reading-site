import { entryKey } from "./manuscripts.js";

export const normalizeSearch = (value) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hans");
export const searchModes = { general: "综合搜索", phrase: "正文原句", keywords: "正文关键词" };

export function searchTerms(query, mode = "general") {
  const normalized = normalizeSearch(query);
  return normalized ? [...new Set(mode === "keywords" ? normalized.split(" ") : [normalized])] : [];
}

function entryMatches(entry, query, blocks, mode) {
  const terms = searchTerms(query, mode);
  if (!terms.length) return { match: null, matches: [], score: 0 };
  const matches = blocks.flatMap((block) => {
    const text = normalizeSearch(block.text);
    const found = terms.filter((term) => text.includes(term));
    return found.length ? [{ label: "正文命中", ...block, terms: found }] : [];
  });
  const covered = new Set(matches.flatMap((match) => match.terms));
  if (covered.size === terms.length) {
    const together = Math.max(...matches.map((match) => match.terms.length));
    return { match: matches[0], matches, score: 100 + together / terms.length };
  }
  if (mode !== "general") return null;
  for (const [label, text] of [["标题", entry.title], ["摘要", entry.summary], ["来源标签", entry.tags.join(" · ")]]) {
    if (normalizeSearch(text).includes(terms[0])) return { match: { label, text, id: null }, matches: [], score: 1 };
  }
  return null;
}

export function searchEntries(entries, { query, tag, mode = "general" }, index = {}) {
  return entries.flatMap((entry) => {
    if (tag !== "全部" && !entry.tags.includes(tag)) return [];
    const result = entryMatches(entry, query, index[entryKey(entry)] || [], mode);
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
