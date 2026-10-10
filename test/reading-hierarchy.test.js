import test from "node:test";
import assert from "node:assert/strict";
import { continuousRoute, readerSearchRoute, resolveReaderRoute, entryKey } from "../src/manuscripts.js";
import { readerFormatRoute } from "../src/reading-routes.js";
import { partsListMarkup } from "../src/reading-layout.js";
import { readerToolsMarkup, readerReturnTarget } from "../src/reader-tools.js";
import { directoryResults } from "../src/directory-view.js";
import { recentReadingMarkup } from "../src/reading-history-browser.js";
import { recordFromEntry } from "../src/reading-history.js";
import { searchEntries, matchHash, parseMatchHash } from "../src/search.js";
import { header } from "../src/ui.js";
import { passageNavigationMarkup } from "../src/search-navigation.js";

const draft = (number, patch = {}) => ({
  manuscriptType: "publication-draft", contentVersion: 2, platform: "bilibili", externalVideoId: "BVexample", partIndex: number - 1,
  editionId: String(number).padStart(32, "0"), title: "一分钟哲学课", summary: "", slug: `part-${number}`,
  sourceMetadata: { title: "一分钟哲学课", partTitle: number === 1 ? '介绍 <与> 来源' : null, tags: [] },
  createdAt: 1791417600, reviewStatus: "pending-review", contentSha256: "a".repeat(64), aiRevisionId: "b".repeat(64), ...patch,
});

test("single/continuous URLs preserve exact query, search mode and scope without admitting unrelated directory controls", () => {
  const entry = draft(1), other = draft(2);
  const search = { query: '主义 & [x.*]', mode: "phrase", view: "all" };
  const single = resolveReaderRoute(readerSearchRoute(entry, search), [], [entry, other]);
  const flow = resolveReaderRoute(readerFormatRoute(entry, single, true), [], [entry, other]);
  assert.equal(flow.kind, "continuous");
  assert.equal(flow.entry, entry);
  assert.deepEqual(flow.videoSearch, search);
  const back = resolveReaderRoute(readerFormatRoute(entry, flow, false), [], [entry, other]);
  assert.equal(back.kind, "article");
  assert.deepEqual(back.videoSearch, search);
  for (const mode of ["general", "phrase", "keywords"]) {
    const href = continuousRoute("bilibili.BVexample", "drafts", entry.editionId, { ...search, mode });
    assert.equal(resolveReaderRoute(href, [], [entry]).videoSearch.mode, mode);
    for (const extra of ['&q=test', '&tag=全部', '&vm=unknown', '&vm=phrase&vm=phrase', '&vq=' + 'x'.repeat(301)]) {
      assert.equal(resolveReaderRoute(href + extra, [], [entry]).kind, "missing");
    }
    const hit = matchHash({ id: "passage-3" }, search.query, mode);
    const toFlow = readerFormatRoute(entry, single, true, { ...search, mode }, hit);
    const flowHash = toFlow.slice(toFlow.indexOf("#"));
    assert.equal(parseMatchHash(flowHash).id, `part-${entry.editionId}-passage-3`);
    const toSingle = readerFormatRoute(entry, flow, false, { ...search, mode }, flowHash);
    assert.equal(toSingle.slice(toSingle.indexOf("#")), hit);
  }
});

test("content identity, manuscript mode and reading format are visible separate controls with safe source names", () => {
  const first = draft(1), second = draft(2);
  const route = { kind: "article", mode: "review", view: "drafts", entry: first };
  const tools = readerToolsMarkup(route, { entries: [first, second], returnView: "all" });
  assert.match(tools, /reader-current-name">P1 · 介绍 &lt;与&gt; 来源/);
  assert.match(tools, /data-reader-mode="review"[^>]*aria-current="page"/);
  assert.match(tools, /data-reader-format="single"[^>]*aria-current="page"/);
  assert.match(tools, /参照查找/);
  const list = partsListMarkup(route, [first, second]);
  assert.match(list, /介绍 &lt;与&gt; 来源/);
  assert.match(list, /分段标题未提供/);
  assert.doesNotMatch(list, /<与>/);
  const returnTarget = readerReturnTarget(route, "all", { view: "all", directory: { query: "概念", mode: "phrase", sort: "title", tag: "全部" } });
  assert.equal(returnTarget.label, "返回全站搜索结果");
  assert.equal(new URLSearchParams(returnTarget.href).get("q"), "概念");
  assert.equal(readerReturnTarget(route, "drafts", null).label, "返回未发布目录");
});

test("continuous passage navigation keeps format, exact part, query and hit instead of switching to single", () => {
  const entry = draft(2);
  const markup = passageNavigationMarkup({ total: 2, current: 0, previous: null, next: { entry, match: { id: "passage-4" } } }, { query: "主义", mode: "phrase", view: "all", manuscriptType: "publication-draft", readingMode: "continuous" });
  const href = markup.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const [query, hash] = href.split("#");
  const route = resolveReaderRoute(query, [], [entry]);
  assert.equal(route.kind, "continuous");
  assert.equal(route.entry, entry);
  assert.deepEqual(route.videoSearch, { query: "主义", mode: "phrase", view: "all" });
  assert.equal(parseMatchHash(`#${hash}`).id, `part-${entry.editionId}-passage-4`);
});

test("exact complete titles precede unrelated body evidence, without weakening phrase or keyword semantics", () => {
  const target = draft(1), other = draft(2, { title: "另一讲", externalVideoId: "BVother" });
  const index = { [entryKey(target)]: [{ id: "passage-1", text: "介绍正文" }], [entryKey(other)]: [{ id: "passage-1", text: "这里提到一分钟哲学课" }] };
  const request = { query: "一分钟哲学课", tag: "全部", sort: "body" };
  assert.equal(searchEntries([other, target], request, index)[0].entry, target);
  assert.deepEqual(searchEntries([other, target], { ...request, mode: "phrase" }, index).map(({ entry }) => entry), [other]);
  assert.deepEqual(searchEntries([other, target], { ...request, query: "一分钟 哲学课", mode: "keywords" }, index).map(({ entry }) => entry), [other]);
});

test("empty states explain active mode and preview links preserve search semantics", () => {
  const counts = { all: 1, published: 0, drafts: 1 };
  for (const [mode, advice] of [["phrase", "连续原句"], ["keywords", "所有关键词"]]) {
    const empty = directoryResults([], { view: "all", query: "原句", mode, counts }, {}).html;
    assert.ok(empty.includes(advice));
    assert.match(empty, /恢复默认查找/);
    const preview = directoryResults([], { view: "published", query: "原句 & 文本", mode, counts }, {}).html;
    const href = preview.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
    const params = new URLSearchParams(href);
    assert.equal(params.get("q"), "原句 & 文本");
    assert.equal(params.get("mode"), mode);
  }
});

test("recent reading is a distinct navigation state and full history does not duplicate the latest record", () => {
  const entry = draft(1);
  const record = recordFromEntry(entry, { anchor: "passage-1", offset: 0.2, text: "正文", lastReadAt: Date.now(), readingMode: "single" });
  const full = recentReadingMarkup({ records: [record], status: "ok" }, [entry], { full: true });
  assert.equal((full.match(/data-reading-resume=/g) || []).length, 1);
  assert.match(full, /介绍 &lt;与&gt; 来源/);
  const nav = header({ directory: true, section: "recent-reading", view: "all", theme: "light", siteRoot: "/" });
  assert.match(nav, /data-directory-section="recent-reading" aria-current="page"/);
  assert.doesNotMatch(nav, /href="\?view=all" aria-current="page"/);
});
