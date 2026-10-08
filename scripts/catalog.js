import { createHash } from "node:crypto";

export const ARTICLE_FIELDS = [
  "manuscriptType", "slug", "title", "summary", "tags", "attribution", "editorNote",
  "releaseId", "editionId", "aiRevisionId", "videoPartId", "bvid", "pageIndex",
  "sourceUrl", "contentSha256", "artifactSha256", "templateVersion", "publishedAt", "file",
];
export const DRAFT_FIELDS = ARTICLE_FIELDS.filter((field) =>
  !["releaseId", "publishedAt", "templateVersion"].includes(field)).concat(["reviewStatus", "createdAt"]);
export const REVIEW_STATUSES = ["pending-review", "in-review", "changes-requested", "approved", "rejected"];

export function snapshotContract(kind = "publication") {
  if (kind === "publication") return {
    kind, fields: ARTICLE_FIELDS, manifest: "publication-export-manifest.json",
    manifestKind: "publication-export", file: /^articles\/part-[1-9][0-9]*\/publish\.md$/,
    directory: /^(articles|articles\/part-[1-9][0-9]*)$/,
  };
  if (kind === "publication-draft") return {
    kind, fields: DRAFT_FIELDS, manifest: "publication-draft-export-manifest.json",
    manifestKind: "publication-draft-export", file: /^drafts\/edition-[0-9a-f]{32}\/preview\.md$/,
    directory: /^(drafts|drafts\/edition-[0-9a-f]{32})$/,
  };
  throw new Error("不支持的稿件快照类型");
}

const SHA256 = /^[0-9a-f]{64}$/;
const EDITION = /^[0-9a-f]{32}$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
  return isObject(value) && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function parseUniqueJson(source) {
  const parsed = JSON.parse(source);
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "")) offset += 1; };
  const string = () => {
    const start = offset++;
    while (source[offset] !== '"') {
      if (source[offset] === "\\") offset += 1;
      offset += 1;
    }
    offset += 1;
    return JSON.parse(source.slice(start, offset));
  };
  const value = () => {
    whitespace();
    if (source[offset] === "{") {
      offset += 1; whitespace();
      const keys = new Set();
      while (source[offset] !== "}") {
        const key = string();
        if (keys.has(key)) throw new Error(`JSON 字段重复: ${key}`);
        keys.add(key);
        whitespace(); offset += 1; value(); whitespace();
        if (source[offset] === "}") break;
        offset += 1; whitespace();
      }
      offset += 1;
    } else if (source[offset] === "[") {
      offset += 1; whitespace();
      while (source[offset] !== "]") {
        value(); whitespace();
        if (source[offset] === "]") break;
        offset += 1; whitespace();
      }
      offset += 1;
    } else if (source[offset] === '"') {
      string();
    } else {
      while (offset < source.length && !/[\s,\]}]/.test(source[offset])) offset += 1;
    }
  };
  value();
  return parsed;
}

export function validateCatalog(catalog, markdownFiles, kind = "publication") {
  const contract = snapshotContract(kind);
  const draft = kind === "publication-draft";
  const errors = [];
  if (!exactFields(catalog, ["schemaVersion", "manuscriptType", "articles"])
      || catalog.schemaVersion !== 1 || catalog.manuscriptType !== kind
      || !Array.isArray(catalog.articles)) {
    return [`catalog.json 必须使用 schemaVersion=1、manuscriptType=${kind} 的准确 envelope`];
  }
  const seen = { slug: new Set(), videoPartId: new Set(), editionId: new Set(), ...(draft ? {} : { releaseId: new Set() }) };
  const listedFiles = new Set();
  for (const [index, entry] of catalog.articles.entries()) {
    const label = `catalog.json.articles[${index}]`;
    if (!exactFields(entry, contract.fields)) {
      errors.push(`${label} 必须包含准确的 ${kind} 字段，不接受内部审核或旧稿件字段`);
      continue;
    }
    if (entry.manuscriptType !== kind || (!draft && entry.templateVersion !== "publish-v1")) {
      errors.push(`${label} 稿件类型或模板无效`);
    }
    for (const field of ["title", "summary", "attribution", "editorNote"]) {
      if (typeof entry[field] !== "string" || (["title", "attribution"].includes(field) && !entry[field].trim())) {
        errors.push(`${label}.${field} 字段无效`);
      }
    }
    const expectedSlug = draft ? `edition-${entry.editionId}` : `part-${entry.videoPartId}`;
    const expectedFile = draft ? `drafts/${expectedSlug}/preview.md` : `articles/${expectedSlug}/publish.md`;
    if (!Number.isSafeInteger(entry.videoPartId) || entry.videoPartId < 1
        || entry.slug !== expectedSlug || entry.file !== expectedFile) {
      errors.push(`${label} 的分 P、slug 和文件身份不一致`);
    }
    if (typeof entry.file !== "string" || !contract.file.test(entry.file)) {
      errors.push(`${label}.file 必须是受控发布稿路径`);
    } else {
      listedFiles.add(entry.file);
    }
    if (!Number.isSafeInteger(entry.pageIndex) || entry.pageIndex < 0
        || typeof entry.bvid !== "string" || !/^[A-Za-z0-9_-]+$/.test(entry.bvid)
        || entry.sourceUrl !== `https://www.bilibili.com/video/${entry.bvid}/?p=${entry.pageIndex + 1}`) {
      errors.push(`${label} 的视频来源身份不一致`);
    }
    const timeField = draft ? "createdAt" : "publishedAt";
    if (!Number.isSafeInteger(entry[timeField]) || entry[timeField] < 0
        || Number.isNaN(new Date(entry[timeField] * 1000).valueOf())) {
      errors.push(`${label}.${timeField} 必须是有效的 Unix 秒时间`);
    }
    if (draft && !REVIEW_STATUSES.includes(entry.reviewStatus)) {
      errors.push(`${label}.reviewStatus 必须是准确的审核状态`);
    }
    if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim())
        || new Set(entry.tags).size !== entry.tags.length) {
      errors.push(`${label}.tags 必须是不重复的字符串数组`);
    }
    for (const field of ["aiRevisionId", "contentSha256", "artifactSha256", ...(draft ? [] : ["releaseId"])]) {
      if (typeof entry[field] !== "string" || !SHA256.test(entry[field])) {
        errors.push(`${label}.${field} 必须是 SHA-256 标识`);
      }
    }
    if (typeof entry.editionId !== "string" || !EDITION.test(entry.editionId)) {
      errors.push(`${label}.editionId 必须是 32 位十六进制版本标识`);
    }
    for (const [field, identities] of Object.entries(seen)) {
      if (identities.has(entry[field])) errors.push(`${label}.${field} 重复`);
      identities.add(entry[field]);
    }
  }
  const availableFiles = new Set(markdownFiles);
  for (const file of listedFiles) {
    if (!availableFiles.has(file)) errors.push(`缺少发布稿文件: ${file}`);
  }
  for (const file of availableFiles) {
    if (!listedFiles.has(file)) errors.push(`未登记文件不能进入公开目录: ${file}`);
  }
  return errors;
}

