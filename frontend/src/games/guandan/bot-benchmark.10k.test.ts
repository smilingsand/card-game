import { expect, test } from "vitest";
import { benchmarkBots } from "./bot-benchmark";

for (let batch = 0; batch < 4; batch += 1) {
  test(`2,500 局固定 seed 普通队对初级队分批基准 ${batch + 1}`, () => {
    const result = benchmarkBots({ startSeed: batch * 2_500, gameCount: 2_500 });
    console.log(JSON.stringify({ batch: batch + 1, ...result }));
    expect(result.completedGames).toBe(2_500);
    expect(result.normalTeamWinRate).toBeGreaterThan(0.5);
    expect(result.averageDecisionMs).toBeLessThan(10);
  }, 300_000);
}
