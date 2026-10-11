import { partName, statusLabel } from "../core/content.js";

const DEFAULT_ISSUE_URL = "https://github.com/SuperCatQR/markdown-reading-site/issues/new";
const FIELD_LIMIT = 4000;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const fact = (value) => value === null || value === undefined || value === "" ? "未提供" : String(value);

export function normalizeFeedbackDraft(draft = {}) {
  return Object.fromEntries(["quote", "context", "suggestion", "reason"].map((field) => [field, String(draft[field] ?? "")]));
}

export function validateFeedbackDraft(draft = {}) {
  const value = normalizeFeedbackDraft(draft);
  const errors = {};
  for (const field of ["quote", "suggestion", "reason"]) if (!value[field].trim()) errors[field] = ({ quote: "请填写需要修改的原句。", suggestion: "请填写建议内容。", reason: "请说明修改理由。" })[field];
  for (const [field, text] of Object.entries(value)) if (text.length > FIELD_LIMIT) errors[field] = "每项最多填写 4000 个字符。";
  return { value, errors, valid: Object.keys(errors).length === 0 };
}

export function feedbackText({ entry, pageUrl = "", mode = "body", ...draft }) {
  const result = validateFeedbackDraft(draft);
  if (!result.valid) throw new Error(Object.values(result.errors)[0]);
  const { quote, context, suggestion, reason } = result.value;
  const label = mode === "review" ? "校验参照" : "正文";
  return [
    `## ${label}修改建议`, "", `- 标题：${fact(entry.title)}`, `- 分 P：${partName(entry)}`,
    `- 当前稿件状态：${statusLabel(entry)}`, `- 稿件类别：${fact(entry.manuscriptType)}`,
    `- 平台：${fact(entry.platform)}`, `- 来源视频 ID：${fact(entry.externalVideoId)}`,
    `- 分 P 索引（从 0 起）：${fact(entry.partIndex)}`, `- 本地分 P ID：${fact(entry.videoPartId)}`,
    `- 内容版本：${fact(entry.contentVersion)}`, `- 编辑版本：${fact(entry.editionId)}`,
    `- AI 修订：${fact(entry.aiRevisionId)}`, `- 完整内容 SHA-256：${fact(entry.contentSha256)}`,
    `- 正文文件 SHA-256：${fact(entry.artifactSha256)}`, `- 校验参照文件 SHA-256：${fact(entry.reviewArtifactSha256)}`,
    ...(entry.manuscriptType === "publication" ? [`- 发布 ID：${fact(entry.releaseId)}`] : []),
    `- 阅读位置：${pageUrl || "未提供"}`, `- 原视频：${fact(entry.sourceUrl)}`,
    "", "## 原句", "", quote.trim(), "", "## 上下文", "", context.trim() || "未补充",
    "", "## 建议内容", "", suggestion.trim(), "", "## 修改理由", "", reason.trim(), "",
  ].join("\n");
}

export function feedbackIssueHref(options) {
  const text = feedbackText(options);
  const title = `[${options.mode === "review" ? "校验参照" : "正文"}修改建议] ${options.entry.title}`;
  const url = new URL(options.issueUrl || DEFAULT_ISSUE_URL);
  url.search = new URLSearchParams({ template: "review.md", title, body: text }).toString();
  // A complete suggestion stays available for copying even when a prefilled URL
  // would exceed a practical browser/GitHub request length.
  return url.href.length <= 8000 ? url.href : "";
}

export function feedbackPanel({ entry, review = false, draft = {}, status = "", issueHref = "", text = "", errors = {} } = {}) {
  const value = normalizeFeedbackDraft(draft);
  const fields = [["quote", "原句", true, 3], ["context", "上下文", false, 3], ["suggestion", "建议内容", true, 3], ["reason", "修改理由", true, 3]];
  return `<p class="tool-help">建议关联当前${review ? "校验参照" : "正文"}的准确版本。可在这里整理并复制；打开 GitHub 后由你确认提交。</p><details class="feedback-version"><summary>当前版本信息</summary><dl class="source-facts"><dt>编辑版本</dt><dd><code>${escape(entry.editionId)}</code></dd><dt>AI 修订</dt><dd><code>${escape(entry.aiRevisionId)}</code></dd><dt>当前状态</dt><dd>${escape(statusLabel(entry))}</dd><dt>完整内容 SHA-256</dt><dd><code>${escape(entry.contentSha256)}</code></dd><dt>正文文件 SHA-256</dt><dd><code>${escape(entry.artifactSha256)}</code></dd><dt>参照文件 SHA-256</dt><dd><code>${escape(entry.reviewArtifactSha256)}</code></dd>${entry.manuscriptType === "publication" ? `<dt>发布 ID</dt><dd><code>${escape(fact(entry.releaseId))}</code></dd>` : ""}</dl></details><form class="feedback-form" data-feedback-form data-edition-id="${escape(entry.editionId)}" data-feedback-mode="${review ? "review" : "body"}">${fields.map(([name, label, required, rows]) => `<label for="feedback-${name}">${label}${required ? "（必填）" : "（可选）"}</label><textarea id="feedback-${name}" name="${name}" rows="${rows}" maxlength="4000"${required ? " required" : ""}${errors[name] ? ` aria-invalid="true" aria-describedby="feedback-${name}-error"` : ""}>${escape(value[name])}</textarea>${errors[name] ? `<p class="field-error" id="feedback-${name}-error">${escape(errors[name])}</p>` : ""}`).join("")}<button class="button-link" type="submit">整理建议</button></form><p class="feedback-status" data-feedback-status role="status" aria-live="polite">${escape(status)}</p><div class="feedback-actions"><button class="quiet-button" type="button" data-action="copy-feedback">复制完整建议</button>${issueHref ? `<a class="button-link" data-feedback-issue href="${escape(issueHref)}" target="_blank" rel="noopener noreferrer">在 GitHub 打开预填建议</a>` : text ? `<p>建议较长时，请复制完整文本并粘贴到 GitHub Issue。</p><a class="text-link" data-feedback-issue href="${DEFAULT_ISSUE_URL}" target="_blank" rel="noopener noreferrer">打开 GitHub Issue</a>` : ""}</div><label class="feedback-output-label" for="feedback-output">完整建议（可手动复制）</label><textarea id="feedback-output" class="feedback-output" data-feedback-output readonly rows="8">${escape(text)}</textarea>`;
}
