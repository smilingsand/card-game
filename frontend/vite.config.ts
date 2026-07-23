import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
// Vite loads this configuration before its alias resolver is active.
import { GUANDAN_CORE_RULES_VERSION } from "@card-game/guandan-core/metadata";
import { createServiceWorkerSource } from "./src/pwa/service-worker-template";

function staticAssetBuildVersion(staticAssets: readonly string[]): string {
  let hash = 5381;
  for (const character of staticAssets.join("|")) hash = (hash * 33) ^ character.charCodeAt(0);
  return `assets-${(hash >>> 0).toString(16)}`;
}

function pwaShellPlugin(): Plugin {
  return {
    name: "pwa-versioned-static-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const staticAssets = [
        "/index.html",
        "/manifest.webmanifest",
        "/icons/card-game.svg",
        ...Object.keys(bundle)
          .filter((fileName) => fileName !== "service-worker.js")
          .map((fileName) => `/${fileName}`)
      ].sort();
      this.emitFile({
        type: "asset",
        fileName: "service-worker.js",
        source: createServiceWorkerSource({
          buildVersion: staticAssetBuildVersion(staticAssets),
          rulesVersion: GUANDAN_CORE_RULES_VERSION,
          staticAssets
        })
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), pwaShellPlugin()],
  test: {
    cache: false,
    server: {
      deps: {
        inline: ["@card-game/guandan-core"]
      }
    },
    environment: "jsdom",
    globals: true,
    setupFiles: new URL("./src/test/setup.ts", import.meta.url).pathname
  }
});
