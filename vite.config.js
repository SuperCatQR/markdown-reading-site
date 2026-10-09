import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readerContentPlugin } from "./scripts/reader-content.js";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    // Markdown documents remain separate files, including short ones.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith("/content/catalog.json") || id.endsWith("/draft-content/catalog.json")
              || id === "\0virtual:reader-summaries") return "reader-catalog";
        },
      },
    },
  },
  plugins: [readerContentPlugin(fileURLToPath(new URL(".", import.meta.url)))],
});
