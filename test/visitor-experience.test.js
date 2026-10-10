import test from "node:test";
import assert from "node:assert/strict";
import { sourceTagStats, tagOptionsMarkup } from "../src/discovery-controls.js";
import { visibleQuery } from "../src/query-state.js";
import { resolveReaderRoute, searchRoute, readerSearchRoute } from "../src/manuscripts.js";
import { sanitizeDirectoryState } from "../src/directory-state.js";
import { prepareDocument } from "../src/document.js";
import { missingPartRanges, partGapsMarkup, readingOutlineMarkup } from "../src/reading-outline.js";
import { sanitizeReadingPreferences, saveReadingPreferences, defaultReadingPreferences } from "../src/reading-preferences.js";
import { partMarkup } from "../src/directory-view.js";

test("whitespace-only shared searches are empty while intentional multiword spacing survives", () => {
  for (const query of ["", " ", "\u00a0", "\t\n　"]) {
    assert.equal(visibleQuery(query), "");
    assert.equal(resolveReaderRoute(`?view=all&q=${encodeURIComponent(query)}`, [], []).searchState.query, "");
    assert.equal(new URLSearchParams(searchRoute({ view: "all", query })).get("q"), "");
    assert.equal(sanitizeDirectoryState({ query }, ["全部"]).query, "");
    assert.equal(new URLSearchParams(readerSearchRoute({ manuscriptType: "publication-draft", editionId: "a".repeat(32) }, { query })).has("vq"), false);
  }
  assert.equal(visibleQuery("黑格尔 "), "黑格尔 ");
  assert.equal(visibleQuery("精神 分析"), "精神 分析");
});

test("topic popularity counts unique source videos, with full exact tags still discoverable", () => {
  const entries = [{ contentVersion: 2, platform: "bilibili", externalVideoId: "BV1", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: ["哲学", "哲学", "原名 & <标签>"] }, tags: ["哲学", "哲学", "原名 & <标签>"] }, { contentVersion: 2, platform: "bilibili", externalVideoId: "BV1", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: ["哲学"] }, tags: ["哲学"] }, { contentVersion: 2, platform: "bilibili", externalVideoId: "BV2", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: ["哲学", "逻辑"] }, tags: ["哲学", "逻辑"] }];
  const stats = sourceTagStats(entries);
  assert.deepEqual(stats, [{ tag: "哲学", count: 2 }, { tag: "原名 & <标签>", count: 1 }, { tag: "逻辑", count: 1 }]);
  const many = Array.from({ length: 875 }, (_, i) => ({ tag: `原标签${i}`, count: 875 - i }));
  const initial = tagOptionsMarkup(many, "原标签874");
  assert.equal((initial.match(/class="tag-option/g) || []).length, 14);
  assert.match(initial, /data-tag="原标签874"/);
  assert.match(initial, /data-tag-more/);
  const search = tagOptionsMarkup(many, "全部", "标签874");
  assert.match(search, /原标签874/);
  assert.doesNotMatch(search, /原标签0/);
  assert.match(tagOptionsMarkup(stats, "全部", "<标签>"), /原名 &amp; &lt;标签&gt;/);
  assert.match(tagOptionsMarkup(stats, "全部", "不存在"), /没有匹配的源标签/);
});

test("paragraph guide uses immutable body anchors and source excerpts; genuine headings stay headings", () => {
  const source = "# 标题\n\n第一段 <安全>。\n\n第二段。\n\n第三段。";
  const prepared = prepareDocument(source, { idPrefix: "part-example-" });
  const guide = readingOutlineMarkup(prepared);
  assert.match(guide, /段落导览/);
  assert.match(guide, /不是编辑章节/);
  for (const block of prepared.blocks) assert.ok(guide.includes(`#${block.id}`));
  assert.match(guide, /&lt;安全&gt;/);
  assert.equal(prepareDocument(source, { idPrefix: "part-example-" }).body, prepared.body);
  assert.equal(readingOutlineMarkup(prepareDocument("一段。")), "");
  const headed = readingOutlineMarkup(prepareDocument("# 标题\n\n## 真实标题\n\n原文。"));
  assert.match(headed, /本文目录/);
  assert.match(headed, /真实标题/);
  assert.doesNotMatch(headed, /段落导览/);
});

test("source gaps describe only missing local parts, including the first recorded part", () => {
  const entries = [14, 6, 10, 6].map((partIndex) => ({ partIndex }));
  assert.deepEqual(missingPartRanges(entries), [[1, 6], [8, 10], [12, 14]]);
  assert.match(partGapsMarkup(entries), /本站尚未收录 P1–P6、P8–P10、P12–P14/);
  assert.match(partGapsMarkup(entries), /不代表原视频缺失/);
  assert.equal(partGapsMarkup([{ partIndex: 0 }, { partIndex: 1 }]), "");
});

test("reading layout only accepts supported values and truthfully reports unavailable persistence", () => {
  assert.deepEqual(sanitizeReadingPreferences({ size: -1, line: Infinity, width: 1, font: "url(evil)" }), defaultReadingPreferences);
  const chosen = { size: 21, line: 2.2, width: 920, font: "sans" };
  let saved;
  assert.equal(saveReadingPreferences({ setItem(key, text) { saved = [key, JSON.parse(text)]; } }, chosen), true);
  assert.deepEqual(saved, ["reading-layout", chosen]);
  assert.equal(saveReadingPreferences({ setItem() { throw new Error("quota"); } }, chosen), false);
});

test("compact results retain every evidence target behind the disclosure", () => {
  const entry = { manuscriptType: "publication-draft", editionId: "a".repeat(32), partIndex: 0, reviewStatus: "pending-review", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: [] }, tags: [] };
  const hits = [1, 2, 3].map((n) => ({ id: `passage-${n}`, text: `原文${n}概念${"后续上下文".repeat(20)}` }));
  const markup = partMarkup({ entry, match: hits[0], matches: hits }, { query: "概念", mode: "general", view: "all", directory: true }, { [`publication-draft:${entry.editionId}`]: { minutes: 3 } });
  assert.match(markup, /其余 2 个命中段落/);
  const beforeDisclosure = markup.split('<details class="passage-disclosure"')[0];
  assert.equal((beforeDisclosure.match(/class="passage-link"/g) || []).length, 1);
  for (const hit of hits) assert.ok(markup.includes(hit.id));
});
