import test from "node:test";
import assert from "node:assert/strict";
import { continuousRoute, resolveReaderRoute } from "../src/manuscripts.js";
import { prepareDocument } from "../src/document.js";
import { continuousPartMarkup } from "../src/continuous-reader.js";

const entry = (part, manuscriptType = "publication-draft", edition = part) => ({
  contentVersion: 2, platform: "bilibili", externalVideoId: "BVexample", partIndex: part - 1, manuscriptType, editionId: String(edition).padStart(32, "0"),
  sourceMetadata: {title: "同一视频", creatorName: null, creatorId: null, metadataObservedAt: null, tags: []}, title: "同一视频", slug: `part-${part}`, sourceUrl: `https://www.bilibili.com/video/BVexample/?p=${part}`,
  reviewStatus: "pending-review", createdAt: 1791417600, publishedAt: 1791417600, attribution: "视频整理", editorNote: "尚待复核", aiRevisionId: "a".repeat(64),
  contentSha256: "b".repeat(64), releaseId: "c".repeat(64),
});

test("continuous route keeps category and exact edition, orders numeric parts and leaves gaps", () => {
  const drafts = [entry(10), entry(2), entry(13)];
  const publication = [entry(2, "publication", 99)];
  const route = resolveReaderRoute(continuousRoute("bilibili.BVexample", "drafts", drafts[0].editionId), publication, drafts);
  assert.equal(route.kind, "continuous");
  assert.equal(route.entry, drafts[0]);
  assert.deepEqual(route.entries.map((part) => part.partIndex + 1), [2, 10, 13]);
  const published = resolveReaderRoute(continuousRoute("bilibili.BVexample", "published"), publication, drafts);
  assert.deepEqual(published.entries, publication);
  assert.equal(resolveReaderRoute(continuousRoute("bilibili.BVexample", "published", drafts[0].editionId), publication, drafts).kind, "missing");
  const empty = resolveReaderRoute(continuousRoute("bilibili.BVexample", "published"), [], drafts);
  assert.equal(empty.kind, "continuous");
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.entry, undefined);
});

test("continuous links reject mixed queries, duplicate selectors and unrelated editions", () => {
  const drafts = [entry(1), { ...entry(2), contentVersion: 2, platform: "bilibili", externalVideoId: "BVother" }];
  const base = continuousRoute("bilibili.BVexample", "drafts");
  for (const query of [`${base}&q=test`, `${base}&mode=general`, `${base}&tag=全部`, `${base}&flow=continuous`,
    `${base}&draft=${drafts[0].editionId}`, `${base}&part=${drafts[1].editionId}`, `${base}&part=`,
    "?video=BVexample&view=all&flow=continuous", "?flow=continuous&view=drafts", "?video=BVexample&part=" + drafts[0].editionId]) {
    assert.equal(resolveReaderRoute(query, [], drafts).kind, "missing", query);
  }
});

test("multiple documents have distinct anchors and safe part boundaries without changing single-reader anchors", () => {
  const source = '# 讲解\n\n## 小节\n\n**原文** [跳到小节](#小节-2)\n\n# 另一个一级标题\n';
  const standalone = prepareDocument(source);
  const first = prepareDocument(source, { idPrefix: "one-", titleLevel: 2 });
  const second = prepareDocument(source, { idPrefix: "two-", titleLevel: 2 });
  assert.match(standalone.body, /id="passage-2"/);
  assert.match(first.title, /<h2/);
  assert.match(first.body, /<h3 id="one-小节-2"/);
  assert.equal(decodeURIComponent(first.body.match(/href="([^"]+)"/)[1]), "#one-小节-2");
  assert.doesNotMatch(first.body, /<h1/);
  assert.ok(first.blocks.every(({ id }) => !second.blocks.some((block) => block.id === id)));
  const draft = entry(2);
  const markup = continuousPartMarkup(draft, source + '\n<script>alert(1)</script>');
  assert.match(markup, /待审核 · 未发布/);
  assert.match(markup, /原视频 · P2/);
  assert.match(markup, /data-reader-panel="source"/);
  assert.ok(markup.includes(draft.editionId));
  assert.match(markup, /关联编辑内容 SHA-256/);
  assert.doesNotMatch(markup, /<script>|已审核 · 已发布|发布 ID/);
});
