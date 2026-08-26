// Shared Guandan core test.
import { expect, test } from "vitest";
import { benchmarkNormalVNextDecisions } from "./bot-benchmark";

test("P7-05：normal-vNext 固定 seed 首次决策保持合法且性能有界", () => {
  const result = benchmarkNormalVNextDecisions([0, 1, 7, 42, 99]);
  expect(result).toMatchObject({
    seeds: [0, 1, 7, 42, 99],
    completedDecisions: 5,
  });
  expect(result.totalLegalActions).toBeGreaterThan(0);
  // P7-00 seed 0 baseline recorded a 3.57 s slowest decision on this host.
  // Keep a small regression allowance without pretending the baseline is <2 s.
  expect(result.maxDecisionMs).toBeLessThan(5_000);
}, 20_000);
