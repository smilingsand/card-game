import { expect, test } from "vitest";
import { runSimulation, runSimulationBatch } from "./simulation";

test("固定 seed 的自动对局只提交合法动作并可完成结算", () => {
  const result = runSimulation(0);

  expect(result).toMatchObject({
    seed: 0,
    ok: true,
    actionCount: expect.any(Number),
    finish: expect.arrayContaining(["east", "south", "west", "north"]),
    settlement: { rulesVersion: "guandan-v1" }
  });
  expect(result.actionCount).toBeGreaterThan(0);
});

test("固定 seed 可按座位混合初级与普通机器人", () => {
  const result = runSimulation(7, {
    east: "normal",
    west: "normal",
    south: "basic",
    north: "basic"
  });

  expect(result).toMatchObject({ ok: true, seed: 7 });
});

test("批量自动对局记录首个失败 seed，并在全部成功时保持为空", () => {
  const result = runSimulationBatch({ startSeed: 0, gameCount: 1_000 });

  expect(result).toEqual({ gameCount: 1_000, firstFailureSeed: undefined });
}, 120_000);
