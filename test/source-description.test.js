import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot, sha256 } from "../scripts/catalog.js";
import { canonicalDigest } from "../scripts/universal-contract.js";
import { validateSiteSnapshots } from "../scripts/validate-catalog.mjs";
import { buildReaderData } from "../scripts/reader-content.js";
import { sourcePanel } from "../src/refactor/views.js";

const root = fileURLToPath(new URL("./fixtures/source-description-v2/", import.meta.url));
async function filesFor(folder) {
  const files = new Map();
  async function scan(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await scan(path.join(directory, entry.name), `${name}/`);
      else files.set(name, await readFile(path.join(directory, entry.name)));
    }
  }
  await scan(path.join(root, folder));
  return files;
}
const publication = await filesFor("content");
const parse = (files, name) => JSON.parse(files.get(name));
function mutate(change) {
  const files = new Map(publication);
  const catalog = parse(files, "catalog.json"), origins = parse(files, "origins.json");
  const name = "publication-export-manifest.json", manifest = parse(files, name);
  change({ article: catalog.articles[0], origin: origins.entries[0], origins, manifest });
  files.set("catalog.json", Buffer.from(JSON.stringify(catalog)));
  files.set("origins.json", Buffer.from(JSON.stringify(origins)));
  manifest.files = [...files].filter(([key]) => key !== name).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, bytes]) => ({ path: key, sha256: sha256(bytes) }));
  manifest.snapshotId = canonicalDigest({ schemaVersion: manifest.schemaVersion, manuscriptType: manifest.manuscriptType,
    contractProfile: manifest.contractProfile, files: manifest.files });
  files.set(name, Buffer.from(JSON.stringify(manifest)));
  return files;
}

test("consumes actual producer v2 publication description and draft title exports through reader resources", async () => {
  assert.deepEqual(validateSnapshot(publication).errors, []);
  assert.deepEqual(validateSnapshot(await filesFor("draft-content"), "publication-draft").errors, []);
  const site = await validateSiteSnapshots(root, { includeOrigins: true });
  const generated = await buildReaderData(root);
  const article = site.publication.articles[0], origin = site.origins.published.entries[0];
  const descriptionFact = origin.metadataEvidence.find((fact) => fact.field === "description");
  assert.equal(descriptionFact.observedAt, 1234);
  assert.equal(article.sourceMetadata.metadataObservedAt, null);
  assert.equal(origin.metadataSupplement.evidence.value, article.sourceMetadata.description);
  assert.equal(origin.aiTemplateVersion, "ai-draft-v1");
  assert.equal(site.origins.drafts.entries[0].policyVersion, "legacy-part-title-supplement-v1");
  const details = JSON.parse(generated.resources.get(`${generated.directory.bases.published}entry-${article.editionId}.json`));
  assert.ok(details, "the generated reader preserves frozen description and origin");
  assert.equal(details.sourceMetadata.description, article.sourceMetadata.description);
  assert.deepEqual(details.origin, origin);
});

test("rejects v2 evidence corruption even when the outer manifest and evidence ID are regenerated", () => {
  const changes = [
    ({ origin }) => { delete origin.metadataSupplement; },
    ({ origin }) => { origin.policyVersion = "legacy-part-title-supplement-v1"; },
    ({ origin }) => { origin.metadataSupplement.supplementId = "f".repeat(64); },
    ({ origin }) => { origin.metadataSupplement.evidence.value = "Invented description"; },
    ({ origin }) => { origin.metadataSupplement.evidence.sourceKind = "archive-part-projection"; },
    ({ origin }) => { origin.metadataSupplement.evidence.version = 1; },
    ({ origin }) => { origin.metadataSupplement.evidence.extra = true; },
    ({ origin }) => { origin.metadataEvidence.find((fact) => fact.field === "description").observedAt = 9999; },
    ({ origin }) => { origin.metadataEvidence.find((fact) => fact.field === "description").kind = "unobserved"; },
    ({ origin }) => { origin.metadataEvidence.find((fact) => fact.field === "description").valueSha256 = "f".repeat(64); },
  ];
  for (const change of changes) assert.ok(validateSnapshot(mutate(change)).errors.length, change.toString());
  for (const [field, value] of [["platform", "youtube"], ["externalVideoId", "Wrong"], ["partIndex", 99],
    ["videoPartId", 99], ["cid", 0], ["observedAt", -1], ["observedAt", Number.MAX_SAFE_INTEGER + 1]]) {
    const files = mutate(({ origin }) => {
      origin.metadataSupplement.evidence[field] = value;
      origin.metadataSupplement.supplementId = canonicalDigest(origin.metadataSupplement.evidence);
    });
    assert.ok(validateSnapshot(files).errors.length, field);
  }
});

