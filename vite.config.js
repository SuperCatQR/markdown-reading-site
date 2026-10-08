import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { validateSiteSnapshots } from "./scripts/validate-catalog.mjs";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [{
    name: "manuscript-snapshot-contract",
    async buildStart() {
      await validateSiteSnapshots(fileURLToPath(new URL(".", import.meta.url)));
    },
  }],
});
