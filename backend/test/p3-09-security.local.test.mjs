// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];

async function createRuntime(rateLimitPerMinute = "100") {
  const directory = await mkdtemp(join(tmpdir(), "p3-09-security-"));
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
      AUTHORITY_GAME: {
        className: "AuthorityGameDurableObject",
        useSQLite: true,
      },
      ROOM: { className: "RoomDurableObject", useSQLite: true },
      REALTIME_ROOM: {
        className: "RealtimeRoomDurableObject",
        useSQLite: true,
      },
    },
    durableObjectsPersist: join(directory, "sqlite"),
    bindings: {
      ENVIRONMENT: "local",
      SESSION_TTL_SECONDS: "3600",
      RATE_LIMIT_PER_MINUTE: rateLimitPerMinute,
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ROOM_INVITE_HASH_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      P3_TEST_MODE: "true",
    },
  });
}

async function post(runtime, pathname, body, cookie) {
  return runtime.dispatchFetch(`https://local.test${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function identity(runtime) {
  return (await post(runtime, "/v1/session", {})).headers.get("set-cookie");
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("P3-09: 四席仅获得自己的手牌；伪造 actor 与跨席访问均不能越权", async () => {
  const runtime = await createRuntime();
  try {
    const cookies = await Promise.all(
      ["south", "east", "north", "west"].map(() => identity(runtime)),
    );
    const names = ["曹操", "刘备", "孙权", "周瑜"];
    const seats = ["south", "east", "north", "west"];
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: names[0], seat: seats[0] },
      cookies[0],
    );
    const { roomId, inviteCode } = await created.json();
    for (let index = 1; index < seats.length; index += 1)
      expect(
        (
          await post(
            runtime,
            `/v1/rooms/${roomId}/join`,
            {
              displayName: names[index],
              seat: seats[index],
              inviteCode,
            },
            cookies[index],
          )
        ).status,
      ).toBe(200);
    for (const cookie of cookies)
      expect(
        (await post(runtime, `/v1/rooms/${roomId}/ready`, {}, cookie)).status,
      ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, {}, cookies[0])).status,
    ).toBe(200);

    const projections = [];
    for (const cookie of cookies) {
      const response = await runtime.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      projections.push(await response.json());
    }
    const allCardIds = projections.map((projection) =>
      projection.hand.map((card) => card.id),
    );
    for (const [index, projection] of projections.entries()) {
      const serialized = JSON.stringify(projection);
      expect(projection.seat).toBe(seats[index]);
      expect(projection.hand).toHaveLength(27);
      expect(serialized).not.toMatch(
        /seed|encryptedSeed|cardsById|hidden|evaluation|reason/i,
      );
      for (const [otherIndex, ids] of allCardIds.entries())
        if (otherIndex !== index)
          for (const id of ids) expect(serialized).not.toContain(id);
    }

    const forged = await post(
      runtime,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "forged-south-action",
        expectedEventSequence: 0,
        kind: "pass",
        actor: "east",
      },
      cookies[0],
    );
    expect(forged.status).toBe(409);
    expect(await forged.json()).toEqual({ error: "not_your_turn" });

    const stranger = await identity(runtime);
    expect(
      (
        await runtime.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie: stranger } },
        )
      ).status,
    ).toBe(403);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-09: 令牌轮换阻止固定与重放，且混合 subject/token 不能获得会话", async () => {
  const runtime = await createRuntime();
  try {
    const first = await identity(runtime);
    const second = await identity(runtime);
    const rotated = await post(runtime, "/v1/session/rotate", {}, first);
    expect(rotated.status).toBe(200);
    const current = rotated.headers.get("set-cookie");
    expect(
      (
        await runtime.dispatchFetch("https://local.test/v1/session", {
          headers: { cookie: first },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await runtime.dispatchFetch("https://local.test/v1/session", {
          headers: { cookie: current },
        })
      ).status,
    ).toBe(200);
    const [firstValue] = first.split(";");
    const [secondValue] = second.split(";");
    const forged = `${firstValue.split(".")[0]}.${secondValue.split(".")[1]}`;
    expect(
      (
        await runtime.dispatchFetch("https://local.test/v1/session", {
          headers: { cookie: forged },
        })
      ).status,
    ).toBe(401);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-09: 超限房间请求被拒绝；并发滥用受既有限流保护", async () => {
  const payloadRuntime = await createRuntime();
  try {
    const cookie = await identity(payloadRuntime);
    const response = await payloadRuntime.dispatchFetch(
      "https://local.test/v1/rooms",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          displayName: "曹操",
          padding: "x".repeat(4_097),
        }),
      },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  } finally {
    await payloadRuntime.dispose();
  }

  const rateRuntime = await createRuntime("3");
  try {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => post(rateRuntime, "/v1/session", {})),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(3);
    const limited = responses.filter((response) => response.status === 429);
    expect(limited).toHaveLength(9);
    expect(
      limited.every((response) => response.headers.get("retry-after") !== null),
    ).toBe(true);
  } finally {
    await rateRuntime.dispose();
  }
}, 30_000);
