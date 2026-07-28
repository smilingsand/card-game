// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];

async function createRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "p3-08-takeover-"));
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
      RATE_LIMIT_PER_MINUTE: "100",
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

async function openRealtime(runtime, roomId, cookie) {
  const response = await runtime.dispatchFetch(
    `https://local.test/v1/rooms/${roomId}/realtime`,
    { headers: { upgrade: "websocket", cookie } },
  );
  expect(response.status).toBe(101);
  response.webSocket.accept();
  return response.webSocket;
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("P3-08: 本回合断线满十秒只在动作边界由 normal-vNext 托管，重连仍取得原个人投影", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const east = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east", now: base },
      east,
    );
    const { roomId } = await created.json();
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, east))
        .status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, east))
        .status,
    ).toBe(200);
    const before = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect((await before.json()).hand).toHaveLength(27);
    const replayBefore = await runtime.dispatchFetch(
      `https://local.test/v1/authority/${roomId}/replay`,
      { headers: { cookie: east } },
    );
    expect(replayBefore.status).toBe(200);
    const { eventCount: eventCountBefore } = await replayBefore.json();

    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: false, now: base + 1_000 },
          east,
        )
      ).status,
    ).toBe(200);
    const concurrentTakeover = await Promise.all([
      post(
        runtime,
        `/v1/rooms/${roomId}/presence`,
        { connected: false, now: base + 11_001 },
        east,
      ),
      post(
        runtime,
        `/v1/rooms/${roomId}/presence`,
        { connected: false, now: base + 11_001 },
        east,
      ),
    ]);
    expect(concurrentTakeover.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: false, now: base + 13_000 },
          east,
        )
      ).status,
    ).toBe(200);

    const recovered = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect(recovered.status).toBe(200);
    const projection = await recovered.json();
    expect(projection.seat).toBe("east");
    expect(projection.hand.length).toBeLessThan(27);
    const replayAfter = await runtime.dispatchFetch(
      `https://local.test/v1/authority/${roomId}/replay`,
      { headers: { cookie: east } },
    );
    expect(replayAfter.status).toBe(200);
    expect((await replayAfter.json()).eventCount).toBe(eventCountBefore + 1);
    expect(JSON.stringify(projection)).not.toMatch(
      /seed|encryptedSeed|cardsById|reasons/i,
    );
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-08: WebSocket 正常关闭立即断线，十秒宽限后由 Authority 内部机器人命令接管", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const east = await identity(runtime);
    const south = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east", now: base },
      east,
    );
    const { roomId, inviteCode } = await created.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { displayName: "刘备", seat: "south", inviteCode, now: base },
          south,
        )
      ).status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, east))
        .status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, south))
        .status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, east))
        .status,
    ).toBe(200);

    const socket = await openRealtime(runtime, roomId, east);
    socket.close(1000, "normal");
    await settle();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: base + 20_000 },
          south,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: base + 22_000 },
          south,
        )
      ).status,
    ).toBe(200);

    const recovered = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).hand.length).toBeLessThan(27);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-08: 十秒心跳延后异常失联；三十秒无心跳会在同一回合超时时由机器人接管", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const east = await identity(runtime);
    const south = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east", now: base },
      east,
    );
    const { roomId, inviteCode } = await created.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { displayName: "刘备", seat: "south", inviteCode, now: base },
          south,
        )
      ).status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, east))
        .status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, south))
        .status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, east))
        .status,
    ).toBe(200);
    const initial = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    const action = (await initial.json()).hand[0];
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: base + 9_999 },
          east,
        )
      ).status,
    ).toBe(200);

    // The last heartbeat prevents an earlier abnormal-disconnect decision, but
    // the independent 30-second authoritative turn deadline still takes over.
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: base + 39_999 },
          south,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: base + 42_000 },
          south,
        )
      ).status,
    ).toBe(200);
    const timedOut = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect(timedOut.status).toBe(200);
    expect((await timedOut.json()).hand.length).toBeLessThan(27);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-08: 大厅房主断线六十秒转让给最早在线真人；无人时五分钟关闭", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const host = await identity(runtime);
    const guest = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", now: base },
      host,
    );
    const { roomId, inviteCode } = await created.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { displayName: "刘备", inviteCode, now: base },
          guest,
        )
      ).status,
    ).toBe(200);
    await post(
      runtime,
      `/v1/rooms/${roomId}/presence`,
      { connected: true, now: base },
      guest,
    );
    await post(
      runtime,
      `/v1/rooms/${roomId}/presence`,
      { connected: true, now: base },
      host,
    );
    await post(
      runtime,
      `/v1/rooms/${roomId}/presence`,
      { connected: false, now: base },
      host,
    );
    await post(
      runtime,
      `/v1/rooms/${roomId}/presence`,
      { connected: true, now: base + 50_000 },
      guest,
    );
    const transferred = await post(
      runtime,
      `/v1/rooms/${roomId}/presence`,
      { connected: true, now: base + 60_000 },
      guest,
    );
    expect(
      (await transferred.json()).room.seats.find(
        (seat) => seat.displayName === "刘备",
      ).isHost,
    ).toBe(true);

    const solo = await identity(runtime);
    const soloCreated = await post(
      runtime,
      "/v1/rooms",
      { displayName: "孙权", now: base },
      solo,
    );
    const { roomId: soloRoomId } = await soloCreated.json();
    await post(
      runtime,
      `/v1/rooms/${soloRoomId}/presence`,
      { connected: true, now: base },
      solo,
    );
    await post(
      runtime,
      `/v1/rooms/${soloRoomId}/presence`,
      { connected: false, now: base },
      solo,
    );
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${soloRoomId}/presence`,
          { connected: false, now: base + 300_000 },
          solo,
        )
      ).status,
    ).toBe(410);
  } finally {
    await runtime.dispose();
  }
}, 30_000);
