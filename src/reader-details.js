import { isDraft, buildIssueUrl } from "./manuscripts.js";
import { escapeHtml, statusBadge, draftNotice, reviewNotice } from "./ui.js";

export function provenanceMarkup(entry, { review = false, pageUrl, issueUrl, includeVersion = false } = {}) {
  return `<details class="provenance" aria-label="来源与整理说明"><summary>来源与整理说明</summary><div class="provenance-content"><div><span>当前稿件</span>${statusBadge(entry)}</div>
    ${review ? reviewNotice() : ""}${isDraft(entry) ? draftNotice() : ""}
    <p><strong>视频来源</strong><a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.bvid)} / P${entry.pageIndex + 1} ↗</a></p>
    <p><strong>整理方式</strong>${escapeHtml(entry.attribution)}</p>${entry.editorNote ? `<p><strong>编辑说明</strong>${escapeHtml(entry.editorNote)}</p>` : ""}
    <p class="verification-scope">审核与发布说明稿件的处理状态，不代表对视频中全部观点的学术认证。</p>
    ${includeVersion ? versionDetailsMarkup(entry, review) : ""}
    ${pageUrl && issueUrl ? `<a class="issue-link" href="${escapeHtml(buildIssueUrl(entry, pageUrl, issueUrl, review ? "review" : "body"))}" target="_blank" rel="noopener noreferrer">建议修改 →</a>` : ""}</div></details>`;
}

export function versionDetailsMarkup(entry, review = false) {
  return `<details class="release-details"><summary>${review ? "校验参照版本" : isDraft(entry) ? "编辑版本" : "发布版本"}</summary><dl>${isDraft(entry) ? "" : `<dt>Release</dt><dd>${entry.releaseId}</dd>`}<dt>Edition</dt><dd>${entry.editionId}</dd><dt>AI Revision</dt><dd>${entry.aiRevisionId}</dd><dt>关联编辑内容 SHA-256</dt><dd>${entry.contentSha256}</dd>${review ? `<dt>校验参照文件 SHA-256</dt><dd>${entry.reviewArtifactSha256}</dd>` : ""}</dl></details>`;
}
