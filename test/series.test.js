import test from "node:test";
import assert from "node:assert/strict";
import { sha256, validateSnapshot } from "../scripts/catalog.js";
import { validateSeries } from "../scripts/series-contract.js";
import { seriesMarkup, seriesAdjacentMarkup } from "../src/series-view.js";
import { readerMarkup } from "../src/reader-view.js";

const doc = "# 合成系列\n\n明确确认的测试正文。\n", review = "# 合成参照\n\n固定AI基线。\n";
const article = (id, bvid = "BV0000000001", pageIndex = 0) => ({
  manuscriptType: "publication-draft", slug: `edition-${String(id).padStart(32, "0")}`, title: "合成系列稿件", summary: "", tags: [], attribution: "合成测试", editorNote: "",
  editionId: String(id).padStart(32, "0"), aiRevisionId: "a".repeat(64), videoPartId: id, bvid, pageIndex,
  sourceUrl: `https://www.bilibili.com/video/${bvid}/?p=${pageIndex + 1}`, contentSha256: "b".repeat(64), artifactSha256: sha256(doc),
  reviewStatus: "pending-review", createdAt: 1791417600,
  file: `drafts/edition-${String(id).padStart(32, "0")}/preview.md`, reviewFile: `drafts/edition-${String(id).padStart(32, "0")}/review.md`, reviewArtifactSha256: sha256(review),
});
const entries = [article(2, "BV0000000001", 1), article(1), article(3, "BV0000000002")];
const catalog = { schemaVersion: 2, manuscriptType: "publication-draft", articles: entries };
const binding = ({ slug, editionId, contentSha256, artifactSha256 }) => ({ slug, editionId, contentSha256, artifactSha256 });
const envelope = () => ({ schemaVersion: 1, manuscriptType: "publication-draft", editorialVersion: "c".repeat(64), series: [{
  id: "synthetic-only", title: "合成系列", sourceUrl: "https://example.test/editorial-confirmation", evidence: "仅供契约测试的编辑确认依据。",
  members: [{ bvid: "BV0000000001", label: "开始", ordinal: 1, entries: [binding(entries[1]), binding(entries[0])] },
    { bvid: "BV0000000002", label: "继续", ordinal: 3, entries: [binding(entries[2])] },
    { bvid: "BV0000000003", label: "尚无当前类别稿件", ordinal: 4, entries: [] }],
  knownMissing: [{ ordinal: 2, label: "编辑确认缺失", note: "测试来源已明确缺失，不能推测补全。" }],
}] });
function snapshot(series = envelope(), { register = true, seriesBytes } = {}) {
  const files = new Map([["catalog.json", Buffer.from(JSON.stringify(catalog))]]);
  for (const entry of entries) { files.set(entry.file, Buffer.from(doc)); files.set(entry.reviewFile, Buffer.from(review)); }
  if (series !== undefined) files.set("series.json", seriesBytes || Buffer.from(JSON.stringify(series)));
  const records = [...files].filter(([name]) => register || name !== "series.json").sort(([a], [b]) => a < b ? -1 : 1).map(([path, bytes]) => ({ path, sha256: sha256(bytes) }));
  files.set("publication-draft-export-manifest.json", Buffer.from(JSON.stringify({ schemaVersion: 1, manuscriptType: "publication-draft-export", snapshotId: sha256(JSON.stringify(records)), files: records })));
  return files;
}

test("series is optional and binds every current-category part in exact source order", () => {
  assert.deepEqual(validateSeries(envelope(), catalog, "publication-draft"), []);
  assert.deepEqual(validateSnapshot(snapshot(), "publication-draft").errors, []);
  const absent = snapshot(); absent.delete("series.json");
  const manifest = JSON.parse(absent.get("publication-draft-export-manifest.json")); manifest.files = manifest.files.filter(({ path }) => path !== "series.json"); manifest.snapshotId = sha256(JSON.stringify(manifest.files)); absent.set("publication-draft-export-manifest.json", Buffer.from(JSON.stringify(manifest)));
  assert.deepEqual(validateSnapshot(absent, "publication-draft").errors, []);
  assert.equal(validateSnapshot(absent, "publication-draft").series, null);
});

test("series rejects stale, omitted, repeated, reordered and cross-category article bindings", () => {
  for (const invalid of [{ articles: true }, { articles: [null] }, null]) assert.ok(validateSeries(envelope(), invalid, "publication-draft").length);
  const patches = [
    (value) => { value.series[0].members[0].entries[0].artifactSha256 = "f".repeat(64); },
    (value) => { value.series[0].members[0].entries.pop(); },
    (value) => { value.series[0].members[0].entries.reverse(); },
    (value) => { value.series[0].members[0].entries.push(value.series[0].members[0].entries[0]); },
    (value) => { value.series[0].members[1].entries = [binding(entries[0])]; },
    (value) => { value.manuscriptType = "publication"; },
  ];
  for (const patch of patches) { const value = envelope(); patch(value); assert.ok(validateSeries(value, catalog, "publication-draft").length); }
});

