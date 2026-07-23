// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";
import { afterEach, expect, test } from "vitest";

const temporaryPaths = [];

async function createRuntime(rateLimitPerMinute = "30", persistentDirectory) {
  const directory =
    persistentDirectory ?? (await mkdtemp(join(tmpdir(), "p3-03-worker-")));
  if (!persistentDirectory) temporaryPaths.push(directory);
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
      AUTHORITY_GAME: {
        className: "AuthorityGameDurableObject",
        useSQLite: true,
      },
    },
    durableObjectsPersist: join(directory, "sqlite"),
    bindings: {
      ENVIRONMENT: "local",
      SESSION_TTL_SECONDS: "3600",
      RATE_LIMIT_PER_MINUTE: rateLimitPerMinute,
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      P3_TEST_MODE: "true",
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

async function internalAuthority(runtime, roomId, pathname, subjectId) {
  const namespace = await runtime.getDurableObjectNamespace("AUTHORITY_GAME");
  const stub = namespace.get(namespace.idFromName(roomId));
  return stub.fetch(`https://authority.internal${pathname}`, {
    method: "POST",
    body: JSON.stringify({ subjectId, now: Date.now() }),
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

test("P3-04: 本地权威 DO 仅返回个人投影", async () => {
  const runtime = await createRuntime();
  try {
    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.8" },
    });
    const cookie = issued.headers.get("set-cookie");
    const created = await runtime.dispatchFetch(
      "https://local.test/v1/authority/local-room",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(created.status).toBe(201);
    const projection = await runtime.dispatchFetch(
      "https://local.test/v1/authority/local-room/view",
      { headers: { cookie } },
    );
    expect(projection.status).toBe(200);
    const body = await projection.json();
    expect(body).toMatchObject({ seat: "south" });
    expect(JSON.stringify(body)).not.toMatch(/seed|cardsById|east.*hand/i);
  } finally {
    await runtime.dispose();
  }
}, 15_000);

test("P3-04: 权威动作 ACK 幂等、序号连续且未授权回放被拒绝", async () => {
  const runtime = await createRuntime();
  try {
    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.9" },
    });
    const cookie = issued.headers.get("set-cookie");
    await runtime.dispatchFetch("https://local.test/v1/authority/action-room", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    const initial = await runtime.dispatchFetch(
      "https://local.test/v1/authority/action-room/view",
      { headers: { cookie } },
    );
    const cardId = (await initial.json()).hand[0].id;
    const command = JSON.stringify({
      commandId: "command-1",
      kind: "play",
      cardIds: [cardId],
    });
    const first = await runtime.dispatchFetch(
      "https://local.test/v1/authority/action-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: command,
      },
    );
    expect(first.status).toBe(200);
    const acknowledged = await first.json();
    expect(acknowledged).toMatchObject({
      acknowledged: true,
      commandId: "command-1",
      eventSequence: 0,
    });
    expect(JSON.stringify(acknowledged)).not.toMatch(
      /seed|east.*hand|west.*hand|north.*hand/i,
    );
    const duplicate = await runtime.dispatchFetch(
      "https://local.test/v1/authority/action-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: command,
      },
    );
    expect(await duplicate.json()).toEqual(acknowledged);
    const replay = await runtime.dispatchFetch(
      "https://local.test/v1/authority/action-room/replay",
    );
    expect(replay.status).toBe(401);
    const authorizedReplay = await runtime.dispatchFetch(
      "https://local.test/v1/authority/action-room/replay",
      { headers: { cookie } },
    );
    expect(await authorizedReplay.json()).toEqual(
      expect.objectContaining({ eventCount: 1, rulesVersion: "guandan-v5" }),
    );
  } finally {
    await runtime.dispose();
  }
}, 15_000);

test("P3-04: 并发不同命令由同一 DO 串行化", async () => {
  const runtime = await createRuntime();
  try {
    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.10" },
    });
    const cookie = issued.headers.get("set-cookie");
    await runtime.dispatchFetch(
      "https://local.test/v1/authority/concurrent-room",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    const initial = await runtime.dispatchFetch(
      "https://local.test/v1/authority/concurrent-room/view",
      { headers: { cookie } },
    );
    const cardId = (await initial.json()).hand[0].id;
    const request = (commandId) =>
      runtime.dispatchFetch(
        "https://local.test/v1/authority/concurrent-room/command",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ commandId, kind: "play", cardIds: [cardId] }),
        },
      );
    const responses = await Promise.all([
      request("parallel-a"),
      request("parallel-b"),
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );
    const successes = bodies.filter((body) => body.acknowledged);
    expect(successes).toHaveLength(1);
    expect(successes[0].eventSequence).toBe(0);
    const replay = await runtime.dispatchFetch(
      "https://local.test/v1/authority/concurrent-room/replay",
      { headers: { cookie } },
    );
    expect(await replay.json()).toEqual(
      expect.objectContaining({ eventCount: 1, rulesVersion: "guandan-v5" }),
    );
  } finally {
    await runtime.dispose();
  }
}, 15_000);

