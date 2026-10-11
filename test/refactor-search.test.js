import test from "node:test";
import assert from "node:assert/strict";
import { createSearchEngine } from "../src/refactor/services/search-engine.js";
import { createRepository } from "../src/refactor/services/repository.js";
import { buildCandidateData } from "../scripts/search-candidate-data.js";
import { entryKey, workKey, searchEntries } from "../packages/content-core/index.js";

const draft = (id, patch = {}) => ({ editionId: String(id).padStart(32, "0"), manuscriptType: "publication-draft", contentVersion: 2,
  platform: "bilibili", externalVideoId: `BV${id}`, partIndex: 0, title: `标题${id}`, summary: "", sourceMetadata: { tags: [] }, ...patch });
function fixture() {
  const entries = [draft(1), draft(2), draft(3, { title: "仅有元数据CPU" })];
  const index = { [entryKey(entries[0])]: [{ id: "passage-1", text: "CPU 与自由" }, { id: "passage-2", text: "Windows 与存在" }],
    [entryKey(entries[1])]: [{ id: "passage-1", text: "甲   乙 自由" }], [entryKey(entries[2])]: [{ id: "passage-1", text: "无关键词" }] };
  const data = buildCandidateData(entries, index);
  const urls = { candidates: { drafts: { manifest: "/manifest", partitions: data.partitions.map((_, id) => `/partition-${id}`) } },
    videos: { drafts: Object.fromEntries(entries.map((entry) => [workKey(entry), `/video-${entry.externalVideoId}`])) } };
  const resources = { "/manifest": data.manifest, ...Object.fromEntries(data.partitions.map((value, id) => [`/partition-${id}`, value])),
    ...Object.fromEntries(entries.map((entry) => [`/video-${entry.externalVideoId}`, { [entryKey(entry)]: index[entryKey(entry)] }])) };
  const repository = { list: (view) => view === "published" ? [] : entries };
  const requests = [];
  const fetchResource = async (url, { signal } = {}) => { requests.push(url); signal?.throwIfAborted(); return { ok: true, json: async () => resources[url] }; };
  return { entries, index, urls, resources, repository, requests, fetchResource };
}

test("new search preserves canonical case, phrase, cross-block keyword and ranking semantics", async () => {
  const f = fixture();
  const service = createSearchEngine(f.repository, f.urls, { fetchResource: f.fetchResource });
  for (const [query, mode] of [["cpu", "general"], ["cpu windows", "keywords"], ["CPU Windows", "general"], ["甲 乙", "phrase"], ["甲   乙", "phrase"]]) {
    const actual = await service.search({ query, mode, view: "drafts" });
    const expected = searchEntries(f.entries, { query, mode, tag: "全部" }, f.index);
    assert.deepEqual(actual.groups.flatMap((group) => group.parts).map(({ entry }) => entry.editionId), expected.map(({ entry }) => entry.editionId), `${mode}: ${query}`);
  }
  assert.ok(!f.requests.includes("/full.json"));
});

test("video scope fetches only the same video and manuscript category without candidate assets", async () => {
  const f = fixture(); const service = createSearchEngine(f.repository, f.urls, { fetchResource: f.fetchResource });
  const result = await service.search({ query: "cpu", scope: { video: workKey(f.entries[0]), view: "drafts" } });
  assert.equal(result.total, 1);
  assert.deepEqual(f.requests, ["/video-BV1"]);
  const other = { ...f.entries[0], editionId: "f".repeat(32), partIndex: 1 };
  f.entries.push(other);
  f.resources["/video-BV1"][entryKey(other)] = [{ id: "passage-1", text: "CPU" }];
  const scoped = createSearchEngine(f.repository, f.urls, { fetchResource: f.fetchResource });
  assert.equal((await scoped.search({ query: "cpu", scope: { video: workKey(other), view: "drafts", editionId: other.editionId } })).total, 1);
});

test("content details reject another edition or body identity and can retry", async () => {
  const entry = { ...draft(1), artifactSha256: "a".repeat(64), contentSha256: "b".repeat(64) };
  const origin = { editionId: entry.editionId, contentSha256: entry.contentSha256, aiRevisionId: entry.aiRevisionId };
  let value = { ...entry, origin, contentSha256: "c".repeat(64) };
  let requests = 0;
  const repo = createRepository({ published: [], drafts: [entry], bases: { drafts: "/reader/" } }, { fetchResource: async () => {
    requests++; return { ok: true, json: async () => value };
  } });
  await assert.rejects(repo.loadDetails(repo.findEdition(entry.editionId)), /当前快照/);
  value = { ...entry, origin };
  await repo.loadDetails(repo.findEdition(entry.editionId));
  assert.equal(requests, 2);
});

