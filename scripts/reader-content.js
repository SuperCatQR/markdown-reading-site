import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSiteSnapshots } from "./validate-catalog.mjs";
import { prepareDocument } from "../src/document.js";
import { entryKey } from "../src/manuscripts.js";
import { estimateReadingMinutes } from "../src/reading-time.js";
import { sha256 } from "./catalog.js";

// Derived presentation data lives outside the immutable input snapshots.
export async function buildReaderData(root, watch = () => {}) {
  const catalogs = await validateSiteSnapshots(root);
  const summaries = {};
  const search = { published: {}, drafts: {} };
  await Promise.all(Object.entries({ published: catalogs.publication, drafts: catalogs.drafts }).map(async ([view, catalog]) => {
    const folder = path.join(root, view === "drafts" ? "draft-content" : "content");
    watch(path.join(folder, "catalog.json"));
    watch(path.join(folder, view === "drafts" ? "publication-draft-export-manifest.json" : "publication-export-manifest.json"));
    const documents = await Promise.all(catalog.articles.map(async (entry) => {
      watch(path.join(folder, entry.file));
      watch(path.join(folder, entry.reviewFile));
      const bytes = await readFile(path.join(folder, entry.file));
      if (sha256(bytes) !== entry.artifactSha256) throw new Error(`生成搜索索引时正文 SHA-256 不匹配: ${entry.file}`);
      const source = bytes.toString("utf8");
      const { blocks } = prepareDocument(source);
      return { entry, blocks, minutes: estimateReadingMinutes(source) };
    }));
    for (const { entry, blocks, minutes } of documents) {
      search[view][entryKey(entry)] = blocks;
      summaries[entryKey(entry)] = { minutes };
    }
  }));
  return { summaries, search };
}

export function readerContentPlugin(root) {
  const prefix = "virtual:reader-";
  const modules = new Map([
    [`${prefix}summaries`, "summaries"],
    [`${prefix}search-urls`, "search-urls"],
  ]);
  let generated;
  let command;
  let base;
  let reloadTimer;
  return {
    name: "validated-reader-content",
    configResolved(config) { command = config.command; base = config.base; },
    async buildStart() {
      generated = await buildReaderData(root, (file) => this.addWatchFile(file));
    },
    resolveId(id) { if (modules.has(id)) return `\0${id}`; },
    load(id) {
      const name = modules.get(id.slice(1));
      if (!name) return;
      if (name === "summaries") return `export default ${JSON.stringify(generated.summaries)};`;
      const urls = Object.keys(generated.search).map((view) => {
        const value = command === "serve" ? JSON.stringify(`${base}__reader/search-${view}.json`)
          : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: `search-${view}.json`, source: JSON.stringify(generated.search[view]) })}`;
        return `${JSON.stringify(view)}: ${value}`;
      });
      return `export default {${urls.join(",")}};`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, "http://reader.local").pathname;
        const view = ["published", "drafts"].find((kind) => pathname === `${base}__reader/search-${kind}.json`);
        if (!view) return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(JSON.stringify(generated.search[view]));
      });
      const refresh = (file) => {
        if (!["content", "draft-content"].some((folder) => file.startsWith(path.join(root, folder) + path.sep))) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          try {
            generated = await buildReaderData(root);
            for (const id of modules.keys()) {
              const module = server.moduleGraph.getModuleById(`\0${id}`);
              if (module) server.moduleGraph.invalidateModule(module);
            }
            server.ws.send({ type: "full-reload" });
          } catch (error) {
            server.ws.send({ type: "error", err: { message: error.message, stack: error.stack } });
          }
        }, 100);
      };
      server.watcher.on("all", (_event, file) => refresh(file));
      server.httpServer?.once("close", () => clearTimeout(reloadTimer));
    },
  };
}
