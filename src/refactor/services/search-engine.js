import { entryKey, groupVideos, isDraft } from "../../../packages/content-core/manuscripts.js";
import { partLabel, workKey } from "../../../packages/content-core/identity.js";
import { normalizeSearch, searchEntries } from "../../../packages/content-core/search.js";
import { candidateIds, candidatePartition, metadataMatches, queryGrams, validateCandidateManifest, validateCandidatePartition } from "../../../packages/content-core/search-candidates.js";
import { createResourceCache, throwIfAborted } from "./resource-cache.js";

export function validateSearchIndex(index, expectedKeys) {
  if (!index || typeof index !== "object" || Array.isArray(index)) throw new Error("搜索索引格式损坏");
  for (const [key, blocks] of Object.entries(index)) {
    if (!expectedKeys.has(key) || !Array.isArray(blocks) || blocks.some((block) => !block || typeof block.id !== "string" || !block.id || typeof block.text !== "string")
      || new Set(blocks.map((block) => block.id)).size !== blocks.length) throw new Error("搜索索引与当前快照不一致");
  }
  if ([...expectedKeys].some((key) => !Object.hasOwn(index, key))) throw new Error("搜索索引缺少当前稿件");
  return index;
}

async function mapLimited(items, mapper, signal) {
  let cursor = 0;
  let failed = false;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      throwIfAborted(signal);
      const index = cursor++;
      try { results[index] = await mapper(items[index]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}

export function createSearchEngine(repository, urls, { fetchResource = globalThis.fetch } = {}) {
  const load = createResourceCache(fetchResource);
  async function videoIndex(view, video, signal) {
    const keys = new Set(repository.list(view).filter((entry) => workKey(entry) === video).map(entryKey));
    return load(urls.videos?.[view]?.[video], { signal, validate: (value) => validateSearchIndex(value, keys) });
  }
  function groupsFor(matches) {
    return groupVideos(matches).map((group) => ({ key: group.videoKey, title: group.title,
      parts: group.parts.map((match) => ({ ...match, hits: match.matches || [], metadata: Boolean(match.match && !match.match.id) })) }));
  }
  return {
    async search(options = {}, context = {}) {
      const { query = "", view = "all", mode = "general", tag = "", sort = "relevance", scope } = options;
      const signal = context.signal || options.signal;
      throwIfAborted(signal);
      const scopedView = scope?.view || view;
      const entries = repository.list(scopedView).filter((entry) => (!tag || entry.sourceMetadata.tags.includes(tag))
        && (!scope?.video || workKey(entry) === scope.video) && (!scope?.editionId || entry.editionId === scope.editionId));
      if (!normalizeSearch(query)) return { groups: groupsFor(entries.map((entry) => ({ entry }))), total: entries.length };
      const views = scopedView === "all" ? ["published", "drafts"] : [scopedView];
      const index = {};
      await Promise.all(views.map(async (kind) => {
        const selected = entries.filter((entry) => isDraft(entry) === (kind === "drafts"));
        if (!selected.length) return;
        let candidates = selected;
        if (!scope?.video) {
          const manifest = await load(urls.candidates?.[kind]?.manifest, { signal, validate: validateCandidateManifest });
          const keys = new Map(repository.list(kind).map((entry) => [entryKey(entry), workKey(entry)]));
          if (manifest.entries.length !== keys.size || manifest.entries.some(([key, video]) => keys.get(key) !== video)) throw new Error("搜索候选与当前快照不一致");
          const grams = queryGrams(query, mode);
          const partitions = new Map(await Promise.all([...new Set(grams.map(candidatePartition))].map(async (part) => [part,
            await load(urls.candidates[kind].partitions[part], { signal, validate: (value) => validateCandidatePartition(value, manifest, part) })])));
          const candidateKeys = new Set(candidateIds(manifest, grams, partitions).map((id) => manifest.entries[id][0]));
          candidates = selected.filter((entry) => candidateKeys.has(entryKey(entry)) || (mode === "general" && metadataMatches(entry, query)));
        }
        const videos = [...new Set(candidates.map(workKey))];
        const loaded = await mapLimited(videos, (video) => videoIndex(kind, video, signal), signal);
        for (const blocks of loaded) Object.assign(index, blocks);
      }));
      throwIfAborted(signal);
      const matches = searchEntries(entries, { query, tag: tag || "全部", mode, sort: sort === "title" ? "title" : "body" }, index);
      return { groups: groupsFor(matches), total: matches.length };
    },
    async loadVideo(entry, view = isDraft(entry) ? "drafts" : "published", options = {}) {
      return videoIndex(view, workKey(entry), options.signal);
    },
    partLabel,
  };
}
