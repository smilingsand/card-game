import type { TurnAction } from "../turns";
import type { HandPlan } from "./hand-plan-generator";
import type { HandStructureAnalysis, HandStructureGroup } from "./hand-structure-analyzer";

export interface RankLegalCandidatesInput {
  /** 必须是规则引擎已经裁决过的完整合法动作集合；本函数绝不删减它。 */
  readonly legalActions: readonly TurnAction[];
  readonly structure: HandStructureAnalysis;
  readonly handPlans: readonly HandPlan[];
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
const actionKey = (action: TurnAction) =>
  action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${cardSetKey(action.cardIds)}`;

/**
 * 高质量排序仅重排规则层提供的合法动作。它不会按预算截断，也不会构造新动作。
 */
export function rankExpertCandidates(input: RankLegalCandidatesInput): readonly TurnAction[] {
  const planGroupKeys = new Set(input.handPlans.flatMap((plan) => plan.groups.map(groupKey)));
  const groupsByKey = new Map(input.structure.groups.map((group) => [groupKey(group), group]));
  return input.legalActions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const score = ({ action }: { readonly action: TurnAction }): readonly number[] => {
        if (action.type === "pass") return [0, 0, 0, 0];
        const group = groupsByKey.get(cardSetKey(action.cardIds));
        return [
          planGroupKeys.has(cardSetKey(action.cardIds)) ? 1 : 0,
          group ? sourceWeight[group.source] : 0,
          group ? kindWeight[group.kind] : 0,
          action.cardIds.length
        ];
      };
      const leftScore = score(left);
      const rightScore = score(right);
      for (let index = 0; index < leftScore.length; index += 1) {
        const difference = rightScore[index] - leftScore[index];
        if (difference) return difference;
      }
      return (
        actionKey(left.action).localeCompare(actionKey(right.action)) || left.index - right.index
      );
    })
    .map(({ action }) => action);
}
