import type { Card, Rank } from "../../../platform/types";
import type { BotView } from "../bot-view";
import type { TurnAction } from "../turns";

export interface DeadHandRiskProxy {
  /** Smaller is preferable. This is a light-stage admission signal, not PostAction. */
  readonly total: number;
  readonly lowSinglePenalty: number;
  readonly controlExhaustionPenalty: number;
  readonly structureBreakPenalty: number;
  readonly wildcardConsumptionPenalty: number;
  readonly publicThreatPenalty: number;
}

const LOW_RANKS = new Set<Rank>(["3", "4", "5", "6", "7", "8", "9", "10"]);
const CONTROL_RANKS = new Set<Rank>(["2", "small-joker", "big-joker"]);

function counts(cards: readonly Card[]): ReadonlyMap<Rank, number> {
  const result = new Map<Rank, number>();
  for (const card of cards) result.set(card.rank, (result.get(card.rank) ?? 0) + 1);
  return result;
}

/**
 * ADR-0022 light, replayable risk proxy. It deliberately only subtracts the
 * action's physical card ids from the BotView hand; it never invokes pattern
 * recognition, successor analysis, HandPlan or FollowUp.
 */
export function evaluateDeadHandRiskProxy(input: {
  readonly view: Pick<BotView, "selfHand" | "levelRank" | "remainingCardCounts">;
  readonly action: TurnAction;
}): DeadHandRiskProxy {
  if (input.action.type === "pass")
    return {
      total: 0,
      lowSinglePenalty: 0,
      controlExhaustionPenalty: 0,
      structureBreakPenalty: 0,
      wildcardConsumptionPenalty: 0,
      publicThreatPenalty: 0
    };

  const removedIds = new Set(input.action.cardIds);
  const removed = input.view.selfHand.filter((card) => removedIds.has(card.id));
  const remaining = input.view.selfHand.filter((card) => !removedIds.has(card.id));
  const before = counts(input.view.selfHand);
  const after = counts(remaining);
  const lowSinglePenalty = [...after.entries()].filter(
    ([rank, count]) => LOW_RANKS.has(rank) && count === 1
  ).length;
  const controlsBefore = input.view.selfHand.filter(
    (card) => CONTROL_RANKS.has(card.rank) || card.rank === input.view.levelRank
  ).length;
  const controlsAfter = remaining.filter(
    (card) => CONTROL_RANKS.has(card.rank) || card.rank === input.view.levelRank
  ).length;
  const controlExhaustionPenalty = controlsBefore > 0 && controlsAfter === 0 ? 4 : 0;
  const structureBreakPenalty = [...before.entries()].reduce((penalty, [rank, count]) => {
    const remainingCount = after.get(rank) ?? 0;
    if (count >= 4 && remainingCount > 0 && remainingCount < 4) return penalty + 5;
    if (count === 3 && remainingCount > 0 && remainingCount < 3) return penalty + 3;
    if (count === 2 && remainingCount === 1) return penalty + 1;
    return penalty;
  }, 0);
  const wildcardConsumptionPenalty =
    removed.filter((card) => card.rank === input.view.levelRank && card.suit === "hearts").length *
    3;
  const nearestOpponent = Object.values(input.view.remainingCardCounts)
    .filter((count) => count > 0)
    .sort((left, right) => left - right)[0];
  const publicThreatPenalty =
    nearestOpponent !== undefined && nearestOpponent <= 3 && removed.length > 0 ? 1 : 0;
  return {
    total:
      lowSinglePenalty +
      controlExhaustionPenalty +
      structureBreakPenalty +
      wildcardConsumptionPenalty +
      publicThreatPenalty,
    lowSinglePenalty,
    controlExhaustionPenalty,
    structureBreakPenalty,
    wildcardConsumptionPenalty,
    publicThreatPenalty
  };
}
