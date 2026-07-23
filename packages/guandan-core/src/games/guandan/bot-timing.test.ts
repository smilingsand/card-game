// Shared Guandan core test.
import { describe, expect, it } from "vitest";
import { botThinkDelayMs } from "./bot-timing";

describe("botThinkDelayMs", () => {
  it("为机器人动作提供稳定且接近正常思考的短暂等待", () => {
    expect([0, 1, 2, 3, 4].map(botThinkDelayMs)).toEqual([
      800, 980, 1160, 1340, 800,
    ]);
  });
});