export function validateSnapshot(files, kind = "publication") {
  const contract = snapshotContract(kind);
  const MANIFEST = contract.manifest;
  const errors = [];
  let catalog, manifest;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    catalog = parseUniqueJson(decoder.decode(files.get("catalog.json")));
    manifest = parseUniqueJson(decoder.decode(files.get(MANIFEST)));
    for (const bytes of files.values()) decoder.decode(bytes);
  } catch (error) {
    return { errors: [`公开快照缺失文件或包含无效 UTF-8/JSON: ${error.message}`], catalog: null };
  }
  const available = [...files.keys()].filter((name) => name !== "catalog.json" && name !== MANIFEST);
  errors.push(...validateCatalog(catalog, available, kind));
  if (!exactFields(manifest, ["schemaVersion", "manuscriptType", "snapshotId", "files"])
      || manifest.schemaVersion !== 1 || manifest.manuscriptType !== contract.manifestKind
      || !SHA256.test(manifest.snapshotId) || !Array.isArray(manifest.files) || !manifest.files.length) {
    errors.push(`${MANIFEST} 必须使用准确的 ${contract.manifestKind} v1 契约`);
    return { errors, catalog };
  }
  const managed = new Map();
  for (const entry of manifest.files) {
    if (!exactFields(entry, ["path", "sha256"]) || typeof entry.path !== "string"
        || (entry.path !== "catalog.json" && !contract.file.test(entry.path)) || !SHA256.test(entry.sha256)) {
      errors.push("manifest 包含无效受管文件");
      continue;
    }
    if (managed.has(entry.path)) errors.push(`manifest 文件重复: ${entry.path}`);
    managed.set(entry.path, entry.sha256);
    if (!files.has(entry.path) || sha256(files.get(entry.path)) !== entry.sha256) {
      errors.push(`manifest 文件缺失或 SHA-256 不一致: ${entry.path}`);
    }
  }
  for (const name of files.keys()) {
    if (name !== MANIFEST && !managed.has(name)) errors.push(`manifest 未登记文件: ${name}`);
  }
  const canonicalFiles = manifest.files.map((entry) => ({ path: entry?.path, sha256: entry?.sha256 }));
  const paths = canonicalFiles.map((entry) => entry.path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    errors.push("manifest 受管文件必须按路径排序");
  }
  if (sha256(JSON.stringify(canonicalFiles)) !== manifest.snapshotId) {
    errors.push("manifest snapshotId 与受管文件身份不一致");
  }
  if (Array.isArray(catalog?.articles)) {
    for (const entry of catalog.articles) {
      if (isObject(entry) && managed.get(entry.file) !== entry.artifactSha256) {
        errors.push(`发布稿与 manifest 的 artifactSha256 不一致: ${entry.file}`);
      }
    }
  }
  return { errors, catalog };
}

export function validateCatalogPair(publication, drafts) {
  const published = new Set(publication.articles.map((entry) => entry.editionId));
  return drafts.articles.filter((entry) => published.has(entry.editionId))
    .map((entry) => `同一编辑版本不能同时声明为已发布和未发布: ${entry.editionId}`);
}
