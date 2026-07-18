import type { Rank } from "../../../platform/types";
import type { TurnAction } from "../turns";
import { analyzeHandStructure, type HandStructureAnalysis } from "./hand-structure-analyzer";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;

export interface ControlResourceInventory {
  readonly jokers: ResourceCards;
  readonly levelCards: ResourceCards;
  readonly wildcardLevelCards: ResourceCards;
  readonly aces: ResourceCards;
  readonly highPairs: ResourceCards;
  readonly highTriples: ResourceCards;
  readonly bombs: ResourceCards;
  readonly straightFlushes: ResourceCards;
  readonly totalUniqueCardIds: readonly string[];
  readonly recoveryPointCount: number;
}

export interface ResourceCards {
  readonly cardIds: readonly string[];
  readonly count: number;
}

export interface ControlResourceEvaluation {
  readonly phase: SituationAnalysis["phase"];
  readonly before: ControlResourceInventory;
  readonly after: ControlResourceInventory;
  readonly spentResourceCardIds: readonly string[];
  readonly spendsLastControlResource: boolean;
  readonly preservesRecoveryPoint: boolean;
  readonly budget: {
    readonly baseReserveCount: number;
    readonly minimumReserveCount: number;
    readonly remainingReserveCount: number;
    readonly isWithinBudget: boolean;
  };
  readonly opportunityCost: {
    readonly score: number;
    readonly reasons: readonly string[];
  };
  /** 仅接受由动作后评估或直接出完事实提供的例外，不自行推测阻断。 */
  readonly exception: "direct_finish" | "endgame_block" | "team_support" | null;
}

export interface EvaluateControlResourcesInput {
  readonly action: TurnAction;
  readonly structure: HandStructureAnalysis;
  readonly situation: SituationAnalysis;
  readonly postAction: PostActionHandEvaluation;
  readonly levelRank: LevelRank;
}

const uniqueSorted = (ids: readonly string[]) => [...new Set(ids)].sort();
const cards = (ids: readonly string[]): ResourceCards => ({
  cardIds: uniqueSorted(ids),
  count: ids.length
});

function inventory(structure: HandStructureAnalysis): ControlResourceInventory {
  const jokers = cards(structure.control.jokerCardIds);
  const levelCards = cards(structure.control.levelCardIds);
  const wildcardLevelCards = cards(structure.control.wildcardCardIds);
  const aces = cards(structure.control.aceCardIds);
  const highPairs = cards(structure.control.highPairCardIds);
  const highTriples = cards(structure.control.highTripleCardIds);
  const bombs = cards(structure.control.bombCardIds);
  const straightFlushes = cards(structure.control.straightFlushCardIds);
  const totalUniqueCardIds = uniqueSorted([
    ...jokers.cardIds,
    ...levelCards.cardIds,
    ...aces.cardIds,
    ...highPairs.cardIds,
    ...highTriples.cardIds,
    ...bombs.cardIds,
    ...straightFlushes.cardIds
  ]);
  const recoveryPointCount = new Set(
    structure.groups
      .filter((group) =>
        ["normal-bomb", "straight-flush", "four-jokers", "pair", "triple"].includes(group.kind)
      )
      .filter((group) => group.cardIds.some((id) => structure.recoveryCardIds.includes(id)))
      .map((group) => `${group.kind}:${group.cardIds.join(",")}`)
  ).size;
  return {
    jokers,
    levelCards,
    wildcardLevelCards,
    aces,
    highPairs,
    highTriples,
    bombs,
    straightFlushes,
    totalUniqueCardIds,
    recoveryPointCount
  };
}

function baseReserve(phase: SituationAnalysis["phase"]): number {
  if (phase === "opening") return 2;
  if (phase === "middle") return 1;
  return 0;
}

