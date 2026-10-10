import { sourceLabel, partLabel } from "./source-identity.js";
import { isDraft, buildIssueUrl } from "./manuscripts.js";
import { escapeHtml, statusBadge, draftNotice, reviewNotice } from "./ui.js";

function observedTime(value) {
  if (value === null) return "未知";
  const date = new Date(value * 1000);
  return Number.isNaN(date.valueOf()) ? "未知" : date.toISOString();
}

export function provenanceMarkup(entry, { review = false, pageUrl, issueUrl, includeVersion = false } = {}) {
  return `<details class="provenance" aria-label="来源与整理说明"><summary>来源与整理说明</summary><div class="provenance-content"><div><span>当前稿件</span>${statusBadge(entry)}</div>
    ${review ? reviewNotice() : ""}${isDraft(entry) ? draftNotice() : ""}
    <p><strong>视频来源</strong><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(entry))} / ${escapeHtml(partLabel(entry))} ↗</a></p>
    <p><strong>来源原标题</strong>${escapeHtml(entry.sourceMetadata.title)}</p>
    ${entry.sourceMetadata.partTitle ? `<p><strong>来源分段标题</strong>${escapeHtml(entry.sourceMetadata.partTitle)}</p>` : ""}
    <p><strong>来源创作者</strong>${escapeHtml(entry.sourceMetadata.creatorName || "未知")}${entry.sourceMetadata.creatorId ? ` · ${escapeHtml(entry.sourceMetadata.creatorId)}` : ""}</p>
    <p><strong>视频发布于（UTC）</strong>${escapeHtml(entry.sourcePublishedAt || "未知")}</p><p><strong>元数据观察时间（UTC）</strong>${escapeHtml(observedTime(entry.sourceMetadata.metadataObservedAt))}</p>
    <p><strong>整理方式</strong>${escapeHtml(entry.attribution)}</p>${entry.editorNote ? `<p><strong>编辑说明</strong>${escapeHtml(entry.editorNote)}</p>` : ""}
    <p class="verification-scope">审核与发布说明稿件的处理状态，不代表对视频中全部观点的学术认证。</p>
    ${includeVersion ? versionDetailsMarkup(entry, review) : ""}
    ${pageUrl && issueUrl ? `<a class="issue-link" href="${escapeHtml(buildIssueUrl(entry, pageUrl, issueUrl, review ? "review" : "body"))}" target="_blank" rel="noopener noreferrer">建议修改 →</a>` : ""}</div></details>`;
}

export function versionDetailsMarkup(entry, review = false) {
  const origin = entry.origin;
  const evidence = origin?.importId ? `<dt>导入记录</dt><dd>${origin.importId}</dd><dt>旧正文 SHA-256</dt><dd>${origin.baselineBodySha256}</dd><dt>当前正文 SHA-256</dt><dd>${origin.currentBodySha256}</dd>` : "";
  return `<details class="release-details"><summary>${review ? "校验参照版本" : isDraft(entry) ? "编辑版本" : "发布版本"}</summary><dl>${isDraft(entry) ? "" : `<dt>Release</dt><dd>${entry.releaseId}</dd>`}<dt>Edition</dt><dd>${entry.editionId}</dd><dt>AI Revision</dt><dd>${entry.aiRevisionId}</dd>${origin ? `<dt>AI 基线模板</dt><dd>${origin.aiTemplateVersion}</dd>` : ""}<dt>关联编辑内容 SHA-256</dt><dd>${entry.contentSha256}</dd>${review ? `<dt>校验参照文件 SHA-256</dt><dd>${entry.reviewArtifactSha256}</dd>` : ""}${evidence}</dl></details>`;
}

export function originNoticeMarkup(entry, review = false) {
  const origin = entry.origin;
  if (!origin || origin.kind === "ai-generated-v2") return "";
  const body = origin.bodyPreserved ? "正文按原样保留，导入时未重新生成。" : "正文已在迁移导入后编辑。";
  return `<p class="origin-notice" role="note"><strong>${review ? "历史 AI 校验基线" : origin.bodyPreserved ? "旧正文迁移" : "迁移后编辑"}</strong> · ${review ? "此参照保留原始生成记录，当前审核状态以关联稿件为准。" : body}</p>`;
}
