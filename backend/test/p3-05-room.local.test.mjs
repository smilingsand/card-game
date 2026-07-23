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
  const directory = await mkdtemp(join(tmpdir(), "p3-05-room-"));
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
    },
    durableObjectsPersist: join(directory, "sqlite"),
    bindings: {
      ENVIRONMENT: "local",
      SESSION_TTL_SECONDS: "3600",
      RATE_LIMIT_PER_MINUTE: "100",
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ROOM_INVITE_HASH_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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

async function identity(runtime, ip) {
  const response = await post(runtime, "/v1/session", {});
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie");
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("P3-05: 受控房间以 1–4 真人和 normal-vNext 空座开始，且不泄露权威状态", async () => {
  const runtime = await createRuntime();
  try {
    const host = await identity(runtime, "10.0.1.1");
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "south" },
      host,
    );
    expect(created.status).toBe(201);
    const { roomId, inviteCode, room: initialRoom } = await created.json();
    expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(initialRoom.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          seat: "south",
          controller: "human",
          displayName: "曹操",
          ready: false,
        }),
        expect.objectContaining({
          controller: "bot",
          strategy: "normal-vNext",
        }),
      ]),
    );

    const guests = await Promise.all(
      ["刘备", "孙权", "周瑜"].map((_, index) =>
        identity(runtime, `10.0.1.${index + 2}`),
      ),
    );
    for (const [index, cookie] of guests.entries()) {
      const joined = await post(
        runtime,
        `/v1/rooms/${roomId}/join`,
        {
          inviteCode,
          displayName: ["刘备", "孙权", "周瑜"][index],
        },
        cookie,
      );
      expect(joined.status).toBe(200);
      expect(
        (await joined.json()).room.seats.filter(
          (seat) => seat.controller === "human",
        ),
      ).toHaveLength(index + 2);
    }

    const fifth = await identity(runtime, "10.0.1.9");
    const full = await post(
      runtime,
      `/v1/rooms/${roomId}/join`,
      { inviteCode, displayName: "关羽" },
      fifth,
    );
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "room_full" });

    for (const cookie of [host, ...guests]) {
      const ready = await post(
        runtime,
        `/v1/rooms/${roomId}/ready`,
        {},
        cookie,
      );
      expect(ready.status).toBe(200);
    }
    const started = await post(runtime, `/v1/rooms/${roomId}/start`, {}, host);
    expect(started.status).toBe(200);
    const body = await started.json();
    expect(body.room.phase).toBe("started");
    expect(
      body.room.seats.filter((seat) => seat.controller === "human"),
    ).toHaveLength(4);
    expect(JSON.stringify(body)).not.toMatch(/seed|hand|cardsById|inviteCode/i);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-05: 重复加入、越权准备/开始和未获批准换座均被拒绝", async () => {
  const runtime = await createRuntime();
  try {
    const host = await identity(runtime, "10.0.2.1");
    const guest = await identity(runtime, "10.0.2.2");
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "诸葛亮" },
      host,
    );
    const { roomId, inviteCode } = await created.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { inviteCode, displayName: "赵云" },
          guest,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { inviteCode, displayName: "赵云" },
          guest,
        )
      ).status,
    ).toBe(409);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, {}, guest)).status,
    ).toBe(403);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, {}, host)).status,
    ).toBe(422);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/seat-requests`,
          { seat: "north" },
          guest,
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/seat-requests/approve`,
          { requestSubjectId: "unknown" },
          guest,
        )
      ).status,
    ).toBe(403);
    const approved = await post(
      runtime,
      `/v1/rooms/${roomId}/seat-requests/approve`,
      {
        requestSubjectId: (
          await (
            await runtime.dispatchFetch("https://local.test/v1/session", {
              headers: { cookie: guest },
            })
          ).json()
        ).anonymousId,
      },
      host,
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()).room.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seat: "north", displayName: "赵云" }),
      ]),
    );
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-05: 开始矩阵覆盖 1、2、3、4 名真人", async () => {
  const runtime = await createRuntime();
  try {
    const names = ["曹操", "刘备", "孙权", "周瑜"];
    for (const playerCount of [1, 2, 3, 4]) {
      const cookies = await Promise.all(
        names
          .slice(0, playerCount)
          .map((_, index) =>
            identity(runtime, `10.0.${playerCount}.${index + 1}`),
          ),
      );
      const created = await post(
        runtime,
        "/v1/rooms",
        { displayName: names[0] },
        cookies[0],
      );
      expect(created.status).toBe(201);
      const { roomId, inviteCode } = await created.json();
      for (let index = 1; index < playerCount; index += 1) {
        expect(
          (
            await post(
              runtime,
              `/v1/rooms/${roomId}/join`,
              { inviteCode, displayName: names[index] },
              cookies[index],
            )
          ).status,
        ).toBe(200);
      }
      for (const cookie of cookies)
        expect(
          (await post(runtime, `/v1/rooms/${roomId}/ready`, {}, cookie)).status,
        ).toBe(200);
      const started = await post(
        runtime,
        `/v1/rooms/${roomId}/start`,
        {},
        cookies[0],
      );
      expect(started.status).toBe(200);
      const { room } = await started.json();
      expect(
        room.seats.filter((seat) => seat.controller === "human"),
      ).toHaveLength(playerCount);
      expect(
        room.seats.filter(
          (seat) =>
            seat.controller === "bot" && seat.strategy === "normal-vNext",
        ),
      ).toHaveLength(4 - playerCount);
    }
  } finally {
    await runtime.dispose();
  }
}, 30_000);
