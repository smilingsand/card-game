import type { TurnAction } from "../turns";
import type { HandPlan } from "./hand-plan-generator";
import type { HandStructureAnalysis, HandStructureGroup } from "./hand-structure-analyzer";

export interface RankLegalCandidatesInput {
  /** 必须是规则引擎已经裁决过的完整合法动作集合；本函数绝不删减它。 */
  readonly legalActions: readonly TurnAction[];
  readonly structure: HandStructureAnalysis;
  readonly handPlans: readonly HandPlan[];
}

/**
 * Immutable decoration of one complete A-layer candidate.  It exists so a
 * sort never repeatedly rebuilds the same card-set key and priority tuple.
 * `originalIndex` deliberately remains the final stable tie-break for two
 * otherwise indistinguishable rule-layer interpretations.
 */
export interface RankedExpertCandidateEntry {
  readonly action: TurnAction;
  readonly originalIndex: number;
  readonly actionKey: string;
  readonly priority: readonly number[];
}

const sourceWeight: Readonly<Record<HandStructureGroup["source"], number>> = {
  natural: 3,
  wildcard_completed: 2,
  split_from_existing_group: 1
};
const kindWeight: Readonly<Record<HandStructureGroup["kind"], number>> = {
  "four-jokers": 10,
  "straight-flush": 9,
  "normal-bomb": 8,
  "steel-plate": 7,
  "three-consecutive-pairs": 6,
  "three-with-pair": 5,
  straight: 4,
  triple: 3,
  pair: 2,
  single: 1
};

const cardSetKey = (cardIds: readonly string[]) => [...cardIds].sort().join(",");
const groupKey = (group: HandStructureGroup) => cardSetKey(group.cardIds);
export const expertCandidateActionKey = (action: TurnAction) =>
  action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${cardSetKey(action.cardIds)}`;

/**
 * 高质量排序仅重排规则层提供的合法动作。它不会按预算截断，也不会构造新动作。
 */
/**
 * Exact, inexpensive ranking tuple used before any successor analysis.  It is
 * intentionally exported so FollowUpPlanner can record a proof that candidates
 * below its configured boundary cannot enter the configured Top-N.
 */
export function expertCandidatePriority(
  action: TurnAction,
  structure: HandStructureAnalysis,
  handPlans: readonly HandPlan[]
): readonly number[] {
  const planGroupKeys = new Set(handPlans.flatMap((plan) => plan.groups.map(groupKey)));
  const groupsByKey = new Map(structure.groups.map((group) => [groupKey(group), group]));
  if (action.type === "pass") return [0, 0, 0, 0];
  const group = groupsByKey.get(cardSetKey(action.cardIds));
  return [
    planGroupKeys.has(cardSetKey(action.cardIds)) ? 1 : 0,
    group ? sourceWeight[group.source] : 0,
    group ? kindWeight[group.kind] : 0,
    action.cardIds.length
  ];
}

/** Negative means left is ranked before right.  The action key is the final
 * deterministic tie-break, so this comparison is a complete order. */
export function compareExpertCandidates(
  left: TurnAction,
  right: TurnAction,
  structure: HandStructureAnalysis,
  handPlans: readonly HandPlan[]
): number {
  const leftScore = expertCandidatePriority(left, structure, handPlans);
  const rightScore = expertCandidatePriority(right, structure, handPlans);
  for (let index = 0; index < leftScore.length; index += 1) {
    const difference = rightScore[index] - leftScore[index];
    if (difference) return difference;
  }
  return expertCandidateActionKey(left).localeCompare(expertCandidateActionKey(right));
}

export function rankExpertCandidates(input: RankLegalCandidatesInput): readonly TurnAction[] {
  return rankExpertCandidateEntries(input).map((entry) => entry.action);
}

/**
 * Exact decorated ordering used by FollowUpPlanner.  The computed tuple is
 * identical to `expertCandidatePriority`; precomputing it only changes the
 * number of allocations and never the complete A-layer membership, order or
 * stable tie-break.
 */
export function rankExpertCandidateEntries(
  input: RankLegalCandidatesInput
): readonly RankedExpertCandidateEntry[] {
  const planGroupKeys = new Set(input.handPlans.flatMap((plan) => plan.groups.map(groupKey)));
  const groupsByKey = new Map(input.structure.groups.map((group) => [groupKey(group), group]));
  return input.legalActions
    .map((action, originalIndex) => {
      const actionKey = expertCandidateActionKey(action);
      if (action.type === "pass")
        return { action, originalIndex, actionKey, priority: [0, 0, 0, 0] };
      const cardIdsKey = cardSetKey(action.cardIds);
      const group = groupsByKey.get(cardIdsKey);
      return {
        action,
        originalIndex,
        actionKey,
        priority: [
          planGroupKeys.has(cardIdsKey) ? 1 : 0,
          group ? sourceWeight[group.source] : 0,
          group ? kindWeight[group.kind] : 0,
          action.cardIds.length
        ]
      };
    })
    .sort((left, right) => {
      for (let priorityIndex = 0; priorityIndex < left.priority.length; priorityIndex += 1) {
        const difference = right.priority[priorityIndex] - left.priority[priorityIndex];
        if (difference) return difference;
      }
      return (
        left.actionKey.localeCompare(right.actionKey) || left.originalIndex - right.originalIndex
      );
    });
}
