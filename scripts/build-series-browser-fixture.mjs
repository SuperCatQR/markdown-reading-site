import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { readerContentPlugin } from "./reader-content.js";
import { readerSeriesPlugin } from "./reader-series.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw Error("Provide an upstream synthetic export pair directory");
const root = path.join(repository, ".tmp", "series-browser-site");
await mkdir(root, { recursive: true });
for (const file of ["src", "index.html"]) await cp(path.join(repository, file), path.join(root, file), { recursive: true });
for (const folder of ["content", "draft-content"]) await cp(path.join(process.argv[2], folder), path.join(root, folder), { recursive: true });
await build({ root, configFile: false, base: "/markdown-reading-site/", build: { outDir: path.join(repository, ".tmp", "series-browser-dist"), emptyOutDir: true, assetsInlineLimit: 0 }, plugins: [readerContentPlugin(root), readerSeriesPlugin(root)] });
