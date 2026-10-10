import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildReaderData } from "./reader-content.js";
import { createSearchLoader } from "../src/search-loader.js";
import { normalizeSearch, searchEntries } from "../src/search.js";
import { entryKey } from "../src/manuscripts.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = await buildReaderData(root);
const catalog = JSON.parse(await readFile(new URL("../draft-content/catalog.json", import.meta.url)));
const publication = JSON.parse(await readFile(new URL("../content/catalog.json", import.meta.url)));
const entries = [...catalog.articles, ...publication.articles];
const urls = { published: "full/published", drafts: "full/drafts", candidates: {}, videos: {} };
const resources = {};
for (const view of ["published", "drafts"]) {
  resources[urls[view]] = data.search[view];
  urls.candidates[view] = { manifest: `manifest/${view}`, partitions: data.candidates[view].partitions.map((_, id) => `pairs/${view}/${id}`) };
  resources[urls.candidates[view].manifest] = data.candidates[view].manifest;
  data.candidates[view].partitions.forEach((partition, id) => { resources[urls.candidates[view].partitions[id]] = partition; });
  urls.videos[view] = {};
  for (const [bvid, index] of Object.entries(data.videos[view])) { urls.videos[view][bvid] = `video/${view}/${bvid}`; resources[urls.videos[view][bvid]] = index; }
}
// Each real manuscript contributes a middle-body probe; this catches a shard
// mapping defect even when named concepts happen not to visit that manuscript.
const probes = entries.map((entry) => {
  const blocks = data.search[entry.manuscriptType === "publication" ? "published" : "drafts"][entryKey(entry)];
  const text = normalizeSearch(blocks[Math.floor(blocks.length / 2)]?.text || "");
  return text.slice(Math.floor(text.length / 3), Math.floor(text.length / 3) + 5);
}).filter(Boolean);
const queries = [...new Set([...probes, "海德格尔", "胡塞尔", "何为无意识", "审美 痛苦", "的", "FOO   BAR", "café", "😺", "没有这种词zzxyq", "I", "现象学 意义", "存在 时间 意义", ...entries.filter((entry) => entry.tags.length).slice(0, 12).flatMap((entry) => [entry.title, entry.tags[0]])])];
let comparisons = 0;
for (const query of queries) for (const mode of ["general", "phrase", "keywords"]) {
  // Fresh loader prevents a broad probe's full-index cache masking a later
  // candidate defect. Responses share immutable fixture objects to save memory.
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => ({ ok: true, text: async () => JSON.stringify(resources[url]) }) });
  const request = { query, mode, tag: "全部", entries };
  const index = await loader("all", null, request);
  const complete = { ...data.search.published, ...data.search.drafts };
  for (const sort of ["body", "title"]) {
    assert.deepEqual(searchEntries(entries, { ...request, sort }, index), searchEntries(entries, { ...request, sort }, complete), `${query}/${mode}/${sort}`);
    comparisons++;
  }
}
const metrics = [];
for (const query of ["海德格尔", "胡塞尔", "何为无意识", "审美 痛苦", "的"]) {
  const requested = new Set();
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => { requested.add(url); return { ok: true, text: async () => JSON.stringify(resources[url]) }; } });
  const request = { query, mode: query.includes(" ") ? "keywords" : "general", entries, tag: "全部" };
  const index = await loader("drafts", null, request);
  const json = [...requested].map((url) => JSON.stringify(resources[url]));
  metrics.push({ query, requests: requested.size, decodedBytes: json.reduce((sum, text) => sum + Buffer.byteLength(text), 0), gzipBytes: json.reduce((sum, text) => sum + gzipSync(text).byteLength, 0), matches: searchEntries(entries, request, index).length });
}
const report = { manuscripts: entries.length, queries: queries.length, comparisons, baseline: { decodedBytes: Buffer.byteLength(JSON.stringify(data.search.drafts)), gzipBytes: gzipSync(JSON.stringify(data.search.drafts)).length }, metrics };
await mkdir(new URL("../.tmp/", import.meta.url), { recursive: true });
await writeFile(new URL("../.tmp/search-equivalence.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
