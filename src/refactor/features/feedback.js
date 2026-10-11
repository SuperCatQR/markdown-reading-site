import { partName, statusLabel } from "../core/content.js";

const DEFAULT_ISSUE_URL = "https://github.com/SuperCatQR/markdown-reading-site/issues/new";
const FIELD_LIMIT = 4000;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const fact = (value) => value === null || value === undefined || value === "" ? "未提供" : String(value);

function pageLink(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://reader.invalid/");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? String(value) : "";
  } catch { return ""; }
}

function paragraphLabel(pageUrl) {
  try {
    const hash = new URL(pageUrl, "https://reader.invalid/").hash;
    const block = new URLSearchParams(hash.slice(hash.indexOf("?") + 1)).get("block");
    return block ? `当前段落 · ${block}` : "当前篇目";
  } catch { return "当前篇目"; }
}

export function normalizeFeedbackDraft(draft = {}) {
  return Object.fromEntries(["quote", "context", "suggestion", "reason"].map((field) => [field, String(draft[field] ?? "")]));
}

export function feedbackFieldCounts(draft = {}) {
  return Object.fromEntries(Object.entries(normalizeFeedbackDraft(draft)).map(([field, value]) => [field, value.length]));
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
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("建议入口必须是有效的 HTTP 或 HTTPS 链接。");
  url.search = new URLSearchParams({ template: "review.md", title, body: text }).toString();
  // A complete suggestion stays available for copying even when a prefilled URL
  // would exceed a practical browser/GitHub request length.
  return url.href.length <= 8000 ? url.href : "";
}

export function feedbackPanel({ entry, review = false, draft = {}, status = "", issueHref = "", text = "", errors = {}, pageUrl = "", selectionAvailable = false, draftStatus = "" } = {}) {
  const validation = validateFeedbackDraft(draft);
  const value = validation.value;
  const counts = feedbackFieldCounts(value);
  const location = pageLink(pageUrl);
  const issueLink = pageLink(issueHref);
  const fields = [
    { name: "quote", label: "原句", required: true, hint: "粘贴需要修改的准确原句，便于定位和对照。" },
    { name: "context", label: "上下文", required: false, hint: "补充前后句、所在论证或视频时间，避免断章取义。" },
    { name: "suggestion", label: "建议内容", required: true, hint: "写出替换后的完整句子，或说明希望怎样修改。" },
    { name: "reason", label: "修改理由", required: true, hint: "说明为什么需要修改；专名、引文或事实问题请附核验依据。" },
  ];
  const validationMessage = validation.valid ? "内容已完整，可整理预览后复制或打开 GitHub。" : "请填写原句、建议内容和修改理由，每项最多 4000 字符。";
  const draftMessage = draftStatus || "草稿仅在当前浏览器会话暂存，并按正文或校验参照的准确版本区分。";
  const version = `<p class="tool-help"><strong>反馈对象：${escape(partName(entry))} · ${review ? "校验参照" : "正文"}</strong><br>${escape(entry.title)}<br>准确编辑版本：<code>${escape(fact(entry.editionId))}</code><br>${location ? `<a data-feedback-location href="${escape(location)}">${escape(paragraphLabel(location))}</a>` : "段落位置未提供；请在原句和上下文中补充位置。"}</p>`;
  const fieldMarkup = fields.map(({ name, label, required, hint }) => {
    const fieldError = errors[name] || (value[name].length > FIELD_LIMIT ? validation.errors[name] : "");
    const describedBy = [`feedback-${name}-hint`, `feedback-${name}-count`, ...(fieldError ? [`feedback-${name}-error`] : [])].join(" ");
    return `<label for="feedback-${name}">${label}${required ? "（必填）" : "（可选）"}</label><p class="tool-help" id="feedback-${name}-hint">${hint}</p><textarea id="feedback-${name}" name="${name}" rows="3" maxlength="4000"${required ? " required" : ""} aria-describedby="${describedBy}"${fieldError ? ' aria-invalid="true"' : ""}>${escape(value[name])}</textarea><span class="tool-help" id="feedback-${name}-count" data-feedback-count="${name}">${counts[name]} / ${FIELD_LIMIT} 字符</span>${fieldError ? `<p class="field-error" id="feedback-${name}-error">${escape(fieldError)}</p>` : ""}`;
  }).join("");
  return `<p class="tool-help">在这里整理修改建议，再复制文本或打开 GitHub 确认提交。复制或暂存草稿不会提交建议。</p>${version}<details class="feedback-version"><summary>查看完整版本证据</summary><dl class="source-facts"><dt>AI 修订</dt><dd><code>${escape(fact(entry.aiRevisionId))}</code></dd><dt>当前状态</dt><dd>${escape(statusLabel(entry))}</dd><dt>完整内容 SHA-256</dt><dd><code>${escape(fact(entry.contentSha256))}</code></dd><dt>正文文件 SHA-256</dt><dd><code>${escape(fact(entry.artifactSha256))}</code></dd><dt>参照文件 SHA-256</dt><dd><code>${escape(fact(entry.reviewArtifactSha256))}</code></dd>${entry.manuscriptType === "publication" ? `<dt>发布 ID</dt><dd><code>${escape(fact(entry.releaseId))}</code></dd>` : ""}</dl></details>${selectionAvailable ? '<button class="quiet-button" type="button" data-action="feedback-selection">带入刚才选中的原句</button>' : ""}<p class="tool-help" data-feedback-draft-status>${escape(draftMessage)}</p><form class="feedback-form" data-feedback-form data-edition-id="${escape(entry.editionId)}" data-feedback-mode="${review ? "review" : "body"}">${fieldMarkup}<button class="button-link" type="submit">整理建议</button></form><p class="tool-help" data-feedback-validation role="status">${escape(validationMessage)}</p><p class="feedback-status" data-feedback-status role="status" aria-live="polite">${escape(status)}</p><div class="feedback-actions"><button class="quiet-button" type="button" data-action="copy-feedback"${validation.valid ? "" : ' disabled aria-disabled="true"'}>复制完整建议</button>${validation.valid && issueLink ? `<a class="button-link" data-feedback-issue href="${escape(issueLink)}" target="_blank" rel="noopener noreferrer">在 GitHub 打开预填建议</a>` : validation.valid && text ? `<p>建议完整保留。预填链接较长时，请复制下方完整文本并粘贴到 GitHub Issue。</p><a class="text-link" data-feedback-issue href="${DEFAULT_ISSUE_URL}" target="_blank" rel="noopener noreferrer">打开 GitHub Issue</a>` : ""}</div><label class="feedback-output-label" for="feedback-output">完整建议（复制失败时可在下方手动选取）</label><textarea id="feedback-output" class="feedback-output" data-feedback-output readonly rows="8">${escape(text)}</textarea>`;
}
