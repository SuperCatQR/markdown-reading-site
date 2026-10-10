import { createHash } from "node:crypto";
import { validSourceIdentity } from "../src/source-identity.js";

export const ORIGIN_PROFILE = "universal-origin-v1";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const hash = (value, size = 64) => typeof value === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const text = (value, limit, multiline = false) => typeof value === "string" && [...value].length <= limit
  && !/[\p{Cc}\p{Cs}]/u.test(multiline ? value.replace(/[\r\n\t]/g, "") : value);
export const METADATA_FIELDS = ["version", "platform", "externalVideoId", "partIndex", "title", "creatorId", "creatorName", "pubdateUnix", "sourcePublishedAt", "metadataObservedAt", "description", "coverUrl", "categoryId", "tags", "aid", "partTitle", "durationMs"];
const common = ["kind", "editionId", "aiRevisionId", "videoPartId", "contentSha256", "sourceMetadataSha256", "inputVersion", "aiTemplateVersion"];
const imported = ["importId", "policyVersion", "legacyAiRevisionId", "legacyEditionId", "legacyReleaseId", "baselineBodySha256", "currentBodySha256", "reviewArtifactSha256", "importedAt", "bodyPreserved", "metadataEvidence"];
const knownFacts = new Set(["version", "platform", "externalVideoId", "partIndex", "title"]);
const supplementPolicy = "legacy-part-title-supplement-v1";
const supplementKind = "archive-part-projection";

