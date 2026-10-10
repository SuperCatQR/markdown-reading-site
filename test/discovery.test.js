import { workKey } from "../src/source-identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import { searchEntries, searchTerms, contextSnippet, textSegments, matchHash, parseMatchHash } from "../src/search.js";
import { resolveReaderRoute, searchRoute, entryKey, readerSearchRoute, videoEntry } from "../src/manuscripts.js";
import { prepareDocument } from "../src/document.js";
import { readerVideoMarkup, videoResults } from "../src/video-view.js";

const entry = (part, patch = {}) => ({ manuscriptType: "publication-draft", contentVersion: 2, platform: "bilibili", externalVideoId: "BVexample", partIndex: part - 1,
  editionId: String(part).padStart(32, "0"), title: "内在体验", summary: "", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: ["哲学"] }, tags: ["哲学"], reviewStatus: "pending-review",
  sourceUrl: `https://www.bilibili.com/video/BVexample/?p=${part}`, ...patch });
const indexFor = (entries, sources) => Object.fromEntries(entries.map((entry, i) => [entryKey(entry), prepareDocument(sources[i]).blocks]));

test("reverse search requires every keyword in the same body while keeping evidence from separate paragraphs", () => {
  const entries = [entry(1), entry(2), entry(3)];
  const index = indexFor(entries, ["# 标题\n\n内在体验值得讨论。\n\n自由带来痛苦。\n\n再谈内在体验。", "# 标题\n\n自由带来痛苦。", "# 标题\n\n内在体验和自由。"]);
  const results = searchEntries(entries, { query: " 内在体验  自由 内在体验 ", mode: "keywords", tag: "全部" }, index);
  assert.deepEqual(searchTerms(" 内在体验  自由 内在体验 ", "keywords"), ["内在体验", "自由"]);
  assert.deepEqual(results.map(({ entry }) => entry.partIndex), [2, 0]);
  assert.equal(results[1].matches.length, 3);
  assert.deepEqual(results[1].matches[1].terms, ["自由"]);
  assert.equal(searchEntries(entries, { query: "自由 不存在", mode: "keywords", tag: "全部" }, index).length, 0);
  assert.equal(searchEntries(entries, { query: "内在体验 自由", mode: "keywords", tag: "其他" }, index).length, 0);
});

test("body evidence takes priority over matching metadata and phrase mode never admits metadata-only matches", () => {
  const entries = [entry(1), entry(2)];
  const index = indexFor(entries, ["# 标题\n\n没有命中的正文。", "# 标题\n\n内在体验。\n\n再谈内在体验。"]);
  const general = searchEntries(entries, { query: "内在体验", tag: "全部" }, index);
  assert.equal(general[0].entry, entries[1]);
  assert.equal(general[0].matches.length, 2);
  assert.equal(general[1].match.label, "标题");
  assert.equal(searchEntries(entries, { query: "内在体验", mode: "phrase", tag: "全部" }, index).length, 1);
  assert.equal(searchEntries(entries, { query: "内在 体验", mode: "phrase", tag: "全部" }, index).length, 0);
});

test("literal phrase whitespace and overlapping keyword highlights have correct offsets and deep links", () => {
  const text = "前".repeat(100) + "Hello\n  WORLD [x.*]" + "后".repeat(100);
  assert.ok(contextSnippet(text, "hello world").includes("Hello\n  WORLD"));
  assert.deepEqual(textSegments("自由与自由意志 [x.*]", ["自由", "自由意志", "[x.*]"]).filter(({ match }) => match).map(({ text }) => text), ["自由", "自由意志", "[x.*]"]);
  const hit = { id: "passage-2", terms: ["自由"] };
  assert.deepEqual(parseMatchHash(matchHash(hit, "内在 自由", "keywords")), { id: "passage-2", query: "自由", mode: "keywords" });
  for (const hash of ["#hit=p&q=a&m=keywords&m=keywords", "#hit=p&q=a&m=phrase", "#hit=p&q=a&unknown=1"]) assert.equal(parseMatchHash(hash), null);
});

test("video overview exposes numeric parts, missing ranges and both manuscript versions without loading documents", () => {
  const entries = [entry(10), entry(2), entry(2, { manuscriptType: "publication", editionId: "f".repeat(32), slug: "published-2" })];
  const summaries = Object.fromEntries(entries.map((entry) => [entryKey(entry), { minutes: 3, excerpt: "原文摘录" }]));
  const overview = readerVideoMarkup(entries, { view: "all", query: "", mode: "general" });
  assert.match(overview, /已收录 2 个分 P/);
  assert.match(overview, /本站尚未收录 P1、P3–P9/);
  assert.match(overview, /不代表原视频缺失/);
  assert.match(overview, /不代表视频完整目录/);
  const html = videoResults(entries.map((entry) => ({ entry, match: null })), { query: "" }, summaries);
  assert.ok(html.indexOf("?read=published-2") < html.indexOf(`?draft=${entries[1].editionId}`));
  assert.ok(html.indexOf(`?draft=${entries[1].editionId}`) < html.indexOf(`?draft=${entries[0].editionId}`));
  assert.match(html, /已审核 · 已发布/);
  assert.match(html, /待审核 · 未发布/);
  assert.doesNotMatch(html, /原文摘录|正文摘录|class="part-excerpt"/);
  assert.match(videoResults([], { query: "" }, summaries), /此类别暂无收录稿件/);
});

