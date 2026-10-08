import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot } from "./catalog.js";

export async function validateContentDirectory(contentRoot) {
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
        if (relative !== "articles" && !/^articles\/part-[1-9][0-9]*$/.test(relative)) {
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
  const { errors, catalog } = validateSnapshot(files);
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
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content");
  try {
    const catalog = await validateContentDirectory(root);
    console.log(`发布稿快照有效，共 ${catalog.articles.length} 篇。`);
  } catch (error) {
    console.error(`发布稿快照校验失败:\n${error.message}`);
    process.exitCode = 1;
  }
}
