import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareDocument } from "../src/document.js";
import { prepareReviewDocument, matchReviewPassages, contributionVersion } from "../src/review-document.js";
import { feedbackText, feedbackIssueUrl, createFeedbackStore, feedbackKey } from "../src/contribution-feedback.js";

const entry = { manuscriptType: "publication-draft", editionId: "a".repeat(32), aiRevisionId: "b".repeat(64),
  contentSha256: "c".repeat(64), artifactSha256: "d".repeat(64), reviewArtifactSha256: "e".repeat(64),
  reviewStatus: "pending-review", title: "测试", slug: "edition-test", sourceUrl: "https://example.com/source?p=1", pageIndex: 0 };
const group = (n, quote = "整理句子。") => `## 段落 ${n}：00:00:00 — 00:00:18\n\n来源：\`t1:s0\`；[回看](https://example.com/source?p=1&t=0)\n\n原文：原句。\n\n整理稿：${quote}\n\n- 疑点：词语；候选：字词；依据：t1:s0\n\n`;
const reference = `# 标题：校验参照稿件\n\n修订：\`revision\`\n\n${group(1)}## 未识别的附录\n\n保留全部尾部。\n\n<script>alert(1)</script>\n`;

test("structured reference retains original anchor IDs, unknown tail, safe text and source URLs", () => {
  const generic = prepareDocument(reference), review = prepareReviewDocument(reference);
  assert.equal(review.structured, true);
  assert.deepEqual(review.blocks, generic.blocks);
  for (const { id } of generic.blocks) assert.ok(review.body.includes(`id="${id}"`), id);
  assert.match(review.body, /review-metadata/);
  assert.match(review.body, /保留全部尾部/);
  assert.doesNotMatch(review.body, /<script>/);
  assert.match(review.body, /&lt;script&gt;/);
  assert.equal(review.passages[0].text, "整理句子。");
  assert.equal(review.passages[0].sourceUrl, "https://example.com/source?p=1&t=0");
  const tail = prepareReviewDocument(`${reference}\n\n整理稿：附录中的普通文本。\n`);
  assert.equal(matchReviewPassages(tail.passages, "附录中的普通文本。").length, 0);
});

test("unknown or incomplete reference falls back to the entire safe document", () => {
  for (const text of ["# 未知格式\n\n仍可查找和复制。", group(1).replace("整理稿：", "编辑稿：")]) {
    const review = prepareReviewDocument(text);
    assert.equal(review.structured, false);
    assert.equal(review.body, prepareDocument(text).body);
    assert.deepEqual(review.passages, []);
  }
});

test("mapping normalizes only whitespace and refuses duplicate or changed wording", () => {
  const single = prepareReviewDocument(group(1, "第一句。\n第二句。")).passages;
  assert.equal(matchReviewPassages(single, " 第一\u53e5。 第二句。 ").length, 1);
  assert.equal(matchReviewPassages(single, "第一句, 第二句。").length, 0);
  assert.equal(matchReviewPassages(single, "第一句。").length, 0);
  assert.equal(matchReviewPassages(prepareReviewDocument(group(1) + group(2)).passages, "整理句子。").length, 2);
  assert.equal(matchReviewPassages(single, "").length, 0);
});

test("every version dimension separates feedback and navigation evidence", () => {
  for (const field of ["manuscriptType", "editionId", "aiRevisionId", "contentSha256", "artifactSha256", "reviewArtifactSha256", "releaseId"]) {
    assert.notEqual(contributionVersion(entry), contributionVersion({ ...entry, [field]: "changed" }), field);
  }
  assert.notEqual(feedbackKey(entry, "body"), feedbackKey(entry, "review"));
});

test("feedback carries full identity, exact hash URL and provided source without a release claim", () => {
  const page = `https://example.com/?review=${entry.editionId}#passage-14`;
  const text = feedbackText(entry, "review", page, { quote: "原句", suggestion: "建议", reason: "理由" }, { heading: "段落 1：00:00:00 — 00:00:18", sourceUrl: "https://example.com/?t=0" });
  for (const value of [entry.editionId, entry.contentSha256, entry.aiRevisionId, entry.reviewArtifactSha256, page, "待审核", "原句", "建议", "理由", "参照时间段"]) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /发布 ID/);
  const url = feedbackIssueUrl(entry, "review", page, text, "https://github.com/example/site/issues/new");
  assert.equal(new URL(url).searchParams.get("body"), text);
  const specialUrl = `${page}&vq=$&`;
  assert.ok(feedbackText(entry, "review", specialUrl, {}).includes(`- 稿件链接: ${specialUrl}`));
  assert.equal(feedbackIssueUrl(entry, "review", page, "长".repeat(4000), "https://github.com/example/site/issues/new"), null);
});

test("feedback storage is bounded, survives corruption and reports denied writes", () => {
  let data = "broken";
  const storage = { getItem: () => data, setItem: (_, value) => { data = value; } };
  const store = createFeedbackStore(storage);
  assert.equal(store.read("missing"), null);
  for (let i = 0; i < 14; i++) assert.equal(store.write(String(i), { quote: "长".repeat(8000), suggestion: "建议" }), true);
  assert.equal(JSON.parse(data).length, 10);
  assert.equal(store.read("0"), null);
  assert.equal(store.read("13").quote.length, 4000);
  store.remove("13"); assert.equal(store.read("13"), null);
  const denied = createFeedbackStore({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(denied.read("x"), null); assert.equal(denied.write("x", {}), false); assert.equal(denied.remove("x"), false);
});

test("all current snapshot references retain every block and select their known presentation", () => {
  const catalog = JSON.parse(readFileSync(new URL("../draft-content/catalog.json", import.meta.url)));
  for (const article of catalog.articles) {
    const source = readFileSync(new URL(`../draft-content/${article.reviewFile}`, import.meta.url), "utf8");
    const review = prepareReviewDocument(source);
    assert.equal(review.structured, true, article.editionId);
    for (const { id } of review.blocks) assert.ok(review.body.includes(`id="${id}"`), `${article.editionId}:${id}`);
  }
});
