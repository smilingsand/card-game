import assert from "node:assert/strict";
import test from "node:test";

import { runFourClientDurableObjectPoc } from "./four-client-durable-object.poc.mjs";

test("P3-01: 四个模拟客户端可连接、断连、冷启动恢复并重连", async () => {
  const result = await runFourClientDurableObjectPoc();

  assert.equal(result.connectedClientCount, 4);
  assert.equal(result.afterDisconnectClientCount, 2);
  assert.equal(result.afterColdStartClientCount, 2);
  assert.equal(result.afterReconnectClientCount, 4);
  assert.equal(result.eventCount, 8);
  assert.equal(result.coldStartStateRecovered, true);
  assert.ok(result.connectLatencyMs >= 0);
  assert.ok(result.reconnectLatencyMs >= 0);
});
