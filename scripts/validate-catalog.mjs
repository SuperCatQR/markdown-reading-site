import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot, snapshotContract, validateCatalogPair } from "./catalog.js";

export async function validateContentDirectory(contentRoot, kind = "publication", { includeSeries = false, includeOrigins = false } = {}) {
  const contract = snapshotContract(kind);
  const root = path.resolve(contentRoot);
  for (let current = root; ; current = path.dirname(current)) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`内容目录不允许链接: ${current}`);
    if (path.dirname(current) === current) break;
  }
  const files = new Map();
  const directories = new Set();
  async function scan(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const target = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`公开快照不允许链接: ${relative}`);
      if (entry.isDirectory()) {
        if (!contract.directory.test(relative)) {
          throw new Error(`公开快照不允许内部或未知目录: ${relative}`);
        }
        directories.add(relative);
        await scan(target, `${relative}/`);
      } else if (entry.isFile()) {
        files.set(relative, await readFile(target));
      } else {
        throw new Error(`公开快照只接受普通文件: ${relative}`);
      }
    }
  }
  await scan(root);
  const { errors, catalog, series, origins } = validateSnapshot(files, kind);
  const expectedDirectories = new Set();
  for (const relative of files.keys()) {
    const segments = relative.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  for (const directory of directories) {
    if (!expectedDirectories.has(directory)) errors.push(`公开快照包含残留空目录: ${directory}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return includeSeries || includeOrigins ? { catalog, series, origins } : catalog;
}

export async function validateSiteSnapshots(siteRoot, { includeOrigins = false } = {}) {
  const published = await validateContentDirectory(path.join(siteRoot, "content"), "publication", { includeOrigins });
  const unpublished = await validateContentDirectory(path.join(siteRoot, "draft-content"), "publication-draft", { includeOrigins });
  const publication = includeOrigins ? published.catalog : published;
  const drafts = includeOrigins ? unpublished.catalog : unpublished;
  const errors = validateCatalogPair(publication, drafts);
  if (errors.length) throw new Error(errors.join("\n"));
  return { publication, drafts, ...(includeOrigins ? { origins: { published: published.origins, drafts: unpublished.origins } } : {}) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const { publication, drafts } = await validateSiteSnapshots(root);
    console.log(`稿件快照有效，已发布 ${publication.articles.length} 篇，未发布 ${drafts.articles.length} 篇。`);
  } catch (error) {
    console.error(`发布稿快照校验失败:\n${error.message}`);
    process.exitCode = 1;
  }
}