test("P3-04: SQLite DO 冷启动后由事件流恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p3-04-cold-"));
  temporaryPaths.push(directory);
  const first = await createRuntime("30", directory);
  try {
    const issued = await post(first, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.11" },
    });
    const cookie = issued.headers.get("set-cookie");
    await first.dispatchFetch("https://local.test/v1/authority/cold-room", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    const before = await first.dispatchFetch(
      "https://local.test/v1/authority/cold-room/view",
      { headers: { cookie } },
    );
    const cardId = (await before.json()).hand[0].id;
    await first.dispatchFetch(
      "https://local.test/v1/authority/cold-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "cold-action",
          kind: "play",
          cardIds: [cardId],
        }),
      },
    );
    await first.dispose();
    const second = await createRuntime("30", directory);
    try {
      const replay = await second.dispatchFetch(
        "https://local.test/v1/authority/cold-room/replay",
        { headers: { cookie } },
      );
      expect(await replay.json()).toEqual(
        expect.objectContaining({ eventCount: 1, rulesVersion: "guandan-v5" }),
      );
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose().catch(() => {});
  }
}, 20_000);

test("P3-04: 新比赛生成新 gameId 与全宽 seed，重启后同局 seed 保持", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p3-04-seed-lifecycle-"));
  temporaryPaths.push(directory);
  const first = await createRuntime("30", directory);
  try {
    const issued = await post(first, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.12" },
    });
    const cookie = issued.headers.get("set-cookie");
    const { anonymousId } = await issued.json();
    const created = await first.dispatchFetch(
      "https://local.test/v1/authority/seed-room",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    const initial = await created.json();
    const initialAudit = await internalAuthority(
      first,
      "seed-room",
      "/internal-audit",
      anonymousId,
    );
    expect(initialAudit.status).toBe(200);
    const firstSeed = await initialAudit.json();
    expect(firstSeed).toMatchObject({
      gameId: initial.gameId,
      seedHexLength: 64,
    });
    expect(firstSeed.seedFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(initial)).not.toMatch(/seed|fingerprint/i);

    await first.dispose();
    const second = await createRuntime("30", directory);
    try {
      const restored = await internalAuthority(
        second,
        "seed-room",
        "/internal-audit",
        anonymousId,
      );
      expect(await restored.json()).toEqual(firstSeed);
      const restarted = await second.dispatchFetch(
        "https://local.test/v1/authority/seed-room/new-game",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: "{}",
        },
      );
      const next = await restarted.json();
      const nextAudit = await internalAuthority(
        second,
        "seed-room",
        "/internal-audit",
        anonymousId,
      );
      const secondSeed = await nextAudit.json();
      expect(next.gameId).not.toBe(initial.gameId);
      expect(secondSeed.seedFingerprint).not.toBe(firstSeed.seedFingerprint);
      expect(JSON.stringify(next)).not.toMatch(/seed|fingerprint/i);
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose().catch(() => {});
  }
}, 25_000);

test("P3-04: 新比赛清除旧命令、事件与快照", async () => {
  const runtime = await createRuntime();
  try {
    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.13" },
    });
    const cookie = issued.headers.get("set-cookie");
    await runtime.dispatchFetch("https://local.test/v1/authority/fresh-room", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    const before = await runtime.dispatchFetch(
      "https://local.test/v1/authority/fresh-room/view",
      { headers: { cookie } },
    );
    const cardId = (await before.json()).hand[0].id;
    const command = JSON.stringify({
      commandId: "old-command",
      kind: "play",
      cardIds: [cardId],
    });
    const original = await runtime.dispatchFetch(
      "https://local.test/v1/authority/fresh-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: command,
      },
    );
    expect(original.status).toBe(200);
    const originalBody = await original.json();
    expect(
      await (
        await runtime.dispatchFetch(
          "https://local.test/v1/authority/fresh-room/replay",
          { headers: { cookie } },
        )
      ).json(),
    ).toEqual(expect.objectContaining({ eventCount: 1 }));
    await runtime.dispatchFetch(
      "https://local.test/v1/authority/fresh-room/new-game",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(
      await (
        await runtime.dispatchFetch(
          "https://local.test/v1/authority/fresh-room/replay",
          { headers: { cookie } },
        )
      ).json(),
    ).toEqual(expect.objectContaining({ eventCount: 0 }));
    const stale = await runtime.dispatchFetch(
      "https://local.test/v1/authority/fresh-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: command,
      },
    );
    expect(await stale.json()).not.toEqual(originalBody);
  } finally {
    await runtime.dispose();
  }
}, 20_000);

