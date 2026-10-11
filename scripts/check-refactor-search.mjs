// Compare the production search path against canonical semantics using the
// current validated snapshots, and report cold-query resource byte counts.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildReaderData } from "./reader-content.js";
import { createSearchEngine } from "../src/refactor/services/search-engine.js";
import { searchEntries, entryKey } from "../packages/content-core/index.js";

const generated = await buildReaderData(fileURLToPath(new URL("..", import.meta.url)));
const resources = new Map();
const urls = { candidates: {}, videos: {} };
for (const view of ["published", "drafts"]) {
  const data = generated.candidates[view];
  const manifest = `/candidates/${view}`;
  resources.set(manifest, data.manifest);
  urls.candidates[view] = { manifest, partitions: data.partitions.map((value, part) => {
    const url = `/pairs/${view}/${part}`; resources.set(url, value); return url;
  }) };
  urls.videos[view] = Object.fromEntries(Object.entries(generated.videos[view]).map(([video, index]) => {
    const url = `/videos/${view}/${video}`; resources.set(url, index); return [video, url];
  }));
}
const all = [...generated.directory.published, ...generated.directory.drafts];
const repository = { list: (view) => view === "all" ? all : generated.directory[view] };
const bytes = new Map();
const report = [];
for (const [query, mode] of [["存在 自由", "keywords"], ["理性 感性", "keywords"], ["CPU", "general"], ["cpu", "general"], ["甲   乙", "phrase"]]) {
  const requests = [];
  const service = createSearchEngine(repository, urls, { fetchResource: async (url, { signal } = {}) => {
    signal?.throwIfAborted(); requests.push(url);
    const value = resources.get(url);
    assert.ok(value, `Unknown asset ${url}`);
    if (!bytes.has(url)) bytes.set(url, Buffer.byteLength(JSON.stringify(value)));
    return { ok: true, json: async () => value };
  } });
  const actual = await service.search({ query, mode });
  const expected = searchEntries(all, { query, mode, tag: "全部", sort: "body" }, { ...generated.search.published, ...generated.search.drafts });
  const actualKeys = actual.groups.flatMap((group) => group.parts.map(({ entry }) => entryKey(entry))).sort();
  assert.deepEqual(actualKeys, expected.map(({ entry }) => entryKey(entry)).sort(), `${mode}: ${query}`);
  const expectedVideoOrder = [...new Set(expected.map(({ entry }) => `${entry.platform}.${entry.externalVideoId}`))];
  assert.deepEqual(actual.groups.map((group) => group.key), expectedVideoOrder, `Relevance order: ${query}`);
  report.push({ query, mode, manuscripts: actual.total, videos: actual.groups.length, requests: requests.length,
    candidateBytes: requests.filter((url) => !url.startsWith("/videos/")).reduce((sum, url) => sum + bytes.get(url), 0),
    bodyIndexBytes: requests.filter((url) => url.startsWith("/videos/")).reduce((sum, url) => sum + bytes.get(url), 0),
    totalBytes: requests.reduce((sum, url) => sum + bytes.get(url), 0) });
}
console.log(JSON.stringify({ directoryBytes: Buffer.byteLength(JSON.stringify(generated.directory)),
  fullIndexBytes: Buffer.byteLength(JSON.stringify(generated.search.drafts)), checks: report }, null, 2));
