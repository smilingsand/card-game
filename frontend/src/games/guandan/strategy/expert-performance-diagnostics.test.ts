import { expect, test } from "vitest";
import { collectExpertPerformanceDiagnostics } from "./expert-performance-diagnostics";
import type { SimulationDecisionSample } from "../simulation";

const action = { type: "pass", actor: "east" } as const;
function sample(actionIndex: number, decisionMs: number): SimulationDecisionSample {
  return {
    seed: 7,
    actionIndex,
    action,
    publicEventSequence: actionIndex,
    decisionMs,
    legalActionCount: 4,
    profile: "expert",
    expertPerformance: {
      botViewReplayFingerprint: `fingerprint-${actionIndex}`,
      rawLegalInterpretationCount: 8,
      canonicalPhysicalActionCount: 5,
      semanticCandidateCount: 6,
      postActionExecutionCount: 3,
      followUpExecutionCount: 2,
      moduleElapsedMilliseconds: { postAction: decisionMs / 2, followUp: decisionMs / 2 },
      memory: { rss: 100 + actionIndex, heapUsed: 20 + actionIndex },
      decisionCache: { hits: actionIndex, misses: 1, evictions: 0, invalidations: 0, size: 1 },
      handAnalysisCache: {
        capacity: 8,
        structure: { hits: actionIndex, misses: 1, evictions: 0, invalidations: 0, size: 1 },
        handPlan: { hits: actionIndex, misses: 1, evictions: 0, invalidations: 0, size: 1 }
      }
    }
  };
}

test("expert 性能诊断按耗时稳定排序，并保留可重放、缓存和内存证据", () => {
  const report = collectExpertPerformanceDiagnostics([sample(1, 10), sample(2, 30), sample(3, 20)]);
  expect(report.slowest.map((item) => item.actionIndex)).toEqual([2, 3, 1]);
  expect(report.slowest[0]).toMatchObject({ seed: 7, botViewReplayFingerprint: "fingerprint-2" });
  expect(report.distributions.semanticCandidateCount).toMatchObject({ count: 3, average: 6 });
  expect(report.moduleElapsedMilliseconds).toEqual({ postAction: 30, followUp: 30 });
  expect(report.peakMemory).toEqual({ rss: 103, heapUsed: 23 });
  expect(report.finalDecisionCache).toMatchObject({ hits: 3 });
});

test("normal 样本不会进入 expert 性能报告", () => {
  expect(
    collectExpertPerformanceDiagnostics([{ ...sample(0, 5), profile: "normal" }]).decisions
  ).toEqual([]);
});