test("requires the complete declared profile version tuple and refuses description downgrade to v1", () => {
  const changes = [
    ({ manifest }) => { manifest.schemaVersion = 2; },
    ({ origins }) => { origins.schemaVersion = 1; },
    ({ origins }) => { origins.contractProfile = "universal-origin-v1"; },
    ({ manifest }) => { manifest.contractProfile = "universal-origin-v1"; },
    ({ manifest, origins }) => { manifest.schemaVersion = 2; manifest.contractProfile = origins.contractProfile = "universal-origin-v1"; origins.schemaVersion = 1; },
    ({ manifest }) => { manifest.contractProfile = "future-profile"; },
  ];
  for (const change of changes) assert.ok(validateSnapshot(mutate(change)).errors.length, change.toString());
});

test("accepts unknown collection time and empty descriptions without substituting an unrelated observation time", () => {
  for (const [description, observedAt] of [["", 1234], ["Description without collection time", null]]) {
    const files = mutate(({ article, origin }) => {
      article.sourceMetadata.description = description;
      origin.sourceMetadataSha256 = canonicalDigest(article.sourceMetadata);
      const evidence = origin.metadataSupplement.evidence;
      evidence.value = description; evidence.observedAt = observedAt;
      origin.metadataSupplement.supplementId = canonicalDigest(evidence);
      const fact = origin.metadataEvidence.find((item) => item.field === "description");
      fact.valueSha256 = canonicalDigest(description); fact.observedAt = observedAt;
    });
    assert.deepEqual(validateSnapshot(files).errors, []);
  }
});

test("source panel treats description as plain text, retains newlines, and distinguishes source from editorial summary", async () => {
  const site = await validateSiteSnapshots(root, { includeOrigins: true });
  const entry = { ...site.publication.articles[0], origin: site.origins.published.entries[0] };
  const description = "<script>alert('x')</script>\n[link](javascript:alert(1))\r\nSecond line";
  const edited = { ...entry, summary: "编辑摘要 <b>保持独立</b>", sourceMetadata: { ...entry.sourceMetadata, description } };
  const markup = sourcePanel(edited);
  assert.match(markup, /<dt>来源简介<\/dt><dd class="source-description">&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;\n\[link\]/);
  assert.ok(markup.includes("\r\nSecond line"));
  assert.match(markup, /<dt>编辑摘要<\/dt><dd>编辑摘要 &lt;b&gt;保持独立&lt;\/b&gt;<\/dd>/);
  assert.match(markup, /来源简介补充证据/);
  assert.doesNotMatch(markup, /<script>|<a[^>]+javascript:|分 P 标题补充证据/);
  assert.match(sourcePanel({ ...entry, sourceMetadata: { ...entry.sourceMetadata, description: null } }), /class="source-description">未提供<\/dd>/);
  assert.match(sourcePanel({ ...entry, sourceMetadata: { ...entry.sourceMetadata, description: "" } }), /class="source-description">（空简介）<\/dd>/);
  const css = await readFile(new URL("../src/refactor/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.source-description\s*\{[^}]*white-space:\s*pre-wrap/);
});