test("only normalized, strictly ordered and evidenced editorial relationships are accepted", () => {
  const patches = [
    (value) => { value.updatedBy = "private actor"; },
    (value) => { value.editorialVersion = "not-a-version"; },
    (value) => { value.series[0].evidence = " "; },
    (value) => { value.series[0].title = " bad "; },
    (value) => { value.series[0].evidence = "bad\ntext"; },
    (value) => { value.series[0].members[1].bvid = value.series[0].members[0].bvid; },
    (value) => { value.series[0].members.reverse(); },
    (value) => { value.series[0].knownMissing[0].ordinal = 1; },
    (value) => { value.series.push(structuredClone(value.series[0])); },
    (value) => { value.series[0].members[0].ordinal = true; },
  ];
  for (const patch of patches) { const value = envelope(); patch(value); assert.ok(validateSeries(value, catalog, "publication-draft").length); }
  for (const sourceUrl of ["javascript:alert(1)", "http://example.test", "https://user:pass@example.test", "https://example.test/#note", "https://example.test:bad", "https://example.test\\path", "https://example.test/a b"]) {
    const value = envelope(); value.series[0].sourceUrl = sourceUrl; assert.ok(validateSeries(value, catalog, "publication-draft").length, sourceUrl);
  }
});

test("series remains protected by exact manifest membership, hashes, unique JSON fields and UTF-8", () => {
  assert.ok(validateSnapshot(snapshot(envelope(), { register: false }), "publication-draft").errors.some((error) => error.includes("未登记")));
  const changed = snapshot(); changed.set("series.json", Buffer.from(JSON.stringify({ ...envelope(), editorialVersion: "d".repeat(64) })));
  assert.ok(validateSnapshot(changed, "publication-draft").errors.some((error) => error.includes("SHA-256")));
  for (const bytes of [Buffer.from('{"series":[],"series":[]}'), Buffer.from([0xff]), Buffer.from('\ufeff' + JSON.stringify(envelope()))]) {
    assert.ok(validateSnapshot(snapshot(envelope(), { seriesBytes: bytes }), "publication-draft").errors.length);
  }
});

test("series UI distinguishes editorial missing positions from unavailable category and uses exact same-category body links", () => {
  const html = seriesMarkup(entries[1], envelope().series, entries);
  assert.match(html, /第 1 部 · 开始 · 当前视频/);
  assert.match(html, /编辑确认缺失/);
  assert.match(html, /当前稿件类别暂无收录/);
  assert.match(html, new RegExp(`\\?draft=${entries[2].editionId}`));
  assert.doesNotMatch(html, /\?read=|\?review=/);
  const published = entries.map((entry) => ({ ...entry, manuscriptType: "publication" }));
  const publishedHtml = seriesMarkup(published[1], envelope().series, published);
  assert.match(publishedHtml, /\?read=edition-/);
  assert.doesNotMatch(publishedHtml, /\?draft=/);
  assert.equal(seriesMarkup(entries[1], [], entries), "");
  assert.equal(seriesMarkup(article(9, "BV0000000009"), envelope().series, entries), "");
  const unsafe = envelope(); unsafe.series[0].title = '<img src=x onerror="alert(1)">';
  assert.doesNotMatch(seriesMarkup(entries[1], unsafe.series, entries), /<img/);
  const markup = readerMarkup(entries[1], "body", doc, { entries, returnView: "drafts", pageUrl: "https://example.test/", issueUrl: "https://example.test/", series: envelope().series });
  assert.match(markup, /reading-series/);
  assert.doesNotMatch(readerMarkup(entries[1], "body", doc, { entries, returnView: "drafts", pageUrl: "https://example.test/", issueUrl: "https://example.test/" }), /reading-series/);
});

test("series adjacent navigation preserves confirmed missing positions and does not jump to another category", () => {
  const definitions = envelope().series;
  const first = seriesAdjacentMarkup(entries[1], definitions, entries);
  assert.match(first, /下一视频 · 编辑确认缺失/);
  assert.doesNotMatch(first, /rel="next"/);
  const middle = seriesAdjacentMarkup(entries[2], definitions, entries);
  assert.match(middle, /上一视频 · 编辑确认缺失/);
  assert.match(middle, /当前稿件类别暂无收录/);
  assert.doesNotMatch(middle, /href=/);
  definitions[0].knownMissing = [];
  assert.match(seriesAdjacentMarkup(entries[1], definitions, entries), new RegExp(`rel="next" href="\\?draft=${entries[2].editionId}"`));
  assert.equal(seriesAdjacentMarkup(entries[1], [], entries), "");
});