function validateSupplement(value, article) {
  if (!exact(value, ["supplementId", "evidence"])) return false;
  const evidence = value.evidence;
  if (!exact(evidence, ["version", "platform", "externalVideoId", "partIndex", "videoPartId", "cid", "field", "value", "sourceKind", "observedAt"])) return false;
  return evidence.version === 1 && evidence.platform === "bilibili" && evidence.sourceKind === supplementKind
    && evidence.field === "partTitle" && evidence.observedAt === null
    && integer(evidence.partIndex) && integer(evidence.videoPartId, 1) && integer(evidence.cid, 1)
    && ["platform", "externalVideoId", "partIndex"].every((key) => evidence[key] === article.sourceMetadata[key])
    && evidence.videoPartId === article.videoPartId && text(evidence.value, 512) && Boolean(evidence.value.trim())
    && evidence.value === article.sourceMetadata.partTitle && value.supplementId === canonicalDigest(evidence);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const canonicalDigest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function sourceTime(value) {
  if (value === null || value === 0) return null;
  const date = new Date(value * 1000);
  if (Number.isNaN(date.valueOf()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().replace(".000Z", "Z");
}

function validCover(value) {
  if (!text(value, 2048) || /[\s\\?#]/u.test(value) || !/^https:\/\/[^/]/i.test(value)
      || value.split("/")[2].includes("@")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (!url.port || url.port === "443")
      && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+hdslb\.com$/i.test(url.hostname);
  } catch { return false; }
}

export function validateUniversalSource(entry) {
  const errors = [];
  const source = entry.sourceMetadata;
  const validIdentity = validSourceIdentity(entry);
  const url = entry.platform === "bilibili" ? `https://www.bilibili.com/video/${entry.externalVideoId}/?p=${entry.partIndex + 1}`
    : `https://www.youtube.com/watch?v=${entry.externalVideoId}`;
  if (!validIdentity || entry.sourceUrl !== url || entry.contentVersion !== 2) errors.push("平台、来源 URL 或 contentVersion 不一致");
  if (!exact(source, METADATA_FIELDS) || source.version !== "source-metadata-v1") return [...errors, "冻结来源元数据字段无效"];
  for (const key of ["platform", "externalVideoId", "partIndex", "sourcePublishedAt", "pubdateUnix"]) {
    if (source[key] !== entry[key]) errors.push(`冻结来源身份不一致: ${key}`);
  }
  for (const key of ["title", "creatorId", "creatorName", "description", "partTitle"]) {
    const value = source[key];
    if (value === null && key !== "title") continue;
    if (!text(value, key === "description" ? 65536 : 512, key === "description")
        || (key !== "description" && !value.trim())) errors.push(`冻结来源文本无效: ${key}`);
  }
  for (const key of ["pubdateUnix", "metadataObservedAt", "categoryId", "aid", "durationMs"]) {
    if (source[key] !== null && !integer(source[key], ["categoryId", "aid", "durationMs"].includes(key) ? 1 : 0)) errors.push(`冻结来源整数无效: ${key}`);
  }
  if (source.sourcePublishedAt !== sourceTime(source.pubdateUnix)) errors.push("源视频发布时间不能由创建或导入时间替代");
  if (!Array.isArray(source.tags) || source.tags.length > 256 || new Set(source.tags).size !== source.tags.length
      || source.tags.some((tag) => !text(tag, 256) || !tag.trim())) errors.push("冻结来源标签无效");
  if (source.coverUrl !== null && !validCover(source.coverUrl)) errors.push("冻结封面来源无效");
  return errors;
}

export function validateOrigins(value, catalog, kind) {
  const errors = [];
  if (!exact(value, ["schemaVersion", "manuscriptType", "contractProfile", "entries"])
      || value.schemaVersion !== 1 || value.manuscriptType !== kind || value.contractProfile !== ORIGIN_PROFILE
      || !Array.isArray(value.entries)) return ["origins.json 来源 envelope 无效"];
  if (!Array.isArray(catalog?.articles) || catalog.articles.some((entry) => !object(entry))) return ["来源需要有效的稿件目录"];
  const articles = new Map((catalog?.articles || []).map((entry) => [entry.editionId, entry]));
  const seen = [];
  for (const origin of value.entries) {
    const native = origin?.kind === "ai-generated-v2";
    const supplemented = !native && origin?.policyVersion === supplementPolicy;
    if (!exact(origin, native ? common : [...common, ...imported, ...(supplemented ? ["metadataSupplement"] : [])])
        || !["ai-generated-v2", "preserved-legacy-body", "edited-after-preservation"].includes(origin.kind)) {
      errors.push("未知来源类型或来源字段"); continue;
    }
    seen.push(origin.editionId);
    const article = articles.get(origin.editionId);
    if (!article || article.contentVersion !== 2 || !exact(article.sourceMetadata, METADATA_FIELDS)) { errors.push("来源没有对应的通用稿件"); continue; }
    for (const key of ["editionId", "aiRevisionId", "videoPartId", "contentSha256"]) {
      if (origin[key] !== article[key]) errors.push(`来源与稿件身份不一致: ${key}`);
    }
    if (origin.sourceMetadataSha256 !== canonicalDigest(article.sourceMetadata)) errors.push("冻结来源元数据哈希不一致");
    if (origin.inputVersion !== (native ? 2 : 1) || origin.aiTemplateVersion !== (native ? "ai-draft-v2" : "ai-draft-v1")) errors.push("来源声明的 input/AI 模板不一致");
    if (native) continue;
    for (const key of ["importId", "baselineBodySha256", "currentBodySha256", "reviewArtifactSha256"]) {
      if (!hash(origin[key])) errors.push(`导入哈希无效: ${key}`);
    }
    for (const [key, size] of [["legacyEditionId", 32], ["legacyReleaseId", 64]]) {
      if (origin[key] !== null && !hash(origin[key], size)) errors.push(`历史身份无效: ${key}`);
    }
    if (origin.legacyAiRevisionId !== article.aiRevisionId || origin.reviewArtifactSha256 !== article.reviewArtifactSha256
        || !["legacy-frozen-facts-v1", supplementPolicy].includes(origin.policyVersion) || !integer(origin.importedAt)) errors.push("导入基线或策略绑定无效");
    if (supplemented && !validateSupplement(origin.metadataSupplement, article)) errors.push("分 P 标题补充证据或身份绑定无效");
    const preserved = origin.kind === "preserved-legacy-body";
    if (origin.bodyPreserved !== preserved || (origin.baselineBodySha256 === origin.currentBodySha256) !== preserved) errors.push("正文保留声明与哈希关系不一致");
    const evidence = origin.metadataEvidence;
    if (!Array.isArray(evidence) || evidence.length !== METADATA_FIELDS.length) { errors.push("导入元数据证据不完整"); continue; }
    const fields = [];
    for (const fact of evidence) {
      if (!exact(fact, ["field", "kind", "observedAt", "valueSha256"]) || !METADATA_FIELDS.includes(fact.field)) { errors.push("元数据证据字段无效"); continue; }
      fields.push(fact.field);
      const known = knownFacts.has(fact.field);
      const supplied = supplemented && fact.field === "partTitle";
      if (fact.kind !== (supplied ? supplementKind : known ? "legacy-input" : "unobserved") || fact.observedAt !== null
          || fact.valueSha256 !== canonicalDigest(article.sourceMetadata?.[fact.field])) errors.push("元数据证据违反冻结旧事实策略");
      if (!known && !supplied && canonicalJson(article.sourceMetadata?.[fact.field]) !== canonicalJson(fact.field === "tags" ? [] : null)) errors.push("未观测元数据必须保留未知值");
    }
    if (JSON.stringify(fields) !== JSON.stringify([...METADATA_FIELDS].sort())) errors.push("元数据证据遗漏、重复或未排序");
  }
  if (JSON.stringify(seen) !== JSON.stringify([...articles.keys()].sort())) errors.push("每篇稿件必须有唯一且按 edition 排序的来源");
  return errors;
}
