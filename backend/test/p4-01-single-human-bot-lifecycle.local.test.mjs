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

async function runtime(seed, rateLimitPerMinute = "1000", testMode = true) {
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
      RATE_LIMIT_PER_MINUTE: rateLimitPerMinute,
      ROOM_SEED_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ROOM_INVITE_HASH_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ...(testMode ? { P3_TEST_MODE: "true" } : {}),
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

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

afterEach(async () =>
  Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

test("P4-01: 实际 alarm 在短思考到期后消费单个机器人任务", async () => {
  const instance = await runtime("alarm-persistence", "1000", false);
  try {
    // Production selects the opening leader randomly.  Create a few isolated
    // rooms until one has an opening bot turn, then prove its persisted task
    // advances without any intervening request to wake the room.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { roomId, cookie } = await startSouthHuman(instance, Date.now());
      const initialResponse = await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        { headers: { cookie } },
      );
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      if (initial.current === "south") continue;

      // The regular delay is at most 1.34 s.  A persisted alarm must execute
      // one bot action without a later HTTP request waking the room up.
      await wait(2_500);
      const advancedResponse = await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        { headers: { cookie } },
      );
      expect(advancedResponse.status).toBe(200);
      const advanced = await advancedResponse.json();
      expect(advanced.eventSequence).toBeGreaterThan(initial.eventSequence);
      return;
    }
    throw new Error("unable_to_create_opening_bot_turn");
  } finally {
    await instance.dispose();
  }
}, 20_000);

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
    const staleOwnerCommand = await post(
      instance,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "p4-01-stale-owner-command",
        expectedEventSequence: view.eventSequence,
        kind: "pass",
        now: now + 1,
      },
      cookie,
    );
    expect(staleOwnerCommand.status).toBe(409);

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

test("P4-01: 完成一局后保留房间并由 Room 自动进入带公开赛局摘要的新局", async () => {
  const instance = await runtime(fixtureSeeds[0][1]);
  try {
    const now = Date.now();
    const { roomId, cookie } = await startSouthHuman(instance, now);
    const before = await (
      await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        {
          headers: { cookie },
        },
      )
    ).json();
    const completed = await post(
      instance,
      `/v1/rooms/${roomId}/complete-round`,
      { now: now + 1 },
      cookie,
    );
    expect(completed.status).toBe(200);
    const room = await (await completed.clone().json()).room;
    expect(room.phase).toBe("started");
    const next = await (
      await instance.dispatchFetch(
        `https://local.test/v1/rooms/${roomId}/game-view`,
        {
          headers: { cookie },
        },
      )
    ).json();
    expect(next.gameId).toBe(before.gameId);
    expect(next.eventSequence).toBeGreaterThan(before.eventSequence);
    expect(next.match.roundNumber).toBe(2);
    expect(next.match.previousFinish).toEqual([
      "south",
      "north",
      "east",
      "west",
    ]);
    expect(next.match.levels).toEqual({ northSouth: "5", eastWest: "2" });
    expect(next.match.tributeHint).toBeTruthy();
    expect(next.tributeAction).toMatchObject({ kind: "return" });
    expect(next.tributeAction.cardIds.length).toBeGreaterThan(0);
    const returned = await post(
      instance,
      `/v1/rooms/${roomId}/actions`,
      {
        commandId: "p4-01-human-return",
        expectedEventSequence: next.eventSequence,
        kind: "return",
        cardIds: [next.tributeAction.cardIds[0]],
        now: now + 2,
      },
      cookie,
    );
    expect(returned.status).toBe(200);
    expect((await returned.json()).view.tributeAction).toBeUndefined();
    expect(JSON.stringify(next)).not.toMatch(/seed|cardsById|reasons/i);
    const log = await diagnostics(instance, roomId, cookie);
    expect(log.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "round.next",
          acknowledgementStatus: 200,
        }),
      ]),
    );
  } finally {
    await instance.dispose();
  }
}, 60_000);

test("P4-01: 高频个人投影刷新按身份限流，不会耗尽通用 30/min 配额", async () => {
  const instance = await runtime(fixtureSeeds[0][1], "30");
  try {
    const now = Date.now();
    const { roomId, cookie } = await startSouthHuman(instance, now);
    const responses = await Promise.all(
      Array.from({ length: 80 }, () =>
        instance.dispatchFetch(
          `https://local.test/v1/rooms/${roomId}/game-view`,
          {
            headers: { cookie },
          },
        ),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  } finally {
    await instance.dispose();
  }
}, 60_000);
