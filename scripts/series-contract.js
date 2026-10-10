import { bilibiliId, partIndex } from "../src/source-identity.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const text = (value) => typeof value === "string" && value.length > 0 && value === value.trim() && !/[\u0000-\u001f]/u.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const bindingFields = ["slug", "editionId", "contentSha256", "artifactSha256"];
const secureSource = (value) => {
  try { const url = new URL(value); return text(value) && value.startsWith("https://") && !/[\s\\#]/u.test(value) && url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
};

// Optional metadata augments the snapshot; it never changes frozen article fields.
export function validateSeries(envelope, catalog, kind = "publication") {
  if (!exact(envelope, ["schemaVersion", "manuscriptType", "editorialVersion", "series"])
      || envelope.schemaVersion !== 1 || envelope.manuscriptType !== kind || !sha(envelope.editorialVersion)
      || !Array.isArray(envelope.series)) return ["series.json 必须使用准确的系列 v1 契约及稿件类别"];
  const errors = [];
  const ids = new Set();
  let previousId = "";
  for (const [index, series] of envelope.series.entries()) {
    const label = `series.json.series[${index}]`;
    if (!exact(series, ["id", "title", "sourceUrl", "evidence", "members", "knownMissing"])) {
      errors.push(`${label} 系列字段无效`); continue;
    }
    if (typeof series.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(series.id) || ids.has(series.id) || series.id <= previousId) errors.push(`${label}.id 无效、重复或未按顺序排序`);
    ids.add(series.id);
    previousId = series.id;
    if (!text(series.title) || !text(series.evidence) || !secureSource(series.sourceUrl)) errors.push(`${label} 必须有编辑确认的标题、来源及依据`);
    if (!Array.isArray(series.members) || !series.members.length || !Array.isArray(series.knownMissing)) {
      errors.push(`${label} 成员及已知缺失列表无效`); continue;
    }
    const ordinals = new Set(), videos = new Set();
    const articles = Array.isArray(catalog?.articles) ? catalog.articles.filter(object) : [];
    let previous = 0;
    for (const [memberIndex, member] of series.members.entries()) {
      const location = `${label}.members[${memberIndex}]`;
      if (!exact(member, ["bvid", "label", "ordinal", "entries"])) { errors.push(`${location} 字段无效`); continue; }
      if (!positive(member.ordinal) || member.ordinal <= previous) errors.push(`${location} 顺序必须是严格递增的正整数`);
      previous = member.ordinal; ordinals.add(member.ordinal);
      if (typeof member.bvid !== "string" || !/^BV[A-Za-z0-9]{10}$/.test(member.bvid) || videos.has(member.bvid) || !text(member.label)) errors.push(`${location} 视频身份或说明无效/重复`);
      videos.add(member.bvid);
      if (!Array.isArray(member.entries)) { errors.push(`${location}.entries 必须是数组`); continue; }
      const expected = articles.filter((entry) => bilibiliId(entry) === member.bvid)
        .sort((a, b) => partIndex(a) - partIndex(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
      if (member.entries.length !== expected.length || member.entries.some((binding, part) => !exact(binding, bindingFields)
          || !expected[part] || bindingFields.some((key) => binding[key] !== expected[part][key]))) errors.push(`${location}.entries 必须准确绑定当前类别的完整目录及版本顺序`);
    }
    previous = 0;
    for (const missing of series.knownMissing) {
      if (!exact(missing, ["ordinal", "label", "note"]) || !positive(missing.ordinal) || missing.ordinal <= previous || ordinals.has(missing.ordinal)
          || !text(missing.label) || !text(missing.note)) errors.push(`${label}.knownMissing 必须明确说明已确认缺失，且不与成员顺序重叠`);
      previous = missing?.ordinal; ordinals.add(missing?.ordinal);
    }
  }
  return errors;
}
