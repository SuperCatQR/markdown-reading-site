import { prepareSearchIndex } from "./search.js";

// Browser diagnostics contain timings and index identity, never the reader's query.
export function measureSearchStage(stage, start, detail = {}, clock = globalThis.performance) {
  if (!clock?.measure) return;
  clock.measure(`reader.search.${stage}`, { start, end: clock.now(), detail });
  const samples = clock.getEntriesByType("measure").filter((entry) => entry.name.startsWith("reader.search."));
  if (samples.length > 120) clock.clearMeasures(samples[0].name);
}

export function createSearchLoader(urls, { fetchIndex = (...args) => fetch(...args), clock = globalThis.performance, measure = measureSearchStage } = {}) {
  const cache = new Map();
  return function load(view, bvid = null) {
    if (!["all", "published", "drafts"].includes(view) || (bvid !== null && !/^[\w-]{1,80}$/.test(bvid))) return Promise.reject(new Error("Unknown search scope"));
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
}

export function showSearchWaiting(results, { isCurrent, cancelId = "cancel-search", longWaitMs = 4000 } = {}) {
  const buttonId = cancelId === "cancel-video-search" ? cancelId : "cancel-search";
  const destination = buttonId === "cancel-video-search" ? "继续阅读" : "回到目录";
  const markup = (longWait) => `<section class="search-feedback" role="status"><p>${longWait ? `搜索资料仍在加载，首次查找可能需要较长时间。你可以继续修改搜索词，或清空搜索${destination}。` : "正在加载搜索资料…首次搜索需下载正文索引。"}</p><button class="reset-button" type="button" id="${buttonId}">清空搜索并取消等待</button></section>`;
  results.innerHTML = markup(false);
  const timer = setTimeout(() => { if (isCurrent()) results.innerHTML = markup(true); }, longWaitMs);
  return () => clearTimeout(timer);
}
