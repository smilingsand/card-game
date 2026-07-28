// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];
const fixtureSeeds = [
  [
    "fixture-a",
    "0123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ],
  [
    "fixture-b",
    "1123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ],
  [
    "fixture-c",
    "2123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ],
  [
    "fixture-d",
    "3123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ],
  [
    "fixture-e",
    "4123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
  ],
];

async function runtime(seed) {
  const directory = await mkdtemp(join(tmpdir(), "p4-01-lifecycle-"));
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
      RATE_LIMIT_PER_MINUTE: "1000",
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ROOM_INVITE_HASH_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      P3_TEST_MODE: "true",
      P3_TEST_SEED: seed,
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

async function startSouthHuman(instance, now, initialLeader = "south") {
  const cookie = await identity(instance);
  const created = await post(
    instance,
    "/v1/rooms",
    { displayName: "曹操", seat: "south", now },
    cookie,
  );
  expect(created.status).toBe(201);
  const { roomId } = await created.json();
  expect(
    (await post(instance, `/v1/rooms/${roomId}/ready`, { now }, cookie)).status,
  ).toBe(200);
  expect(
    (
      await post(
        instance,
        `/v1/rooms/${roomId}/start`,
        { now, initialLeader },
        cookie,
      )
    ).status,
  ).toBe(200);
  return { roomId, cookie };
}

function selectNines(view) {
  const nines = new Set(
    view.hand.filter((card) => card.rank === "9").map((card) => card.id),
  );
  return view.legalActions.find(
    (action) =>
      action.type === "play" &&
      action.cardIds.length === 2 &&
      action.cardIds.every((id) => nines.has(id)),
  );
}

async function diagnostics(instance, roomId, cookie) {
  const response = await post(
    instance,
    `/v1/rooms/${roomId}/diagnostics`,
    {},
    cookie,
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function actionTrace(instance, roomId, cookie) {
  const response = await instance.dispatchFetch(
    `https://local.test/v1/authority/${roomId}/action-trace`,
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function advanceOneScheduledBot(instance, roomId, cookie) {
  const before = await diagnostics(instance, roomId, cookie);
  const scheduled = [...before.entries]
    .reverse()
    .find((entry) => entry.event === "bot.dispatch.scheduled");
  expect(scheduled).toBeDefined();
  expect(
    (
      await post(
        instance,
        `/v1/rooms/${roomId}/presence`,
        { connected: true, now: scheduled.scheduledAt },
        cookie,
      )
    ).status,
  ).toBe(200);
  return scheduled;
}

afterEach(async () =>
  Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

test("P4-01: 固定一人三机器人牌局记录真人 99 命令、权威动作及逐个 bot 调度", async () => {
  let selected;
  for (const [fixtureId, seed] of fixtureSeeds) {
    const instance = await runtime(seed);
    try {
      const now = Date.now();
      const { roomId, cookie } = await startSouthHuman(instance, now);
      const viewResponse = await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        { headers: { cookie } },
      );
      expect(viewResponse.status).toBe(200);
      const view = await viewResponse.json();
      const nines = selectNines(view);
      if (!nines) continue;
      selected = {
        instance,
        fixtureId,
        roomId,
        cookie,
        now,
        view,
        action: nines,
      };
      break;
    } finally {
      if (!selected || selected.instance !== instance) await instance.dispose();
    }
  }
  expect(selected, "固定 seed 组中必须存在南家可出的 99").toBeDefined();
  const { instance, fixtureId, roomId, cookie, now, view, action } = selected;
  try {
    expect(view.current).toBe("south");
    const commandId = "p4-01-human-99";
    const submitted = await post(
      instance,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId,
        expectedEventSequence: view.eventSequence,
        kind: "play",
        cardIds: action.cardIds,
        now: now + 1,
      },
      cookie,
    );
    expect(submitted.status).toBe(200);
    const acknowledged = await submitted.json();
    expect(acknowledged.view.eventSequence).toBe(view.eventSequence + 1);

    // P3 test mode has no timer; advancing the controlled clock deliberately
    // exposes the current reconciliation behaviour without browser timing.
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: now + 2 },
          cookie,
        )
      ).status,
    ).toBe(200);
    await advanceOneScheduledBot(instance, roomId, cookie);
    await advanceOneScheduledBot(instance, roomId, cookie);
    await advanceOneScheduledBot(instance, roomId, cookie);
    const trace = await actionTrace(instance, roomId, cookie);
    const diagnosticsLog = await diagnostics(instance, roomId, cookie);
    const humanEvent = trace.actions.find(
      (event) => event.eventSequence === acknowledged.eventSequence,
    );
    const botEvents = diagnosticsLog.entries.filter(
      (entry) => entry.event === "bot.dispatch.executed",
    );

    expect(trace.gameId).toBe(acknowledged.view.gameId);
    expect(humanEvent.appliedCardIds).toEqual(action.cardIds);
    expect(botEvents.length).toBeGreaterThanOrEqual(3);
    expect(botEvents.slice(-3).map((entry) => entry.executedAt)).toEqual(
      expect.arrayContaining(
        botEvents.slice(-3).map((entry) => entry.scheduledAt),
      ),
    );
    expect(
      new Set(botEvents.slice(-3).map((entry) => entry.executedAt)).size,
    ).toBe(3);
    expect(botEvents.slice(-3).map((entry) => entry.currentActorSeat)).toEqual([
      "east",
      "north",
      "west",
    ]);
    expect(diagnosticsLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "human.command.received",
          commandId,
          submittedCardIds: action.cardIds,
        }),
        expect.objectContaining({
          event: "human.command.acknowledged",
          commandId,
          authorityEventSequence: acknowledged.eventSequence,
        }),
      ]),
    );
    expect(JSON.stringify({ diagnosticsLog, trace })).not.toMatch(
      /seed|cookie|invite|hand|cardsById/i,
    );

    // Prove the exact P3-08 branch that changes a connected human seat to a
    // temporary bot controller, then returns it at the following boundary.
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/presence`,
          { connected: false, now: now + 3 },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/presence`,
          { connected: false, now: now + 10_004 },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/presence`,
          { connected: true, now: now + 10_005 },
          cookie,
        )
      ).status,
    ).toBe(200);
    // Temporary takeover completes exactly one bot action before the recovered
    // human controller is restored at the following action boundary.
    await advanceOneScheduledBot(instance, roomId, cookie);
    const takeoverLog = await diagnostics(instance, roomId, cookie);
    expect(takeoverLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "takeover.changed",
          logicalSeat: "south",
          controllerMode: "bot",
          takeoverEnabled: true,
        }),
        expect.objectContaining({
          event: "takeover.changed",
          logicalSeat: "south",
          controllerMode: "human",
          takeoverEnabled: false,
        }),
      ]),
    );

    // Both host restart routes complete in the Authority and leave an
    // observable acknowledgement; the current browser symptom is therefore
    // not an absent Room onClick/route in this deterministic path.
    const beforeRestart = await (
      await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        {
          headers: { cookie },
        },
      )
    ).json();
    const restartMatch = await post(
      instance,
      `/v1/rooms/${roomId}/restart-match`,
      {
        clientCommandId: "p4-01-restart-match",
        expectedEventSequence: beforeRestart.eventSequence,
        now: now + 10_006,
      },
      cookie,
    );
    expect(restartMatch.status).toBe(200);
    const afterMatch = await (
      await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        {
          headers: { cookie },
        },
      )
    ).json();
    const restartRound = await post(
      instance,
      `/v1/rooms/${roomId}/restart-round`,
      {
        clientCommandId: "p4-01-restart-round",
        expectedEventSequence: afterMatch.eventSequence,
        now: now + 10_007,
      },
      cookie,
    );
    expect(restartRound.status).toBe(200);
    const restartLog = await diagnostics(instance, roomId, cookie);
    expect(restartLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "restart.acknowledged",
          commandId: "p4-01-restart-match",
        }),
        expect.objectContaining({
          event: "restart.acknowledged",
          commandId: "p4-01-restart-round",
        }),
      ]),
    );
    // The label, rather than the seed value, is the reproducible diagnostic identifier.
    expect(fixtureId).toMatch(/^fixture-[a-e]$/);
  } finally {
    await instance.dispose();
  }
}, 60_000);

test("P4-01: 人类动作后的下家 bot 使用独立短思考延迟而非三十秒截止", async () => {
  const instance = await runtime(fixtureSeeds[2][1]);
  try {
    const now = Date.now();
    const { roomId, cookie } = await startSouthHuman(instance, now);
    const viewResponse = await instance.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie } },
    );
    expect(viewResponse.status).toBe(200);
    const view = await viewResponse.json();
    expect(view.current).toBe("south");
    const action = view.legalActions.find(
      (candidate) => candidate.type === "play",
    );
    expect(action).toBeDefined();
    expect(
      (
        await post(
          instance,
          `/v1/rooms/${roomId}/actions`,
          {
            commandId: "p4-01-same-millisecond-human",
            expectedEventSequence: view.eventSequence,
            kind: "play",
            cardIds: action.cardIds,
            now,
          },
          cookie,
        )
      ).status,
    ).toBe(200);
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
    const log = await diagnostics(instance, roomId, cookie);
    const scheduled = log.entries.find(
      (entry) =>
        entry.event === "bot.dispatch.scheduled" &&
        entry.currentActorSeat === "east",
    );
    expect(scheduled).toEqual(
      expect.objectContaining({
        at: now,
      }),
    );
    expect(scheduled.scheduledAt).toBeGreaterThan(now);
    expect(scheduled.scheduledAt).toBeLessThan(now + 2_000);
  } finally {
    await instance.dispose();
  }
}, 60_000);
