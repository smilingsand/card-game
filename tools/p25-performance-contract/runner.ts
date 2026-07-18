import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { runSimulation } from "../../frontend/src/games/guandan/simulation";
import { clearCompleteLegalActionsCaches } from "../../frontend/src/games/guandan/rule-complete-legal-actions";
import { createDefaultStrategyProfile } from "../../frontend/src/games/guandan/strategy/decision-explanation";
import {
  EXPERT_DECISION_BUDGET,
  chooseExpertBotDecision,
  clearExpertDecisionCache,
  getExpertDecisionCacheStatistics,
} from "../../frontend/src/games/guandan/strategy/expert-decision";
import {
  collectExpertPerformanceDiagnostics,
  distribution,
} from "../../frontend/src/games/guandan/strategy/expert-performance-diagnostics";
import {
  clearExpertHandAnalysisCache,
  getExpertHandAnalysisCacheStatistics,
} from "../../frontend/src/games/guandan/strategy/hand-analysis-cache";
import {
  ADR_0020_FIXED_ACTION_INDEXES,
  selectSeedZeroFixedBotViewSamples,
} from "../../frontend/src/games/guandan/strategy/fixed-botview-quality";

type FixedView = Parameters<typeof chooseExpertBotDecision>[0]["view"];

interface DecisionMeasurement {
  readonly actionIndex: number;
  readonly elapsedMilliseconds: number;
  readonly selectedAction: ReturnType<
    typeof chooseExpertBotDecision
  >["selectedAction"];
  readonly candidateCount: number;
  readonly moduleElapsedMilliseconds: Readonly<Record<string, number>>;
}

interface WorkerReport {
  readonly contract: "ADR-0023";
  readonly processId: number;
  readonly gcBeforeMeasurement: boolean;
  readonly fixedActionIndexes: readonly number[];
  readonly processColdStart: DecisionMeasurement;
  readonly warmupActionIndexes: readonly number[];
  readonly steadyStateCold: readonly DecisionMeasurement[];
  readonly warm: readonly DecisionMeasurement[];
  readonly steadyStateColdAverageMilliseconds: number;
  readonly warmP95Milliseconds: number;
  readonly coldDiagnostics: ReturnType<
    typeof collectExpertPerformanceDiagnostics
  >;
  readonly cache: {
    readonly afterCold: ReturnType<typeof getExpertDecisionCacheStatistics>;
    readonly afterWarm: ReturnType<typeof getExpertDecisionCacheStatistics>;
    readonly handAnalysisAfterCold: ReturnType<
      typeof getExpertHandAnalysisCacheStatistics
    >;
    readonly handAnalysisAfterWarm: ReturnType<
      typeof getExpertHandAnalysisCacheStatistics
    >;
  };
  readonly peakMemory: {
    readonly rss: number;
    readonly heapUsed: number;
    readonly heapTotal: number;
  };
}

function clearExactCaches(): void {
  clearExpertDecisionCache();
  clearExpertHandAnalysisCache();
  clearCompleteLegalActionsCaches();
}

function captureReplayViews(): readonly {
  readonly actionIndex: number;
  readonly profile: "basic" | "normal" | "expert" | "experimental";
  readonly view: FixedView;
}[] {
  const botViews: {
    readonly seed: number;
    readonly actionIndex: number;
    readonly profile: "basic" | "normal" | "expert" | "experimental";
    readonly view: FixedView;
  }[] = [];
  const result = runSimulation(0, {
    difficulties: {
      east: "expert",
      west: "expert",
      south: "normal",
      north: "normal",
    },
    expertPerformanceBudget: {
      handPlanTopN: { default: 4, max: 4 },
      postActionReplanCount: { default: 1, max: 1 },
      postActionCandidateCount: { default: 12, max: 24 },
      followUpCandidateCount: { default: 12, max: 24 },
    },
    onBotView: (sample) => botViews.push(sample),
  });
  if (!result.ok)
    throw new Error(
      `fixed BotView replay failed: ${result.code} ${result.message}`,
    );
  return botViews.filter((sample) => sample.seed === 0);
}

function measure(
  views: readonly { readonly actionIndex: number; readonly view: FixedView }[],
): readonly DecisionMeasurement[] {
  const profile = createDefaultStrategyProfile("expert");
  return views.map(({ actionIndex, view }) => {
    const started = performance.now();
    const decision = chooseExpertBotDecision({
      view,
      profile,
      performanceBudget: EXPERT_DECISION_BUDGET,
    });
    return {
      actionIndex,
      elapsedMilliseconds: performance.now() - started,
      selectedAction: decision.selectedAction,
      candidateCount: decision.explanation.candidates.length,
      moduleElapsedMilliseconds:
        decision.debug?.moduleElapsedMilliseconds ?? {},
    };
  });
}

function memory() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
  };
}

