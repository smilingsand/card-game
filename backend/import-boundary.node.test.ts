// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() && !["node_modules", "dist"].includes(entry.name)
      ? sourceFiles(path)
      : entry.isFile() &&
          /\.[cm]?[jt]sx?$/.test(entry.name) &&
          !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });
}

function contents(directory: string): string {
  return sourceFiles(directory)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

test("共享核心保持纯 TypeScript，后台不回导前端源码", () => {
  const core = contents(
    join(repositoryRoot, "packages", "guandan-core", "src"),
  );
  const backend = contents(join(repositoryRoot, "backend"));
  const coreTsconfig = readFileSync(
    join(repositoryRoot, "packages", "guandan-core", "tsconfig.json"),
    "utf8",
  );

  expect(
    sourceFiles(join(repositoryRoot, "frontend", "src", "games", "guandan")),
  ).toEqual([]);
  expect(core).not.toMatch(/from\s+["'][^"']*(react|vite|cloudflare|node:)/);
  expect(coreTsconfig).not.toContain('"DOM"');
  expect(backend).not.toMatch(/from\s+["'][^"']*frontend\/src/);
});
