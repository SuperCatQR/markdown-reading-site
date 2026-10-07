export const REQUIRED_FIELDS = ["slug", "title", "date", "summary"];
export const REVIEW_STATUSES = [
  "pending-review", "in-review", "changes-requested", "approved", "published", "rejected", "withdrawn",
];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateCatalog(catalog, markdownFiles) {
  const errors = [];
  if (!Array.isArray(catalog)) {
    return ["catalog.json 必须是数组"];
  }

  const seenSlugs = new Set();
  const listedFiles = new Set();

  for (const [index, entry] of catalog.entries()) {
    const label = `catalog.json[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label} 必须是对象`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        errors.push(`${label}.${field} 为必填项`);
      }
    }

    if (typeof entry.slug !== "string" || !SLUG_PATTERN.test(entry.slug)) {
      errors.push(`${label}.slug 只能包含小写字母、数字和单个连字符`);
    } else if (seenSlugs.has(entry.slug)) {
      errors.push(`${label}.slug 重复: ${entry.slug}`);
    } else {
      seenSlugs.add(entry.slug);
    }

    if (typeof entry.date === "string") {
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? new Date(`${entry.date}T00:00:00Z`) : null;
      if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== entry.date) {
        errors.push(`${label}.date 必须是有效的 YYYY-MM-DD 日期`);
      }
    }
    if (!Array.isArray(entry.tags) || entry.tags.length === 0 || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
      errors.push(`${label}.tags 必须是非空字符串数组`);
    }
    if (typeof entry.summary === "string" && entry.summary.length > 240) {
      errors.push(`${label}.summary 不能超过 240 个字符`);
    }
    if (entry.reviewStatus !== undefined && !REVIEW_STATUSES.includes(entry.reviewStatus)) {
      errors.push(`${label}.reviewStatus 无效`);
    }
    if (entry.issueUrl && (typeof entry.issueUrl !== "string" || !entry.issueUrl.startsWith("https://"))) {
      errors.push(`${label}.issueUrl 必须是 HTTPS 地址`);
    }

    const expectedFile = typeof entry.slug === "string" ? `${entry.slug}.md` : "";
    if (entry.file !== expectedFile) {
      errors.push(`${label}.file 必须是与 slug 对应的 Markdown 文件名`);
    } else {
      listedFiles.add(expectedFile);
    }
  }

  const availableFiles = new Set(markdownFiles);
  for (const file of listedFiles) {
    if (!availableFiles.has(file)) errors.push(`缺少阅读稿文件: ${file}`);
  }
  for (const file of availableFiles) {
    if (!listedFiles.has(file)) errors.push(`未登记的 Markdown 文件不能进入发布目录: ${file}`);
  }

  return errors;
}