test("reader folds scoped search, restores active queries and makes empty categories recoverable", () => {
  const draft = entry(1);
  const summaries = { [entryKey(draft)]: { minutes: 25 } };
  const render = (options = {}) => readerVideoMarkup([draft], { view: "drafts", query: "", mode: "general", ...options });
  const single = render();
  assert.doesNotMatch(single, /class="reader-video-search" open|视频总览/);
  assert.match(single, /id="video-query"/);
  assert.match(single, /id="video-result-count"/);
  assert.match(single, /校验参照不参与搜索/);
  assert.match(render({ query: "体验" }), /value="体验"/);
  assert.match(render({ mode: "phrase" }), /value="phrase" checked/);
  assert.match(render({ view: "published" }), /value="published" selected/);
  assert.match(single, /data-reader-panel="search" hidden/);
  assert.match(single, /仅筛选查找结果，不切换当前正文/);
  const second = entry(2);
  const multi = readerVideoMarkup([draft, second], { view: "all" });
  assert.match(multi, /已收录 2 个分 P/);
  const published = entry(1, { manuscriptType: "publication", editionId: "f".repeat(32) });
  const both = readerVideoMarkup([draft, published], { view: "all" });
  assert.match(both, /已发布 · 1/);
  assert.match(both, /未发布 · 1/);
});

test("reader search URLs preserve exact edition, category and query without mixing directory parameters", () => {
  const draft = entry(2);
  const published = entry(1, { manuscriptType: "publication", editionId: "f".repeat(32), slug: "published-1" });
  const search = { query: '自由 & "[x.*]"', mode: "keywords", view: "published" };
  const route = resolveReaderRoute(readerSearchRoute(draft, search), [published], [draft]);
  assert.equal(route.entry, draft);
  assert.deepEqual(route.videoSearch, search);
  assert.equal(resolveReaderRoute(readerSearchRoute(draft, search, true), [published], [draft]).mode, "review");
  assert.equal(videoEntry([draft, published], workKey(draft)), published);
  assert.equal(videoEntry([draft, published], workKey(draft), "drafts"), draft);
  assert.equal(videoEntry([draft], workKey(draft), "published"), undefined);
  for (const suffix of ["&vq=a&vq=b", "&vm=semantic", "&vview=unknown", "&vq=" + "x".repeat(301), "&q=test"]) {
    assert.equal(resolveReaderRoute(`${readerSearchRoute(draft)}${suffix}`, [published], [draft]).kind, "missing");
  }
  assert.equal(resolveReaderRoute("?view=all&vq=test", [published], [draft]).kind, "missing");
});

test("search URLs round-trip video scope, exact query and category while rejecting ambiguous manuscript selectors", () => {
  const draft = entry(1);
  const url = searchRoute({ view: "drafts", videoKey: workKey(draft), query: "自由 & [x.*]", mode: "keywords" });
  assert.deepEqual(resolveReaderRoute(url, [], [draft]), { kind: "video", view: "drafts", videoKey: workKey(draft), searchState: { query: "自由 & [x.*]", mode: "keywords", tag: "全部" } });
  assert.deepEqual(resolveReaderRoute(searchRoute({ view: "published", query: "自由", tag: "哲学" }), [], [draft]), { kind: "directory", view: "published", searchState: { query: "自由", mode: "general", sort: "body", tag: "哲学" } });
  for (const invalid of ["?video=missing", "?video=../escape", "?q=a&q=b", "?mode=semantic", "?tag=不存在", "?video=BVexample&tag=哲学", "?video=BVexample&draft=" + draft.editionId, "?review=" + draft.editionId + "&q=test", "?q=" + "a".repeat(301)]) {
    assert.equal(resolveReaderRoute(invalid, [], [draft]).kind, "missing", invalid);
  }
  const summaries = { [entryKey(draft)]: { minutes: 1, excerpt: "摘录" } };
  const blocks = prepareDocument("# 标题\n\n自由。\n\n第二次自由。\n\n第三次自由。").blocks;
  const result = searchEntries([draft], { query: "自由", mode: "keywords", tag: "全部" }, { [entryKey(draft)]: blocks });
  const html = videoResults(result, { query: "自由", mode: "keywords", passages: [entryKey(draft)] }, summaries);
  assert.match(html, /全部关键词命中 · 3 个段落/);
  assert.match(html, /data-entry="publication-draft:[^"]+" open/);
  for (const block of blocks) assert.ok(html.includes(`hit=${block.id}`));
});

test("all additional passage evidence escapes hostile text and literal search expressions", () => {
  const draft = entry(1);
  const text = '<script>alert("[x.*]")</script> & [x.*]';
  const blocks = [1, 2, 3].map((i) => ({ id: `passage-${i}`, text }));
  const result = searchEntries([draft], { query: "[x.*]", mode: "keywords", tag: "全部" }, { [entryKey(draft)]: blocks });
  const html = videoResults(result, { query: "[x.*]", mode: "keywords" }, { [entryKey(draft)]: { minutes: 1, excerpt: "" } });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<mark>\[x\.\*\]<\/mark>/);
  assert.match(html, /&amp;/);
});
