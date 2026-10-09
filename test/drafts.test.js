import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256, validateCatalog, validateSnapshot, validateCatalogPair, REVIEW_STATUSES } from "../scripts/catalog.js";
import { validateContentDirectory, validateSiteSnapshots } from "../scripts/validate-catalog.mjs";
import { entryKey, resolveReaderRoute, buildIssueUrl, entryDate, REVIEW_LABELS } from "../src/manuscripts.js";
import { buildReaderData } from "../scripts/reader-content.js";
import { searchEntries } from "../src/search.js";

const document = "# 未发布版本 B\n\n红杉星辰只在草稿中。\n";
const review = "# 合成数据校验参照\n\nAI 初稿基线，未经人工复核。\n";
const draft = {
  manuscriptType: "publication-draft", slug: "edition-" + "b".repeat(32),
  title: "未发布版本 B", summary: "尚未发布", tags: ["合成测试"], attribution: "合成数据", editorNote: "",
  editionId: "b".repeat(32), aiRevisionId: "c".repeat(64), videoPartId: 1, bvid: "BVtest", pageIndex: 0,
  sourceUrl: "https://www.bilibili.com/video/BVtest/?p=1", contentSha256: "d".repeat(64),
  artifactSha256: sha256(document), reviewStatus: "pending-review", createdAt: 1791417600,
  file: "drafts/edition-" + "b".repeat(32) + "/preview.md",
  reviewFile: "drafts/edition-" + "b".repeat(32) + "/review.md", reviewArtifactSha256: sha256(review),
};
const publication = {
  manuscriptType: "publication", slug: "part-1", title: "已发布版本 A", summary: "", tags: [],
  attribution: "合成数据", editorNote: "", editionId: "a".repeat(32), aiRevisionId: "c".repeat(64),
  videoPartId: 1, bvid: "BVtest", pageIndex: 0, sourceUrl: draft.sourceUrl, contentSha256: "e".repeat(64),
  artifactSha256: sha256("# 已发布版本 A\n\n青竹溪流。\n"), releaseId: "f".repeat(64), templateVersion: "publish-v1",
  publishedAt: 1791417600, file: "articles/part-1/publish.md",
  reviewFile: "articles/part-1/review.md", reviewArtifactSha256: sha256(review),
};
const envelope = (entries = [draft], kind = "publication-draft") => ({ schemaVersion: 2, manuscriptType: kind, articles: entries });

function snapshot(entries = [draft], kind = "publication-draft") {
  const files = new Map(entries.map((entry) => [entry.file, Buffer.from(entry.manuscriptType === "publication-draft" ? document : "# 已发布版本 A\n\n青竹溪流。\n")]));
  for (const entry of entries) files.set(entry.reviewFile, Buffer.from(review));
  files.set("catalog.json", Buffer.from(JSON.stringify(envelope(entries, kind)) + "\n"));
  const managed = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, bytes]) => ({ path: name, sha256: sha256(bytes) }));
  const manifestKind = kind === "publication" ? "publication-export" : "publication-draft-export";
  files.set(manifestKind + "-manifest.json", Buffer.from(JSON.stringify({
    schemaVersion: 1, manuscriptType: manifestKind, snapshotId: sha256(JSON.stringify(managed)), files: managed,
  }) + "\n"));
  return files;
}

async function writeSnapshot(root, files) {
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
}

test("accepts exact draft snapshots, empty roots and every review status", () => {
  assert.deepEqual(validateSnapshot(snapshot([]), "publication-draft").errors, []);
  for (const reviewStatus of REVIEW_STATUSES) {
    assert.deepEqual(validateSnapshot(snapshot([{ ...draft, reviewStatus }]), "publication-draft").errors, []);
  }
  assert.equal(REVIEW_LABELS.approved, "已审核 · 未发布");
  assert.equal(REVIEW_LABELS["pending-review"], "待审核");
  assert.equal(REVIEW_LABELS["in-review"], "审核中");
  assert.equal(REVIEW_LABELS["changes-requested"], "待修改");
  assert.equal(REVIEW_LABELS.rejected, "未采用");
  assert.equal(entryDate(draft), "2026-10-08");
});

test("rejects private context, release claims and unsupported draft statuses", () => {
  for (const patch of [{ releaseId: "f".repeat(64) }, { publishedAt: draft.createdAt }, { templateVersion: "publish-v1" },
    { reviews: [] }, { events: [] }, { ai: {} }, { reviewStatus: "published" }, { reviewStatus: "withdrawn" }]) {
    assert.ok(validateCatalog(envelope([{ ...draft, ...patch }]), [draft.file], "publication-draft").length, JSON.stringify(patch));
  }
  assert.ok(validateCatalog(envelope(), [draft.file]).length, "draft envelope rejected by publication validator");
  assert.ok(validateCatalog(envelope([publication], "publication"), [publication.file], "publication-draft").length);
});

test("binds draft paths and video source to exact edition identity", () => {
  for (const patch of [{ editionId: "b".repeat(64) }, { editionId: "a".repeat(32) }, { slug: "part-1" },
    { file: "drafts/../preview.md" }, { file: draft.file.toUpperCase() }, { videoPartId: 0 },
    { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "https://www.bilibili.com/video/BVtest/?p=2" },
    { aiRevisionId: "" }, { contentSha256: "" }, { createdAt: "2026-10-08" }, { tags: ["dup", "dup"] }]) {
    assert.ok(validateCatalog(envelope([{ ...draft, ...patch }]), [draft.file], "publication-draft").length, JSON.stringify(patch));
  }
  assert.ok(validateCatalog(envelope([draft, draft]), [draft.file], "publication-draft").some((error) => error.includes("重复")));
});

