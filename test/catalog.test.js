import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256, validateCatalog, validateSnapshot } from "../scripts/catalog.js";
import { validateContentDirectory } from "../scripts/validate-catalog.mjs";

const document = "# 合成发布稿\n\n经过明确审核的测试正文。\n";
const validEntry = {
  manuscriptType: "publication", slug: "part-1", title: "合成发布稿", summary: "测试摘要", tags: [],
  attribution: "根据视频口述整理", editorNote: "", releaseId: "a".repeat(64), editionId: "b".repeat(32),
  aiRevisionId: "c".repeat(64), videoPartId: 1, bvid: "BV1haEB66Eg1", pageIndex: 0,
  sourceUrl: "https://www.bilibili.com/video/BV1haEB66Eg1/?p=1", contentSha256: "d".repeat(64),
  artifactSha256: sha256(document), templateVersion: "publish-v1", publishedAt: 1791417600,
  file: "articles/part-1/publish.md",
};
const envelope = (articles) => ({ schemaVersion: 1, manuscriptType: "publication", articles });

function snapshot(articles = [validEntry], documents = new Map([[validEntry.file, Buffer.from(document)]])) {
  const files = new Map(documents);
  files.set("catalog.json", Buffer.from(JSON.stringify(envelope(articles)) + "\n"));
  const managed = [...files].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ path: name, sha256: sha256(value) }));
  files.set("publication-export-manifest.json", Buffer.from(JSON.stringify({
    schemaVersion: 1, manuscriptType: "publication-export", snapshotId: sha256(JSON.stringify(managed)), files: managed,
  })));
  return files;
}

test("accepts empty and complete exact public catalog envelopes", () => {
  assert.deepEqual(validateCatalog(envelope([]), []), []);
  assert.deepEqual(validateCatalog(envelope([validEntry]), [validEntry.file]), []);
  assert.deepEqual(validateSnapshot(snapshot()).errors, []);
  assert.deepEqual(validateSnapshot(snapshot([], new Map())).errors, []);
  assert.deepEqual(validateCatalog(envelope([{ ...validEntry, bvid: "BV_test-1", sourceUrl: "https://www.bilibili.com/video/BV_test-1/?p=1" }]), [validEntry.file]), []);
});

test("rejects legacy arrays, editorial envelope, draft fields and wrong templates", () => {
  assert.ok(validateCatalog([], []).length);
  assert.ok(validateCatalog({ ...envelope([]), manuscriptType: "editorial-review" }, []).length);
  assert.ok(validateCatalog(envelope([{ ...validEntry, reviewStatus: "approved" }]), [validEntry.file]).length);
  assert.ok(validateCatalog(envelope([{ ...validEntry, templateVersion: "ai-draft-v1" }]), [validEntry.file]).length);
});

test("rejects path traversal, duplicate parts, missing releases and residual files", () => {
  const unsafe = { ...validEntry, file: "../private/review.md" };
  assert.ok(validateCatalog(envelope([unsafe]), [unsafe.file]).some((error) => error.includes("路径")));
  assert.ok(validateCatalog(envelope([validEntry, validEntry]), [validEntry.file]).some((error) => error.includes("重复")));
  assert.ok(validateCatalog(envelope([validEntry]), []).some((error) => error.includes("缺少")));
  assert.ok(validateCatalog(envelope([]), [validEntry.file]).some((error) => error.includes("未登记")));
});

test("requires correct full-content hashes, frozen source identity and Unix dates", () => {
  for (const patch of [{ editionId: "b".repeat(64) }, { artifactSha256: "abc" }, { videoPartId: 2 },
    { sourceUrl: "javascript:alert(1)" }, { pageIndex: -1 }, { publishedAt: "2026-10-08" },
    { tags: ["重复", "重复"] }, { title: "" }, { attribution: "" }]) {
    assert.ok(validateCatalog(envelope([{ ...validEntry, ...patch }]), [validEntry.file]).length, JSON.stringify(patch));
  }
});

