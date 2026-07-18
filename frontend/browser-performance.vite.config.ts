import { defineConfig } from "vite";
import { resolve } from "node:path";

/** ADR-0023 measurement-only production bundle; it is not an application entry. */
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "../temp/p25-adr-0023-browser-build"),
    rollupOptions: {
      input: resolve(import.meta.dirname, "browser-performance.html")
    }
  }
});
