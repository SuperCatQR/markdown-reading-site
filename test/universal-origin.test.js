import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, validateSnapshot, validateCatalog, validateCatalogPair } from "../scripts/catalog.js";
import { canonicalDigest, validateUniversalSource } from "../scripts/universal-contract.js";
import { validateSiteSnapshots } from "../scripts/validate-catalog.mjs";
import { buildReaderData } from "../scripts/reader-content.js";
import { workKey, partIndex, partLabel, validWorkKey } from "../src/source-identity.js";
import { resolveReaderRoute, continuousRoute, groupVideos, adjacentParts, entryKey } from "../src/manuscripts.js";
import { originNoticeMarkup, provenanceMarkup, versionDetailsMarkup } from "../src/reader-details.js";
import { READING_HISTORY_KEY, recordFromEntry, createReadingHistoryStore, reconcileReadingRecord } from "../src/reading-history.js";
import { createSearchLoader } from "../src/search-loader.js";
import { validateCandidateManifest } from "../src/search-candidates.js";
import { sourceTagStats } from "../src/discovery-controls.js";
import { missingPartRanges } from "../src/reading-outline.js";
import { searchEntries } from "../src/search.js";
import { metadataMatches } from "../src/search-candidates.js";
import { readerVideoMarkup } from "../src/video-view.js";
import { directoryResults } from "../src/directory-view.js";

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
  assert.deepEqual(sourceTagStats([{ ...native, sourceMetadata: {...native.sourceMetadata, tags: ["shared"]} }, { ...sameIdBilibili, sourceMetadata: {...native.sourceMetadata, tags: ["shared"]} }]), [{ tag: "shared", count: 2 }]);
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
  assert.match(provenanceMarkup(preserved), /视频发布于（UTC）<\/strong>未知/);
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

test("only v3 content-v2 catalogs and explicit provider video routes are accepted", () => {
  for (const schemaVersion of [1, 2]) {
    assert.ok(validateCatalog({ schemaVersion, manuscriptType: "publication", articles: [] }, []).length);
  }
  const entry = entryFor("ai-generated-v2");
  const valid = continuousRoute(workKey(entry), "drafts", entry.editionId);
  const params = new URLSearchParams(valid);
  assert.equal(params.get("platform"), "youtube");
  assert.equal(params.get("video"), entry.externalVideoId);
  for (const query of [`?video=${entry.externalVideoId}`, `?video=${workKey(entry)}`, "?platform=youtube",
    valid + "&platform=youtube", valid.replace("platform=youtube", "platform=unknown"),
    valid.replace(entry.externalVideoId, entry.externalVideoId.toUpperCase())]) {
    assert.equal(resolveReaderRoute(query, [], catalog.articles).kind, "missing", query);
  }
  assert.equal(validWorkKey(entry.externalVideoId), false);
  assert.equal(partLabel(entry), "单视频");
  const sameIdOtherPlatform = { ...entry, platform: "bilibili" };
  assert.equal(groupVideos([entry, sameIdOtherPlatform].map((entry) => ({ entry }))).length, 2);
  assert.notEqual(workKey(entry), workKey({ ...entry, externalVideoId: entry.externalVideoId.toUpperCase() }));
  const youtubePart = mutate("catalog.json", (value) => {
    const item = value.articles.find((item) => item.platform === "youtube");
    item.partIndex = item.sourceMetadata.partIndex = 1;
  });
  assert.ok(validateSnapshot(youtubePart, "publication-draft").errors.length);
});

test("unsafe raw JSON numbers cannot round into valid safe integers", () => {
  for (const token of ["9007199254740993", "9007199254740990.9", "1e100", "2.0000000000000001"]) {
    const files = new Map(draftFiles);
    const raw = files.get("catalog.json").toString().replace('"schemaVersion": 3', `"schemaVersion": ${token}`);
    files.set("catalog.json", Buffer.from(raw)); resign(files);
    assert.ok(validateSnapshot(files, "publication-draft").errors.some((error) => error.includes("安全整数")), token);
  }
});

