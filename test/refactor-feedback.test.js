import test from "node:test";
import assert from "node:assert/strict";
import { feedbackFieldCounts, feedbackPanel, feedbackText, feedbackIssueHref, normalizeFeedbackDraft, validateFeedbackDraft } from "../src/refactor/features/feedback.js";

const entry = {
  title: "哲学 <script>课</script>", manuscriptType: "publication", platform: "bilibili", externalVideoId: "BVCaseA",
  partIndex: 2, videoPartId: 3, contentVersion: 2, editionId: "a".repeat(32), aiRevisionId: "b".repeat(64),
  contentSha256: "c".repeat(64), artifactSha256: "d".repeat(64), reviewArtifactSha256: "e".repeat(64),
  releaseId: "f".repeat(64), sourceMetadata: { partTitle: "论证与引文" }, sourceUrl: "https://www.bilibili.com/video/BVCaseA/?p=3",
};
const draft = { quote: "原句 <tag>&", context: "前后句", suggestion: "修改后的完整句子", reason: "有核验依据" };
const pageUrl = `https://example.com/library/#/read/${entry.editionId}?block=passage-7&flow=continuous`;

test("feedback shows the exact version and paragraph before collapsed technical evidence", () => {
  const html = feedbackPanel({ entry, draft, pageUrl });
  assert.ok(html.indexOf(entry.editionId) < html.indexOf('<details class="feedback-version">'));
  assert.ok(html.includes('当前段落 · passage-7'));
  assert.ok(html.includes(`href="${pageUrl.replaceAll("&", "&amp;")}"`));
  assert.ok(!html.includes('<details class="feedback-version" open'));
  assert.ok(html.includes('准确原句'));
  assert.ok(html.includes('前后句'));
  assert.ok(html.includes('替换后的完整句子'));
  assert.ok(html.includes('核验依据'));
  assert.ok(html.includes('复制或暂存草稿不会提交建议'));
});

test("feedback textarea and status text escape HTML and accessible errors describe their field", () => {
  const html = feedbackPanel({ entry, draft: { ...draft, quote: '</textarea><script>alert(1)</script>"&' }, status: '<img src=x onerror=x>', errors: { quote: '<b>错误</b>' } });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;'));
  assert.ok(html.includes('aria-describedby="feedback-quote-hint feedback-quote-count feedback-quote-error" aria-invalid="true"'));
  assert.ok(html.includes('id="feedback-quote-error">&lt;b&gt;错误&lt;/b&gt;'));
  assert.ok(html.includes('data-feedback-count="quote"'));
  assert.deepEqual(feedbackFieldCounts(draft), { quote: draft.quote.length, context: draft.context.length, suggestion: draft.suggestion.length, reason: draft.reason.length });
});

test("blank or overlimit feedback cannot be copied while invalid drafts remain intact for correction", () => {
  const empty = feedbackPanel({ entry });
  assert.match(empty, /data-action="copy-feedback" disabled aria-disabled="true"/);
  assert.ok(empty.includes('请填写原句、建议内容和修改理由'));
  assert.ok(!empty.includes('data-feedback-issue'));
  assert.equal(validateFeedbackDraft({ ...draft, quote: ' \n\t ' }).valid, false);
  assert.equal(validateFeedbackDraft({ ...draft, reason: '理'.repeat(4000) }).valid, true);
  const long = { ...draft, reason: '理'.repeat(4001) };
  assert.equal(normalizeFeedbackDraft(long).reason.length, 4001);
  assert.equal(validateFeedbackDraft(long).valid, false);
  assert.throws(() => feedbackText({ ...long, entry }), /4000/);
  const panel = feedbackPanel({ entry, draft: long });
  assert.ok(panel.includes('理'.repeat(4001)));
  assert.ok(panel.includes('4001 / 4000'));
  assert.match(panel, /data-action="copy-feedback" disabled aria-disabled="true"/);
  assert.ok(panel.includes('aria-invalid="true"'));
});

test("Issue body contains complete exact source identity and paragraph link in each manuscript mode", () => {
  const options = { entry, ...draft, pageUrl };
  const text = feedbackText(options);
  const url = new URL(feedbackIssueHref(options));
  assert.equal(url.searchParams.get('body'), text);
  for (const field of ['editionId', 'aiRevisionId', 'contentSha256', 'artifactSha256', 'reviewArtifactSha256', 'releaseId', 'externalVideoId']) assert.ok(text.includes(entry[field]), field);
  assert.ok(text.includes(pageUrl));
  assert.ok(text.includes(draft.quote));
  assert.ok(text.includes('本地分 P ID：3'));
  const reviewUrl = pageUrl.replace('/read/', '/verify/');
  const review = feedbackText({ ...options, pageUrl: reviewUrl, mode: 'review' });
  assert.ok(review.startsWith('## 校验参照修改建议'));
  assert.ok(review.includes(reviewUrl));
  assert.equal(new URL(feedbackIssueHref({ ...options, pageUrl: reviewUrl, mode: 'review' })).searchParams.get('body'), review);
});

test("long prefilled links fall back to a complete manual copy and unsafe location URLs stay inactive", () => {
  const options = { entry, ...draft, pageUrl, context: '上'.repeat(4000) };
  const text = feedbackText(options);
  assert.equal(feedbackIssueHref(options), '');
  assert.ok(text.includes('上'.repeat(4000)));
  const panel = feedbackPanel({ entry, draft: options, pageUrl, text });
  assert.ok(panel.includes('上'.repeat(4000)));
  assert.ok(panel.includes('复制失败时可在下方手动选取'));
  assert.ok(panel.includes('预填链接较长时'));
  const unsafe = feedbackPanel({ entry, draft, pageUrl: 'javascript:alert(1)', issueHref: 'javascript:alert(2)' });
  assert.ok(!unsafe.includes('href="javascript:'));
  assert.throws(() => feedbackIssueHref({ ...options, issueUrl: 'javascript:alert(1)' }), /HTTP/);
});

test("selection action is available only when the application provides a captured selection", () => {
  assert.ok(!feedbackPanel({ entry, draft }).includes('data-action="feedback-selection"'));
  assert.ok(feedbackPanel({ entry, draft, selectionAvailable: true }).includes('data-action="feedback-selection"'));
});
