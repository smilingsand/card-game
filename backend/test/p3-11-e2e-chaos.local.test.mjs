// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];
const names = ["曹操", "刘备", "孙权", "周瑜"];
const seats = ["south", "east", "north", "west"];

async function runtime(directory, testSeed) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), "p3-11-chaos-")));
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
      RATE_LIMIT_PER_MINUTE: "1000",
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ROOM_INVITE_HASH_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      P3_TEST_MODE: "true",
      ...(testSeed ? { P3_TEST_SEED: testSeed } : {}),
    },
  });
}
async function post(instance, path, body, cookie) {
  return instance.dispatchFetch(`https://local.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function identity(instance) {
  return (await post(instance, "/v1/session", {})).headers.get("set-cookie");
}
async function started(instance, humanCount, now, initialLeader) {
  const cookies = await Promise.all(
    Array.from({ length: humanCount }, () => identity(instance)),
  );
  const created = await post(
    instance,
    "/v1/rooms",
    { displayName: names[0], seat: seats[0], now },
    cookies[0],
  );
  const { roomId, inviteCode } = await created.json();
  for (let index = 1; index < humanCount; index += 1)
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/join`,
          { displayName: names[index], seat: seats[index], inviteCode, now },
          cookies[index],
        )
      ).status,
    ).toBe(200);
  for (const cookie of cookies)
    expect(
      (await post(instance, `/v1/rooms/${roomId}/ready`, { now }, cookie))
        .status,
    ).toBe(200);
  const start = await post(
    instance,
    `/v1/rooms/${roomId}/start`,
    { now, ...(initialLeader ? { initialLeader } : {}) },
    cookies[0],
  );
  if (!start.ok)
    throw new Error(
      JSON.stringify({ roomId, initialLeader, start: await start.json() }),
    );
  return { roomId, cookies };
}
async function replay(instance, roomId, cookie) {
  const response = await instance.dispatchFetch(
    `https://local.test/v1/authority/${roomId}/replay`,
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return response.json();
}
function assertSafe(value) {
  expect(JSON.stringify(value)).not.toMatch(
    /seed|encryptedSeed|token|cookie|evaluation|cardsById/i,
  );
}
function chooseDeterministicLegalAction(view) {
  const legal = [...view.legalActions].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  const play = legal.find((action) => action.type === "play");
  // The Authority projection only contains legal actions for the authenticated
  // current seat. A leading state always has a legal play; when following this
  // chooses a deterministic legal contest, otherwise the sole legal pass.
  const selected = play ?? legal.find((action) => action.type === "pass");
  if (!selected)
    throw new Error(
      JSON.stringify({
        error: "missing_legal_action",
        roomId: view.roomId,
        seat: view.seat,
        current: view.current,
        leader: view.leader,
        legalActionCount: legal.length,
        legalActionTypes: legal.map((action) => action.type),
      }),
    );
  return selected.type === "play"
    ? { kind: "play", cardIds: selected.cardIds }
    : { kind: "pass" };
}
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 40));
}
async function openRealtime(instance, roomId, cookie) {
  const response = await instance.dispatchFetch(
    `https://local.test/v1/rooms/${roomId}/realtime`,
    { headers: { upgrade: "websocket", cookie } },
  );
  expect(response.status).toBe(101);
  response.webSocket.accept();
  return response.webSocket;
}
function receivedMessages(socket) {
  const received = [];
  socket.addEventListener("message", (event) =>
    received.push(JSON.parse(event.data)),
  );
  return received;
}
async function startedAtSeat(instance, seat, now) {
  const cookie = await identity(instance);
  const created = await post(
    instance,
    "/v1/rooms",
    { displayName: names[seats.indexOf(seat)], seat, now },
    cookie,
  );
  expect(created.status).toBe(201);
  const { roomId } = await created.json();
  expect(
    (await post(instance, `/v1/rooms/${roomId}/ready`, { now }, cookie)).status,
  ).toBe(200);
  expect(
    (await post(instance, `/v1/rooms/${roomId}/start`, { now }, cookie)).status,
  ).toBe(200);
  return { roomId, cookie };
}
afterEach(async () =>
  Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

test("P3-11: 1–3 真人空座 bot 首调度各十局、四真人五局均经 Authority 推进且个人投影安全", async () => {
  const instance = await runtime();
  try {
    let now = Date.now();
    for (const humanCount of [1, 2, 3, 4])
      for (let game = 0; game < (humanCount < 4 ? 10 : 5); game += 1) {
        const { roomId, cookies } = await started(
          instance,
          humanCount,
          (now += 1000),
          humanCount < 4 ? seats[humanCount] : undefined,
        );
        const before = await replay(instance, roomId, cookies[0]);
        const views = await Promise.all(
          cookies.map((cookie) =>
            instance
              .dispatchFetch(
                `https://local.test/v1/rooms/${roomId}/game-view`,
                { headers: { cookie } },
              )
              .then(async (response) => ({
                status: response.status,
                body: await response.json(),
              })),
          ),
        );
        for (const [index, view] of views.entries()) {
          expect(view.status).toBe(200);
          expect(view.body.seat).toBe(seats[index]);
          expect(view.body.positions.bottom).toBe(seats[index]);
          assertSafe(view.body);
        }
        const after = await replay(instance, roomId, cookies[0]);
        expect(after.eventCount).toBeGreaterThanOrEqual(before.eventCount);
        // In 1–3 human variants east is vacant and must advance only through an
        // internal Authority bot command before a client can observe the room.
        if (humanCount < 4) expect(after.eventCount).toBeGreaterThan(0);
      }
  } finally {
    await instance.dispose();
  }
}, 120_000);

test("P3-11: 五次重启与协议/ACK 混沌保持连续个人重放，且拒绝旧协议", async () => {
  const root = await mkdtemp(join(tmpdir(), "p3-11-restart-"));
  temporaryPaths.push(root);
  let instance = await runtime(root);
  try {
    const { roomId, cookies } = await started(instance, 1, Date.now());
    for (let index = 0; index < 5; index += 1) {
      const before = await replay(instance, roomId, cookies[0]);
      await instance.dispose();
      instance = await runtime(root);
      const after = await replay(instance, roomId, cookies[0]);
      expect(after).toEqual(before);
    }
    for (let index = 0; index < 3; index += 1) {
      const socket = await openRealtime(instance, roomId, cookies[0]);
      const received = receivedMessages(socket);
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: "p3-ws-v1",
          roomId,
          payload: { lastEventSequence: 0 },
        }),
      );
      await settle();
      expect(received).toContainEqual(
        expect.objectContaining({ type: "hello.accepted" }),
      );
      assertSafe(received);
      socket.close(1000, "p3-11-compatible-protocol-complete");
    }
    for (let index = 0; index < 3; index += 1) {
      const response = await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/realtime`,
        { headers: { upgrade: "websocket", cookie: cookies[0] } },
      );
      expect(response.status).toBe(101);
      response.webSocket.accept();
      const received = [];
      response.webSocket.addEventListener("message", (event) =>
        received.push(JSON.parse(event.data)),
      );
      response.webSocket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: "p3-ws-v0",
          roomId,
          payload: { lastEventSequence: 0 },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(received).toEqual([
        expect.objectContaining({ type: "protocol.unsupported" }),
      ]);
      assertSafe(received);
    }
  } finally {
    await instance.dispose();
  }
}, 120_000);

test("P3-11: 四个逻辑座位各三次断线、超时、托管与恢复只在动作边界发生", async () => {
  const instance = await runtime();
  try {
    let now = Date.now();
    for (const seat of seats)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { roomId, cookie } = await startedAtSeat(
          instance,
          seat,
          (now += 1_000),
        );
        const before = await instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie } },
        );
        const initial = await before.json();
        expect(initial.seat).toBe(seat);
        const beforeReplay = await replay(instance, roomId, cookie);
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: true, now },
              cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: false, now: now + 1 },
              cookie,
            )
          ).status,
        ).toBe(200);
        // Normal close/abnormal heartbeat loss reaches the same ten-second action boundary.
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: false, now: now + 11_001 },
              cookie,
            )
          ).status,
        ).toBe(200);
        const takenOver = await instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie } },
        );
        expect(takenOver.status).toBe(200);
        const takeoverView = await takenOver.json();
        expect(takeoverView.seat).toBe(seat);
        expect(
          (await replay(instance, roomId, cookie)).eventCount,
        ).toBeGreaterThan(beforeReplay.eventCount);
        assertSafe(takeoverView);
        // A connected player that exceeds the 30-second turn deadline is also
        // controlled by normal-vNext, then regains the original controller/seat.
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: true, now: now + 11_002 },
              cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: true, now: now + 41_002 },
              cookie,
            )
          ).status,
        ).toBe(200);
        const recovered = await instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie } },
        );
        expect(recovered.status).toBe(200);
        const recoveredView = await recovered.json();
        expect(recoveredView.seat).toBe(seat);
        assertSafe(recoveredView);
      }
  } finally {
    await instance.dispose();
  }
}, 120_000);

test("P3-11: ACK 重复、乱序和缺口重放各五次保持连续且不泄露个人投影", async () => {
  const instance = await runtime();
  try {
    const { roomId, cookie } = await startedAtSeat(
      instance,
      "east",
      Date.now(),
    );
    const socket = await openRealtime(instance, roomId, cookie);
    const received = receivedMessages(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: { lastEventSequence: 0 },
      }),
    );
    await settle();
    let expected = 1;
    for (let index = 0; index < 5; index += 1) {
      const command = {
        type: "command",
        protocolVersion: "p3-ws-v1",
        roomId,
        payload: {
          clientCommandId: `p3-11-sync-${index}`,
          expectedEventSequence: expected,
          kind: "sync",
        },
      };
      socket.send(JSON.stringify(command));
      await settle();
      socket.send(JSON.stringify(command));
      await settle();
      socket.send(
        JSON.stringify({
          ...command,
          payload: {
            ...command.payload,
            clientCommandId: `p3-11-stale-${index}`,
            expectedEventSequence: expected - 1,
          },
        }),
      );
      await settle();
      socket.send(
        JSON.stringify({
          type: "resync",
          protocolVersion: "p3-ws-v1",
          roomId,
          payload: { afterEventSequence: Math.max(0, expected - 1) },
        }),
      );
      await settle();
      expected += 1;
    }
    const acknowledgements = received.filter(
      (message) => message.type === "ack",
    );
    expect(acknowledgements).toHaveLength(10);
    for (let index = 0; index < 5; index += 1)
      expect(acknowledgements[index * 2]).toEqual(
        acknowledgements[index * 2 + 1],
      );
    expect(
      received.filter((message) => message.type === "command.conflict"),
    ).toHaveLength(5);
    const sequences = [
      ...new Set(
        received
          .filter((message) => message.type === "serverEvent")
          .map((message) => message.payload.eventSequence),
      ),
    ];
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);
    assertSafe(received);
  } finally {
    await instance.dispose();
  }
}, 120_000);

test("P3-11: 五个固定 seed 的真实 Authority 动作可正常结算；过期房间三次稳定拒绝后续动作", async () => {
  const fixedSeeds = [
    "0123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
    "1123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
    "2123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
    "3123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
    "4123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ];
  for (const seed of fixedSeeds) {
    const instance = await runtime(undefined, seed);
    try {
      const base = Date.now();
      const { roomId, cookies } = await started(instance, 4, base);
      for (const cookie of cookies)
        expect(
          (
            await post(
              instance,
              `/v1/rooms/${roomId}/presence`,
              { connected: true, now: base },
              cookie,
            )
          ).status,
        ).toBe(200);
      let completed = false;
      for (let step = 0; step < 1_000; step += 1) {
        const now = base + step + 1;
        // The fixture advances a logical clock rather than waiting on wall
        // time. Keep all four real clients heartbeating on that same clock so
        // this settlement test exercises card play, not the separate P3-08
        // timeout/takeover path.
        if (step % 10 === 0)
          for (const cookie of cookies)
            expect(
              (
                await post(
                  instance,
                  `/v1/rooms/${roomId}/presence`,
                  { connected: true, now },
                  cookie,
                )
              ).status,
            ).toBe(200);
        const completeView = await instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie: cookies[0] } },
        );
        expect(completeView.status).toBe(200);
        const publicView = await completeView.json();
        if (publicView.finished.length === 4) {
          completed = true;
          break;
        }
        const actorIndex = seats.indexOf(publicView.current);
        const actorView = await instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          { headers: { cookie: cookies[actorIndex] } },
        );
        const view = await actorView.json();
        const currentReplay = await replay(
          instance,
          roomId,
          cookies[actorIndex],
        );
        const action = chooseDeterministicLegalAction(view);
        const submitted = await post(
          instance,
          `/v1/rooms/${roomId}/actions`,
          {
            commandId: `settlement-${step}`,
            expectedEventSequence: currentReplay.eventCount - 1,
            now,
            ...action,
          },
          cookies[actorIndex],
        );
        if (!submitted.ok)
          throw new Error(
            JSON.stringify({
              roomId,
              seed,
              eventSequence: currentReplay.eventCount,
              replay: currentReplay,
              error: await submitted.json(),
            }),
          );
      }
      expect(completed).toBe(true);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { roomId: expiredRoom, cookie } = await startedAtSeat(
          instance,
          "east",
          base + attempt * 1_000,
        );
        const expired = await post(
          instance,
          `/v1/rooms/${expiredRoom}/actions`,
          {
            commandId: `expired-${attempt}`,
            expectedEventSequence: 0,
            kind: "pass",
            now: base + 2_592_000_000 + attempt * 1_000,
          },
          cookie,
        );
        expect(expired.status).not.toBe(200);
        expect([410, 503]).toContain(expired.status);
      }
    } finally {
      await instance.dispose();
    }
  }
}, 240_000);

test("P3-11: single human action is acknowledged before subsequent bot turns", async () => {
  const instance = await runtime();
  try {
    const now = Date.now();
    const { roomId, cookies } = await started(instance, 1, now, "west");
    const beforeResponse = await instance.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: cookies[0] } },
    );
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json();
    expect(before.current).toBe("south");
    const action = chooseDeterministicLegalAction(before);
    const submittedAt = Date.now();
    const submitted = await post(
      instance,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "human-action-before-bot-run",
        expectedEventSequence: before.eventSequence,
        now: now + 1,
        ...action,
      },
      cookies[0],
    );
    expect(submitted.status).toBe(200);
    expect(Date.now() - submittedAt).toBeLessThan(1_000);
    const acknowledged = await submitted.json();
    expect(acknowledged.view.eventSequence).toBe(before.eventSequence + 1);
    expect(acknowledged.view.remainingCardCounts.south).toBe(
      before.remainingCardCounts.south - (action.cardIds?.length ?? 0),
    );
    expect(acknowledged.view.current).toBe("east");
    await settle();
    // Test mode has no wall-clock alarm: explicitly advance the same controlled
    // clock to run the pending internal bot command after the human ACK.
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: now + 2 },
          cookies[0],
        )
      ).status,
    ).toBe(200);
    const afterResponse = await instance.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie: cookies[0] } },
    );
    expect(afterResponse.status).toBe(200);
    const after = await afterResponse.json();
    expect(after.eventSequence).toBeGreaterThan(
      acknowledged.view.eventSequence,
    );
  } finally {
    await instance.dispose();
  }
}, 30_000);
