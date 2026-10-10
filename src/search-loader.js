import { prepareSearchIndex } from "./search.js";
import { entryKey } from "./manuscripts.js";
import { queryGrams, candidatePartition, candidateIds, metadataMatches, validateCandidateManifest, validateCandidatePartition } from "./search-candidates.js";

// Browser diagnostics contain timings and index identity, never the reader's query.
const measureCounts = new WeakMap();
export function measureSearchStage(stage, start, detail = {}, clock = globalThis.performance) {
  if (!clock?.measure) return;
  const count = (measureCounts.get(clock) || 0) + 1;
  if (count > 2000) {
    for (const name of new Set(clock.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search.")).map((entry) => entry.name))) clock.clearMeasures(name);
    measureCounts.set(clock, 1);
  } else measureCounts.set(clock, count);
  clock.measure(`reader.search.${stage}`, { start, end: clock.now(), detail });
}

export function createSearchLoader(urls, { fetchIndex = (...args) => fetch(...args), clock = globalThis.performance, measure = measureSearchStage } = {}) {
  const cache = new Map();
  const candidateCache = new Map();
  const current = (request) => { if (request.isCurrent && !request.isCurrent()) throw Error("Search superseded"); };
  async function fetchCandidate(url, detail, validate) {
    if (candidateCache.has(url)) return candidateCache.get(url);
    const promise = (async () => {
      let start = clock.now();
      const response = await fetchIndex(url);
      measure("response", start, detail, clock);
      if (!response.ok) throw Error("Search candidates unavailable");
      start = clock.now();
      const text = await response.text();
      measure("download", start, { ...detail, bytes: new TextEncoder().encode(text).byteLength }, clock);
      start = clock.now();
      const index = validate(JSON.parse(text));
      measure("parse", start, detail, clock);
      return index;
    })().catch((error) => { candidateCache.delete(url); throw error; });
    candidateCache.set(url, promise);
    return promise;
  }
  async function loadCandidates(view, request) {
    if (view === "all") return Object.assign({}, ...await Promise.all([load("published", null, request), load("drafts", null, request)]));
    if (cache.has(`${view}:*`)) return load(view);
    const grams = queryGrams(request.query, request.mode);
    // Broad/short queries use one complete index instead of hundreds of files.
    if (!grams.length || !urls.candidates?.[view] || ((request.mode || "general") === "general" && !Array.isArray(request.entries))) return load(view);
    const descriptor = urls.candidates[view];
    const detail = { view, scope: "candidates" };
    const manifest = await fetchCandidate(descriptor.manifest, { ...detail, url: descriptor.manifest }, validateCandidateManifest);
    current(request);
    if (!manifest.entries.length) return {};
    const partitions = new Map();
    const selected = [...new Set(grams.map(candidatePartition))];
    // Bound both partition and body concurrency; a cleared query stops queuing.
    await boundedMap(selected, async (partition) => {
      current(request);
      const url = descriptor.partitions[partition];
      if (!url) throw Error("Search partition unavailable");
      partitions.set(partition, await fetchCandidate(url, { ...detail, url }, (data) => validateCandidatePartition(data, manifest, partition)));
    });
    current(request);
    let start = clock.now();
    const ids = new Set(candidateIds(manifest, grams, partitions));
    if ((request.mode || "general") === "general") {
      const metadata = new Set((request.entries || []).filter((entry) => metadataMatches(entry, request.query)).map(entryKey));
      manifest.entries.forEach(([key], id) => { if (metadata.has(key)) ids.add(id); });
    }
    measure("candidates", start, { ...detail, candidates: ids.size, documents: manifest.entries.length }, clock);
    // When most documents remain, prefer the compressed full index. Never
    // display provisional counts: searchEntries receives all required bodies.
    if (ids.size > manifest.entries.length * 0.6) return load(view);
    const bvids = [...new Set([...ids].map((id) => manifest.entries[id][1]))];
    const indices = await boundedMap(bvids, async (bvid) => {
      current(request);
      if (!urls.videos?.[view]?.[bvid]) throw Error("Search body unavailable");
      return load(view, bvid);
    });
    current(request);
    return Object.assign({}, ...indices);
  }
  async function boundedMap(items, run) {
    const results = new Array(items.length);
    let cursor = 0;
    let failed = false;
    await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
      while (!failed && cursor < items.length) {
        const position = cursor++;
        try { results[position] = await run(items[position]); }
        catch (error) { failed = true; throw error; }
      }
    }));
    return results;
  }
  function load(view, bvid = null, request = null) {
    if (!["all", "published", "drafts"].includes(view) || (bvid !== null && !/^[\w-]{1,80}$/.test(bvid))) return Promise.reject(new Error("Unknown search scope"));
    if (bvid === null && request?.query?.trim()) return loadCandidates(view, request);
    const key = `${view}:${bvid || "*"}`;
    const scope = bvid ? "video" : "global";
    if (cache.has(key)) {
      measure("memory-cache", clock.now(), { view, scope, ...(bvid ? { bvid } : {}) }, clock);
      return cache.get(key);
    }
    const promise = (async () => {
      if (view === "all") return Object.assign({}, ...await Promise.all([load("published", bvid), load("drafts", bvid)]));
      // A video absent from a category has no searchable body. Never fall back
      // to a full-library download for a scoped query.
      const url = bvid ? urls.videos?.[view]?.[bvid] : urls[view];
      if (bvid && !url) return {};
      if (!url) throw new Error("Unknown search category");
      let start = clock.now();
      const response = await fetchIndex(url);
      const detail = { view, scope, url, ...(bvid ? { bvid } : {}) };
      measure("response", start, detail, clock);
      if (!response.ok) throw new Error("Search index unavailable");
      start = clock.now();
      const text = await response.text();
      measure("download", start, { ...detail, characters: text.length, bytes: new TextEncoder().encode(text).byteLength }, clock);
      start = clock.now();
      const index = JSON.parse(text);
      measure("parse", start, detail, clock);
      start = clock.now();
      prepareSearchIndex(index);
      measure("normalize", start, detail, clock);
      return index;
    })().catch((error) => { cache.delete(key); throw error; });
    cache.set(key, promise);
    return promise;
  };
  return load;
}

export function showSearchWaiting(results, { isCurrent, cancelId = "cancel-search", longWaitMs = 4000 } = {}) {
  const buttonId = cancelId === "cancel-video-search" ? cancelId : "cancel-search";
  const destination = buttonId === "cancel-video-search" ? "继续阅读" : "回到目录";
  const markup = (longWait) => `<section class="search-feedback" role="status"><p>${longWait ? `搜索资料仍在加载，首次查找可能需要较长时间。你可以继续修改搜索词，或清空搜索${destination}。` : "正在加载搜索资料…首次搜索需下载正文索引。"}</p><button class="reset-button" type="button" id="${buttonId}">清空搜索并取消等待</button></section>`;
  results.innerHTML = markup(false);
  const timer = setTimeout(() => { if (isCurrent()) results.innerHTML = markup(true); }, longWaitMs);
  return () => clearTimeout(timer);
}