test("source topics and edited manuscript tags retain separate ownership in search and provenance", () => {
  const original = entryFor("ai-generated-v2");
  const entry = { ...original, title: "编辑后的标题", tags: ["编辑分类"], sourceMetadata: {
    ...original.sourceMetadata, title: "来源原标题<script>", creatorName: "作者<img>", creatorId: "creator-1",
    tags: ["来源主题"], metadataObservedAt: 1791618677,
  } };
  assert.deepEqual(sourceTagStats([entry]), [{ tag: "来源主题", count: 1 }]);
  assert.equal(searchEntries([entry], { query: "来源主题", tag: "全部" }).length, 1);
  assert.equal(searchEntries([entry], { query: "编辑分类", tag: "全部" }).length, 0);
  assert.equal(searchEntries([entry], { query: "", tag: "编辑分类" }).length, 0);
  assert.equal(metadataMatches(entry, "来源主题"), true);
  assert.equal(metadataMatches(entry, "编辑分类"), false);
  assert.equal(resolveReaderRoute("?view=drafts&tag=来源主题", [], [entry]).kind, "directory");
  assert.equal(resolveReaderRoute("?view=drafts&tag=编辑分类", [], [entry]).kind, "missing");
  const markup = provenanceMarkup(entry);
  assert.match(markup, /来源原标题&lt;script&gt;/);
  assert.match(markup, /作者&lt;img&gt; · creator-1/);
  assert.match(markup, /元数据观察时间（UTC）/);
  assert.match(markup, /单视频/);
  assert.doesNotMatch(markup, /P1|PNaN|<script>|<img>/);
  assert.doesNotMatch(readerVideoMarkup([entry], { view: "drafts" }), /分 P|P1/);
  const results = directoryResults([{ entry, matches: [] }], { view: "drafts", query: "来源主题", mode: "general", visibleCount: 24, expanded: [], passages: [] }, { [entryKey(entry)]: { minutes: 1 } });
  assert.match(results.html, /单视频/);
  assert.doesNotMatch(results.html, /分 P|P1/);
  assert.deepEqual(sourceTagStats([{ ...entry, sourceMetadata: { ...entry.sourceMetadata, tags: [] } }]), []);
});

test("new history never consumes or deletes v1 data and requires every source and version field", () => {
  const entry = entryFor("ai-generated-v2");
  const record = recordFromEntry(entry, { anchor: "passage-3", lastReadAt: 1000 });
  const old = '{"schemaVersion":1,"records":["old-data"]}';
  const values = new Map([["reader-history-v1", old]]);
  const store = createReadingHistoryStore({ getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value) }, { now: () => 1000 });
  assert.deepEqual(store.read(), { status: "ok", records: [] });
  assert.equal(store.write(record).ok, true);
  assert.equal(READING_HISTORY_KEY, "reader-history-v2");
  assert.equal(JSON.parse(values.get(READING_HISTORY_KEY)).schemaVersion, 2);
  for (const [field, changed] of Object.entries({ contentVersion: 1, platform: "bilibili",
    externalVideoId: entry.externalVideoId.toUpperCase(), partIndex: 1, editionId: "f".repeat(32),
    contentSha256: "f".repeat(64), artifactSha256: "f".repeat(64) })) {
    assert.equal(reconcileReadingRecord(record, [{ ...entry, [field]: changed }]).status, "updated", field);
  }
  assert.equal(store.write({ ...record, platform: "unknown", lastReadAt: 1001 }).ok, false);
  assert.equal(store.clear().ok, true);
  assert.equal(values.get("reader-history-v1"), old);
});

test("source dates, Unicode and cover URLs honor frozen producer semantics", () => {
  const original = entryFor("ai-generated-v2");
  const withMetadata = (patch) => ({ ...original, sourceMetadata: { ...original.sourceMetadata, ...patch } });
  for (const coverUrl of [null, "https://i0.hdslb.com/a.jpg", "https://I0.HDSLB.COM/a.jpg", "HTTPS://i0.hdslb.com:443/a.jpg"]) {
    assert.deepEqual(validateUniversalSource(withMetadata({ coverUrl })), [], String(coverUrl));
  }
  for (const coverUrl of ["http://i0.hdslb.com/a.jpg", "https://hdslb.com/a.jpg", "https://i0.hdslb.com.evil.test/a.jpg",
    "https://user@i0.hdslb.com/a.jpg", "https://@i0.hdslb.com/a.jpg", "https:///i0.hdslb.com/a.jpg",
    "https://i0.hdslb.com:444/a.jpg", "https://i0.hdslb.com/a.jpg?x=1", "https://i0.hdslb.com/a.jpg#x",
    "https://i0.hdslb.com/a\\b.jpg", "https://i0.hdslb.com/a b.jpg", "https://i.ytimg.com/a.jpg"]) {
    assert.ok(validateUniversalSource(withMetadata({ coverUrl })).length, coverUrl);
  }
  for (const patch of [{ title: "bad\ud800" }, { creatorName: "\u0001" }, { description: "bad\u0000" },
    { tags: ["one", "one"] }, { sourcePublishedAt: "2026-02-30T00:00:00Z" }, { aid: 0 }]) {
    assert.ok(validateUniversalSource(withMetadata(patch)).length, JSON.stringify(patch));
  }
  for (const pubdateUnix of [null, 0]) assert.deepEqual(validateUniversalSource({ ...withMetadata({ pubdateUnix, sourcePublishedAt: null }), pubdateUnix, sourcePublishedAt: null }), []);
  const pubdateUnix = 1791618677, sourcePublishedAt = "2026-10-10T07:51:17Z";
  assert.deepEqual(validateUniversalSource({ ...withMetadata({ pubdateUnix, sourcePublishedAt, description: "line\nnext\ttext\r" }), pubdateUnix, sourcePublishedAt }), []);
});
