import { collectExpertMetrics, type ExpertMetricReport } from "./strategy/simulation-metrics";
import {
  collectExpertPerformanceDiagnostics,
  type ExpertPerformanceDiagnosticsReport
} from "./strategy/expert-performance-diagnostics";
import {
  clearExpertDecisionCache,
  getExpertDecisionCacheStatistics
} from "./strategy/expert-decision";
import type { CacheStatistics } from "./strategy/decision-cache";
import {
  clearExpertHandAnalysisCache,
  getExpertHandAnalysisCacheStatistics,
  type HandAnalysisCache
} from "./strategy/hand-analysis-cache";
import { runSimulation, type BotDifficulty, type SimulationDecisionSample } from "./simulation";

export interface DecisionLatency {
  readonly sampleCount: number;
  readonly averageMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly slowestMs: number;
}
export interface ProfileLatencyReport {
  readonly cold: DecisionLatency;
  readonly warm: DecisionLatency;
}
export interface HardwareSample {
  readonly runtime: string;
  readonly platform: string;
  readonly architecture: string;
}
export interface BotBenchmark {
  readonly gameCount: number;
  readonly completedGames: number;
  /** Compatibility field: team east/west's win rate, regardless of the explicitly selected profile. */
  readonly normalTeamWinRate: number;
  readonly averageActionCount: number;
  readonly averageDecisionMs: number;
  readonly maxDecisionMs: number;
  readonly profiles: Readonly<Record<BotDifficulty, ProfileLatencyReport | undefined>>;
  readonly expertMetrics: ExpertMetricReport;
  /** Per-decision, replayable real-expert observations; never derived from normal. */
  readonly expertPerformanceDiagnostics: {
    readonly cold: ExpertPerformanceDiagnosticsReport;
    readonly warm: ExpertPerformanceDiagnosticsReport;
  };
  /** Exact expert-decision cache observations for the two deterministic passes. */
  readonly expertDecisionCache: { readonly cold: CacheStatistics; readonly warm: CacheStatistics };
  /** Exact bounded HandStructure/HandPlan cache observations for the two passes. */
  readonly expertHandAnalysisCache: {
    readonly cold: ReturnType<HandAnalysisCache["statistics"]>;
    readonly warm: ReturnType<HandAnalysisCache["statistics"]>;
  };
  readonly firstFailureSeed?: number;
  readonly hardware: HardwareSample;
}
export interface BenchmarkBotsOptions {
  readonly startSeed: number;
  readonly gameCount: number;
  /** Defaults to an explicitly expert east/west team against the normal regression baseline. */
  readonly difficulties?: Readonly<Record<Seat, BotDifficulty>>;
}
function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  return [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)
  ];
}
function latency(values: readonly number[]): DecisionLatency {
  return {
    sampleCount: values.length,
    averageMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    slowestMs: Math.max(0, ...values)
  };
}
function defaultDifficulties(): Readonly<Record<Seat, BotDifficulty>> {
  return { east: "expert", west: "expert", south: "normal", north: "normal" };
}
function hardware(): HardwareSample {
  const processInfo = globalThis.process;
  return {
    runtime: typeof processInfo === "undefined" ? "browser" : processInfo.version,
    platform: typeof processInfo === "undefined" ? "browser" : processInfo.platform,
    architecture: typeof processInfo === "undefined" ? "unknown" : processInfo.arch
  };
}

/**
 * Runs the actual simulation decision path. `expertMetrics` is derived solely from samples
 * carrying an expert DecisionExplanation; normal samples never enter its numerators or denominators.
 * The second deterministic pass is the warm-cache measurement boundary. It deliberately does not
 * change candidates or use a wall-clock early stop.
 */
export function benchmarkBots(options: BenchmarkBotsOptions): BotBenchmark {
  if (!Number.isInteger(options.startSeed) || options.startSeed < 0)
    throw new RangeError("startSeed must be a non-negative integer");
  if (!Number.isInteger(options.gameCount) || options.gameCount < 1)
    throw new RangeError("gameCount must be a positive integer");
  const difficulties = options.difficulties ?? defaultDifficulties();
  clearExpertDecisionCache();
  clearExpertHandAnalysisCache();
  const cold = new Map<BotDifficulty, number[]>(),
    warm = new Map<BotDifficulty, number[]>();
  const expertSamples: SimulationDecisionSample[] = [];
  const warmExpertSamples: SimulationDecisionSample[] = [];
  let completedGames = 0,
    teamWins = 0,
    actions = 0,
    maxDecisionMs = 0,
    firstFailureSeed: number | undefined;
  const run = (
    target: Map<BotDifficulty, number[]>,
    collect: boolean,
    performanceSamples: SimulationDecisionSample[]
  ) => {
    for (let i = 0; i < options.gameCount; i += 1) {
      const result = runSimulation(options.startSeed + i, {
        difficulties,
        onDecision: (sample) => {
          const list = target.get(sample.profile) ?? [];
          list.push(sample.decisionMs);
          target.set(sample.profile, list);
          if (sample.profile === "expert" || sample.profile === "experimental")
            performanceSamples.push(sample);
          maxDecisionMs = Math.max(maxDecisionMs, sample.decisionMs);
        }
      });
      if (collect) {
        if (result.ok) {
          completedGames += 1;
          actions += result.actionCount;
          if (result.finish[0] === "east" || result.finish[0] === "west") teamWins += 1;
        } else if (firstFailureSeed === undefined) firstFailureSeed = result.seed;
      }
    }
  };
  run(cold, true, expertSamples);
  const coldCache = getExpertDecisionCacheStatistics();
  const coldHandAnalysisCache = getExpertHandAnalysisCacheStatistics();
  run(warm, false, warmExpertSamples);
  const warmCache = getExpertDecisionCacheStatistics();
  const warmHandAnalysisCache = getExpertHandAnalysisCacheStatistics();
  const profiles = Object.fromEntries(
    (["basic", "normal", "expert", "experimental"] as const).map((profile) => {
      const coldValues = cold.get(profile),
        warmValues = warm.get(profile);
      return [
        profile,
        coldValues || warmValues
          ? { cold: latency(coldValues ?? []), warm: latency(warmValues ?? []) }
          : undefined
      ];
    })
  ) as Readonly<Record<BotDifficulty, ProfileLatencyReport | undefined>>;
  const expertLatency = profiles.expert ?? profiles.experimental;
  return {
    gameCount: options.gameCount,
    completedGames,
    normalTeamWinRate: completedGames ? teamWins / completedGames : 0,
    averageActionCount: completedGames ? actions / completedGames : 0,
    maxDecisionMs,
    profiles,
    expertMetrics: collectExpertMetrics(expertSamples),
    expertPerformanceDiagnostics: {
      cold: collectExpertPerformanceDiagnostics(expertSamples),
      warm: collectExpertPerformanceDiagnostics(warmExpertSamples)
    },
    expertDecisionCache: { cold: coldCache, warm: warmCache },
    expertHandAnalysisCache: { cold: coldHandAnalysisCache, warm: warmHandAnalysisCache },
    firstFailureSeed,
    hardware: hardware(),
    averageDecisionMs: expertLatency?.cold.averageMs ?? 0
  };
}
import type { Seat } from "../../platform/types";