test("details bind all directory identity fields and the origin to the immutable projection", async () => {
  const entry = { ...draft(1), videoPartId: 12, aiRevisionId: "d".repeat(64), releaseId: null, artifactSha256: "a".repeat(64), contentSha256: "b".repeat(64) };
  const origin = { editionId: entry.editionId, contentSha256: entry.contentSha256, aiRevisionId: entry.aiRevisionId };
  for (const [field, value] of [["platform", "youtube"], ["externalVideoId", "BVdifferent"], ["partIndex", 8], ["videoPartId", 999],
    ["contentVersion", 3], ["aiRevisionId", "f".repeat(64)], ["releaseId", 88], ["manuscriptType", "publication-release"],
    ["origin", { ...origin, editionId: "f".repeat(32) }], ["sourceMetadata", { tags: ["invented"], partTitle: "invented" }]]) {
    const repo = createRepository({ published: [], drafts: [entry], bases: { drafts: "/reader/" } }, {
      fetchResource: async () => ({ ok: true, json: async () => ({ ...entry, origin, [field]: value }) }),
    });
    await assert.rejects(repo.loadDetails(repo.findEdition(entry.editionId)), /当前快照/, field);
  }
});

test("malformed body and candidate indices fail explicitly and remain retryable", async () => {
  for (const target of ["/video-BV1", "/manifest"]) {
    const f = fixture(); const good = f.resources[target]; f.resources[target] = [];
    const service = createSearchEngine(f.repository, f.urls, { fetchResource: f.fetchResource });
    await assert.rejects(service.search({ query: "cpu", view: "drafts" }));
    f.resources[target] = good;
    assert.equal((await service.search({ query: "cpu", view: "drafts" })).total, 2);
    assert.equal(f.requests.filter((url) => url === target).length, 2);
  }
});

test("cancellation reaches fetch, does not cache incomplete data, and allows the next session", async () => {
  const f = fixture(); const controller = new AbortController(); let first = true;
  const service = createSearchEngine(f.repository, f.urls, { fetchResource: async (url, options) => {
    if (first) { first = false; assert.equal(options.signal, controller.signal); controller.abort(); options.signal.throwIfAborted(); }
    return f.fetchResource(url, options);
  } });
  await assert.rejects(service.search({ query: "cpu", view: "drafts" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal((await service.search({ query: "cpu", view: "drafts" })).total, 2);
});

test("empty query and directory construction require no network or heavyweight entry data", async () => {
  const f = fixture(); const service = createSearchEngine(f.repository, f.urls, { fetchResource: f.fetchResource });
  assert.equal((await service.search()).total, 3); assert.equal(f.requests.length, 0);
  const entry = { ...f.entries[0], artifactSha256: "a".repeat(64), contentSha256: "b".repeat(64) };
  const details = { ...entry, sourceUrl: "https://example.test", origin: { kind: "native-ai", editionId: entry.editionId, contentSha256: entry.contentSha256, aiRevisionId: entry.aiRevisionId }, sourceMetadata: { ...entry.sourceMetadata, creatorName: "作者" } };
  const original = new TextEncoder().encode("\uFEFF# 正文\r\n\r\n未经改写的完整文本。\r\n");
  const requests = [];
  const repo = createRepository({ published: [], drafts: [entry], bases: { drafts: "/reader/drafts-fingerprint/" } }, { fetchResource: async (url) => {
    requests.push(url); return new Response(url.endsWith(".json") ? JSON.stringify(details) : original);
  } });
  const found = repo.findEdition(entry.editionId); assert.equal(requests.length, 0); assert.equal(found.origin, undefined);
  assert.equal(await repo.loadDetails(found), found); assert.equal(found.origin.kind, "native-ai");
  assert.deepEqual(new TextEncoder().encode(await repo.loadBody(found)), original);
  assert.deepEqual(requests, [`/reader/drafts-fingerprint/entry-${entry.editionId}.json`, `/reader/drafts-fingerprint/body-${entry.editionId}.md`]);
});
