import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { Miniflare } from "miniflare";

const WORKER_SCRIPT = `
export class RoomDurableObject {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    const state = (await this.ctx.storage.get("state")) ?? {
      connectedClientIds: [],
      eventCount: 0,
    };

    if (url.pathname === "/connect") {
      if (!clientId) return new Response("clientId required", { status: 400 });
      if (!state.connectedClientIds.includes(clientId)) {
        state.connectedClientIds.push(clientId);
        state.eventCount += 1;
      }
      await this.ctx.storage.put("state", state);
      return Response.json(state);
    }

    if (url.pathname === "/disconnect") {
      state.connectedClientIds = state.connectedClientIds.filter((id) => id !== clientId);
      state.eventCount += 1;
      await this.ctx.storage.put("state", state);
      return Response.json(state);
    }

    if (url.pathname === "/state") return Response.json(state);
    return new Response("not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const room = env.ROOM.getByName("p3-01-four-client-room");
    return room.fetch(request);
  },
};
`;

function createMiniflare(persistPath) {
  return new Miniflare({
    compatibilityDate: "2026-07-23",
    modules: true,
    script: WORKER_SCRIPT,
    durableObjects: { ROOM: "RoomDurableObject" },
    durableObjectsPersist: persistPath,
  });
}

async function request(miniflare, pathname, clientId) {
  const url = new URL(`https://poc.invalid${pathname}`);
  if (clientId) url.searchParams.set("clientId", clientId);
  const response = await miniflare.dispatchFetch(url);
  if (!response.ok) throw new Error(`POC request failed: ${response.status}`);
  return response.json();
}

export async function runFourClientDurableObjectPoc() {
  const persistPath = await mkdtemp(join(tmpdir(), "p3-01-do-poc-"));
  let firstRuntime;
  let restartedRuntime;

  try {
    firstRuntime = createMiniflare(persistPath);
    const clientIds = ["client-a", "client-b", "client-c", "client-d"];

    const connectStart = performance.now();
    await Promise.all(
      clientIds.map((clientId) => request(firstRuntime, "/connect", clientId)),
    );
    const connectLatencyMs = performance.now() - connectStart;
    const connected = await request(firstRuntime, "/state");

    await request(firstRuntime, "/disconnect", "client-b");
    const afterDisconnect = await request(
      firstRuntime,
      "/disconnect",
      "client-d",
    );
    await firstRuntime.dispose();
    firstRuntime = undefined;

    restartedRuntime = createMiniflare(persistPath);
    const recovered = await request(restartedRuntime, "/state");

    const reconnectStart = performance.now();
    await Promise.all([
      request(restartedRuntime, "/connect", "client-b"),
      request(restartedRuntime, "/connect", "client-d"),
    ]);
    const reconnectLatencyMs = performance.now() - reconnectStart;
    const afterReconnect = await request(restartedRuntime, "/state");

    return {
      connectedClientCount: connected.connectedClientIds.length,
      afterDisconnectClientCount: afterDisconnect.connectedClientIds.length,
      afterColdStartClientCount: recovered.connectedClientIds.length,
      afterReconnectClientCount: afterReconnect.connectedClientIds.length,
      eventCount: afterReconnect.eventCount,
      coldStartStateRecovered:
        recovered.connectedClientIds.includes("client-a") &&
        recovered.connectedClientIds.includes("client-c"),
      connectLatencyMs,
      reconnectLatencyMs,
    };
  } finally {
    await firstRuntime?.dispose();
    await restartedRuntime?.dispose();
    await rm(persistPath, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await runFourClientDurableObjectPoc(), null, 2));
}
