import { workKey } from "../src/source-identity.js";
import { universalEntry, signSnapshot } from "./support/universal-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildReaderData } from "../scripts/reader-content.js";
import { createSearchLoader } from "../src/search-loader.js";
import { searchEntries } from "../src/search.js";
import { entryKey } from "../src/manuscripts.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sha256 } from "../scripts/catalog.js";

test("video search never requests the full library and category caches and retries stay independent", async () => {
  const urls = { published: "/all-published.json", drafts: "/all-drafts.json", videos: {
    published: { "bilibili.BVone": "/one-published.json" }, drafts: { "bilibili.BVone": "/one-drafts.json", "bilibili.BVtwo": "/two-drafts.json" },
  } };
  const requests = [];
  let failed = false;
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => {
    requests.push(url);
    if (url === "/one-drafts.json" && !failed) { failed = true; throw Error("offline"); }
    return { ok: true, text: async () => JSON.stringify({ [url]: [] }) };
  } });
  await assert.rejects(loader("all", "bilibili.BVone"));
  assert.deepEqual(await loader("all", "bilibili.BVone"), { "/one-published.json": [], "/one-drafts.json": [] });
  const before = requests.length;
  assert.equal(await loader("all", "bilibili.BVone"), await loader("all", "bilibili.BVone"));
  assert.deepEqual(await loader("published", "bilibili.BVtwo"), {});
  assert.equal(requests.length, before);
  assert.deepEqual(await loader("drafts", "bilibili.BVtwo"), { "/two-drafts.json": [] });
  assert.ok(!requests.some((url) => url.startsWith("/all-")));
  await loader("drafts");
  assert.equal(requests.at(-1), "/all-drafts.json");
  for (const [view, videoKey] of [["unknown", "bilibili.BVone"], ["drafts", "../escape"], ["drafts", ""]]) await assert.rejects(loader(view, videoKey));
});

test("derived video shards equal global body blocks without reference content and preserve phrase and keyword semantics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reader-scoped-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const document = "# 合成稿件\n\n胡塞尔的先验直觉主义。\n\n直觉有其意义。\n";
  const review = "# 校验参照\n\n仅参照中存在的紫色树木。\n";
  const entries = [1, 2].map((part) => {
    const editionId = String(part).padStart(32, "0");
    return universalEntry({ manuscriptType: "publication-draft", slug: `edition-${editionId}`, title: "合成稿件", summary: "", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: [] }, tags: [], attribution: "合成测试", editorNote: "",
      editionId, aiRevisionId: "a".repeat(64), videoPartId: part, contentVersion: 2, platform: "bilibili", externalVideoId: part === 1 ? "BVone" : "BVtwo", partIndex: 0,
      sourceUrl: `https://www.bilibili.com/video/${part === 1 ? "BVone" : "BVtwo"}/?p=1`, contentSha256: "b".repeat(64), artifactSha256: sha256(document),
      reviewStatus: "pending-review", createdAt: 1791417600, file: `drafts/edition-${editionId}/preview.md`, reviewFile: `drafts/edition-${editionId}/review.md`, reviewArtifactSha256: sha256(review) });
  });
  for (const [folder, kind, records] of [["content", "publication", []], ["draft-content", "publication-draft", entries]]) {
    const files = new Map([["catalog.json", Buffer.from(JSON.stringify({ schemaVersion: 3, manuscriptType: kind, articles: records }))]]);
    for (const entry of records) { files.set(entry.file, Buffer.from(document)); files.set(entry.reviewFile, Buffer.from(review)); }
    signSnapshot(files, kind);
    for (const [name, bytes] of files) { const filename = path.join(root, folder, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); }
  }
  const { search, videos } = await buildReaderData(root);
  const videoKey = "bilibili.BVone";
  const candidates = entries.filter((entry) => workKey(entry) === videoKey);
  assert.ok(candidates.length > 0);
  assert.deepEqual(Object.keys(videos.drafts[videoKey]).sort(), candidates.map(entryKey).sort());
  for (const entry of candidates) assert.deepEqual(videos.drafts[videoKey][entryKey(entry)], search.drafts[entryKey(entry)]);
  for (const [query, mode] of [["胡塞尔", "general"], ["先验直觉主义", "phrase"], ["胡塞尔 直觉", "keywords"]]) {
    const request = { query, mode, tag: "全部" };
    assert.deepEqual(searchEntries(candidates, request, videos.drafts[videoKey]), searchEntries(candidates, request, search.drafts));
    assert.ok(searchEntries(candidates, request, videos.drafts[videoKey]).length > 0);
  }
  assert.equal(Object.keys(videos.published).length, 0);
  assert.equal(searchEntries(candidates, { query: "紫色树木", mode: "phrase", tag: "全部" }, videos.drafts[videoKey]).length, 0);
});
