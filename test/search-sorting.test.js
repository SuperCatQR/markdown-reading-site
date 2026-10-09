import test from "node:test";
import assert from "node:assert/strict";
import { searchEntries, prepareSearchIndex } from "../src/search.js";
import { entryKey, groupVideos, resolveReaderRoute, searchRoute } from "../src/manuscripts.js";
import { createDirectoryStore, sanitizeDirectoryState } from "../src/directory-state.js";

const draft = (id, title, patch = {}) => ({ manuscriptType: "publication-draft", editionId: String(id).padStart(32, "0"),
  bvid: `BV${id}`, pageIndex: 0, title, summary: "", tags: ["哲学"], ...patch });

test("title relevance is optional, keeps body evidence and ranks videos by their strongest part", () => {
  const entries = [draft(1, "其他题目"), draft(2, "自由专题", { bvid: "BVseries", pageIndex: 10 }),
    draft(3, "自由专题", { bvid: "BVseries", pageIndex: 1 }), draft(4, "自由讲解"), draft(5, "第五讲")];
  const index = Object.fromEntries(entries.map((entry, i) => [entryKey(entry), [{ id: "passage-1", text: ["自由在正文中出现。", "讨论自由。", "不同内容。", "不同内容。", "自由再现。"][i] }]]));
  const options = { query: "自由", tag: "全部" };
  assert.deepEqual(searchEntries(entries, options, index).map(({ entry }) => entry.editionId), [entries[0], entries[1], entries[4], entries[2], entries[3]].map((entry) => entry.editionId));
  const title = searchEntries(entries, { ...options, sort: "title" }, index);
  assert.deepEqual(title.map(({ entry }) => entry.editionId), [entries[1], entries[2], entries[3], entries[0], entries[4]].map((entry) => entry.editionId));
  assert.equal(title[0].match.label, "正文命中");
  assert.equal(title[0].matches[0].id, "passage-1");
  const groups = groupVideos(title);
  assert.equal(groups[0].bvid, "BVseries");
  assert.deepEqual(groups[0].parts.map(({ entry }) => entry.pageIndex), [1, 10]);
  for (const mode of ["phrase", "keywords"]) {
    assert.deepEqual(searchEntries(entries, { ...options, mode, sort: "title" }, index), searchEntries(entries, { ...options, mode }, index));
  }
});

test("normalization caches preserve literal matching, display evidence and allow changed inputs", () => {
  const entry = draft(1, "不同标题");
  const block = { id: "passage-1", text: " Hello\n  WORLD [x.*] " };
  const index = { [entryKey(entry)]: [block] };
  const before = structuredClone(index);
  prepareSearchIndex(index);
  assert.equal(searchEntries([entry], { query: "hello world [x.*]", tag: "全部", mode: "phrase" }, index)[0].match.text, block.text);
  assert.deepEqual(index, before);
  block.text = "新正文自由。";
  assert.equal(searchEntries([entry], { query: "hello", tag: "全部" }, index).length, 0);
  assert.equal(searchEntries([entry], { query: "自由", tag: "全部" }, index).length, 1);
});

test("sort links and directory persistence round-trip while strict routing rejects ambiguous scopes", () => {
  const entry = draft(1, "自由");
  const state = { view: "drafts", query: "自由 & [x.*]", mode: "general", tag: "哲学", sort: "title" };
  const route = resolveReaderRoute(searchRoute(state), [], [entry]);
  assert.equal(route.kind, "directory");
  assert.deepEqual(route.searchState, { query: state.query, mode: state.mode, tag: state.tag, sort: "title" });
  assert.equal(resolveReaderRoute("?view=all&sort=title", [], [entry]).searchState.sort, "title");
  assert.equal(resolveReaderRoute("?view=all&q=自由", [], [entry]).searchState.sort, "body", "Default shared search must override a previously saved title sort");
  for (const url of ["?sort=unknown", "?sort=title&sort=body", `?draft=${entry.editionId}&sort=title`,
    `?video=${entry.bvid}&view=drafts&sort=title`, `?video=${entry.bvid}&view=drafts&flow=continuous&sort=title`]) {
    assert.equal(resolveReaderRoute(url, [], [entry]).kind, "missing", url);
  }
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createDirectoryStore(storage);
  store.write("drafts", { ...state, scroll: 900, visibleCount: 48, expanded: ["BV1"] });
  assert.equal(createDirectoryStore(storage).read("drafts", ["全部", "哲学"]).sort, "title");
  assert.equal(sanitizeDirectoryState({ sort: "injected" }, ["全部"]).sort, "body");
});
