import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, validateSnapshot, validateCatalogPair } from "../scripts/catalog.js";
import { canonicalDigest } from "../scripts/universal-contract.js";
import { validateSiteSnapshots } from "../scripts/validate-catalog.mjs";
import { buildReaderData } from "../scripts/reader-content.js";
import { workKey, partIndex } from "../src/source-identity.js";
import { resolveReaderRoute, continuousRoute, groupVideos, adjacentParts, entryKey } from "../src/manuscripts.js";
import { originNoticeMarkup, provenanceMarkup, versionDetailsMarkup } from "../src/reader-details.js";
import { recordFromEntry, createReadingHistoryStore, reconcileReadingRecord } from "../src/reading-history.js";
import { createSearchLoader } from "../src/search-loader.js";
import { validateCandidateManifest } from "../src/search-candidates.js";
import { sourceTagStats } from "../src/discovery-controls.js";
import { missingPartRanges } from "../src/reading-outline.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/universal-origin-v1/", import.meta.url));
async function readSnapshot(folder) {
  const files = new Map();
  async function scan(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await scan(path.join(directory, entry.name), `${name}/`);
      else files.set(name, await readFile(path.join(directory, entry.name)));
    }
  }
  await scan(path.join(fixtureRoot, folder));
  return files;
}
const draftFiles = await readSnapshot("draft-content");
const publicFiles = await readSnapshot("content");
const parse = (files, name) => JSON.parse(files.get(name));
const catalog = parse(draftFiles, "catalog.json");
const origins = parse(draftFiles, "origins.json");
const entryFor = (kind) => {
  const origin = origins.entries.find((entry) => entry.kind === kind);
  return { ...catalog.articles.find((entry) => entry.editionId === origin.editionId), origin };
};
function resign(files) {
  const name = "publication-draft-export-manifest.json";
  const manifest = parse(files, name);
  manifest.files = [...files].filter(([file]) => file !== name).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([file, bytes]) => ({ path: file, sha256: sha256(bytes) }));
  manifest.snapshotId = canonicalDigest({ schemaVersion: 2, manuscriptType: manifest.manuscriptType, contractProfile: manifest.contractProfile, files: manifest.files });
  files.set(name, Buffer.from(JSON.stringify(manifest)));
}
function mutate(name, change) {
  const files = new Map(draftFiles);
  const value = parse(files, name);
  change(value);
  files.set(name, Buffer.from(JSON.stringify(value)));
  resign(files);
  return files;
}

test("consumes producer-exported native, preserved and subsequently edited origins plus empty public v3", async () => {
  assert.deepEqual(validateSnapshot(draftFiles, "publication-draft").errors, []);
  assert.deepEqual(validateSnapshot(publicFiles).errors, []);
  const site = await validateSiteSnapshots(fixtureRoot, { includeOrigins: true });
  assert.equal(site.drafts.articles.length, 3);
  assert.deepEqual(new Set(site.origins.drafts.entries.map((entry) => entry.kind)), new Set(["ai-generated-v2", "preserved-legacy-body", "edited-after-preservation"]));
  assert.ok(catalog.articles.every((entry) => !Object.hasOwn(entry, "bvid") && !Object.hasOwn(entry, "pageIndex")));
  const publication = validateSnapshot(await readSnapshot("published-example"));
  assert.deepEqual(publication.errors, []);
  assert.equal(publication.catalog.articles[0].templateVersion, "publish-v2");
  assert.equal(publication.origins.entries[0].aiTemplateVersion, "ai-draft-v1");
});

test("rejects semantic origin corruption even with a correctly regenerated manifest", () => {
  const changes = [
    (value) => value.entries.pop(), (value) => value.entries.push(value.entries[0]),
    (value) => value.entries.reverse(), (value) => { value.entries[0].kind = "unknown"; },
    (value) => { value.entries[0].aiRevisionId = "f".repeat(64); },
    (value) => { value.entries[0].videoPartId += 1; },
    (value) => { value.entries[0].contentSha256 = "f".repeat(64); },
    (value) => { value.entries[0].inputVersion = 2; },
    (value) => { value.entries[0].aiTemplateVersion = "ai-draft-v2"; },
    (value) => { value.entries[0].bodyPreserved = true; },
    (value) => { value.entries[0].currentBodySha256 = value.entries[0].baselineBodySha256; },
    (value) => { value.entries[0].reviewArtifactSha256 = "f".repeat(64); },
    (value) => { value.entries[0].metadataEvidence[0].observedAt = 123; },
    (value) => { value.entries[0].metadataEvidence[0].kind = "legacy-input"; },
    (value) => { value.entries[0].metadataEvidence[0].valueSha256 = "f".repeat(64); },
    (value) => { value.entries[0].metadataEvidence.push(value.entries[0].metadataEvidence[0]); },
    (value) => { value.entries[0].privatePrompt = "private"; },
    (value) => { value.contractProfile = "future-profile"; },
  ];
  for (const change of changes) assert.ok(validateSnapshot(mutate("origins.json", change), "publication-draft").errors.length, change.toString());
});

