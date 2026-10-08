import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { validateContentDirectory } from "./scripts/validate-catalog.mjs";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [{
    name: "publication-snapshot-contract",
    async buildStart() {
      await validateContentDirectory(fileURLToPath(new URL("./content", import.meta.url)));
    },
  }],
});
