import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { highlight, libraryPage, recentPage, sourcePanel } from "../src/refactor/views.js";
import { feedbackText, feedbackIssueHref, validateFeedbackDraft } from "../src/refactor/features/feedback.js";

const catalog = JSON.parse(await readFile(new URL("./fixtures/universal-origin-v1/draft-content/catalog.json", import.meta.url), "utf8"));
const entry = catalog.articles[0];
const repository = { all: [entry], list: () => [entry], findEdition: (editionId) => editionId === entry.editionId ? entry : null, summaries: {} };

test("highlight matches original text without splitting HTML entities or creating elements from a query", () => {
  assert.equal(highlight("A&B <img src=x>", "&"), "A<mark>&amp;</mark>B &lt;img src=x&gt;");
  assert.equal(highlight("<script>alert(1)</script>", "<script>"), "<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;");
  assert.equal(highlight("safe &amp; text", "amp"), "safe &amp;<mark>amp</mark>; text");
});

test("feedback links carry complete unmodified version evidence and user text", () => {
  const options = { entry, pageUrl: "https://example.com/site/#/read/" + entry.editionId + "?block=passage-1", quote: "旧原句", context: "上下文 & <tag>", suggestion: "改为另一句", reason: "术语错误", mode: "body" };
  const text = feedbackText(options);
  const issue = new URL(feedbackIssueHref(options));
  assert.equal(issue.searchParams.get("body"), text);
  for (const field of ["editionId", "aiRevisionId", "contentSha256", "artifactSha256", "reviewArtifactSha256"]) assert.ok(text.includes(entry[field]), field);
  assert.ok(text.includes(options.context));
  assert.ok(text.includes(options.pageUrl));
  assert.equal(validateFeedbackDraft({ quote: "句", suggestion: "", reason: "" }).valid, false);
  assert.equal(feedbackIssueHref({ ...options, context: "长".repeat(4000) }), "");
  assert.ok(feedbackText({ ...options, context: "长".repeat(4000) }).endsWith("术语错误\n"));
});

test("recent page preserves stale and withdrawn records without restoring their anchors", () => {
  const withdrawn = { editionId: "f".repeat(32), title: "已撤回篇目", part: 0, readAt: 1 };
  const stale = { editionId: entry.editionId, title: entry.title, anchor: "old-block", readAt: 2 };
  const html = recentPage({ route: { name: "recent" }, theme: "light", repository, state: { status: {} }, records: [{ record: withdrawn, entry: null, status: "missing" }, { record: stale, entry, status: "stale" }] });
  assert.ok(html.includes("已撤回篇目"));
  assert.ok(html.includes(`data-remove-history="${withdrawn.editionId}"`));
  assert.ok(html.includes("从当前版本开始"));
  assert.ok(!html.includes("old-block"));
  assert.ok(!html.includes("继续阅读 <svg"));
});

test("empty published scope leads directly to preview while source timestamps remain unknown", () => {
  const html = libraryPage({ route: { name: "library", view: "published", mode: "general" }, repository, groups: [], history: [], theme: "light" });
  assert.ok(html.includes('href="#/library?view=drafts"'));
  const source = sourcePanel({ ...entry, sourceMetadata: { ...entry.sourceMetadata, sourcePublishedAt: null, pubdateUnix: null, metadataObservedAt: null } });
  assert.ok(source.includes("源视频发布时间</dt><dd>未知"));
  assert.ok(!source.includes("Invalid Date"));
});

test("search previews choose the most relevant P while expansion keeps source order", () => {
  const parts = [0, 1, 2, 3].map((partIndex) => ({ ...entry, editionId: `${String(partIndex + 1).repeat(32)}`.slice(0, 32), partIndex, videoPartId: partIndex + 1 }));
  const groups = [{ title: entry.title, parts: [
    { entry: parts[0], score: 2, hits: [{ id: "p1", text: "早期命中" }] },
    { entry: parts[1], score: 50, hits: [{ id: "p2", text: "第二相关" }] },
    { entry: parts[2], score: 98, hits: [{ id: "p3", text: "最相关命中" }] },
    { entry: parts[3], score: 1, hits: [{ id: "p4", text: "较弱命中" }] },
  ] }];
  const localRepository = { ...repository, all: parts, list: () => parts, findEdition: (id) => parts.find((part) => part.editionId === id), summaries: {} };
  const html = libraryPage({ route: { name: "search", query: "命中", view: "all", mode: "general" }, repository: localRepository, groups, history: [], theme: "light" });
  const titleHref = html.match(/<h2><a href="([^"]+)"/)[1];
  assert.equal(titleHref, `#/read/${parts[2].editionId}?block=p3`);
  const partEditions = (markup) => [...markup.matchAll(/<a href="#\/read\/([0-9a-f]{32})[^\"]*" class="result-part-link">/g)].map((match) => match[1]);
  assert.deepEqual(partEditions(html), [parts[2].editionId, parts[1].editionId, parts[0].editionId, parts[3].editionId]);
  assert.deepEqual(partEditions(html.split('<details class="more-parts">')[0]), [parts[2].editionId, parts[1].editionId]);
  assert.deepEqual(groups[0].parts.map(({ entry }) => entry.editionId), parts.map((part) => part.editionId));
  groups[0].parts[1].score = 98;
  const tied = libraryPage({ route: { name: "search", query: "命中", view: "all", mode: "general" }, repository: localRepository, groups, history: [], theme: "light" });
  assert.deepEqual(partEditions(tied), [parts[1].editionId, parts[2].editionId, parts[0].editionId, parts[3].editionId]);
});
