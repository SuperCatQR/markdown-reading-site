import { workKey } from "../src/source-identity.js";
import assert from "node:assert/strict";
import { buildCandidateData } from "./search-candidate-data.js";
import { createSearchLoader } from "../src/search-loader.js";
import { searchEntries } from "../src/search.js";
import { entryKey } from "../src/manuscripts.js";
import { candidatePartition } from "../src/search-candidates.js";

const entries = Array.from({ length: 10 }, (_, id) => ({ manuscriptType: "publication-draft", editionId: String(id), contentVersion: 2, platform: "bilibili", externalVideoId: `BV${id}`, partIndex: 0, sourceMetadata: {tags: []}, title: id === 0 ? "秘密标题" : "标题", summary: "", tags: [] }));
const index = Object.fromEntries(entries.map((entry, id) => [entryKey(entry), [{ id: "passage-1", text: id === 1 ? "海德格尔的意义" : "一般正文" }]]));
const candidate = buildCandidateData(entries, index);
const urls = { drafts: "full", candidates: { drafts: { manifest: "manifest", partitions: candidate.partitions.map((_, id) => `pairs${id}`) } }, videos: { drafts: Object.fromEntries(entries.map((entry) => [workKey(entry), workKey(entry)])) } };
const original = { full: index, manifest: candidate.manifest, ...Object.fromEntries(candidate.partitions.map((partition, id) => [`pairs${id}`, partition])), ...Object.fromEntries(entries.map((entry) => [workKey(entry), { [entryKey(entry)]: index[entryKey(entry)] }])) };
const mutate = async (kind) => {
  const resources = structuredClone(original);
  let query = "海德格尔";
  if (kind === "lost posting") resources[`pairs${candidatePartition("海德")}`].postings["海德"] = [];
  if (kind === "wrong body mapping") resources["bilibili.BV1"] = resources["bilibili.BV2"];
  const loader = createSearchLoader(urls, { measure() {}, fetchIndex: async (url) => ({ ok: true, text: async () => JSON.stringify(resources[url]) }) });
  const request = { query, mode: "general", entries, tag: "全部" };
  const result = searchEntries(entries, request, await loader("drafts", null, request));
  assert.notDeepEqual(result, searchEntries(entries, request, index), `equivalence did not detect ${kind}`);
};
for (const kind of ["lost posting", "wrong body mapping"]) await mutate(kind);
console.log("PASS: equivalence detects lost posting and wrong video body mapping");
