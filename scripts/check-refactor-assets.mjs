// Run after pnpm build. Checks the exact emitted resource set, details/origins,
// and every original Markdown byte against the validated source snapshots.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateSiteSnapshots } from "./validate-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "dist");
const snapshots = await validateSiteSnapshots(root, { includeOrigins: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];
for (const [view, catalog] of [["published", snapshots.publication], ["drafts", snapshots.drafts]]) {
  if (!catalog.articles.length) { results.push({ view, editions: 0, markdownFiles: 0, markdownBytes: 0 }); continue; }
  const origins = snapshots.origins[view];
  const originByEdition = new Map(origins.entries.map((entry) => [entry.editionId, entry]));
  const emittedFolder = path.join(output, "reader", `${view}-${sha256(JSON.stringify([catalog, origins])).slice(0, 16)}`);
  const sourceFolder = path.join(root, view === "drafts" ? "draft-content" : "content");
  const expectedFiles = catalog.articles.flatMap((entry) => [`entry-${entry.editionId}.json`, `body-${entry.editionId}.md`, `review-${entry.editionId}.md`]);
  assert.deepEqual((await readdir(emittedFolder)).sort(), expectedFiles.sort(), `${view}: emitted resource set`);
  let markdownBytes = 0;
  for (const entry of catalog.articles) {
    const detail = JSON.parse(await readFile(path.join(emittedFolder, `entry-${entry.editionId}.json`), "utf8"));
    assert.deepEqual(detail, { ...entry, origin: originByEdition.get(entry.editionId) }, `${entry.editionId}: full frozen details and origin`);
    for (const [kind, originalFile, expectedHash] of [["body", entry.file, entry.artifactSha256], ["review", entry.reviewFile, entry.reviewArtifactSha256]]) {
      const [source, emitted] = await Promise.all([readFile(path.join(sourceFolder, originalFile)), readFile(path.join(emittedFolder, `${kind}-${entry.editionId}.md`))]);
      assert.equal(sha256(emitted), expectedHash, `${entry.editionId}: ${kind} SHA-256`);
      assert.ok(source.equals(emitted), `${entry.editionId}: ${kind} original bytes`);
      markdownBytes += emitted.byteLength;
    }
  }
  results.push({ view, editions: catalog.articles.length, resourceFiles: expectedFiles.length, markdownFiles: catalog.articles.length * 2, markdownBytes });
}
console.log(JSON.stringify({ output, immutableArtifactsExact: true, results }, null, 2));
