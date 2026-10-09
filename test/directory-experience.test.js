import test from "node:test";
import assert from "node:assert/strict";
import { directoryMarkup, directoryResults, searchControls } from "../src/directory-view.js";
import { entryKey } from "../src/manuscripts.js";

function home(counts, patch = {}) {
  return directoryMarkup({ view: "all", query: "", mode: "general", tag: "全部", tags: ["全部"], counts, videoCount: counts.all ? 1 : 0, ...patch });
}

test("compact home represents empty, preview, released and mixed libraries without claiming preview approval", () => {
  for (const [counts, message] of [
    [{ all: 0, drafts: 0, published: 0 }, "暂无公开内容"],
    [{ all: 2, drafts: 2, published: 0 }, "目前为公开预览"],
    [{ all: 2, drafts: 0, published: 2 }, "全部正式发布"],
    [{ all: 3, drafts: 2, published: 1 }, "发布稿与公开预览"],
  ]) {
    const markup = home(counts);
    assert.ok(markup.includes(message));
    assert.match(markup, new RegExp(`<strong>${counts.all}</strong> 篇稿件`));
    if (counts.drafts) assert.match(markup, /公开预览不代表审核通过/);
    assert.match(markup, /id="search"/);
    assert.doesNotMatch(markup, /class="library-notice"|class="draft-notice"/);
  }
});

test("advanced search keeps an accessible current mode and reveals nondefault shared settings", () => {
  const basic = searchControls({ mode: "general", directory: true });
  assert.match(basic, /id="advanced-search"><summary>/);
  assert.match(basic, /class="search-mode-current">综合搜索/);
  assert.match(basic, /value="general" checked/);
  for (const mode of ["phrase", "keywords"]) {
    const advanced = searchControls({ mode, directory: true });
    assert.match(advanced, /id="advanced-search" open/);
    assert.match(advanced, new RegExp(`value="${mode}" checked`));
    assert.match(advanced, /id="search-sort" aria-describedby="sort-help" disabled/);
  }
  assert.match(searchControls({ directory: true, sort: "title" }), /id="advanced-search" open/);
  assert.doesNotMatch(searchControls({ mode: "phrase" }), /id="search-sort"/);
});

test("theme filtering preserves exact source tag text and safe attributes", () => {
  const tag = '概念 & "原名" <讨论>';
  const markup = home({ all: 1, published: 0, drafts: 1 }, { tag, tags: ["全部", tag] });
  assert.match(markup, /<span class="filter-label">按主题筛选<\/span>/);
  assert.match(markup, /主题来自原视频标签/);
  assert.match(markup, /data-tag="概念 &amp; &quot;原名&quot; &lt;讨论&gt;"/);
  assert.doesNotMatch(markup, /<讨论>/);
});

test("directory keeps full long titles and distinguishes two versions from two parts", () => {
  const title = "完整长标题：" + "哲学讲解与概念辨析".repeat(10);
  const draft = { manuscriptType: "publication-draft", videoPartId: 1, pageIndex: 0, bvid: "BVexample", editionId: "a".repeat(32), title, tags: [], summary: "", reviewStatus: "pending-review", sourceUrl: "https://www.bilibili.com/video/BVexample/?p=1" };
  const published = { ...draft, manuscriptType: "publication", slug: "part-1", editionId: "b".repeat(32) };
  const third = { ...draft, pageIndex: 2, videoPartId: 3, editionId: "c".repeat(32) };
  const summaries = Object.fromEntries([draft, published, third].map((entry) => [entryKey(entry), { minutes: 3 }]));
  const options = { view: "all", query: "", mode: "general", visibleCount: 24, expanded: [], passages: [], counts: { all: 3 } };
  const single = directoryResults([{ entry: draft }], options, summaries).html;
  assert.ok(single.includes(title));
  assert.match(single, /原视频<span class="source-bvid">BVexample/);
  assert.doesNotMatch(single, /已收录 1 个分 P|1 篇稿件|class="parts-disclosure"/);
  const versions = directoryResults([{ entry: draft }, { entry: published }], options, summaries).html;
  assert.match(versions, /同一分 P · 2 个版本/);
  assert.match(versions, /查看 2 个版本与稿件状态/);
  assert.doesNotMatch(versions, /2 个分 P/);
  const parts = directoryResults([{ entry: draft }, { entry: third }], options, summaries).html;
  assert.match(parts, /已收录 2 个分 P/);
  assert.match(parts, /P1/);
  assert.match(parts, /P3/);
  assert.doesNotMatch(parts, /P2/);
});
