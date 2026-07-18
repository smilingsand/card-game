import { expect, test } from "vitest";
import { benchmarkBots } from "./bot-benchmark";

test("固定 seed 区间输出可复现的完成率、普通队胜率与单步耗时", () => {
  const result = benchmarkBots({ startSeed: 0, gameCount: 100 });
  expect(result).toMatchObject({ gameCount: 100, completedGames: 100 });
  expect(result.normalTeamWinRate).toBeGreaterThan(0.5);
  expect(result.averageDecisionMs).toBeGreaterThanOrEqual(0);
});

/**
 * P2.5-16 Stage 1 manual gate.  It is opt-in because a real expert 100-game
 * run is intentionally a long-running benchmark rather than a unit test.
 */
test.runIf(process.env.P25_STAGE1_EXPERT === "1")(
  "Stage 1 真实 expert 性能门禁",
  () => {
    const gameCount = Number(process.env.P25_STAGE1_GAMES ?? "1");
    const result = benchmarkBots({ startSeed: 0, gameCount });
    const slowestSummary = (
      items: readonly (typeof result.expertPerformanceDiagnostics.cold.slowest)[number][]
    ) =>
      items.map((item) => ({
        seed: item.seed,
        actionIndex: item.actionIndex,
        profile: item.profile,
        botViewReplayFingerprint: item.botViewReplayFingerprint,
        decisionMs: item.decisionMs,
        candidateCounts: [
          item.rawLegalInterpretationCount,
          item.canonicalPhysicalActionCount,
          item.semanticCandidateCount
        ],
        deepCounts: [item.postActionExecutionCount, item.followUpExecutionCount],
        selectedAction: {
          type: item.selectedAction.type,
          actor: item.selectedAction.actor,
          cardIds: item.selectedAction.type === "play" ? item.selectedAction.cardIds : [],
          pattern:
            item.selectedAction.type === "play" ? item.selectedAction.interpretation.type : "pass"
        },
        postActionMs: item.moduleElapsedMilliseconds.postAction ?? 0,
        followUpMs: item.moduleElapsedMilliseconds.followUp ?? 0
      }));
    console.info(
      JSON.stringify({
        profiles: result.profiles,
        expertPerformanceDiagnostics: {
          cold: {
            distributions: result.expertPerformanceDiagnostics.cold.distributions,
            moduleElapsedMilliseconds:
              result.expertPerformanceDiagnostics.cold.moduleElapsedMilliseconds,
            peakMemory: result.expertPerformanceDiagnostics.cold.peakMemory,
            finalDecisionCache: result.expertPerformanceDiagnostics.cold.finalDecisionCache,
            finalHandStructureCache:
              result.expertPerformanceDiagnostics.cold.finalHandStructureCache,
            finalHandPlanCache: result.expertPerformanceDiagnostics.cold.finalHandPlanCache,
            slowest: slowestSummary(result.expertPerformanceDiagnostics.cold.slowest)
          },
          warm: {
            peakMemory: result.expertPerformanceDiagnostics.warm.peakMemory,
            finalDecisionCache: result.expertPerformanceDiagnostics.warm.finalDecisionCache,
            finalHandStructureCache:
              result.expertPerformanceDiagnostics.warm.finalHandStructureCache,
            finalHandPlanCache: result.expertPerformanceDiagnostics.warm.finalHandPlanCache
          }
        }
      })
    );
    expect(result.completedGames).toBe(gameCount);
    expect(result.profiles.expert?.cold.sampleCount).toBeGreaterThan(0);
  },
  0
);
