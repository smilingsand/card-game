// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";
import { afterEach, expect, test } from "vitest";

const temporaryPaths = [];

async function createRuntime(rateLimitPerMinute = "30") {
  const directory = await mkdtemp(join(tmpdir(), "p3-03-worker-"));
  temporaryPaths.push(directory);
  const scriptPath = join(directory, "worker.mjs");
  await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    format: "esm",
    outfile: scriptPath,
    platform: "browser",
    target: "es2022",
  });
  return new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-23",
    durableObjects: {
      AUTH_SESSION: { className: "AuthSessionDurableObject", useSQLite: true },
      RATE_LIMITER: { className: "RateLimiterDurableObject", useSQLite: true },
    },
    bindings: {
      ENVIRONMENT: "local",
      SESSION_TTL_SECONDS: "3600",
      RATE_LIMIT_PER_MINUTE: rateLimitPerMinute,
    },
  });
}

async function post(runtime, pathname, init = {}) {
  return runtime.dispatchFetch(`https://local.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body ?? "{}",
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("P3-03: 本地 Worker 健康检查、匿名会话和轮换令牌", async () => {
  const runtime = await createRuntime();
  try {
    const health = await runtime.dispatchFetch("https://local.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "127.0.0.1" },
    });
    expect(issued.status).toBe(201);
    const { anonymousId } = await issued.json();
    const originalCookie = issued.headers.get("set-cookie");
    expect(anonymousId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(originalCookie).toContain("HttpOnly");

    const rotated = await post(runtime, "/v1/session/rotate", {
      headers: { cookie: originalCookie },
    });
    expect(rotated.status).toBe(200);
    const replacementCookie = rotated.headers.get("set-cookie");
    expect(replacementCookie).not.toBe(originalCookie);

    const replay = await runtime.dispatchFetch(
      "https://local.test/v1/session",
      { headers: { cookie: originalCookie } },
    );
    expect(replay.status).toBe(401);
    const current = await runtime.dispatchFetch(
      "https://local.test/v1/session",
      { headers: { cookie: replacementCookie } },
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ anonymousId });
  } finally {
    await runtime.dispose();
  }
}, 15_000);

test("P3-03: 本地 Worker 拒绝模糊输入并在 DO 中限流", async () => {
  const runtime = await createRuntime("2");
  try {
    const malformed = await post(runtime, "/v1/session", {
      body: '{"unexpected":true}',
      headers: { "cf-connecting-ip": "10.0.0.1" },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_payload" });

    const first = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.2" },
    });
    const second = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.2" },
    });
    const limited = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.2" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  } finally {
    await runtime.dispose();
  }
}, 15_000);
