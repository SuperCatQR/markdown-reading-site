import { visibleQuery } from "./query-state.js";
export function browserStorage(name) {
  return {
    getItem(key) { try { return window[name].getItem(key); } catch { return null; } },
    setItem(key, value) { try { window[name].setItem(key, value); } catch { /* In-memory navigation still works. */ } },
  };
}

export function sanitizeDirectoryState(value, tags) {
  const saved = value && typeof value === "object" ? value : {};
  return {
    query: typeof saved.query === "string" ? visibleQuery(saved.query.slice(0, 300)) : "",
    mode: ["general", "phrase", "keywords"].includes(saved.mode) ? saved.mode : "general",
    sort: ["body", "title"].includes(saved.sort) ? saved.sort : "body",
    tag: tags.includes(saved.tag) ? saved.tag : "全部",
    scroll: Number.isFinite(saved.scroll) ? Math.max(0, saved.scroll) : 0,
    visibleCount: Number.isInteger(saved.visibleCount) ? Math.max(24, Math.min(100000, saved.visibleCount)) : 24,
    expanded: Array.isArray(saved.expanded) ? saved.expanded.filter((id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id)) : [],
    passages: Array.isArray(saved.passages) ? saved.passages.filter((id) => typeof id === "string" && /^[\w:-]{1,100}$/.test(id)) : [],
  };
}

// A search origin describes an actual directory-to-reader navigation. A cached
// directory alone cannot establish that the reader came from its results.
export function sanitizeSearchOrigin(value, bvid) {
  if (typeof bvid !== "string" || !/^[\w-]{1,80}$/.test(bvid)
      || value?.kind !== "directory-search" || value.bvid !== bvid
      || !["all", "published", "drafts"].includes(value.view)
      || typeof value.directory?.query !== "string" || !value.directory.query.trim()
      || typeof value.directory?.tag !== "string" || value.directory.tag.length > 300) return null;
  return { kind: "directory-search", bvid, view: value.view,
    directory: sanitizeDirectoryState(value.directory, ["全部", value.directory.tag]) };
}

export function createDirectoryStore(storage) {
  const memory = new Map();
  return {
    read(view, tags) {
      if (!memory.has(view)) {
        try { memory.set(view, JSON.parse(storage.getItem(`reading-directory-${view}`))); }
        catch { memory.set(view, null); }
      }
      return sanitizeDirectoryState(memory.get(view), tags);
    },
    write(view, value) {
      memory.set(view, structuredClone(value));
      try { storage.setItem(`reading-directory-${view}`, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
    },
  };
}
