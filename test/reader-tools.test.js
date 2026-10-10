import test from "node:test";
import assert from "node:assert/strict";
import { readerToolsMarkup, readingToolPosition, restoreReadingToolPosition } from "../src/reader-tools.js";
import { readerMarkup } from "../src/reader-view.js";
import { continuousPartMarkup } from "../src/continuous-reader.js";

const entry = (partIndex, patch = {}) => ({
  manuscriptType: "publication-draft", contentVersion: 2, platform: "bilibili", externalVideoId: "BVexample", partIndex, videoPartId: partIndex + 1,
  editionId: String(partIndex + 1).padStart(32, "0"), title: "原始长标题", summary: "", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: ["哲学 & 现象学"] }, tags: ["哲学 & 现象学"],
  attribution: "视频转录，AI 整理", editorNote: "编辑说明原文", reviewStatus: "pending-review",
  createdAt: 1791417600, contentSha256: "a".repeat(64), aiRevisionId: "b".repeat(64),
  reviewArtifactSha256: "c".repeat(64), sourceUrl: `https://www.bilibili.com/video/BVexample/?p=${partIndex + 1}`,
  slug: `part-${partIndex + 1}`, ...patch,
});

test("reading tools keep real numeric parts and manuscript category while preserving scoped queries", () => {
  const first = entry(0), tenth = entry(9), published = entry(1, { manuscriptType: "publication", editionId: "e".repeat(32) });
  const route = { kind: "article", entry: first, view: "drafts", mode: "review", videoSearch: { query: "海德格尔", mode: "phrase", view: "all" } };
  const markup = readerToolsMarkup(route, { entries: [tenth, published, first], returnView: "all" });
  assert.match(markup, /返回全部内容目录/);
  assert.match(markup, /P10/);
  assert.doesNotMatch(markup, />P2</);
  assert.match(markup, new RegExp(`review=${tenth.editionId}`));
  assert.match(markup, /vm=phrase/);
  assert.match(markup, /vview=all/);
  const single = readerToolsMarkup(route, { entries: [first] });
  assert.doesNotMatch(single, /reader-part-menu/);
  assert.match(single, /查找当前校验参照/);
});

test("continuous tools target exact P and category without creating a merged publication", () => {
  const first = entry(0), tenth = entry(9);
  const markup = readerToolsMarkup({ kind: "continuous", view: "drafts", entry: tenth }, { entries: [first, tenth] });
  assert.match(markup, /flow=continuous/);
  assert.match(markup, new RegExp(`part=${first.editionId}`));
  assert.doesNotMatch(markup.split('</ol>')[0], /read=|review=/);
  assert.match(markup, new RegExp(`class="reader-mode-link" href="\\?review=${tenth.editionId}"`));
});

test("reader folds detailed provenance but keeps accurate state, immutable body and explorable source tags", () => {
  const manuscript = entry(0);
  const source = "# 冻结标题\n\n原始正文，逐字保持。\n\n## 真实章节\n\n第二段。\n";
  const options = { entries: [manuscript], returnView: "all", pageUrl: "https://example.com/", issueUrl: "https://github.com/example/site/issues/new" };
  const markup = readerMarkup(manuscript, "body", source, options);
  assert.match(markup, /待审核 · 未发布/);
  assert.match(markup, /未经正式发布，信息待核验/);
  assert.match(markup, /<details class="provenance"/);
  assert.doesNotMatch(markup, /<details class="provenance"[^>]* open/);
  for (const text of [manuscript.attribution, manuscript.editorNote, manuscript.contentSha256, "建议修改", "原始正文，逐字保持。", "冻结标题"]) assert.ok(markup.includes(text));
  assert.match(markup, /tag=%E5%93%B2%E5%AD%A6\+%26\+%E7%8E%B0%E8%B1%A1%E5%AD%A6/);
  assert.match(markup, /探索原视频主题标签/);
  assert.match(markup, /<details class="table-of-contents"><summary>本文目录/);
  const reference = readerMarkup(manuscript, "review", source, options);
  assert.match(reference, /AI 初稿的固定校验参照/);
  assert.match(reference, /不构成人工审核记录/);
  assert.ok(reference.includes(manuscript.reviewArtifactSha256));
});

test("continuous part preserves the version and review facts when details are folded", () => {
  const manuscript = entry(0);
  const markup = continuousPartMarkup(manuscript, "# 标题\n\n冻结正文。\n");
  assert.match(markup, /待审核 · 未发布/);
  assert.match(markup, /<details class="provenance"/);
  assert.ok(markup.includes(manuscript.editionId) && markup.includes(manuscript.contentSha256));
  assert.match(markup, /冻结正文。/);
});

test("temporary tools return to the same paragraph fraction after disclosure layout changes", () => {
  const originalWindow = globalThis.window;
  let scrollTarget;
  let focused = false;
  let rect = { top: 20, height: 200, bottom: 220 };
  const target = { isConnected: true, closest: () => null, getBoundingClientRect: () => rect, hasAttribute: () => true,
    focus: (options) => { focused = options.preventScroll; } };
  globalThis.window = { innerHeight: 844, scrollY: 600, scrollTo: (options) => { scrollTarget = options.top; } };
  try {
    const hidden = { closest: () => ({}), getBoundingClientRect: () => ({ top: 0, height: 300, bottom: 300 }) };
    const position = readingToolPosition({ querySelectorAll: () => [hidden, target] }, 100);
    assert.equal(position.target, target, "Closed details must not become a reading position");
    assert.equal(position.fraction, 0.4);
    // Tool results change layout and a later viewport has a different paragraph height.
    rect = { top: -200, height: 300, bottom: 100 };
    assert.equal(restoreReadingToolPosition(position, 120), true);
    assert.equal(scrollTarget, 400);
    assert.equal(focused, true);
    target.isConnected = false;
    assert.equal(restoreReadingToolPosition(position, 120), false);
  } finally { globalThis.window = originalWindow; }
});
