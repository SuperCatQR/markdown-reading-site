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
  return function load(view) {
    if (cache.has(view)) {
      measure("memory-cache", clock.now(), { view }, clock);
      return cache.get(view);
    }
    const promise = (async () => {
      if (view === "all") return Object.assign({}, ...await Promise.all([load("published"), load("drafts")]));
      const url = urls[view];
      if (!url) throw new Error("Unknown search category");
      let start = clock.now();
      const response = await fetchIndex(url);
      measure("response", start, { view, url }, clock);
      if (!response.ok) throw new Error("Search index unavailable");
      start = clock.now();
      const text = await response.text();
      measure("download", start, { view, url, characters: text.length }, clock);
      start = clock.now();
      const index = JSON.parse(text);
      measure("parse", start, { view, url }, clock);
      start = clock.now();
      prepareSearchIndex(index);
      measure("normalize", start, { view, url }, clock);
      return index;
    })().catch((error) => { cache.delete(view); throw error; });
    cache.set(view, promise);
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
