import type { BotView } from "../bot-view";
import type { TurnAction } from "../turns";
import { compareExpertDepthQuality, type ExpertDepthQualityCase } from "./expert-depth-quality";

/**
 * Seed=0 Stage-1 cold-path Top-20 from the immutable diagnostic handoff.
 * These are action indices in the actual east/west=expert simulation path,
 * not synthetic fixtures.
 */
export const SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES = [
  0, 2, 4, 18, 16, 10, 22, 40, 12, 6, 36, 32, 8, 28, 20, 44, 24, 26, 76, 14
] as const;

/**
 * ADR-0020 froze this exact seed=0 expert-12 replay set.  It must never be
 * rebuilt from a later expert policy's game trajectory: doing so changes the
 * BotViews being compared rather than measuring the new policy against the
 * agreed reference population.
 */
export const ADR_0020_FIXED_ACTION_INDEXES = [
  0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 61, 64, 76, 103, 105, 107,
  108, 109, 110, 111, 112, 113, 114, 115, 116
] as const;

export const ADR_0020_MANDATORY_ACTION_INDEXES = [
  103, 105, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116
] as const;

export type FixedBotViewCoverage =
  | "opening"
  | "middle"
  | "endgame"
  | "top_20_slow"
  | "bomb"
  | "wildcard"
  | "partner_cooperation"
  | "opponent_near_finish"
  | "mandatory";

export interface FixedBotViewSample {
  readonly seed: number;
  readonly actionIndex: number;
  readonly view: BotView;
  readonly coverage: readonly Exclude<FixedBotViewCoverage, "mandatory">[];
}

export interface FixedBotViewQualityCase extends ExpertDepthQualityCase {
  readonly coverage: readonly FixedBotViewCoverage[];
  readonly botViewFingerprint: string;
}

export interface FixedBotViewQualityReport {
  readonly totalCaseCount: number;
  readonly actionDifferenceCount: number;
  readonly actionDifferenceRate: number;
  readonly coverage: Readonly<Record<FixedBotViewCoverage, readonly number[]>>;
  readonly cases: readonly {
    readonly actionIndex: number;
    readonly botViewFingerprint: string;
    readonly coverage: readonly FixedBotViewCoverage[];
    readonly selectedActionEqual: boolean;
    readonly candidateOrderEqual: boolean;
    readonly explanationEqual: boolean;
    readonly expertCandidateCount: number;
    readonly experimentalFullCandidateCount: number;
  }[];
  readonly depth: ReturnType<typeof compareExpertDepthQuality>;
  /** Differences are never silently accepted; product review decides materiality. */
  readonly requiresQualityReview: boolean;
}

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

function teammateFor(seat: BotView["selfSeat"]): BotView["selfSeat"] {
  const teammates: Readonly<Record<BotView["selfSeat"], BotView["selfSeat"]>> = {
    east: "west",
    west: "east",
    north: "south",
    south: "north"
  };
  return teammates[seat];
}

function baseCoverage(input: {
  readonly sample: { readonly actionIndex: number; readonly view: BotView };
  readonly finalActionIndex: number;
}): readonly Exclude<FixedBotViewCoverage, "mandatory">[] {
  const { actionIndex, view } = input.sample;
  const values: Exclude<FixedBotViewCoverage, "mandatory">[] = [];
  const phase =
    actionIndex * 3 < input.finalActionIndex
      ? "opening"
      : actionIndex * 3 < input.finalActionIndex * 2
        ? "middle"
        : "endgame";
  values.push(phase);
  if ((SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES as readonly number[]).includes(actionIndex))
    values.push("top_20_slow");
  if (
    view.legalActions.some(
      (action) =>
        action.type === "play" &&
        (action.interpretation.type === "normal-bomb" ||
          action.interpretation.type === "straight-flush" ||
          action.interpretation.type === "four-jokers")
    )
  )
    values.push("bomb");
  if (
    view.legalActions.some(
      (action) => action.type === "play" && Object.keys(action.interpretation.wildcardAs).length > 0
    )
  )
    values.push("wildcard");
  if (view.remainingCardCounts[teammateFor(view.selfSeat)] <= 5) values.push("partner_cooperation");
  if (
    (["east", "south", "west", "north"] as const).some(
      (seat) =>
        seat !== view.selfSeat &&
        seat !== teammateFor(view.selfSeat) &&
        view.remainingCardCounts[seat] <= 3
    )
  )
    values.push("opponent_near_finish");
  return values;
}

/**
 * Selects the full Top-20 slow set, while retaining a deterministic coverage
 * tag for every replayed BotView. Additional scenario tags are derived solely
 * from that public BotView; no hidden hand is inspected.
 */
export function selectSeedZeroFixedBotViewSamples(
  samples: readonly {
    readonly seed: number;
    readonly actionIndex: number;
    readonly view: BotView;
  }[]
): readonly FixedBotViewSample[] {
  const finalActionIndex = Math.max(...samples.map((sample) => sample.actionIndex), 1);
  const seedSamples = samples.filter((sample) => sample.seed === 0);
  const selectedIndexes = new Set<number>(ADR_0020_FIXED_ACTION_INDEXES);
  const selected = seedSamples.filter((sample) => selectedIndexes.has(sample.actionIndex));
  const foundIndexes = new Set(selected.map((sample) => sample.actionIndex));
  const missing = ADR_0020_FIXED_ACTION_INDEXES.filter((index) => !foundIndexes.has(index));
  if (missing.length > 0)
    throw new Error(`ADR-0020 fixed BotView replay is incomplete: missing ${missing.join(",")}`);
  return selected.map((sample) => ({
    ...sample,
    coverage: baseCoverage({ sample, finalActionIndex })
  }));
}

export function createFixedBotViewQualityReport(
  cases: readonly FixedBotViewQualityCase[]
): FixedBotViewQualityReport {
  const depth = compareExpertDepthQuality(cases);
  const coverage = Object.fromEntries(
    (
      [
        "opening",
        "middle",
        "endgame",
        "top_20_slow",
        "bomb",
        "wildcard",
        "partner_cooperation",
        "opponent_near_finish",
        "mandatory"
      ] as const
    ).map((kind) => [kind, []])
  ) as unknown as Record<FixedBotViewCoverage, number[]>;
  const summaries = cases.map((item) => {
    const selectedActionEqual =
      actionKey(item.expert.selectedAction) === actionKey(item.experimentalFull.selectedAction);
    const expertOrder = item.expert.explanation.candidates.map(
      (candidate) => candidate.candidateKey ?? actionKey(candidate.action)
    );
    const fullOrder = item.experimentalFull.explanation.candidates.map(
      (candidate) => candidate.candidateKey ?? actionKey(candidate.action)
    );
    const candidateOrderEqual = stableJson(expertOrder) === stableJson(fullOrder);
    const explanationEqual =
      stableJson(item.expert.explanation) === stableJson(item.experimentalFull.explanation);
    for (const kind of item.coverage) coverage[kind].push(item.actionIndex);
    return {
      actionIndex: item.actionIndex,
      botViewFingerprint: item.botViewFingerprint,
      coverage: item.coverage,
      selectedActionEqual,
      candidateOrderEqual,
      explanationEqual,
      expertCandidateCount: item.expert.explanation.candidates.length,
      experimentalFullCandidateCount: item.experimentalFull.explanation.candidates.length
    };
  });
  return {
    totalCaseCount: cases.length,
    actionDifferenceCount: depth.actionDifferenceCount,
    actionDifferenceRate: depth.actionDifferenceRate,
    coverage,
    cases: summaries,
    depth,
    requiresQualityReview: depth.requiresQualityReview
  };
}
