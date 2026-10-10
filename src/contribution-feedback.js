import { buildIssueUrl } from "./manuscripts.js";
import { contributionVersion } from "./review-document.js";

const FIELDS = ["quote", "context", "suggestion", "reason"];
export function feedbackKey(entry, mode) { return `${contributionVersion(entry)}:${mode}`; }
export function sanitizeFeedback(value = {}) {
  return Object.fromEntries(FIELDS.map((field) => [field, typeof value?.[field] === "string" ? value[field].slice(0, 4000) : ""]));
}
export function feedbackText(entry, mode, pageUrl, value, source = {}) {
  const issue = new URL(buildIssueUrl(entry, pageUrl, "https://github.com/SuperCatQR/markdown-reading-site/issues/new", mode));
  const metadata = issue.searchParams.get("body").split("## 建议修改")[0]
    .replace(/- 稿件链接: .*/u, () => `- 稿件链接: ${pageUrl}`);
  const fields = sanitizeFeedback(value);
  return `${metadata}- 正文文件 SHA-256: \`${entry.artifactSha256}\`\n${source.heading ? `- 参照时间段: ${source.heading}\n` : ""}${source.sourceUrl ? `- 段落来源链接: ${source.sourceUrl}\n` : ""}\n`
    + FIELDS.map((field, index) => `## ${["原句 / 选中文本", "上下文", "建议修改", "理由"][index]}\n\n${fields[field] || "（待补充）"}`).join("\n\n");
}
export function feedbackIssueUrl(entry, mode, pageUrl, text, issueUrl) {
  const url = new URL(buildIssueUrl(entry, pageUrl, issueUrl, mode));
  url.searchParams.set("body", text);
  // Percent encoding can multiply Chinese text size. Bound the actual URL,
  // without silently truncating version evidence or the contributor's proposal.
  return url.href.length <= 7000 ? url.href : null;
}
export function createFeedbackStore(storage) {
  const key = "reader-feedback-v1";
  function readAll() {
    try {
      const value = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter((row) => typeof row?.key === "string" && row.key.length < 1000).slice(-10) : [];
    } catch { return []; }
  }
  return {
    read(id) { const row = readAll().find((item) => item.key === id); return row ? sanitizeFeedback(row.value) : null; },
    write(id, value) {
      try { storage.setItem(key, JSON.stringify([...readAll().filter((row) => row.key !== id), { key: id, value: sanitizeFeedback(value) }].slice(-10))); return true; }
      catch { return false; }
    },
    remove(id) { try { storage.setItem(key, JSON.stringify(readAll().filter((row) => row.key !== id))); return true; } catch { return false; } },
  };
}