test("refuses absent origins, v1 manifest downgrade, unknown files and damaged paired reference", () => {
  const missing = new Map(draftFiles); missing.delete("origins.json"); resign(missing);
  assert.ok(validateSnapshot(missing, "publication-draft").errors.length);
  const downgrade = new Map(draftFiles);
  const manifest = parse(downgrade, "publication-draft-export-manifest.json");
  manifest.schemaVersion = 1; delete manifest.contractProfile;
  manifest.snapshotId = sha256(JSON.stringify(manifest.files));
  downgrade.set("publication-draft-export-manifest.json", Buffer.from(JSON.stringify(manifest)));
  assert.ok(validateSnapshot(downgrade, "publication-draft").errors.length);
  const privateFile = new Map(draftFiles); privateFile.set("private.json", Buffer.from("{}")); resign(privateFile);
  assert.ok(validateSnapshot(privateFile, "publication-draft").errors.length);
  const reference = new Map(draftFiles); reference.set(catalog.articles[0].reviewFile, Buffer.from("Changed reference")); resign(reference);
  assert.ok(validateSnapshot(reference, "publication-draft").errors.length);
});

test("rejects invented BVID, source time substitutions, unknown metadata, unsafe integers and controls", () => {
  const changes = [
    (value) => { value.articles[0].bvid = "Fake"; },
    (value) => { value.articles[0].sourcePublishedAt = new Date(value.articles[0].createdAt * 1000).toISOString(); },
    (value) => { value.articles[0].sourceMetadata.extra = null; },
    (value) => { value.articles[0].sourceMetadata.pubdateUnix = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.articles[0].sourceMetadata.title = "bad\u0000title"; },
    (value) => { value.articles[0].sourceMetadata = null; },
    (value) => { value.articles[0] = null; },
  ];
  for (const change of changes) assert.ok(validateSnapshot(mutate("catalog.json", change), "publication-draft").errors.length);
  assert.ok(validateCatalogPair({ schemaVersion: 2, articles: [] }, catalog).length);
});

test("groups and routes real provider identity without injecting legacy fields", () => {
  const native = entryFor("ai-generated-v2");
  const preserved = entryFor("preserved-legacy-body");
  const edited = entryFor("edited-after-preservation");
  const groups = groupVideos(catalog.articles.map((entry) => ({ entry })));
  assert.equal(groups.length, 2);
  assert.equal(adjacentParts(edited, catalog.articles).next.editionId, preserved.editionId);
  assert.equal(partIndex(preserved), 1);
  const route = resolveReaderRoute(continuousRoute(workKey(native), "drafts", native.editionId), [], catalog.articles);
  assert.equal(route.kind, "continuous"); assert.equal(route.entries.length, 1);
  assert.equal(resolveReaderRoute("?video=undefined&view=drafts", [], catalog.articles).kind, "missing");
  assert.equal(resolveReaderRoute("?video=youtube...%2Fprivate&view=drafts", [], catalog.articles).kind, "missing");
  const sameIdBilibili = { ...native, platform: "bilibili" };
  assert.notEqual(workKey(native), workKey(sameIdBilibili));
  assert.deepEqual(sourceTagStats([{ ...native, tags: ["shared"] }, { ...sameIdBilibili, tags: ["shared"] }]), [{ tag: "shared", count: 2 }]);
  assert.deepEqual(missingPartRanges([preserved]), [[1, 1]]);
});

test("shows preservation, later edits and historical AI baseline truthfully while unknown source time stays unknown", () => {
  const preserved = entryFor("preserved-legacy-body"), edited = entryFor("edited-after-preservation"), native = entryFor("ai-generated-v2");
  assert.match(originNoticeMarkup(preserved), /旧正文迁移.*未重新生成/s);
  assert.match(originNoticeMarkup(edited), /迁移后编辑/);
  assert.match(originNoticeMarkup(preserved, true), /历史 AI 校验基线/);
  assert.equal(originNoticeMarkup(native), "");
  assert.match(versionDetailsMarkup(preserved), /ai-draft-v1/);
  assert.match(versionDetailsMarkup(native), /ai-draft-v2/);
  assert.match(provenanceMarkup(preserved), /视频发布于<\/strong>未知/);
  assert.doesNotMatch(provenanceMarkup(preserved), /1970|undefined/);
  assert.doesNotThrow(() => provenanceMarkup({ ...native, sourceMetadata: { ...native.sourceMetadata, metadataObservedAt: Number.MAX_SAFE_INTEGER } }));
});

test("derives search shards for each platform and loads a universal video without downloading the full index", async () => {
  const generated = await buildReaderData(fixtureRoot);
  const native = entryFor("ai-generated-v2");
  assert.equal(Object.keys(generated.videos.drafts).length, 2);
  assert.doesNotThrow(() => validateCandidateManifest(generated.candidates.drafts.manifest));
  const calls = [];
  const key = workKey(native);
  const loader = createSearchLoader({ drafts: "full", videos: { drafts: { [key]: "youtube-shard" } } }, {
    fetchIndex: async (url) => { calls.push(url); return { ok: true, text: async () => JSON.stringify(generated.videos.drafts[key]) }; },
  });
  assert.ok((await loader("drafts", key))[entryKey(native)]);
  assert.deepEqual(calls, ["youtube-shard"]);
});

test("universal reading progress round-trips frozen source identity and refuses stale edition hashes", () => {
  const entry = entryFor("ai-generated-v2");
  const record = recordFromEntry(entry, { anchor: "paragraph-1", lastReadAt: 1000 });
  assert.equal(Object.hasOwn(record, "bvid"), false);
  let stored = null;
  const store = createReadingHistoryStore({ getItem: () => stored, setItem: (_key, value) => { stored = value; } }, { now: () => 1000 });
  assert.equal(store.write(record).ok, true);
  assert.deepEqual(store.read().records, [record]);
  assert.equal(reconcileReadingRecord(record, [entry]).status, "available");
  assert.equal(reconcileReadingRecord(record, [{ ...entry, contentSha256: "f".repeat(64) }]).status, "updated");
  assert.equal(store.write({ ...record, bvid: "manufactured", lastReadAt: 1001 }).ok, false);
});