test("checks complete draft byte hashes, manifests, UTF-8 and duplicate JSON keys", () => {
  const changed = snapshot(); changed.set(draft.file, Buffer.from("changed"));
  assert.ok(validateSnapshot(changed, "publication-draft").errors.some((error) => error.includes("SHA-256")));
  const missing = snapshot(); missing.delete(draft.file);
  assert.ok(validateSnapshot(missing, "publication-draft").errors.length);
  const invalid = snapshot(); invalid.set(draft.file, Buffer.from([0xff]));
  assert.ok(validateSnapshot(invalid, "publication-draft").errors.some((error) => error.includes("UTF-8")));
  const privateFile = snapshot(); privateFile.set("review.md", Buffer.from("internal"));
  assert.ok(validateSnapshot(privateFile, "publication-draft").errors.some((error) => error.includes("未登记")));
  const duplicate = snapshot();
  duplicate.set("catalog.json", Buffer.from('{"schemaVersion":0,"schemaVersion":1,"manuscriptType":"publication-draft","articles":[]}'));
  assert.ok(validateSnapshot(duplicate, "publication-draft").errors.some((error) => error.includes("字段重复")));
  const wrongKind = snapshot(); const manifest = JSON.parse(wrongKind.get("publication-draft-export-manifest.json"));
  manifest.manuscriptType = "editorial-export";
  wrongKind.set("publication-draft-export-manifest.json", Buffer.from(JSON.stringify(manifest)));
  assert.ok(validateSnapshot(wrongKind, "publication-draft").errors.some((error) => error.includes("契约")));
});

test("published A and current draft B coexist without asserting the same edition twice", () => {
  assert.deepEqual(validateCatalogPair(envelope([publication], "publication"), envelope()), []);
  assert.ok(validateCatalogPair(envelope([{ ...publication, editionId: draft.editionId }], "publication"), envelope()).length);
});

test("directory search and routes keep published A independent of B review status", () => {
  const index = { [entryKey(publication)]: [{ id: "passage-1", text: "青竹溪流" }], [entryKey(draft)]: [{ id: "passage-1", text: "红杉星辰" }] };
  for (const reviewStatus of REVIEW_STATUSES) {
    const selectedDraft = { ...draft, reviewStatus };
    assert.equal(searchEntries([publication], { query: "红杉星辰", tag: "全部" }, index).length, 0);
    assert.equal(searchEntries([selectedDraft], { query: "红杉星辰", tag: "全部" }, index)[0].entry.editionId, draft.editionId);
    assert.equal(searchEntries([selectedDraft], { query: "", tag: "不存在" }, index).length, 0);
    assert.equal(resolveReaderRoute("?read=part-1", [publication], [selectedDraft]).entry, publication);
    assert.equal(resolveReaderRoute("?draft=" + draft.editionId, [publication], [selectedDraft]).entry, selectedDraft);
  }
  assert.equal(resolveReaderRoute("?view=drafts", [publication], [draft]).view, "drafts");
  assert.equal(resolveReaderRoute("?review=part-1", [publication], [draft]).kind, "missing");
  assert.equal(resolveReaderRoute("?read=part-1&draft=" + draft.editionId, [publication], [draft]).kind, "missing");
  assert.equal(resolveReaderRoute("?draft=../private", [publication], [draft]).kind, "missing");
  assert.equal(resolveReaderRoute("?draft=" + "0".repeat(32), [publication], [draft]).entry, undefined);
});

test("draft Issue suggestions include exact edition/hash/source without publication claims", () => {
  const issue = new URL(buildIssueUrl(draft, "https://site.example/reader/?view=drafts", "https://github.com/example/site/issues/new"));
  const body = issue.searchParams.get("body");
  for (const identity of [draft.editionId, draft.aiRevisionId, draft.contentSha256, draft.sourceUrl]) assert.ok(body.includes(identity));
  assert.ok(body.includes("https://site.example/reader/?draft=" + draft.editionId));
  assert.ok(!body.includes("发布 ID") && !body.includes("undefined"));
  const published = new URL(buildIssueUrl(publication, "https://site.example/reader/", "https://github.com/example/site/issues/new"));
  assert.ok(published.searchParams.get("body").includes(publication.releaseId));
});

test("validates both deployment roots, refuses leftovers and detects changed draft bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draft-site-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSnapshot(path.join(root, "content"), snapshot([publication], "publication"));
  await writeSnapshot(path.join(root, "draft-content"), snapshot());
  assert.equal((await validateSiteSnapshots(root)).drafts.articles[0].editionId, draft.editionId);
  const generated = await buildReaderData(root);
  assert.equal(Object.keys(generated.summaries).length, 2);
  assert.ok(JSON.stringify(generated.search.drafts).includes("红杉星辰"));
  assert.ok(!JSON.stringify(generated.search.published).includes("红杉星辰"));
  assert.ok(!JSON.stringify(generated.search).includes("AI 初稿基线"), "reference content stays out of the body search index");
  await writeFile(path.join(root, "draft-content", draft.file), "modified draft");
  await assert.rejects(validateSiteSnapshots(root), /SHA-256/);
  await assert.rejects(buildReaderData(root), /SHA-256/);
  await writeSnapshot(path.join(root, "draft-content"), snapshot());
  await mkdir(path.join(root, "draft-content", "reviews"));
  await assert.rejects(validateSiteSnapshots(root), /未知目录/);
  await rm(path.join(root, "draft-content", "reviews"), { recursive: true });
  const alias = root + "-alias";
  try { await symlink(path.join(root, "draft-content"), alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { t.skip("directory links unavailable: " + error.message); return; }
  t.after(() => rm(alias, { force: true }));
  await assert.rejects(validateContentDirectory(alias, "publication-draft"), /不允许链接/);
});