test("detects changed or missing article bytes and mismatched catalog artifact hash", () => {
  const changed = snapshot();
  changed.set(validEntry.file, Buffer.from("tampered publication"));
  assert.ok(validateSnapshot(changed).errors.some((error) => error.includes("SHA-256")));
  const missing = snapshot(); missing.delete(validEntry.file);
  assert.ok(validateSnapshot(missing).errors.some((error) => error.includes("缺失")));
  const wrongHash = snapshot([{ ...validEntry, artifactSha256: "e".repeat(64) }]);
  assert.ok(validateSnapshot(wrongHash).errors.some((error) => error.includes("artifactSha256")));
});

test("rejects manifest hash mismatches, duplicates, private files and invalid UTF-8", () => {
  const files = snapshot();
  const manifest = JSON.parse(files.get("publication-export-manifest.json"));
  manifest.snapshotId = "0".repeat(64); manifest.files.push(manifest.files[0]);
  files.set("publication-export-manifest.json", Buffer.from(JSON.stringify(manifest)));
  assert.ok(validateSnapshot(files).errors.some((error) => error.includes("重复")));
  assert.ok(validateSnapshot(files).errors.some((error) => error.includes("snapshotId")));
  const reordered = snapshot();
  const reorderedManifest = JSON.parse(reordered.get("publication-export-manifest.json"));
  reorderedManifest.files.reverse(); reorderedManifest.snapshotId = sha256(JSON.stringify(reorderedManifest.files));
  reordered.set("publication-export-manifest.json", Buffer.from(JSON.stringify(reorderedManifest)));
  assert.ok(validateSnapshot(reordered).errors.some((error) => error.includes("排序")));
  const privateFiles = snapshot(); privateFiles.set("review.md", Buffer.from("private discussion"));
  assert.ok(validateSnapshot(privateFiles).errors.some((error) => error.includes("未登记")));
  const invalid = snapshot(); invalid.set(validEntry.file, Buffer.from([0xff]));
  assert.ok(validateSnapshot(invalid).errors.some((error) => error.includes("UTF-8")));
});

test("rejects duplicate JSON keys and UTF-8 BOM before interpreting identities", () => {
  const duplicate = snapshot([], new Map());
  duplicate.set("catalog.json", Buffer.from('{"schemaVersion":0,"schemaVersion":1,"manuscriptType":"publication","articles":[]}'));
  assert.ok(validateSnapshot(duplicate).errors.some((error) => error.includes("JSON 字段重复")));
  const escaped = snapshot();
  const manifest = escaped.get("publication-export-manifest.json").toString();
  escaped.set("publication-export-manifest.json", Buffer.from(manifest.replace('"path":', '"p\\u0061th":"ignored","path":')));
  assert.ok(validateSnapshot(escaped).errors.some((error) => error.includes("JSON 字段重复")));
  const bom = snapshot();
  bom.set("catalog.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bom.get("catalog.json")]));
  assert.ok(validateSnapshot(bom).errors.some((error) => error.includes("JSON")));
});

test("validates nested filesystem snapshots and refuses private directories or links", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publication-site-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "articles", "part-1"), { recursive: true });
  for (const [name, value] of snapshot()) await writeFile(path.join(root, name), value);
  assert.equal((await validateContentDirectory(root)).articles[0].releaseId, validEntry.releaseId);
  await mkdir(path.join(root, "reviews"));
  await assert.rejects(validateContentDirectory(root), /未知目录/);
  await rm(path.join(root, "reviews"), { recursive: true });
  await mkdir(path.join(root, "articles", "part-2"));
  await assert.rejects(validateContentDirectory(root), /残留空目录/);
  await rm(path.join(root, "articles", "part-2"), { recursive: true });
  const alias = `${root}-alias`;
  try {
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory links unavailable: ${error.message}`);
    return;
  }
  t.after(() => rm(alias, { force: true }));
  await assert.rejects(validateContentDirectory(alias), /不允许链接/);
});
