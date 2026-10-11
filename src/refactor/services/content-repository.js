import catalog from "../../../content/catalog.json";
import draftCatalog from "../../../draft-content/catalog.json";
import origins from "virtual:reader-origins";
import summaries from "virtual:reader-summaries";
import { isDraft, entryKey } from "../core/content.js";

const bodyFiles = {
  ...import.meta.glob("../../../content/articles/part-*/publish.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../../../draft-content/drafts/edition-*/preview.md", { eager: true, query: "?url", import: "default" }),
};
const reviewFiles = {
  ...import.meta.glob("../../../content/articles/part-*/review.md", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob("../../../draft-content/drafts/edition-*/review.md", { eager: true, query: "?url", import: "default" }),
};

function attachOrigins(entries, snapshot) {
  const index = new Map((snapshot?.entries || []).map((origin) => [origin.editionId, origin]));
  return entries.map((entry) => index.has(entry.editionId) ? { ...entry, origin: index.get(entry.editionId) } : entry);
}

export function createContentRepository() {
  const entries = {
    published: attachOrigins(catalog.articles, origins.published),
    drafts: attachOrigins(draftCatalog.articles, origins.drafts),
  };
  const all = [...entries.published, ...entries.drafts];
  const cache = new Map();
  const load = async (entry, review = false) => {
    const key = `${entryKey(entry)}:${review ? "review" : "body"}`;
    if (!cache.has(key)) {
      const files = review ? reviewFiles : bodyFiles;
      const folder = isDraft(entry) ? "draft-content" : "content";
      const file = review ? entry.reviewFile : entry.file;
      const url = files[`../../../${folder}/${file}`];
      cache.set(key, url ? fetch(url).then((response) => {
        if (!response.ok) throw new Error("文档加载失败");
        return response.text();
      }).catch((error) => { cache.delete(key); throw error; }) : Promise.reject(new Error("文档不在当前快照中")));
    }
    return cache.get(key);
  };
  return {
    entries,
    all,
    summaries,
    findEdition(editionId) { return all.find((entry) => entry.editionId === editionId) || null; },
    list(view) { return view === "all" ? all : entries[view] || []; },
    loadBody(entry) { return load(entry, false); },
    loadReview(entry) { return load(entry, true); },
  };
}
