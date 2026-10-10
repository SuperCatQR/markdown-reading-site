import { canonicalDigest, ORIGIN_PROFILE } from "../../scripts/universal-contract.js";
import { sha256 } from "../../scripts/catalog.js";

// Synthetic mutations supplement the byte-for-byte producer fixtures. They are
// never used as production input or evidence that a producer exported a release.
export function universalEntry(entry) {
  return { ...entry, contentVersion: 2, platform: entry.platform || "bilibili",
    pubdateUnix: null, sourcePublishedAt: null,
    sourceMetadata: { version: "source-metadata-v1", platform: entry.platform || "bilibili",
      externalVideoId: entry.externalVideoId, partIndex: entry.partIndex,
      title: "合成来源标题", creatorId: null, creatorName: null, pubdateUnix: null,
      sourcePublishedAt: null, metadataObservedAt: null, description: null, coverUrl: null,
      categoryId: null, tags: entry.sourceMetadata?.tags || [], aid: null, partTitle: null, durationMs: null },
  };
}

export function signSnapshot(files, kind, { omit = [] } = {}) {
  const manifestKind = `${kind}-export`, name = `${manifestKind}-manifest.json`;
  const catalog = JSON.parse(files.get("catalog.json"));
  files.set("origins.json", Buffer.from(JSON.stringify({ schemaVersion: 1, manuscriptType: kind,
    contractProfile: ORIGIN_PROFILE, entries: catalog.articles.map((entry) => ({
      kind: "ai-generated-v2", editionId: entry.editionId, aiRevisionId: entry.aiRevisionId,
      videoPartId: entry.videoPartId, contentSha256: entry.contentSha256,
      sourceMetadataSha256: canonicalDigest(entry.sourceMetadata), inputVersion: 2, aiTemplateVersion: "ai-draft-v2",
    })).sort((a, b) => a.editionId < b.editionId ? -1 : a.editionId > b.editionId ? 1 : 0) })));
  const managed = [...files].filter(([file]) => file !== name && !omit.includes(file))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, sha256: sha256(bytes) }));
  const manifest = { schemaVersion: 2, manuscriptType: manifestKind, contractProfile: ORIGIN_PROFILE, files: managed };
  files.set(name, Buffer.from(JSON.stringify({ ...manifest, snapshotId: canonicalDigest(manifest) })));
  return files;
}
