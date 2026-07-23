// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];

async function createRuntime(directory = undefined) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), "p3-06-realtime-")));
  if (!directory) temporaryPaths.push(root);
  const scriptPath = join(root, "worker.mjs");
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
    durableObjectsPersist: join(root, "sqlite"),
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
  const response = await post(runtime, "/v1/session", {});
  return response.headers.get("set-cookie");
}

function messages(socket) {
  const received = [];
  socket.addEventListener("message", (event) =>
    received.push(JSON.parse(event.data)),
  );
  socket.accept();
  return received;
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

async function openRealtime(runtime, roomId, cookie) {
  const response = await runtime.dispatchFetch(
    `https://local.test/v1/rooms/${roomId}/realtime`,
    { headers: { upgrade: "websocket", cookie } },
  );
  expect(response.status).toBe(101);
  return response.webSocket;
}

async function makeStartedRoom(runtime) {
  const host = await identity(runtime);
  const created = await post(
    runtime,
    "/v1/rooms",
    { displayName: "曹操" },
    host,
  );
  const { roomId } = await created.json();
  expect(
    (await post(runtime, `/v1/rooms/${roomId}/ready`, {}, host)).status,
  ).toBe(200);
  expect(
    (await post(runtime, `/v1/rooms/${roomId}/start`, {}, host)).status,
  ).toBe(200);
  return { host, roomId };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("P3-06: 协商、ACK、乱序/重复与缺口重放收敛为同一个人投影序列", async () => {
  const runtime = await createRuntime();
  try {
    const { host, roomId } = await makeStartedRoom(runtime);
    const socket = await openRealtime(runtime, roomId, host);
    const received = messages(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: { lastEventSequence: 0 },
      }),
    );
    await settle();
    expect(received.map((message) => message.type)).toEqual([
      "hello.accepted",
      "serverEvent",
    ]);
    expect(received[1].payload.eventSequence).toBe(1);
    expect(JSON.stringify(received)).not.toMatch(
      /seed|cardsById|encryptedSeed/i,
    );

    socket.send(
      JSON.stringify({
        type: "command",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: {
          clientCommandId: "sync-1",
          expectedEventSequence: 1,
          kind: "sync",
        },
      }),
    );
    await settle();
    socket.send(
      JSON.stringify({
        type: "command",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: {
          clientCommandId: "stale-delayed-command",
          expectedEventSequence: 0,
          kind: "sync",
        },
      }),
    );
    await settle();
    socket.send(
      JSON.stringify({
        type: "command",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: {
          clientCommandId: "sync-1",
          expectedEventSequence: 1,
          kind: "sync",
        },
      }),
    );
    await settle();
    socket.send(
      JSON.stringify({
        type: "resync",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: { afterEventSequence: 0 },
      }),
    );
    await settle();
    const acknowledgements = received.filter(
      (message) => message.type === "ack",
    );
    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements[0]).toEqual(acknowledgements[1]);
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command.conflict",
          payload: expect.objectContaining({
            clientCommandId: "stale-delayed-command",
            eventSequence: 2,
          }),
        }),
      ]),
    );
    const events = received.filter((message) => message.type === "serverEvent");
    expect(events.map((event) => event.payload.eventSequence)).toEqual([
      1, 2, 1, 2,
    ]);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-06: Room 绑定真人逻辑座位，Authority 忽略伪造 actor 并按 east 首出校验", async () => {
  const runtime = await createRuntime();
  try {
    const east = await identity(runtime);
    const south = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east" },
      east,
    );
    const { roomId, inviteCode } = await created.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/join`,
          { inviteCode, displayName: "刘备", seat: "south" },
          south,
        )
      ).status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, {}, east)).status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/ready`, {}, south)).status,
    ).toBe(200);
    expect(
      (await post(runtime, `/v1/rooms/${roomId}/start`, {}, east)).status,
    ).toBe(200);
    const eastView = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect(eastView.status).toBe(200);
    const view = await eastView.json();
    expect(view).toMatchObject({
      seat: "east",
      current: "east",
      positions: { bottom: "east", left: "south", right: "north", top: "west" },
    });
    const action = await post(
      runtime,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "east-first-play",
        expectedEventSequence: -1,
        kind: "play",
        actor: "south",
        cardIds: [view.hand[0].id],
      },
      east,
    );
    expect(action.status).toBe(200);
    expect((await action.json()).view.seat).toBe("east");
    const notTurn = await post(
      runtime,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "south-forged-turn",
        expectedEventSequence: 0,
        kind: "pass",
        actor: "east",
      },
      south,
    );
    expect(notTurn.status).toBe(409);
    expect(await notTurn.json()).toEqual({ error: "not_your_turn" });
    const reconnected = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: east } },
    );
    expect((await reconnected.json()).seat).toBe("east");
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-06: 四个逻辑座位的个人投影保持固定上下游与队友映射", async () => {
  const runtime = await createRuntime();
  try {
    const cookies = await Promise.all(
      ["south", "east", "north", "west"].map(() => identity(runtime)),
    );
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "south" },
      cookies[0],
    );
    const { roomId, inviteCode } = await created.json();
    for (const [index, seat] of ["east", "north", "west"].entries())
      expect(
        (
          await post(
            runtime,
            `/v1/rooms/${roomId}/join`,
            { inviteCode, displayName: ["刘备", "孙权", "周瑜"][index], seat },
            cookies[index + 1],
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
    const expected = {
      south: { bottom: "south", left: "west", right: "east", top: "north" },
      east: { bottom: "east", left: "south", right: "north", top: "west" },
      north: { bottom: "north", left: "east", right: "west", top: "south" },
      west: { bottom: "west", left: "north", right: "south", top: "east" },
    };
    for (const [index, seat] of ["south", "east", "north", "west"].entries()) {
      const response = await runtime.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        { headers: { cookie: cookies[index] } },
      );
      const projection = await response.json();
      expect(projection.seat).toBe(seat);
      expect(projection.positions).toEqual(expected[seat]);
      expect(projection.hand).toHaveLength(27);
      expect(JSON.stringify(projection)).not.toMatch(
        /seed|cardsById|encryptedSeed/i,
      );
    }
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-06: 不兼容协议和未授权实时连接被明确拒绝，重启后可从缺口恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p3-06-restart-"));
  temporaryPaths.push(directory);
  let runtime = await createRuntime(directory);
  try {
    const { host, roomId } = await makeStartedRoom(runtime);
    const bad = await openRealtime(runtime, roomId, host);
    const badMessages = messages(bad);
    bad.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "p3-ws-v0",
        roomId,
        payload: { lastEventSequence: 0 },
      }),
    );
    await settle();
    expect(badMessages).toEqual([
      expect.objectContaining({ type: "protocol.unsupported" }),
    ]);

    const socket = await openRealtime(runtime, roomId, host);
    const received = messages(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: { lastEventSequence: 0 },
      }),
    );
    await settle();
    await runtime.dispose();
    runtime = await createRuntime(directory);
    const recovered = await openRealtime(runtime, roomId, host);
    const replay = messages(recovered);
    recovered.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: { lastEventSequence: 0 },
      }),
    );
    await settle();
    expect(replay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "serverEvent",
          payload: expect.objectContaining({ eventSequence: 1 }),
        }),
      ]),
    );
    const stranger = await identity(runtime);
    expect(
      (
        await runtime.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/realtime`,
          { headers: { upgrade: "websocket", cookie: stranger } },
        )
      ).status,
    ).toBe(403);
  } finally {
    await runtime.dispose();
  }
}, 30_000);
