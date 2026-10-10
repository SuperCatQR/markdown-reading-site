import { universalEntry, signSnapshot } from "./support/universal-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { sha256, validateCatalog, validateSnapshot } from "../scripts/catalog.js";
import { reviewRoute, resolveReaderRoute, entryKey, buildIssueUrl } from "../src/manuscripts.js";
import { markdown } from "../src/markdown.js";
import { prepareDocument } from "../src/document.js";
import { searchEntries } from "../src/search.js";

const reference = `# 合成稿件：校验参照稿件

AI 合成稿件，未经人工复核。

修订：\`${"c".repeat(64)}\`

## 段落 1：00:00:00 — 00:00:22

来源：\`t1:s0\`；[回看](https://www.bilibili.com/video/BVtest/?p=1&t=0)

原文：参照独有星河。

整理稿：参照独有星河。

- 疑点：待核验词语；候选：星河；依据：t1:s0

<script>alert(1)</script>

[不安全链接](javascript:alert(1))
`;
const body = "# 人工编辑后正文\n\n正文独有青竹。\n";
const published = universalEntry({
  manuscriptType: "publication", slug: "part-1", title: "合成稿件", summary: "", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: [] }, tags: [],
  attribution: "合成测试数据", editorNote: "", releaseId: "f".repeat(64), editionId: "a".repeat(32),
  aiRevisionId: "c".repeat(64), videoPartId: 1, contentVersion: 2, platform: "bilibili", externalVideoId: "BVtest", partIndex: 0,
  sourceUrl: "https://www.bilibili.com/video/BVtest/?p=1", contentSha256: "d".repeat(64),
  artifactSha256: sha256(body), templateVersion: "publish-v2", publishedAt: 1791417600,
  file: "articles/part-1/publish.md", reviewFile: "articles/part-1/review.md", reviewArtifactSha256: sha256(reference),
});
const { releaseId, publishedAt, templateVersion, ...reader } = published;
const draft = universalEntry({ ...reader, manuscriptType: "publication-draft", editionId: "b".repeat(32),
  slug: "edition-" + "b".repeat(32), createdAt: 1791417600, reviewStatus: "pending-review",
  file: "drafts/edition-" + "b".repeat(32) + "/preview.md",
  reviewFile: "drafts/edition-" + "b".repeat(32) + "/review.md",
});
const entries = [published, draft];
const envelope = (entry, schemaVersion = 3) => ({ schemaVersion, manuscriptType: entry.manuscriptType, articles: [entry] });
const manifestName = (entry) => entry.manuscriptType === "publication" ? "publication-export-manifest.json" : "publication-draft-export-manifest.json";

function snapshot(entry, reviewBytes = Buffer.from(reference)) {
  const files = new Map([[entry.file, Buffer.from(body)], [entry.reviewFile, reviewBytes],
    ["catalog.json", Buffer.from(JSON.stringify(envelope(entry)) + "\n")]]);
  setManifest(files, entry);
  return files;
}

function setManifest(files, entry, omit = []) {
  signSnapshot(files, entry.manuscriptType, { omit });
}

test("both v3 catalogs require paired references and the origin-profile v2 manifest", () => {
  for (const entry of entries) {
    assert.deepEqual(validateSnapshot(snapshot(entry), entry.manuscriptType).errors, []);
    assert.ok(validateCatalog(envelope(entry, 1), [entry.file, entry.reviewFile], entry.manuscriptType).length);
    for (const field of ["reviewFile", "reviewArtifactSha256"]) {
      const incomplete = { ...entry }; delete incomplete[field];
      assert.ok(validateCatalog(envelope(incomplete), [entry.file, entry.reviewFile], entry.manuscriptType).length);
    }
    const files = snapshot(entry);
    const manifest = JSON.parse(files.get(manifestName(entry))); manifest.schemaVersion = 1;
    files.set(manifestName(entry), Buffer.from(JSON.stringify(manifest)));
    assert.ok(validateSnapshot(files, entry.manuscriptType).errors.some((error) => error.includes("v2")));
  }
});

test("reference paths bind to exact part or edition and reject arbitrary files", () => {
  for (const entry of entries) {
    for (const reviewFile of ["review.md", entry.file, "../private/review.md", entry.reviewFile.toUpperCase(),
      entry.manuscriptType === "publication" ? "articles/part-2/review.md" : "drafts/edition-" + "0".repeat(32) + "/review.md"]) {
      assert.ok(validateCatalog(envelope({ ...entry, reviewFile }), [entry.file, reviewFile], entry.manuscriptType)
        .some((error) => error.includes("reviewFile")), reviewFile);
    }
    for (const reviewArtifactSha256 of ["", "abc", "A".repeat(64), null]) {
      assert.ok(validateCatalog(envelope({ ...entry, reviewArtifactSha256 }), [entry.file, entry.reviewFile], entry.manuscriptType)
        .some((error) => error.includes("reviewArtifactSha256")));
    }
  }
});

