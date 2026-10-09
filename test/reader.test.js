import test from "node:test";
import assert from "node:assert/strict";
import { entryKey, entryRoute, groupVideos, adjacentParts, resolveReaderRoute, statusLabel, sourceTagsByFrequency } from "../src/manuscripts.js";
import { prepareDocument } from "../src/document.js";
import { searchEntries, contextSnippet, textSegments, matchHash, parseMatchHash } from "../src/search.js";
import { createDirectoryStore } from "../src/directory-state.js";
import { directoryMarkup, directoryResults } from "../src/directory-view.js";
import { readerMarkup } from "../src/reader-view.js";

function entry(part, kind = "publication-draft", patch = {}) {
  return {
    manuscriptType: kind, bvid: "BVexample", pageIndex: part - 1, videoPartId: part,
    title: "同一视频的讲解", summary: "", tags: ["哲学"], attribution: "根据视频转录整理，经 AI 合成。",
    editorNote: "人工复核情况见审核状态。", editionId: `${part}`.padStart(32, "0"),
    slug: `part-${part}`, sourceUrl: `https://www.bilibili.com/video/BVexample/?p=${part}`,
    contentSha256: "a".repeat(64), aiRevisionId: "b".repeat(64), releaseId: "c".repeat(64),
    reviewArtifactSha256: "d".repeat(64), createdAt: 1791417600, publishedAt: 1791417600,
    reviewStatus: "pending-review", ...patch,
  };
}

test("source tag options rank frequent tags first and preserve first appearance for ties", () => {
  const entries = [{ tags: ["低频", "并列甲", "常见"] }, { tags: ["常见", "并列乙"] }, { tags: ["并列乙", "常见", "并列甲"] }];
  const before = structuredClone(entries);
  assert.deepEqual(sourceTagsByFrequency(entries), ["常见", "并列甲", "并列乙", "低频"]);
  assert.deepEqual(sourceTagsByFrequency(entries.slice(0, 1)), entries[0].tags);
  assert.deepEqual(sourceTagsByFrequency([]), []);
  assert.deepEqual(entries, before);
});

test("home exposes previews without treating them as releases and explicit published routes remain available", () => {
  assert.deepEqual(resolveReaderRoute("", [], []), { kind: "directory", view: "all" });
  assert.deepEqual(resolveReaderRoute("?view=all", [], []), { kind: "directory", view: "all" });
  assert.deepEqual(resolveReaderRoute("?view=published", [], []), { kind: "directory", view: "published" });
  const counts = { all: 3, published: 0, drafts: 3 };
  const home = directoryMarkup({ view: "all", query: "", tag: "全部", tags: ["全部"], counts, videoCount: 1 });
  assert.match(home, /正式发布内容暂为空/);
  assert.match(home, /公开预览不代表审核通过/);
  const empty = directoryResults([], { view: "published", query: "", counts }, {}).html;
  assert.match(empty, /href="\?view=drafts"/);
  for (const invalid of ["?view=all&view=drafts", "?view=all&draft=" + "1".repeat(32), "?view=unknown"]) {
    assert.equal(resolveReaderRoute(invalid, [], []).kind, "missing");
  }
});

test("video grouping orders numeric parts and preserves publication/draft versions separately", () => {
  const draft = entry(2);
  const published = entry(2, "publication", { editionId: "e".repeat(32) });
  const matches = [entry(13), draft, entry(1), published, entry(10)].map((entry) => ({ entry, match: null }));
  const grouped = groupVideos(matches);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].parts.map(({ entry }) => entry.pageIndex + 1), [1, 2, 2, 10, 13]);
  assert.equal(grouped[0].parts[1].entry, published);
  const navigation = adjacentParts(draft, matches.map(({ entry }) => entry));
  assert.equal(navigation.previous.pageIndex + 1, 1);
  assert.equal(navigation.next.pageIndex + 1, 10);
  assert.ok(navigation.parts.every((part) => part.manuscriptType === "publication-draft"));
  assert.equal(adjacentParts(published, matches.map(({ entry }) => entry)).next, undefined);
  assert.equal(statusLabel({ ...draft, reviewStatus: "approved" }), "已审核 · 未发布");
});

test("search finds readable Markdown text, displays context and links to the exact rendered block", () => {
  const source = '# 标题\n\n这段讨论 **内在**体验与自由。\n\n```text\n其他专名\n```\n\n| 术语 | 说明 |\n| --- | --- |\n| 努斯 | 心智 |\n';
  const document = prepareDocument(source);
  const draft = entry(1);
  const index = { [entryKey(draft)]: document.blocks };
  const matches = searchEntries([draft], { query: "内在体验", tag: "全部" }, index);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].match.label, "正文命中");
  assert.match(document.body, new RegExp(`id="${matches[0].match.id}"`));
  assert.deepEqual(parseMatchHash(matchHash(matches[0].match, "内在体验")), { id: matches[0].match.id, query: "内在体验" });
  assert.equal(searchEntries([draft], { query: "内在体验", tag: "不存在" }, index).length, 0);
  for (const query of ["其他专名", "努斯"]) {
    const [result] = searchEntries([draft], { query, tag: "全部" }, index);
    assert.ok(result.match);
    assert.match(document.body, new RegExp(`id="${result.match.id}"`));
  }
  const snippet = contextSnippet("前".repeat(100) + "内在体验" + "后".repeat(100), "内在体验");
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
  assert.ok(snippet.includes("内在体验") && snippet.length < 150);
  assert.equal(parseMatchHash("#hit=passage-1&q=test&q=again"), null);
});

