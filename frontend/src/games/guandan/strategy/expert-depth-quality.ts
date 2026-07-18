import type { TurnAction } from "../turns";
import type { StrategyDecision } from "./decision-explanation";
import { EXPERT_METRIC_IDS, collectExpertMetrics, type ExpertMetricId } from "./simulation-metrics";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function actionKey(action: TurnAction): string {
  return stableJson(action);
}

export interface ExpertDepthQualityCase {
  readonly id: string;
  readonly seed: number;
  readonly actionIndex: number;
  readonly expert: StrategyDecision;
  /** experimental-full reference evaluated from the identical BotView. */
  readonly experimentalFull: StrategyDecision;
}

export interface ExpertDepthQualityReport {
  readonly totalCaseCount: number;
  readonly actionDifferenceCount: number;
  readonly actionDifferenceRate: number;
  readonly differences: readonly {
    readonly id: string;
    readonly seed: number;
    readonly actionIndex: number;
    readonly expertAction: TurnAction;
    readonly experimentalFullAction: TurnAction;
    readonly expertMetricCounters: ReturnType<typeof collectExpertMetrics>["counters"];
    readonly experimentalFullMetricCounters: ReturnType<typeof collectExpertMetrics>["counters"];
  }[];
  readonly metrics: Readonly<
    Record<
      ExpertMetricId,
      { readonly expert: number; readonly experimentalFull: number; readonly delta: number }
    >
  >;
  /** Any divergence is surfaced for review; this helper never silently accepts it. */
  readonly requiresQualityReview: boolean;
}

function metricsFor(input: {
  readonly seed: number;
  readonly actionIndex: number;
  readonly decision: StrategyDecision;
}) {
  return collectExpertMetrics([
    {
      seed: input.seed,
      actionIndex: input.actionIndex,
      action: input.decision.selectedAction,
      publicEventSequence: input.actionIndex,
      decisionMs: 0,
      legalActionCount: input.decision.explanation.candidates.length,
      profile: "expert",
      explanation: input.decision.explanation
    }
  ]).counters;
}

/**
 * ADR-0021 quality-diff evidence. Full is a research/reference budget, not a
 * fallback: differing selected actions and all nine metric deltas stay in the
 * returned report for fixture/seed review.
 */
export function compareExpertDepthQuality(
  cases: readonly ExpertDepthQualityCase[]
): ExpertDepthQualityReport {
  const differences: ExpertDepthQualityReport["differences"][number][] = [];
  const aggregate = Object.fromEntries(
    EXPERT_METRIC_IDS.map((id) => [id, { expert: 0, experimentalFull: 0 }])
  ) as Record<ExpertMetricId, { expert: number; experimentalFull: number }>;
  for (const item of cases) {
    const expertMetricCounters = metricsFor({
      seed: item.seed,
      actionIndex: item.actionIndex,
      decision: item.expert
    });
    const experimentalFullMetricCounters = metricsFor({
      seed: item.seed,
      actionIndex: item.actionIndex,
      decision: item.experimentalFull
    });
    for (const metric of EXPERT_METRIC_IDS) {
      aggregate[metric].expert += expertMetricCounters[metric].numerator;
      aggregate[metric].experimentalFull += experimentalFullMetricCounters[metric].numerator;
    }
    if (actionKey(item.expert.selectedAction) !== actionKey(item.experimentalFull.selectedAction))
      differences.push({
        id: item.id,
        seed: item.seed,
        actionIndex: item.actionIndex,
        expertAction: item.expert.selectedAction,
        experimentalFullAction: item.experimentalFull.selectedAction,
        expertMetricCounters,
        experimentalFullMetricCounters
      });
  }
  const metrics = Object.fromEntries(
    EXPERT_METRIC_IDS.map((metric) => [
      metric,
      {
        expert: aggregate[metric].expert,
        experimentalFull: aggregate[metric].experimentalFull,
        delta: aggregate[metric].expert - aggregate[metric].experimentalFull
      }
    ])
  ) as ExpertDepthQualityReport["metrics"];
  return {
    totalCaseCount: cases.length,
    actionDifferenceCount: differences.length,
    actionDifferenceRate: cases.length === 0 ? 0 : differences.length / cases.length,
    differences,
    metrics,
    requiresQualityReview: differences.length > 0
  };
}
