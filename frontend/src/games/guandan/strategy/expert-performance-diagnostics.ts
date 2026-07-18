import type { CacheStatistics } from "./decision-cache";
import type { SimulationDecisionSample } from "../simulation";

export interface ProcessMemorySnapshot {
  readonly rss?: number;
  readonly heapUsed?: number;
  readonly heapTotal?: number;
}

export interface ExpertDecisionPerformanceDiagnostic {
  readonly seed: number;
  readonly actionIndex: number;
  readonly profile: "expert" | "experimental";
  readonly botViewReplayFingerprint: string;
  readonly selectedAction: SimulationDecisionSample["action"];
  readonly decisionMs: number;
  readonly legalActionCount: number;
  readonly rawLegalInterpretationCount: number;
  readonly canonicalPhysicalActionCount: number;
  readonly semanticCandidateCount: number;
  readonly postActionExecutionCount: number;
  readonly followUpExecutionCount: number;
  readonly moduleElapsedMilliseconds: Readonly<Record<string, number>>;
  readonly memory?: ProcessMemorySnapshot;
  readonly decisionCache?: CacheStatistics;
  readonly handStructureCache?: CacheStatistics;
  readonly handPlanCache?: CacheStatistics;
}

export interface ExpertPerformanceDistribution {
  readonly count: number;
  readonly min: number;
  readonly average: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface ExpertPerformanceDiagnosticsReport {
  readonly decisions: readonly ExpertDecisionPerformanceDiagnostic[];
  readonly slowest: readonly ExpertDecisionPerformanceDiagnostic[];
  readonly distributions: Readonly<
    Record<
      | "legalActionCount"
      | "rawLegalInterpretationCount"
      | "canonicalPhysicalActionCount"
      | "semanticCandidateCount"
      | "postActionExecutionCount"
      | "followUpExecutionCount",
      ExpertPerformanceDistribution
    >
  >;
  readonly moduleElapsedMilliseconds: Readonly<Record<string, number>>;
  readonly peakMemory: ProcessMemorySnapshot;
  readonly finalDecisionCache?: CacheStatistics;
  readonly finalHandStructureCache?: CacheStatistics;
  readonly finalHandPlanCache?: CacheStatistics;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function distribution(values: readonly number[]): ExpertPerformanceDistribution {
  return {
    count: values.length,
    min: values.length === 0 ? 0 : Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length === 0 ? 0 : Math.max(...values)
  };
}

/**
 * Aggregates observations already produced by the real expert entry. This is
 * deliberately post-decision only: no clock, cache value or memory sample can
 * influence candidate admission, scoring, tie-break or the selected action.
 */
export function collectExpertPerformanceDiagnostics(
  samples: readonly SimulationDecisionSample[]
): ExpertPerformanceDiagnosticsReport {
  const decisions = samples
    .filter(
      (
        sample
      ): sample is SimulationDecisionSample & {
        readonly profile: "expert" | "experimental";
        readonly expertPerformance: NonNullable<SimulationDecisionSample["expertPerformance"]>;
      } =>
        (sample.profile === "expert" || sample.profile === "experimental") &&
        sample.expertPerformance !== undefined
    )
    .map(({ expertPerformance, ...sample }) => ({
      seed: sample.seed,
      actionIndex: sample.actionIndex,
      profile: sample.profile,
      botViewReplayFingerprint: expertPerformance.botViewReplayFingerprint,
      selectedAction: sample.action,
      decisionMs: sample.decisionMs,
      legalActionCount: sample.legalActionCount,
      rawLegalInterpretationCount: expertPerformance.rawLegalInterpretationCount,
      canonicalPhysicalActionCount: expertPerformance.canonicalPhysicalActionCount,
      semanticCandidateCount: expertPerformance.semanticCandidateCount,
      postActionExecutionCount: expertPerformance.postActionExecutionCount,
      followUpExecutionCount: expertPerformance.followUpExecutionCount,
      moduleElapsedMilliseconds: expertPerformance.moduleElapsedMilliseconds,
      memory: expertPerformance.memory,
      decisionCache: expertPerformance.decisionCache,
      handStructureCache: expertPerformance.handAnalysisCache?.structure,
      handPlanCache: expertPerformance.handAnalysisCache?.handPlan
    }));
  const moduleElapsedMilliseconds: Record<string, number> = {};
  const peakMemory: { rss?: number; heapUsed?: number; heapTotal?: number } = {};
  for (const decision of decisions) {
    for (const [module, elapsed] of Object.entries(decision.moduleElapsedMilliseconds))
      moduleElapsedMilliseconds[module] = (moduleElapsedMilliseconds[module] ?? 0) + elapsed;
    for (const key of ["rss", "heapUsed", "heapTotal"] as const) {
      const value = decision.memory?.[key];
      if (value !== undefined) peakMemory[key] = Math.max(peakMemory[key] ?? 0, value);
    }
  }
  const last = decisions.at(-1);
  return {
    decisions,
    slowest: [...decisions]
      .sort(
        (left, right) =>
          right.decisionMs - left.decisionMs ||
          left.seed - right.seed ||
          left.actionIndex - right.actionIndex
      )
      .slice(0, 20),
    distributions: {
      legalActionCount: distribution(decisions.map((item) => item.legalActionCount)),
      rawLegalInterpretationCount: distribution(
        decisions.map((item) => item.rawLegalInterpretationCount)
      ),
      canonicalPhysicalActionCount: distribution(
        decisions.map((item) => item.canonicalPhysicalActionCount)
      ),
      semanticCandidateCount: distribution(decisions.map((item) => item.semanticCandidateCount)),
      postActionExecutionCount: distribution(
        decisions.map((item) => item.postActionExecutionCount)
      ),
      followUpExecutionCount: distribution(decisions.map((item) => item.followUpExecutionCount))
    },
    moduleElapsedMilliseconds,
    peakMemory,
    finalDecisionCache: last?.decisionCache,
    finalHandStructureCache: last?.handStructureCache,
    finalHandPlanCache: last?.handPlanCache
  };
}