function runWorker(output: string): void {
  const replayViews = captureReplayViews();
  const views = selectSeedZeroFixedBotViewSamples(replayViews).map(
    ({ actionIndex, view }) => ({ actionIndex, view }),
  );
  if (views.length !== ADR_0020_FIXED_ACTION_INDEXES.length)
    throw new Error(
      `expected ${ADR_0020_FIXED_ACTION_INDEXES.length} fixed BotViews, got ${views.length}`,
    );
  const fixedIndexes = new Set(ADR_0020_FIXED_ACTION_INDEXES);
  const nonFixedExpertViews = replayViews.filter(
    (sample) =>
      sample.profile === "expert" && !fixedIndexes.has(sample.actionIndex),
  );
  if (nonFixedExpertViews.length < 4)
    throw new Error(
      "ADR-0023 replay lacks four non-fixed expert BotViews for cold-start and warmup",
    );
  const processColdStartView = nonFixedExpertViews[0];
  const warmup = nonFixedExpertViews.slice(1, 4);
  clearExactCaches();
  const processColdStart = measure([processColdStartView])[0];
  measure(warmup);
  const gcBeforeMeasurement = typeof global.gc === "function";
  if (gcBeforeMeasurement) global.gc();
  const steadyStateCold = measure(views);
  const afterCold = getExpertDecisionCacheStatistics();
  const handAnalysisAfterCold = getExpertHandAnalysisCacheStatistics();
  const warm = measure(views);
  const afterWarm = getExpertDecisionCacheStatistics();
  const handAnalysisAfterWarm = getExpertHandAnalysisCacheStatistics();
  const coldDiagnostics = collectExpertPerformanceDiagnostics(
    steadyStateCold.map((item) => ({
      seed: 0,
      actionIndex: item.actionIndex,
      action: item.selectedAction,
      publicEventSequence: item.actionIndex,
      decisionMs: item.elapsedMilliseconds,
      legalActionCount: item.candidateCount,
      profile: "expert" as const,
      expertPerformance: {
        botViewReplayFingerprint: `adr-0020:${item.actionIndex}`,
        rawLegalInterpretationCount: item.candidateCount,
        canonicalPhysicalActionCount: item.candidateCount,
        semanticCandidateCount: item.candidateCount,
        postActionExecutionCount: 0,
        followUpExecutionCount: 0,
        moduleElapsedMilliseconds: item.moduleElapsedMilliseconds,
        memory: memory(),
        decisionCache: afterCold,
        handAnalysisCache: handAnalysisAfterCold,
      },
    })),
  );
  const report: WorkerReport = {
    contract: "ADR-0023",
    processId: process.pid,
    gcBeforeMeasurement,
    fixedActionIndexes: views.map((item) => item.actionIndex),
    processColdStart,
    warmupActionIndexes: warmup.map((item) => item.actionIndex),
    steadyStateCold,
    warm,
    steadyStateColdAverageMilliseconds: distribution(
      steadyStateCold.map((item) => item.elapsedMilliseconds),
    ).average,
    warmP95Milliseconds: distribution(
      warm.map((item) => item.elapsedMilliseconds),
    ).p95,
    coldDiagnostics,
    cache: {
      afterCold,
      afterWarm,
      handAnalysisAfterCold,
      handAnalysisAfterWarm,
    },
    peakMemory: memory(),
  };
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(
    resolve(output),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.info(
    JSON.stringify({
      output: resolve(output),
      steadyStateColdAverageMilliseconds:
        report.steadyStateColdAverageMilliseconds,
    }),
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function aggregate(inputs: readonly string[], output?: string): void {
  if (inputs.length !== 5)
    throw new Error(`ADR-0023 requires five reports, got ${inputs.length}`);
  const reports = inputs.map(
    (input) => JSON.parse(readFileSync(resolve(input), "utf8")) as WorkerReport,
  );
  const allSteadyStateCold = reports.flatMap(
    (report) => report.steadyStateCold,
  );
  const allWarm = reports.flatMap((report) => report.warm);
  const steadyStateCold = distribution(
    allSteadyStateCold.map((item) => item.elapsedMilliseconds),
  );
  const warm = distribution(allWarm.map((item) => item.elapsedMilliseconds));
  const perProcessAverages = reports.map(
    (report) => report.steadyStateColdAverageMilliseconds,
  );
  const gates = {
    coldAverage: median(perProcessAverages) <= 500,
    coldP95: steadyStateCold.p95 <= 1_500,
    coldSlowest: steadyStateCold.max <= 4_000,
    warmP95: warm.p95 <= 400,
  };
  const moduleElapsedMilliseconds: Record<string, number> = {};
  for (const measurement of allSteadyStateCold)
    for (const [module, elapsed] of Object.entries(
      measurement.moduleElapsedMilliseconds,
    ))
      moduleElapsedMilliseconds[module] =
        (moduleElapsedMilliseconds[module] ?? 0) + elapsed;
  const report = {
    contract: "ADR-0023",
    processCount: reports.length,
    steadyStateColdSampleCount: allSteadyStateCold.length,
    processColdStarts: reports.map((report) => report.processColdStart),
    perProcessSteadyStateColdAverageMilliseconds: perProcessAverages,
    medianProcessSteadyStateColdAverageMilliseconds: median(perProcessAverages),
    pooledSteadyStateColdP95Milliseconds: steadyStateCold.p95,
    globalSteadyStateSlowestMilliseconds: steadyStateCold.max,
    warmP95Milliseconds: warm.p95,
    gates,
    passed: Object.values(gates).every(Boolean),
    steadyStateColdSlowest: allSteadyStateCold
      .sort(
        (left, right) => right.elapsedMilliseconds - left.elapsedMilliseconds,
      )
      .slice(0, 20),
    moduleElapsedMilliseconds,
    peakMemory: reports.map((report) => report.peakMemory),
    cache: reports.map((report) => report.cache),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), serialized, "utf8");
  }
  console.info(serialized);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "worker" && args.length === 1) runWorker(args[0]);
else if (mode === "aggregate" && (args.length === 5 || args.length === 6))
  aggregate(args.slice(0, 5), args[5]);
else
  throw new Error(
    "usage: runner.ts worker <output.json> | aggregate <five output files> [output.json]",
  );
