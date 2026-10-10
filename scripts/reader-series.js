import path from "node:path";
import { validateContentDirectory } from "./validate-catalog.mjs";

export function readerSeriesPlugin(root) {
  let snapshots;
  const moduleId = "virtual:reader-series";
  return {
    name: "validated-reader-series",
    async buildStart() {
      snapshots = {};
      for (const [view, folder, kind] of [["published", "content", "publication"], ["drafts", "draft-content", "publication-draft"]]) {
        const directory = path.join(root, folder);
        for (const file of ["series.json", "catalog.json", `${kind === "publication" ? "publication" : "publication-draft"}-export-manifest.json`]) this.addWatchFile(path.join(directory, file));
        const { series } = await validateContentDirectory(directory, kind, { includeSeries: true });
        snapshots[view] = series?.series || [];
      }
    },
    resolveId(id) { if (id === moduleId) return `\0${id}`; },
    load(id) { if (id === `\0${moduleId}`) return `export const seriesSnapshots = ${JSON.stringify(snapshots)};`; },
    handleHotUpdate({ file, server }) {
      if (/[/\\](?:content|draft-content)[/\\](?:series|catalog|publication(?:-draft)?-export-manifest)\.json$/.test(file)) server.restart();
    },
  };
}