test("review absence, raw byte tampering and catalog hash substitution fail validation", () => {
  for (const entry of entries) {
    const missing = snapshot(entry); missing.delete(entry.reviewFile);
    assert.ok(validateSnapshot(missing, entry.manuscriptType).errors.some((error) => error.includes("缺")));
    const changed = snapshot(entry); changed.set(entry.reviewFile, Buffer.from(reference + "变更"));
    assert.ok(validateSnapshot(changed, entry.manuscriptType).errors.some((error) => error.includes("SHA-256")));
    const substituted = snapshot({ ...entry, reviewArtifactSha256: "0".repeat(64) });
    assert.ok(validateSnapshot(substituted, entry.manuscriptType).errors.some((error) => error.includes("artifactSha256")));
    const invalid = snapshot(entry, Buffer.from([0xff]));
    assert.ok(validateSnapshot(invalid, entry.manuscriptType).errors.some((error) => error.includes("UTF-8")));
  }
});

test("manifest must register reference exactly once and cannot authorize internal review JSON", () => {
  for (const entry of entries) {
    const absent = snapshot(entry); setManifest(absent, entry, [entry.reviewFile]);
    assert.ok(validateSnapshot(absent, entry.manuscriptType).errors.some((error) => error.includes("未登记")));
    const duplicate = snapshot(entry), manifest = JSON.parse(duplicate.get(manifestName(entry)));
    manifest.files.push(manifest.files.find((item) => item.path === entry.reviewFile));
    manifest.files.sort((a, b) => a.path.localeCompare(b.path)); manifest.snapshotId = sha256(JSON.stringify(manifest.files));
    duplicate.set(manifestName(entry), Buffer.from(JSON.stringify(manifest)));
    assert.ok(validateSnapshot(duplicate, entry.manuscriptType).errors.some((error) => error.includes("重复")));
    const extra = snapshot(entry); extra.set(entry.reviewFile.replace("review.md", "review.json"), Buffer.from("{}"));
    setManifest(extra, entry);
    assert.ok(validateSnapshot(extra, entry.manuscriptType).errors.some((error) => error.includes("无效受管文件")));
  }
});

test("review routes uniquely resolve both catalogs and follow the same edition after publication", () => {
  for (const [entry, view] of [[published, "published"], [draft, "drafts"]]) {
    assert.deepEqual(resolveReaderRoute(reviewRoute(entry), [published], [draft]), { kind: "article", view, mode: "review", entry });
  }
  const newlyPublished = { ...published, editionId: draft.editionId };
  assert.equal(resolveReaderRoute(reviewRoute(draft), [newlyPublished], []).view, "published");
  assert.equal(resolveReaderRoute(reviewRoute(draft), [newlyPublished], [draft]).kind, "missing");
  assert.equal(resolveReaderRoute(reviewRoute(published), [published, published], []).kind, "missing");
});

test("review routes reject unknown IDs, duplicate keys and conflicting selectors", () => {
  for (const query of ["?review=part-1", "?review=" + "0".repeat(32), "?review=" + "A".repeat(32),
    reviewRoute(draft) + "&review=" + draft.editionId, reviewRoute(draft) + "&draft=" + draft.editionId,
    reviewRoute(draft) + "&read=part-1", reviewRoute(draft) + "&view=drafts", reviewRoute(draft) + "&unexpected=1"]) {
    assert.equal(resolveReaderRoute(query, [published], [draft]).kind, "missing", query);
  }
});

test("reference Issue links preserve both artifact and edition identities without draft release claims", () => {
  for (const entry of entries) {
    const issue = new URL(buildIssueUrl(entry, "https://reader.example/site/", "https://github.com/example/site/issues/new", "review"));
    const text = issue.searchParams.get("body");
    for (const identity of [entry.editionId, entry.aiRevisionId, entry.contentSha256, entry.reviewArtifactSha256, entry.sourceUrl]) {
      assert.ok(text.includes(identity), identity);
    }
    assert.ok(text.includes("https://reader.example/site/" + reviewRoute(entry)));
    assert.equal(text.includes("发布 ID"), entry.manuscriptType === "publication");
  }
});

test("complete reference text stays safe while directory search indexes edited body only", () => {
  const html = markdown.render(reference);
  for (const label of ["原文：", "整理稿：", "疑点：", "候选：", "依据：", "回看", "未经人工复核"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  const index = Object.fromEntries(entries.map((entry) => [entryKey(entry), prepareDocument(body).blocks]));
  assert.equal(searchEntries(entries, { query: "参照独有星河", tag: "全部" }, index).length, 0);
  assert.equal(searchEntries(entries, { query: "正文独有青竹", tag: "全部" }, index).length, 2);
  assert.equal(sha256(Buffer.from(reference)), published.reviewArtifactSha256);
});