test("directory omits automatic excerpts, links video sources and preserves safe search evidence", () => {
  assert.deepEqual(textSegments("a [x.*] b [x.*]", "[x.*]").filter((part) => part.match).map((part) => part.text), ["[x.*]", "[x.*]"]);
  const draft = entry(1, "publication-draft", { title: '<img src=x onerror="alert(1)">' });
  const summaries = { [entryKey(draft)]: { excerpt: "正文摘录内容", minutes: 2 } };
  const result = directoryResults([{ entry: draft, match: null }], { view: "all", query: "", visibleCount: 24, expanded: [], counts: { all: 1 } }, summaries);
  assert.doesNotMatch(result.html, /正文摘录|正文摘录内容|class="part-excerpt"/);
  assert.match(result.html, /href="https:\/\/www.bilibili.com\/video\/BVexample\/\?p=1" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(result.html, /<img/);
  assert.match(result.html, /&lt;img/);
  assert.match(result.html, new RegExp(`href="\\?draft=${draft.editionId}"`));
  assert.doesNotMatch(result.html, /href="\?video=/);
  const match = { label: "正文命中", id: "passage-1", text: '<script>危险</script>' };
  const search = directoryResults([{ entry: draft, match }], { view: "all", query: "危险", visibleCount: 24, expanded: [], counts: { all: 1 } }, summaries);
  assert.match(search.html, /<mark>危险<\/mark>/);
  assert.doesNotMatch(search.html, /<script>/);
  const withSummary = { ...draft, summary: "人工编辑摘要" };
  const summaryResult = directoryResults([{ entry: withSummary, match: null }], { view: "all", query: "", visibleCount: 24, expanded: [], counts: { all: 1 } }, summaries);
  assert.match(summaryResult.html, /编辑摘要<\/span>人工编辑摘要/);
});

test("directory state survives return and session restoration, rejects corrupt values and tolerates blocked storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createDirectoryStore(storage);
  const saved = { query: "努斯", mode: "keywords", tag: "哲学", scroll: 860, visibleCount: 48, expanded: ["BVexample"], passages: [entryKey(entry(1))] };
  store.write("all", saved);
  saved.query = "changed";
  assert.equal(store.read("all", ["全部", "哲学"]).query, "努斯");
  assert.deepEqual(createDirectoryStore(storage).read("all", ["全部", "哲学"]), { ...saved, query: "努斯", sort: "body" });
  assert.equal(createDirectoryStore(storage).read("all", ["全部"]).tag, "全部");
  assert.equal(store.read("drafts", ["全部"]).query, "");
  values.set("reading-directory-all", '{"query":1,"tag":"不存在","scroll":-12,"visibleCount":0,"expanded":["../escape",5]}');
  assert.deepEqual(createDirectoryStore(storage).read("all", ["全部"]), { query: "", mode: "general", sort: "body", tag: "全部", scroll: 0, visibleCount: 24, expanded: [], passages: [] });
  const blocked = createDirectoryStore({ getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } });
  blocked.write("all", { ...saved, query: "仍然可用" });
  assert.equal(blocked.read("all", ["全部", "哲学"]).query, "仍然可用");
});

test("reader displays source, editorial notes and review scope with navigation and unmodified document", () => {
  const first = entry(1);
  const second = entry(2);
  const source = "# 原始标题\n\n完整正文，不能改写。\n";
  const html = readerMarkup(first, "body", source, { entries: [first, second], returnView: "all", pageUrl: "https://site.example/", issueUrl: "https://github.com/example/site/issues/new" });
  for (const value of [first.attribution, first.editorNote, "待审核 · 未发布", "不代表对视频中全部观点的学术认证", "完整正文，不能改写。", "返回全部内容目录"]) assert.ok(html.includes(value));
  assert.ok(html.includes(`href="${entryRoute(second)}"`));
  assert.equal(html.match(/<h1/g).length, 1);
  assert.match(html, /从此 P 连续阅读/);
  assert.match(html, /在此视频中查找/);
  assert.doesNotMatch(html, /视频总览/);
  const single = readerMarkup(first, "body", source, { entries: [first], returnView: "all", pageUrl: "https://site.example/", issueUrl: "https://github.com/example/site/issues/new" });
  assert.doesNotMatch(single, /class="parts-navigation"|从此 P 连续阅读/);
  assert.match(single, /class="reader-video-search"/);
});