test("P3-04: 权威下一局使用新 CSPRNG seed，冷恢复不泄露且可重放", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p3-04-next-round-"));
  temporaryPaths.push(directory);
  const first = await createRuntime("30", directory);
  try {
    const issued = await post(first, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.16" },
    });
    const cookie = issued.headers.get("set-cookie");
    const { anonymousId } = await issued.json();
    await first.dispatchFetch("https://local.test/v1/authority/next-room", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    const before = await internalAuthority(
      first,
      "next-room",
      "/internal-audit",
      anonymousId,
    );
    const firstAudit = await before.json();
    expect(
      (
        await internalAuthority(
          first,
          "next-room",
          "/internal-complete-round",
          anonymousId,
        )
      ).status,
    ).toBe(200);
    const next = await first.dispatchFetch(
      "https://local.test/v1/authority/next-room/next-round",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ commandId: "next-round-1" }),
      },
    );
    expect(next.status).toBe(200);
    const response = await next.json();
    expect(response).toMatchObject({
      acknowledged: true,
      commandId: "next-round-1",
    });
    expect(response.eventSequence).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(response)).not.toMatch(/seed|fingerprint|encrypted/i);
    const after = await internalAuthority(
      first,
      "next-room",
      "/internal-audit",
      anonymousId,
    );
    const secondAudit = await after.json();
    expect(secondAudit).toMatchObject({ roundNumber: 2, seedHexLength: 64 });
    expect(secondAudit.roundSeedFingerprint).not.toBe(
      firstAudit.roundSeedFingerprint,
    );
    expect(
      await (
        await first.dispatchFetch(
          "https://local.test/v1/authority/next-room/next-round",
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ commandId: "next-round-1" }),
          },
        )
      ).json(),
    ).toEqual(response);
    await first.dispose();
    const second = await createRuntime("30", directory);
    try {
      const restored = await internalAuthority(
        second,
        "next-room",
        "/internal-audit",
        anonymousId,
      );
      expect(await restored.json()).toEqual(secondAudit);
      const replay = await second.dispatchFetch(
        "https://local.test/v1/authority/next-room/replay",
        { headers: { cookie } },
      );
      expect(await replay.json()).toEqual(
        expect.objectContaining({ eventCount: response.eventSequence + 1 }),
      );
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose().catch(() => {});
  }
}, 25_000);

test("P3-04: 篡改快照后恢复安全拒绝且不泄露状态", async () => {
  const runtime = await createRuntime();
  try {
    const issued = await post(runtime, "/v1/session", {
      headers: { "cf-connecting-ip": "10.0.0.14" },
    });
    const cookie = issued.headers.get("set-cookie");
    const { anonymousId } = await issued.json();
    await runtime.dispatchFetch(
      "https://local.test/v1/authority/corrupt-room",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    const before = await runtime.dispatchFetch(
      "https://local.test/v1/authority/corrupt-room/view",
      { headers: { cookie } },
    );
    const cardId = (await before.json()).hand[0].id;
    await runtime.dispatchFetch(
      "https://local.test/v1/authority/corrupt-room/command",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "stored",
          kind: "play",
          cardIds: [cardId],
        }),
      },
    );
    expect(
      (
        await internalAuthority(
          runtime,
          "corrupt-room",
          "/internal-corrupt-snapshot",
          anonymousId,
        )
      ).status,
    ).toBe(200);
    const recovered = await runtime.dispatchFetch(
      "https://local.test/v1/authority/corrupt-room/view",
      { headers: { cookie } },
    );
    expect(recovered.status).toBe(503);
    const error = await recovered.json();
    expect(error).toEqual({ error: "authority_state_unavailable" });
    expect(JSON.stringify(error)).not.toMatch(
      /seed|snapshot|hand|stored_event/i,
    );
  } finally {
    await runtime.dispose();
  }
}, 20_000);
