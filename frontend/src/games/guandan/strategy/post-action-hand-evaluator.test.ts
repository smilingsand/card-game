import { expect, test } from "vitest";
import type { Seat } from "../../../platform/types";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import type { TurnAction, TurnState } from "../turns";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import { generateHandPlans } from "./hand-plan-generator";
import { evaluatePostActionHand } from "./post-action-hand-evaluator";

const planBudget = { handPlanTopN: { default: 8, max: 16 } } as const;
const postActionBudget = { postActionReplanCount: { default: 5, max: 8 } } as const;
const seats: readonly Seat[] = ["east", "south", "west", "north"];

function fixture(id: string) {
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

function legalPlay(
  id: string,
  indexes: readonly number[]
): Extract<TurnAction, { readonly type: "play" }> {
  const value = fixture(id);
  const wanted = indexes
    .map((index) => value.selfHand[index].id)
    .sort()
    .join(",");
  const action = getCompleteLegalCandidates({
    state: leadState(value.selfHand.map((card) => card.id)),
    selfHand: value.selfHand,
    levelRank: value.levelRank
  }).find(
    (candidate) =>
      candidate.type === "play" && candidate.cardIds.slice().sort().join(",") === wanted
  );
  if (!action || action.type !== "play") throw new Error(`missing legal action ${id}`);
  return action;
}

function evaluate(id: string, action: TurnAction) {
  const value = fixture(id);
  const structure = analyzeHandStructure(value.selfHand, value.levelRank);
  return evaluatePostActionHand({
    action,
    selfHand: value.selfHand,
    levelRank: value.levelRank,
    structure,
    handPlans: generateHandPlans({ structure, performanceBudget: planBudget }),
    performanceBudget: postActionBudget,
    handPlanPerformanceBudget: planBudget
  });
}

test("S01/S03/S11/S18/S21/S39：动作后重组保留前后质量、拆组类别与确定性", () => {
  for (const [id, indexes] of [
    ["S01", [0, 1]],
    ["S03", [0, 1, 2, 3]],
    ["S11", [0]],
    ["S18", [5]],
    ["S21", [0]],
    ["S39", [0]]
  ] as const) {
    const action = legalPlay(id, indexes);
    const first = evaluate(id, action);
    const second = evaluate(id, action);
    expect(first).toEqual(second);
    expect(first.before).toMatchObject({
      estimatedTurns: expect.any(Number),
      deadHandRisk: expect.any(Number)
    });
    expect(first.after).toMatchObject({
      estimatedTurns: expect.any(Number),
      finishability: expect.any(Number)
    });
  }

  const splitBomb = evaluate("S11", legalPlay("S11", [0]));
  expect(splitBomb.destroyedGroups).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "normal-bomb", severity: "severe" })])
  );
  expect(splitBomb.delta.structuralIntegrity).toBeLessThan(0);

  const wildcardBomb = evaluate("S03", legalPlay("S03", [4, 5, 6, 7]));
  expect(wildcardBomb.lowValueWildcardUse).toBe(true);
});

test("play 精确移除实体牌；pass 不移牌且清楚表达中性语义；输入保持不变", () => {
  const value = fixture("S18");
  const before = structuredClone(value.selfHand);
  const play = evaluate("S18", legalPlay("S18", [5]));
  expect(play.remainingHand.map((card) => card.id)).not.toContain(value.selfHand[5].id);
  expect(play.remainingHand).toHaveLength(value.selfHand.length - 1);
  expect(value.selfHand).toEqual(before);

  const pass = evaluate("S21", { type: "pass", actor: "east" });
  expect(pass.semantics).toBe("pass_keeps_hand");
  expect(pass.remainingHand).toEqual(fixture("S21").selfHand);
  expect(pass.delta).toEqual({
    estimatedTurns: 0,
    structuralIntegrity: 0,
    finishability: 0,
    deadHandRisk: 0,
    lowSingleCount: 0,
    weakPairCount: 0,
    controlCount: 0,
    recoveryCount: 0
  });
});

test("拒绝不属于手牌、重复实体牌和非法性能预算；尾局例外只记录，不自行放行", () => {
  const valid = legalPlay("S11", [0]);
  expect(() => evaluate("S11", { ...valid, cardIds: ["missing-card"] })).toThrow(/不属于己方手牌/);
  expect(() =>
    evaluate("S11", { ...valid, cardIds: [valid.cardIds[0], valid.cardIds[0]] })
  ).toThrow(/重复/);
  expect(() =>
    evaluatePostActionHand({
      action: valid,
      selfHand: fixture("S11").selfHand,
      levelRank: "2",
      performanceBudget: { postActionReplanCount: { default: 9, max: 8 } },
      handPlanPerformanceBudget: planBudget
    })
  ).toThrow(/性能预算/);

  const s12 = fixture("S12");
  const endgameAction = legalPlay("S12", [0]);
  const endgameStructure = analyzeHandStructure(s12.selfHand, s12.levelRank);
  const endgame = evaluatePostActionHand({
    action: endgameAction,
    selfHand: s12.selfHand,
    levelRank: s12.levelRank,
    structure: endgameStructure,
    handPlans: generateHandPlans({ structure: endgameStructure, performanceBudget: planBudget }),
    performanceBudget: postActionBudget,
    handPlanPerformanceBudget: planBudget,
    exceptionContext: "endgame_block"
  });
  expect(endgame.acceptableExceptions).toEqual(
    expect.arrayContaining(["endgame_exception_requires_external_context"])
  );
});

test("完整候选 A 层的复杂动作可评估", () => {
  const value = fixture("S47");
  const action = getCompleteLegalCandidates({
    state: leadState(value.selfHand.map((card) => card.id)),
    selfHand: value.selfHand,
    levelRank: value.levelRank
  }).find(
    (candidate) => candidate.type === "play" && candidate.interpretation.type === "steel-plate"
  );
  if (!action) throw new Error("missing steel-plate");
  expect(evaluate("S47", action).remainingHand).toHaveLength(value.selfHand.length - 6);
});
