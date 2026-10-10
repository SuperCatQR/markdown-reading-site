import { workKey } from "../src/source-identity.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSiteSnapshots } from "./validate-catalog.mjs";
import { prepareDocument } from "../src/document.js";
import { entryKey } from "../src/manuscripts.js";
import { estimateReadingMinutes } from "../src/reading-time.js";
import { sha256 } from "./catalog.js";
import { buildCandidateData } from "./search-candidate-data.js";

// Derived presentation data lives outside the immutable input snapshots.
export async function buildReaderData(root, watch = () => {}) {
  const catalogs = await validateSiteSnapshots(root, { includeOrigins: true });
  const summaries = {};
  const search = { published: {}, drafts: {} };
  const videos = { published: {}, drafts: {} };
  const candidates = {};
  await Promise.all(Object.entries({ published: catalogs.publication, drafts: catalogs.drafts }).map(async ([view, catalog]) => {
    const folder = path.join(root, view === "drafts" ? "draft-content" : "content");
    watch(path.join(folder, "catalog.json"));
    watch(path.join(folder, view === "drafts" ? "publication-draft-export-manifest.json" : "publication-export-manifest.json"));
    watch(path.join(folder, "origins.json"));
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
      (videos[view][workKey(entry)] ||= {})[entryKey(entry)] = blocks;
      summaries[entryKey(entry)] = { minutes };
    }
    candidates[view] = buildCandidateData(catalog.articles, search[view]);
  }));
  return { summaries, search, videos, candidates, origins: catalogs.origins };
}

export function readerContentPlugin(root) {
  const prefix = "virtual:reader-";
  const modules = new Map([
    [`${prefix}summaries`, "summaries"],
    [`${prefix}search-urls`, "search-urls"],
    [`${prefix}origins`, "origins"],
  ]);
  let generated;
  let command;
  let base;
  let reloadTimer;
  const videoAssets = new Map();
  function indexVideoAssets() {
    videoAssets.clear();
    for (const [view, indices] of Object.entries(generated.videos)) for (const [key, index] of Object.entries(indices)) {
      const name = `search-video-${view}-${sha256(key)}`;
      if (videoAssets.has(name)) throw new Error("Search video asset collision");
      videoAssets.set(name, index);
    }
  }
  return {
    name: "validated-reader-content",
    configResolved(config) { command = config.command; base = config.base; },
    async buildStart() {
      generated = await buildReaderData(root, (file) => this.addWatchFile(file));
      indexVideoAssets();
    },
    resolveId(id) { if (modules.has(id)) return `\0${id}`; },
    load(id) {
      const name = modules.get(id.slice(1));
      if (!name) return;
      if (name === "summaries") return `export default ${JSON.stringify(generated.summaries)};`;
      if (name === "origins") return `export default ${JSON.stringify(generated.origins)};`;
      const assetUrl = (name, index) => command === "serve" ? JSON.stringify(`${base}__reader/${name}.json`)
        : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: `${name}.json`, source: JSON.stringify(index) })}`;
      const urls = Object.keys(generated.search).map((view) => `${JSON.stringify(view)}: ${assetUrl(`search-${view}`, generated.search[view])}`);
      const videos = Object.entries(generated.videos).map(([view, indices]) => {
        const records = Object.entries(indices).map(([videoKey, index]) => `${JSON.stringify(videoKey)}: ${assetUrl(`search-video-${view}-${sha256(videoKey)}`, index)}`);
        return `${JSON.stringify(view)}: {${records.join(",")}}`;
      });
      const candidates = Object.entries(generated.candidates).map(([view, data]) => `${JSON.stringify(view)}: {
        manifest: ${assetUrl(`search-candidates-${view}`, data.manifest)},
        partitions: [${data.partitions.map((index, partition) => assetUrl(`search-pairs-${view}-${partition}`, index)).join(",")}]
      }`);
      return `export default {${urls.join(",")}, videos: {${videos.join(",")}}, candidates: {${candidates.join(",")}}};`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, "http://reader.local").pathname;
        const view = ["published", "drafts"].find((kind) => pathname === `${base}__reader/search-${kind}.json`);
        const local = pathname.startsWith(`${base}__reader/`) ? pathname.slice(`${base}__reader/`.length).match(/^(search-video-(?:published|drafts)-[0-9a-f]{64})\.json$/) : null;
        const manifest = pathname.startsWith(`${base}__reader/`) ? pathname.slice(`${base}__reader/`.length).match(/^search-candidates-(published|drafts)\.json$/) : null;
        const pairs = pathname.startsWith(`${base}__reader/`) ? pathname.slice(`${base}__reader/`.length).match(/^search-pairs-(published|drafts)-(\d+)\.json$/) : null;
        const index = view ? generated.search[view] : local ? videoAssets.get(local[1])
          : manifest ? generated.candidates[manifest[1]].manifest : pairs ? generated.candidates[pairs[1]].partitions[Number(pairs[2])] : null;
        if (!index) return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(JSON.stringify(index));
      });
      const refresh = (file) => {
        if (!["content", "draft-content"].some((folder) => file.startsWith(path.join(root, folder) + path.sep))) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          try {
            generated = await buildReaderData(root);
            indexVideoAssets();
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
