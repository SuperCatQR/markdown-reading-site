import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateSnapshot, sha256 } from "../scripts/catalog.js";
import { canonicalDigest } from "../scripts/universal-contract.js";
import { validateSiteSnapshots } from "../scripts/validate-catalog.mjs";
import { partsListMarkup } from "../src/reading-layout.js";
import { originNoticeMarkup, provenanceMarkup } from "../src/reader-details.js";

const root = fileURLToPath(new URL("./fixtures/source-supplement-v1/", import.meta.url));
async function filesFor(folder) {
  const files = new Map();
  async function scan(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = prefix + entry.name;
      if (entry.isDirectory()) await scan(path.join(directory, entry.name), `${key}/`);
      else files.set(key, await readFile(path.join(directory, entry.name)));
    }
  }
  await scan(path.join(root, folder));
  return files;
}
const drafts = await filesFor("draft-content");
const parse = (files, name) => JSON.parse(files.get(name));
function mutate(change) {
  const files = new Map(drafts);
  const origins = parse(files, "origins.json");
  change(origins.entries[0]);
  files.set("origins.json", Buffer.from(JSON.stringify(origins)));
  const name = "publication-draft-export-manifest.json";
  const manifest = parse(files, name);
  manifest.files = [...files].filter(([key]) => key !== name).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, bytes]) => ({ path: key, sha256: sha256(bytes) }));
  manifest.snapshotId = canonicalDigest({ schemaVersion: 2, manuscriptType: manifest.manuscriptType,
    contractProfile: manifest.contractProfile, files: manifest.files });
  files.set(name, Buffer.from(JSON.stringify(manifest)));
  return files;
}

test("consumes paired producer exports with supplemental titles and historical AI references", async () => {
  assert.deepEqual(validateSnapshot(drafts, "publication-draft").errors, []);
  assert.deepEqual(validateSnapshot(await filesFor("content")).errors, []);
  const site = await validateSiteSnapshots(root, { includeOrigins: true });
  const entry = { ...site.drafts.articles[0], origin: site.origins.drafts.entries[0] };
  assert.equal(entry.sourceMetadata.partTitle, "如何进行真正的哲学反思");
  assert.equal(entry.sourceMetadata.metadataObservedAt, null);
  assert.equal(entry.origin.metadataSupplement.evidence.observedAt, null);
  assert.equal(entry.origin.aiTemplateVersion, "ai-draft-v1");
  assert.equal(entry.origin.bodyPreserved, true);
  const markup = partsListMarkup({ entry, kind: "draft", view: "drafts" }, [entry]);
  assert.match(markup, /如何进行真正的哲学反思/);
  assert.doesNotMatch(markup, /分段标题未提供/);
  assert.match(originNoticeMarkup(entry, true), /历史 AI 校验基线/);
  assert.match(provenanceMarkup(entry), /来源分段标题/);
  assert.match(provenanceMarkup(entry), /元数据观察时间（UTC）<\/strong>未知/);
});

test("rejects invented policy, missing evidence, mismatched identity and hashes despite a regenerated manifest", () => {
  const changes = [
    (origin) => { delete origin.metadataSupplement; },
    (origin) => { origin.policyVersion = "legacy-frozen-facts-v1"; },
    (origin) => { origin.policyVersion = "invented"; },
    (origin) => { origin.metadataSupplement.supplementId = "f".repeat(64); },
    (origin) => { origin.metadataSupplement.evidence.cid += 1; },
    (origin) => { origin.metadataSupplement.evidence.value = "Invented title"; },
    (origin) => { origin.metadataSupplement.evidence.observedAt = 123; },
    (origin) => { origin.metadataSupplement.evidence.sourceKind = "legacy-input"; },
    (origin) => { origin.metadataSupplement.evidence.extra = "unrecognized"; },
    (origin) => { origin.metadataEvidence.find((fact) => fact.field === "partTitle").kind = "unobserved"; },
    (origin) => { origin.metadataEvidence.find((fact) => fact.field === "partTitle").valueSha256 = "f".repeat(64); },
  ];
  for (const change of changes) assert.ok(validateSnapshot(mutate(change), "publication-draft").errors.length, change.toString());
  for (const [field, value] of [["platform", "youtube"], ["externalVideoId", "Wrong"], ["partIndex", 99], ["videoPartId", 99], ["cid", Number.MAX_SAFE_INTEGER + 1], ["observedAt", 123]]) {
    const files = mutate((origin) => {
      origin.metadataSupplement.evidence[field] = value;
      origin.metadataSupplement.supplementId = canonicalDigest(origin.metadataSupplement.evidence);
    });
    assert.ok(validateSnapshot(files, "publication-draft").errors.length, field);
  }
});
