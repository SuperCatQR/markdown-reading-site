import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "./catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "content", "catalog.json");
const articlesPath = path.join(root, "content", "articles");
const reviewsPath = path.join(root, "content", "reviews");

let catalog;
try {
  catalog = JSON.parse(await readFile(catalogPath, "utf8"));
} catch (error) {
  console.error(`无法读取 content/catalog.json: ${error.message}`);
  process.exit(1);
}

const files = (await readdir(articlesPath, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name);
const reviewFiles = (await readdir(reviewsPath, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name);
const errors = validateCatalog(catalog, files, reviewFiles);

if (errors.length) {
  console.error("阅读稿发布清单校验失败:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`阅读稿发布清单有效，共 ${catalog.length} 篇。`);
