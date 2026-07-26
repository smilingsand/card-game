// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../poc/node_modules/miniflare/dist/src/index.js";

const temporaryPaths = [];

async function createRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "p3-10-operations-"));
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
afterEach(async () =>
  Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

test("P3-10: 受控备份校验后可恢复损坏快照，重放与幂等 ACK 均不丢失", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const cookie = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east", now: base },
      cookie,
    );
    const { roomId } = await created.json();
    await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, cookie);
    await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, cookie);
    const view = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie } },
    );
    const cardId = (await view.json()).hand[0].id;
    const replayBefore = await runtime.dispatchFetch(
      `https://local.test/v1/authority/${roomId}/replay`,
      { headers: { cookie } },
    );
    const { eventCount } = await replayBefore.json();
    const action = {
      commandId: "p3-10-persisted-action",
      expectedEventSequence: eventCount - 1,
      kind: "play",
      cardIds: [cardId],
      now: base + 1,
    };
    const acknowledged = await post(
      runtime,
      `/v1/rooms/${roomId}/actions`,
      action,
      cookie,
    );
    expect(acknowledged.status).toBe(200);
    const backupResponse = await post(
      runtime,
      `/v1/authority/${roomId}/backup`,
      { now: base + 2 },
      cookie,
    );
    expect(backupResponse.status).toBe(200);
    const backup = await backupResponse.json();
    expect(JSON.stringify(backup)).not.toMatch(/token|cookie|displayName/i);
    const backupDirectory = fileURLToPath(
      new URL("../temp/backups/", import.meta.url),
    );
    const backupPath = join(backupDirectory, `${roomId}.json`);
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(backupPath, JSON.stringify(backup), "utf8");
    const localBackup = JSON.parse(await readFile(backupPath, "utf8"));
    expect(backup.eventSequence).toBe(eventCount);
    expect(
      (
        await post(
          runtime,
          `/v1/authority/${roomId}/corrupt`,
          { now: base + 3 },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await runtime.dispatchFetch(
          `https://local.test/v1/authority/${roomId}/replay`,
          { headers: { cookie } },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await post(
          runtime,
          `/v1/authority/${roomId}/restore`,
          { backup: localBackup, now: base + 4 },
          cookie,
        )
      ).status,
    ).toBe(200);
    const replay = await runtime.dispatchFetch(
      `https://local.test/v1/authority/${roomId}/replay`,
      { headers: { cookie } },
    );
    expect(await replay.json()).toMatchObject({ eventCount: eventCount + 1 });
    const duplicate = await post(
      runtime,
      `/v1/rooms/${roomId}/actions`,
      action,
      cookie,
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      acknowledged: true,
      commandId: action.commandId,
      eventSequence: eventCount,
    });
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-10: 破坏的备份被拒绝且留下结构化失败审计，不会静默恢复", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const cookie = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", now: base },
      cookie,
    );
    const { roomId } = await created.json();
    await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, cookie);
    await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, cookie);
    const backup = await (
      await post(
        runtime,
        `/v1/authority/${roomId}/backup`,
        { now: base + 1 },
        cookie,
      )
    ).json();
    backup.eventSequence = 99;
    const restored = await post(
      runtime,
      `/v1/authority/${roomId}/restore`,
      { backup, now: base + 2 },
      cookie,
    );
    expect(restored.status).toBe(422);
    expect(await restored.json()).toEqual({
      error: "backup_checksum_mismatch",
    });
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-10: 事件序号缺口触发恢复，完整备份使重放回到连续序列", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const cookie = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", seat: "east", now: base },
      cookie,
    );
    const { roomId } = await created.json();
    await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, cookie);
    await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, cookie);
    const view = await runtime.dispatchFetch(
      `https://local.test/v1/rooms/${roomId}/game-view`,
      { headers: { cookie } },
    );
    const cardId = (await view.json()).hand[0].id;
    const replay = await runtime.dispatchFetch(
      `https://local.test/v1/authority/${roomId}/replay`,
      { headers: { cookie } },
    );
    const { eventCount } = await replay.json();
    expect(
      (
        await post(
          runtime,
          `/v1/rooms/${roomId}/actions`,
          {
            commandId: "p3-10-gap-action",
            expectedEventSequence: eventCount - 1,
            kind: "play",
            cardIds: [cardId],
            now: base + 1,
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    const backup = await (
      await post(
        runtime,
        `/v1/authority/${roomId}/backup`,
        { now: base + 2 },
        cookie,
      )
    ).json();
    expect(
      (
        await post(
          runtime,
          `/v1/authority/${roomId}/corrupt-event-gap`,
          { now: base + 2 },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await runtime.dispatchFetch(
          `https://local.test/v1/authority/${roomId}/replay`,
          { headers: { cookie } },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await post(
          runtime,
          `/v1/authority/${roomId}/restore`,
          { backup, now: base + 3 },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await runtime.dispatchFetch(
          `https://local.test/v1/authority/${roomId}/replay`,
          { headers: { cookie } },
        )
      ).status,
    ).toBe(200);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("P3-10: 人工指定房间恢复使用校验后的备份且不会暴露恢复材料", async () => {
  const runtime = await createRuntime();
  try {
    const base = Date.now();
    const cookie = await identity(runtime);
    const created = await post(
      runtime,
      "/v1/rooms",
      { displayName: "曹操", now: base },
      cookie,
    );
    const { roomId } = await created.json();
    await post(runtime, `/v1/rooms/${roomId}/ready`, { now: base }, cookie);
    await post(runtime, `/v1/rooms/${roomId}/start`, { now: base }, cookie);
    const backup = await (
      await post(
        runtime,
        `/v1/authority/${roomId}/backup`,
        { now: base + 1 },
        cookie,
      )
    ).json();
    const restored = await post(
      runtime,
      `/v1/authority/${roomId}/restore`,
      { backup, now: base + 2 },
      cookie,
    );
    expect(restored.status).toBe(200);
    expect(JSON.stringify(await restored.json())).not.toMatch(
      /seed|token|cookie|card/i,
    );
  } finally {
    await runtime.dispose();
  }
}, 30_000);
