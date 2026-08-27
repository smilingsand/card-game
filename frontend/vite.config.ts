import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
// Vite loads this configuration before its alias resolver is active.
import { GUANDAN_CORE_RULES_VERSION } from "@card-game/guandan-core/metadata";
import { createServiceWorkerSource } from "./src/pwa/service-worker-template";

type IniSettings = ReadonlyMap<string, string>;

function parseIniSettings(contents: string): IniSettings {
  const settings = new Map<string, string>();
  let section = "";
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.replace(/[;#].*$/u, "").trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const settingMatch = /^([^=]+)=(.*)$/u.exec(line);
    if (!settingMatch) throw new Error(`Invalid settings.ini line: ${rawLine}`);
    settings.set(`${section}.${settingMatch[1].trim()}`, settingMatch[2].trim().toLowerCase());
  }
  return settings;
}

function requiredBooleanSetting(settings: IniSettings, key: string): boolean {
  const value = settings.get(key);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`settings.ini requires ${key} = true or false`);
}

const appSettings = parseIniSettings(
  readFileSync(new URL("../settings.ini", import.meta.url), "utf8")
);
const multiplayerGameEnabled = requiredBooleanSetting(appSettings, "features.multiplayers-game");

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
  define: {
    __CARD_GAME_MULTIPLAYER_GAME_ENABLED__: JSON.stringify(multiplayerGameEnabled)
  },
  plugins: [react(), pwaShellPlugin()],
  server: {
    // Local-only bridge: Vite proxies the browser's same-origin /v1 and WebSocket
    // requests to a locally running Wrangler worker. No Cloudflare account is used.
    proxy: {
      "/v1": {
        target: process.env.P3_LOCAL_WORKER_ORIGIN ?? "http://127.0.0.1:8788",
        changeOrigin: true,
        ws: true
      }
    }
  },
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
