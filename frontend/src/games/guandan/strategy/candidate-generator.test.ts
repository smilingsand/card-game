import { expect, test } from "vitest";
import type { Seat } from "../../../platform/types";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import type { TurnState } from "../turns";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import { generateHandPlans } from "./hand-plan-generator";
import { rankExpertCandidates } from "./candidate-generator";

const budget = { handPlanTopN: { default: 8, max: 16 } } as const;
const seats: readonly Seat[] = ["east", "south", "west", "north"];

function fixture(id: "S47" | "S48") {
  const value = EXPERT_SCENARIOS.find((item) => item.id === id);
  if (!value) throw new Error(`missing ${id}`);
  return value;
}

function leadState(cardIds: readonly string[]): TurnState {
  return {
    hands: Object.fromEntries(
      seats.map((seat) => [seat, seat === "east" ? cardIds : []])
    ) as TurnState["hands"],
    current: "east",
    leader: "east",
    passes: 0,
    finished: []
  };
}

test("S47/S48 的领出候选覆盖指定复杂牌型、经规则验证且无重复实体组合", () => {
  for (const id of ["S47", "S48"] as const) {
    const value = fixture(id);
    const candidates = getCompleteLegalCandidates({
      state: leadState(value.selfHand.map(({ id: cardId }) => cardId)),
      selfHand: value.selfHand,
      levelRank: value.levelRank
    });

    const plays = candidates.filter(
      (action): action is Extract<(typeof candidates)[number], { readonly type: "play" }> =>
        action.type === "play"
    );
    expect(plays.map((action) => action.interpretation.type)).toEqual(
      expect.arrayContaining(
        value.candidateExpectations.map(({ pattern }) =>
          pattern === "joker-bomb" ? "four-jokers" : pattern
        )
      )
    );
    if (id === "S47")
      expect(new Set(plays.map((action) => action.cardIds.slice().sort().join(","))).size).toBe(
        plays.length
      );
    expect(candidates).toEqual(
      getCompleteLegalCandidates({
        state: leadState(value.selfHand.map(({ id: cardId }) => cardId)),
        selfHand: value.selfHand,
        levelRank: value.levelRank
      })
    );
  }
});

test("跟牌候选只保留统一规则引擎已裁决的动作，且排序不修改输入", () => {
  const value = fixture("S47");
  const structure = analyzeHandStructure(value.selfHand, value.levelRank);
  const plans = generateHandPlans({ structure, performanceBudget: budget });
  const target = getCompleteLegalCandidates({
    state: leadState(value.selfHand.map(({ id: cardId }) => cardId)),
    selfHand: value.selfHand,
    levelRank: value.levelRank
  }).find(
    (action) => action.type === "play" && action.interpretation.type === "three-consecutive-pairs"
  );
  if (!target || target.type !== "play") throw new Error("missing target");
  const state: TurnState = {
    ...leadState(value.selfHand.map(({ id: cardId }) => cardId)),
    highest: { ...target.interpretation, comparisonKey: [4] },
    highestSeat: "south"
  };
  const before = structuredClone(value.selfHand);
  const candidates = getCompleteLegalCandidates({
    state,
    selfHand: value.selfHand,
    levelRank: value.levelRank
  });
  const ranked = rankExpertCandidates({ legalActions: candidates, structure, handPlans: plans });

  expect(candidates).toEqual(expect.arrayContaining([{ type: "pass", actor: "east" }]));
  expect(ranked).toEqual(
    rankExpertCandidates({ legalActions: candidates, structure, handPlans: plans })
  );
  expect(value.selfHand).toEqual(before);
});

test("完整规则集合不会被 HandPlan 裁剪，专家排序只重排不丢动作", () => {
  const value = fixture("S47");
  const structure = analyzeHandStructure(value.selfHand, value.levelRank);
  const plans = generateHandPlans({ structure, performanceBudget: budget });
  const legalActions = getCompleteLegalCandidates({
    state: leadState(value.selfHand.map(({ id: cardId }) => cardId)),
    selfHand: value.selfHand,
    levelRank: value.levelRank
  });
  const planSets = new Set(
    plans.flatMap((plan) => plan.groups.map((group) => group.cardIds.slice().sort().join(",")))
  );
  const ranked = rankExpertCandidates({ legalActions, structure, handPlans: plans });

  expect(
    legalActions.some(
      (action) => action.type === "play" && !planSets.has(action.cardIds.slice().sort().join(","))
    )
  ).toBe(true);
  expect(ranked).toHaveLength(legalActions.length);
  expect(ranked.map((action) => JSON.stringify(action)).sort()).toEqual(
    legalActions.map((action) => JSON.stringify(action)).sort()
  );
});
