import urls from "virtual:reader-search-urls";
import { entryKey, isDraft, partIndex, partLabel, workKey } from "../core/content.js";

const modes = new Set(["general", "phrase", "keywords"]);
const normalize = (value) => String(value || "").replace(/\s+/gu, " ").trim();

export function createSearchService(repository) {
  const indexes = new Map();
  async function indexFor(view) {
    if (!indexes.has(view)) indexes.set(view, fetch(urls[view]).then((response) => {
      if (!response.ok) throw new Error("搜索索引加载失败");
      return response.json();
    }).catch((error) => { indexes.delete(view); throw error; }));
    return indexes.get(view);
  }
  function metadataMatch(entry, query) {
    const haystack = [entry.title, entry.summary, ...(entry.sourceMetadata?.tags || [])].join(" ").toLocaleLowerCase("zh-Hans");
    return haystack.includes(query.toLocaleLowerCase("zh-Hans"));
  }
  function bodyHits(blocks, query, mode) {
    const clean = normalize(query);
    if (!clean || !Array.isArray(blocks)) return [];
    const terms = clean.split(/\s+/u).filter(Boolean);
    return blocks.filter((block) => {
      const text = normalize(block.text || block.content);
      return mode === "keywords" ? terms.every((term) => text.includes(term)) : mode === "phrase" ? text.includes(clean) : terms.some((term) => text.includes(term));
    }).map((block) => ({ id: block.id, text: normalize(block.text || block.content), terms }));
  }
  return {
    async search({ query = "", view = "all", mode = "general", tag = "", sort = "relevance" } = {}) {
      const clean = normalize(query);
      const sourceEntries = repository.list(view).filter((entry) => !tag || (entry.sourceMetadata?.tags || []).includes(tag));
      if (!clean) {
        const grouped = new Map();
        for (const entry of sourceEntries) {
          const key = workKey(entry);
          if (!grouped.has(key)) grouped.set(key, { key, title: entry.title, parts: [] });
          grouped.get(key).parts.push({ entry, hits: [], metadata: false });
        }
        for (const group of grouped.values()) group.parts.sort((a, b) => partIndex(a.entry) - partIndex(b.entry) || Number(isDraft(a.entry)) - Number(isDraft(b.entry)));
        return { groups: [...grouped.values()], total: sourceEntries.length };
      }
      const views = view === "all" ? ["published", "drafts"] : [view];
      const indexes = Object.fromEntries(await Promise.all(views.map(async (kind) => [kind, await indexFor(kind)])));
      const matches = [];
      for (const entry of sourceEntries) {
        const kind = isDraft(entry) ? "drafts" : "published";
        const hits = bodyHits(indexes[kind]?.[entryKey(entry)], clean, modes.has(mode) ? mode : "general");
        if (hits.length || (mode === "general" && metadataMatch(entry, clean))) matches.push({ entry, hits, metadata: hits.length === 0 });
      }
      const grouped = new Map();
      for (const match of matches) {
        const key = workKey(match.entry);
        if (!grouped.has(key)) grouped.set(key, { key, title: match.entry.title, parts: [] });
        grouped.get(key).parts.push(match);
      }
      const groups = [...grouped.values()].map((group) => ({ ...group, parts: group.parts.sort((a, b) => a.entry.partIndex - b.entry.partIndex) }));
      if (sort === "title") groups.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans"));
      return { groups, total: matches.length };
    },
    async loadVideo(entry, view = isDraft(entry) ? "drafts" : "published") {
      const index = await indexFor(view);
      return index?.[entryKey(entry)] || [];
    },
    partLabel,
  };
}
