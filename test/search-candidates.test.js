import { workKey } from "../src/source-identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateData } from "../scripts/search-candidate-data.js";
import { queryGrams, candidatePartition, candidateIds } from "../src/search-candidates.js";
import { createSearchLoader } from "../src/search-loader.js";
import { searchEntries } from "../src/search.js";
import { entryKey } from "../src/manuscripts.js";

const entries = Array.from({ length: 30 }, (_, id) => ({ manuscriptType: "publication-draft", editionId: `${id}`, contentVersion: 2, platform: "bilibili", externalVideoId: `BV${id}`, title: id === 0 ? "仅标题秘密概念" : "无关标题", summary: "", sourceMetadata: {tags: id === 1 ? ["标签索引"] : []}, tags: [] }));
const index = Object.fromEntries(entries.map((entry, id) => [entryKey(entry), [
  { id: "passage-1", text: id === 2 ? "海德格尔 CAFÉ 😺xyz Foo\n  Bar 中文。" : "普通文本，没有特别概念。" },
  { id: "passage-2", text: id === 2 ? "另一段痛苦，海洋德性格局尔雅只是字符误报。" : "另一段。" },
]]));
const data = buildCandidateData(entries, index);
const urls = { drafts: "/full.json", published: "/published.json", candidates: { drafts: { manifest: "/manifest.json", partitions: data.partitions.map((_, id) => `/pairs-${id}.json`) } }, videos: { drafts: Object.fromEntries(entries.map((entry) => [workKey(entry), `/${entry.externalVideoId}.json`])) } };
const bodies = Object.fromEntries(entries.map((entry) => [`/${entry.externalVideoId}.json`, { [entryKey(entry)]: index[entryKey(entry)] }]));
const resources = { ...bodies, "/full.json": index, "/published.json": {}, "/manifest.json": data.manifest, ...Object.fromEntries(data.partitions.map((value, id) => [`/pairs-${id}.json`, value])) };
function fixture(change = (url, value) => value) {
  const requests = [];
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => {
    requests.push(url);
    return { ok: true, text: async () => JSON.stringify(change(url, resources[url])) };
  } });
  return { requests, loader };
}

test("candidate shards preserve exact Unicode, whitespace, cross-paragraph, metadata, sort and tag results", async () => {
  const cases = [["海德格尔", "general"], ["秘密概念", "general"], ["标签索引", "general"], ["海德格尔 痛苦", "keywords"],
    ["café", "phrase"], ["😺xyz", "phrase"], ["FOO  BAR", "phrase"], ["不存在", "phrase"], ["的", "general"], ["海 痛苦", "keywords"]];
  for (const [query, mode] of cases) for (const sort of ["body", "title"]) for (const tag of ["全部", "标签索引"]) {
    const { loader } = fixture();
    const request = { query, mode, sort, tag, entries };
    assert.deepEqual(searchEntries(entries, request, await loader("drafts", null, request)), searchEntries(entries, request, index), `${query}/${mode}/${sort}/${tag}`);
  }
  const { loader, requests } = fixture();
  await loader("drafts", null, { query: "海德格尔", mode: "general", entries });
  assert.ok(requests.includes("/BV2.json"));
  assert.ok(!requests.includes("/full.json"));
  assert.ok(!requests.includes("/BV0.json"));
  const count = requests.length;
  await loader("drafts", null, { query: "海德格尔", mode: "general", entries });
  assert.equal(requests.length, count, "warm query redownloaded shards");
});

test("a candidate partition failure or corrupt version retries instead of announcing empty results", async () => {
  for (const failure of ["offline", "version", "posting"]) {
    let failed = false;
    const { loader, requests } = fixture((url, value) => {
      if (!failed && url.startsWith("/pairs-")) {
        failed = true;
        if (failure === "offline") throw Error("offline");
        if (failure === "version") return { ...value, fingerprint: "0".repeat(64) };
        return { ...value, postings: { ab: [-1] } };
      }
      return value;
    });
    const request = { query: "海德格尔", mode: "phrase" };
    await assert.rejects(loader("drafts", null, request));
    assert.deepEqual(searchEntries(entries, { ...request, tag: "全部" }, await loader("drafts", null, request)), searchEntries(entries, { ...request, tag: "全部" }, index));
    assert.ok(requests.length > new Set(requests).size, "failed promise was not evicted");
  }
});

test("superseded search stops before candidate body requests and single-character queries use full index", async () => {
  const { loader, requests } = fixture();
  await assert.rejects(loader("drafts", null, { query: "海德格尔", mode: "phrase", isCurrent: () => false }), /superseded/);
  assert.ok(requests.every((url) => !url.startsWith("/BV")));
  const { loader: short, requests: shortRequests } = fixture();
  await short("drafts", null, { query: "的", mode: "phrase" });
  assert.deepEqual(shortRequests, ["/full.json"]);
  await short("drafts", null, { query: "海德格尔", mode: "phrase" });
  assert.deepEqual(shortRequests, ["/full.json"], "already loaded full index must be reused");
});

test("postings intersect in document scope rather than requiring keywords in the same paragraph", () => {
  const grams = queryGrams("海德格尔 痛苦", "keywords");
  const partitions = new Map([...new Set(grams.map(candidatePartition))].map((id) => [id, data.partitions[id]]));
  assert.deepEqual(candidateIds(data.manifest, grams, partitions), [2]);
});

test("candidate body downloads are bounded, stop queuing after cancellation, and retry a failed body", async () => {
  const bodyIndex = Object.fromEntries(entries.map((entry, id) => [entryKey(entry), [{ id: "passage-1", text: id < 17 ? "稀有概念" : "普通文本" }]]));
  const candidateData = buildCandidateData(entries, bodyIndex);
  const bodyResources = { ...resources, "/manifest.json": candidateData.manifest,
    ...Object.fromEntries(candidateData.partitions.map((value, id) => [`/pairs-${id}.json`, value])),
    ...Object.fromEntries(entries.map((entry) => [`/${entry.externalVideoId}.json`, { [entryKey(entry)]: bodyIndex[entryKey(entry)] }])) };
  let active = 0;
  let peak = 0;
  let bodyRequests = 0;
  let failed = false;
  let isCurrent = true;
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => {
    if (url.startsWith("/BV")) {
      bodyRequests++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (!failed) { failed = true; throw Error("body unavailable"); }
    }
    return { ok: true, text: async () => JSON.stringify(bodyResources[url]) };
  } });
  const request = { query: "稀有概念", mode: "phrase", tag: "全部", isCurrent: () => isCurrent };
  await assert.rejects(loader("drafts", null, request));
  assert.ok(bodyRequests <= 8, "a failure did not stop remaining queued bodies");
  const loaded = await loader("drafts", null, request);
  assert.ok(peak <= 8);
  assert.deepEqual(searchEntries(entries, request, loaded), searchEntries(entries, request, bodyIndex));
  const before = bodyRequests;
  isCurrent = false;
  await assert.rejects(loader("drafts", null, request), /superseded/);
  assert.equal(bodyRequests, before);
});
