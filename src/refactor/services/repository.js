import { createResourceCache, throwIfAborted } from "./resource-cache.js";

export function createRepository(directory, { summaries = {}, fetchResource = globalThis.fetch } = {}) {
  const entries = { published: directory.published.map((entry) => ({ ...entry })), drafts: directory.drafts.map((entry) => ({ ...entry })) };
  const all = [...entries.published, ...entries.drafts];
  const byEdition = new Map(all.map((entry) => [entry.editionId, entry]));
  const identities = new Map(all.map((entry) => [entry.editionId, structuredClone(entry)]));
  const load = createResourceCache(fetchResource);
  const viewOf = (entry) => entry.manuscriptType === "publication-draft" ? "drafts" : "published";
  const resourceUrl = (entry, kind) => `${directory.bases[viewOf(entry)]}${kind}-${entry.editionId}.${kind === "entry" ? "json" : "md"}`;
  const signalFrom = (options) => options?.signal || (options?.aborted !== undefined ? options : undefined);
  async function loadDetails(entry, options = {}) {
    const signal = signalFrom(options);
    const identity = identities.get(entry.editionId);
    if (!identity || byEdition.get(entry.editionId) !== entry) throw new Error("稿件不在当前目录中");
    const details = await load(resourceUrl(entry, "entry"), { signal, validate(value) {
      const fields = ["editionId", "manuscriptType", "contentVersion", "platform", "externalVideoId", "partIndex", "videoPartId", "aiRevisionId",
        "releaseId", "artifactSha256", "contentSha256", "title", "summary", "reviewStatus", "createdAt", "publishedAt", "sourcePublishedAt"];
      if (!value || Array.isArray(value) || fields.some((field) => (value[field] ?? null) !== (identity[field] ?? null))
        || !value.sourceMetadata || !value.origin || value.origin.editionId !== identity.editionId
        || value.origin.contentSha256 !== identity.contentSha256 || value.origin.aiRevisionId !== identity.aiRevisionId
        || value.sourceMetadata.partTitle !== identity.sourceMetadata.partTitle
        || JSON.stringify(value.sourceMetadata.tags) !== JSON.stringify(identity.sourceMetadata.tags)) throw new Error("稿件详情与当前快照不一致");
      return value;
    } });
    throwIfAborted(signal);
    Object.assign(entry, details);
    return entry;
  }
  async function loadDocument(entry, kind, options = {}) {
    const signal = signalFrom(options);
    await loadDetails(entry, { signal });
    return load(resourceUrl(entry, kind), { signal, text: true });
  }
  return {
    entries, all, summaries,
    findEdition(editionId) { return byEdition.get(editionId) || null; },
    list(view) { return view === "all" ? all : entries[view] || []; },
    loadDetails,
    loadBody(entry, options) { return loadDocument(entry, "body", options); },
    loadReview(entry, options) { return loadDocument(entry, "review", options); },
  };
}
