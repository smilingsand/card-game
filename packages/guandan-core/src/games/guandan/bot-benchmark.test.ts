// Shared Guandan core test.
import { expect, test } from "vitest";
import { benchmarkBots } from "./bot-benchmark";

test("固定 seed 区间输出可复现的完成率、普通队胜率与单步耗时", () => {
  const result = benchmarkBots({ startSeed: 0, gameCount: 100 });
  expect(result).toMatchObject({ gameCount: 100, completedGames: 100 });
  expect(result.normalTeamWinRate).toBeGreaterThan(0.5);
  expect(result.averageDecisionMs).toBeGreaterThanOrEqual(0);
});