function exceptionFor(
  situation: SituationAnalysis,
  postAction: PostActionHandEvaluation
): ControlResourceEvaluation["exception"] {
  if (postAction.remainingHand.length === 0) return "direct_finish";
  if (
    situation.phase === "endgame" &&
    situation.opponentThreat.level === "critical" &&
    postAction.acceptableExceptions.includes("endgame_exception_requires_external_context")
  )
    return "endgame_block";
  if (
    situation.teammate.isSprinting &&
    postAction.acceptableExceptions.includes("team_support_requires_external_context")
  )
    return "team_support";
  return null;
}

/**
 * 仅比较己方结构、公开局面及动作后结果；不读取隐藏手牌，也不裁决动作合法性。
 * 预算是一项可解释的机会成本信号，最终是否争牌由后续 ContestEvaluator 决定。
 */
export function evaluateControlResources(
  input: EvaluateControlResourcesInput
): ControlResourceEvaluation {
  const before = inventory(input.structure);
  // Post-action evaluation has already derived this exact remaining-hand structure. Reusing it
  // avoids a duplicate pure analysis without changing the control inventory.
  const after = inventory(
    input.postAction.afterAnalysis?.structure ??
      analyzeHandStructure(input.postAction.remainingHand, input.levelRank)
  );
  const playedIds =
    input.action.type === "play" ? new Set(input.action.cardIds) : new Set<string>();
  const spentResourceCardIds = before.totalUniqueCardIds.filter((id) => playedIds.has(id));
  const exception = exceptionFor(input.situation, input.postAction);
  const lowSinglesRemain =
    input.postAction.remainingHand.length > 0 && input.postAction.after.lowSingleCount >= 2;
  const baseReserveCount = baseReserve(input.situation.phase);
  const minimumReserveCount = Math.min(
    before.totalUniqueCardIds.length,
    Math.max(baseReserveCount, lowSinglesRemain ? 1 : 0)
  );
  const remainingReserveCount = after.totalUniqueCardIds.length;
  const spendsLastControlResource =
    spentResourceCardIds.length > 0 &&
    before.totalUniqueCardIds.length > 0 &&
    remainingReserveCount === 0;
  const preservesRecoveryPoint = after.recoveryPointCount > 0;
  const reasons: string[] = [];
  // A control card need not be the *last* one to carry an opportunity cost.
  // In particular, using a joker, level card or AA/high pair as an attachment
  // can be materially worse than spending an otherwise equivalent low pair.
  // These are exact facts from the bot's own hand only; they do not infer an
  // opponent holding or invoke any successor analysis.
  const spent = new Set(spentResourceCardIds);
  const spentJoker = before.jokers.cardIds.some((id) => spent.has(id));
  const spentLevel = before.levelCards.cardIds.some((id) => spent.has(id));
  const spentAceOrHighPair =
    before.aces.cardIds.some((id) => spent.has(id)) ||
    before.highPairs.cardIds.some((id) => spent.has(id));
  if (!exception && spentJoker) reasons.push("spends_joker_control");
  if (!exception && spentLevel) reasons.push("spends_level_control");
  if (!exception && spentAceOrHighPair) reasons.push("spends_ace_or_high_pair_control");
  if (!exception && spendsLastControlResource) reasons.push("spends_last_control_resource");
  if (!exception && lowSinglesRemain && !preservesRecoveryPoint)
    reasons.push("leaves_low_singles_without_recovery");
  if (!exception && remainingReserveCount < minimumReserveCount)
    reasons.push("falls_below_phase_reserve");
  if (input.postAction.lowValueWildcardUse) reasons.push("low_value_wildcard_use");
  if (exception) reasons.push(`exception_${exception}`);

  return {
    phase: input.situation.phase,
    before,
    after,
    spentResourceCardIds,
    spendsLastControlResource,
    preservesRecoveryPoint,
    budget: {
      baseReserveCount,
      minimumReserveCount,
      remainingReserveCount,
      isWithinBudget: exception !== null || remainingReserveCount >= minimumReserveCount
    },
    opportunityCost: { score: reasons.length, reasons },
    exception
  };
}
