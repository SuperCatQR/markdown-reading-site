import { entryKey } from "./manuscripts.js";

export const normalizeSearch = (value) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hans");

export function findEntryMatch(entry, query, blocks = []) {
  const needle = normalizeSearch(query);
  if (!needle) return null;
  for (const [label, text] of [["标题", entry.title], ["摘要", entry.summary], ["来源标签", entry.tags.join(" · ")]]) {
    if (normalizeSearch(text).includes(needle)) return { label, text, id: null };
  }
  const block = blocks.find(({ text }) => normalizeSearch(text).includes(needle));
  return block ? { label: "正文命中", ...block } : null;
}

export function searchEntries(entries, { query, tag }, index = {}) {
  return entries.flatMap((entry) => {
    if (tag !== "全部" && !entry.tags.includes(tag)) return [];
    const match = findEntryMatch(entry, query, index[entryKey(entry)]);
    return !normalizeSearch(query) || match ? [{ entry, match }] : [];
  });
}

export function contextSnippet(text, query, radius = 65) {
  const index = text.toLocaleLowerCase("zh-Hans").indexOf(normalizeSearch(query));
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, Math.max(0, index) + query.trim().length + radius);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function textSegments(text, query) {
  const needle = query.trim().replace(/\s+/gu, " ");
  if (!needle) return [{ text, match: false }];
  const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"), "giu");
  const segments = [];
  let end = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index > end) segments.push({ text: text.slice(end, match.index), match: false });
    segments.push({ text: match[0], match: true });
    end = match.index + match[0].length;
  }
  if (end < text.length) segments.push({ text: text.slice(end), match: false });
  return segments;
}

export function matchHash(match, query) {
  return match?.id ? `#hit=${encodeURIComponent(match.id)}&q=${encodeURIComponent(query.trim())}` : "";
}

export function parseMatchHash(hash) {
  if (!hash.startsWith("#hit=")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const id = params.get("hit");
  const query = params.get("q");
  if (params.getAll("hit").length !== 1 || params.getAll("q").length !== 1
      || [...params.keys()].some((key) => !["hit", "q"].includes(key)) || !id || !query || query.length > 300) return null;
  return { id, query };
}
