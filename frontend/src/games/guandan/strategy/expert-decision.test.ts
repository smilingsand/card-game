import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import { createBotView } from "../bot-view";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import type { TurnState } from "../turns";
import type { TurnAction } from "../turns";
import {
  chooseTableBotAction,
  chooseTableHintAction,
  chooseTableStrategicDecision,
  type TableGame
} from "../table-controller";
import { createDefaultStrategyProfile } from "./decision-explanation";
import {
  chooseExpertBotDecision,
  chooseExpertBotDecisionWithDirectFollowUpLeadLayerForDifferential,
  clearExpertDecisionCache,
  getExpertDecisionCacheStatistics
} from "./expert-decision";

test("expert 完整决策缓存只复用完全相同的公开输入，冷暖结果逐字段一致", () => {
  clearExpertDecisionCache();
  const input = { view: view(), profile: createDefaultStrategyProfile("expert") } as const;
  const cold = chooseExpertBotDecision(input);
  const afterCold = getExpertDecisionCacheStatistics();
  const warm = chooseExpertBotDecision(input);
  expect(warm).toEqual(cold);
  expect(getExpertDecisionCacheStatistics()).toMatchObject({
    hits: afterCold.hits + 1,
    misses: afterCold.misses,
    size: 1
  });

  chooseExpertBotDecision({
    ...input,
    view: {
      ...input.view,
      publicEvents: [{ sequence: 1, type: "turn", payload: { action: "changed" } }]
    }
  });
  expect(getExpertDecisionCacheStatistics().misses).toBe(afterCold.misses + 1);
});

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});

const selfHand = [
  card("s3", "3"),
  card("s4", "4"),
  card("s5", "5"),
  card("s6", "6"),
  card("s7", "7")
];
const state: TurnState = {
  hands: { east: [], south: selfHand.map((item) => item.id), west: [], north: [] },
  current: "south",
  leader: "south",
  passes: 0,
  finished: []
};
const view = () =>
  createBotView({
    selfSeat: "south",
    leader: "south",
    levelRank: "2",
    hand: selfHand,
    publicEvents: [],
    remainingCardCounts: { east: 10, south: 5, west: 10, north: 10 },
    legalActions: getCompleteLegalCandidates({ state, selfHand, levelRank: "2" })
  });

test("expert 入口完整执行、可复现且不接受 normal 回退", () => {
  const first = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  const second = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  expect(first).toEqual(second);
  expect(first.explanation.profile).toMatchObject({ id: "expert", version: "p2.5a-depth-24-v1" });
  expect(first.debug?.candidateCount).toBe(view().legalActions.length);
  expect(first.explanation.candidates.some((candidate) => candidate.matchedRules.length > 0)).toBe(
    true
  );
  expect(() =>
    chooseExpertBotDecision({ view: view(), profile: createDefaultStrategyProfile("normal") })
  ).toThrow(/normal/);
  expect(() =>
    chooseExpertBotDecision({
      view: { ...view(), legalActions: [] },
      profile: createDefaultStrategyProfile("expert")
    })
  ).toThrow(/完整合法动作/);
});

test("严格等价 alias 只执行一次物理动作后与 FollowUp 分析，并保留追溯解释", () => {
  const canonical: TurnAction = {
    type: "play",
    actor: "south",
    cardIds: ["s3"],
    interpretation: { type: "single", cardIds: ["s3"], comparisonKey: [3], wildcardAs: {} }
  };
  const alias: TurnAction = {
    ...canonical,
    interpretation: {
      ...canonical.interpretation,
      wildcardAs: { s3: { rank: "3", suit: "spades" } }
    }
  };
  const result = chooseExpertBotDecision({
    view: { ...view(), legalActions: [canonical, alias] },
    profile: createDefaultStrategyProfile("expert")
  });
  expect(result.explanation.candidates).toHaveLength(1);
  expect(result.explanation.candidates[0]).toMatchObject({
    equivalentInterpretationCount: 2,
    aliases: [alias]
  });
  expect(result.debug).toMatchObject({
    rawLegalInterpretationCount: 2,
    canonicalPhysicalActionCount: 1,
    semanticCandidateCount: 1,
    postActionExecutionCount: 1,
    followUpExecutionCount: 1
  });
});

test("同物理牌但不同公开比较语义不得共享完整 FollowUp", () => {
  clearExpertDecisionCache();
  const first: TurnAction = {
    type: "play",
    actor: "south",
    cardIds: ["s3"],
    interpretation: { type: "single", cardIds: ["s3"], comparisonKey: [3], wildcardAs: {} }
  };
  const second: TurnAction = {
    ...first,
    interpretation: { ...first.interpretation, comparisonKey: [4] }
  };
  const result = chooseExpertBotDecision({
    view: { ...view(), legalActions: [first, second] },
    profile: createDefaultStrategyProfile("expert")
  });

  expect(result.explanation.candidates).toHaveLength(2);
  expect(result.debug).toMatchObject({
    canonicalPhysicalActionCount: 1,
    semanticCandidateCount: 2,
    postActionExecutionCount: 1,
    followUpExecutionCount: 2
  });
});

test("experimental 与 expert 规则集隔离，且专家评分不是 normal 基线伪装", () => {
  const expert = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  const experimental = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("experimental")
  });
  expect(expert.explanation.candidates.some((candidate) => candidate.matchedRules.length > 0)).toBe(
    true
  );
  expect(
    experimental.explanation.candidates.every((candidate) => candidate.matchedRules.length === 0)
  ).toBe(true);
  expect(expert.explanation.candidates.some((candidate) => candidate.finalScore !== 0)).toBe(true);
});

test("只有完成 FollowUp 的候选具备最终选择资格，未入选者保留基础评分与可回放原因", () => {
  clearExpertDecisionCache();
  const result = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert"),
    performanceBudget: {
      handPlanTopN: { default: 4, max: 4 },
      postActionReplanCount: { default: 1, max: 1 },
      followUpCandidateCount: { default: 1, max: 1 }
    }
  });
  const completed = result.explanation.candidates.filter(
    (candidate) => candidate.followUpStatus === "completed"
  );
  const deferred = result.explanation.candidates.filter(
    (candidate) => candidate.followUpStatus === "not_evaluated"
  );
  expect(completed).toHaveLength(1);
  expect(deferred.length).toBeGreaterThan(0);
  expect(deferred.every((candidate) => typeof candidate.baseScore === "number")).toBe(true);
  expect(deferred.every((candidate) => candidate.followUpSelectionReason !== undefined)).toBe(true);
  expect(completed.some((candidate) => candidate.action === result.selectedAction)).toBe(true);
  expect(result.debug?.followUpExecutionCount).toBe(1);
});

test("ADR-0018：全部合法语义候选都有轻量阶段，只有深度入围者可最终胜出", () => {
  clearExpertDecisionCache();
  const result = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert"),
    performanceBudget: {
      handPlanTopN: { default: 4, max: 4 },
      postActionReplanCount: { default: 1, max: 1 },
      postActionCandidateCount: { default: 1, max: 1 },
      followUpCandidateCount: { default: 1, max: 1 }
    }
  });
  const screened = result.explanation.candidates.filter(
    (candidate) => candidate.postActionStatus === "not_evaluated"
  );
  expect(screened.length).toBeGreaterThan(0);
  expect(
    screened.every(
      (candidate) =>
        typeof candidate.lightBaseScore === "number" &&
        typeof candidate.candidateKey === "string" &&
        candidate.followUpStatus === "not_evaluated" &&
        candidate.notFinallyEligible === true &&
        candidate.screeningReason === "base_score_budget"
    )
  ).toBe(true);
  const selected = result.explanation.candidates.find(
    (candidate) => candidate.action === result.selectedAction
  );
  expect(selected).toMatchObject({ postActionStatus: "completed", followUpStatus: "completed" });
  expect(result.debug?.postActionExecutionCount).toBe(1);
});

test("牌桌 normal 保持 legacy，expert 的机器人与提示共用完整入口", () => {
  const game: TableGame = {
    cardsById: new Map(selfHand.map((item) => [item.id, item])),
    state,
    publicEvents: []
  };
  const normal = chooseTableStrategicDecision(game);
  const expert = chooseTableStrategicDecision(game, "expert");
  expect(normal?.explanation.profile.id).toBe("normal");
  expect(normal?.explanation.candidates).toHaveLength(1);
  expect(expert?.explanation.profile.id).toBe("expert");
  expect(expert?.explanation.candidates.length).toBe(view().legalActions.length);
  expect(chooseTableBotAction(game, "expert")).toEqual(expert?.selectedAction);
  expect(chooseTableHintAction(game, "expert")).toEqual(expert?.selectedAction);
});

function withoutElapsedDebug(decision: ReturnType<typeof chooseExpertBotDecision>) {
  const {
    moduleElapsedMilliseconds: _elapsed,
    followUpLeadCatalogueSource: _catalogueSource,
    followUpLeadProjectionCount: _projectionCount,
    followUpLeadFilteredActionCount: _filteredActionCount,
    ...debug
  } = decision.debug ?? {};
  void _elapsed;
  void _catalogueSource;
  void _projectionCount;
  void _filteredActionCount;
  return { ...decision, debug };
}

test("root lead catalogue is byte-for-byte equivalent to direct successor A layers", () => {
  const profile = createDefaultStrategyProfile("expert");
  const fixedInput = { view: view(), profile } as const;
  expect(withoutElapsedDebug(chooseExpertBotDecision(fixedInput))).toEqual(
    withoutElapsedDebug(
      chooseExpertBotDecisionWithDirectFollowUpLeadLayerForDifferential(fixedInput)
    )
  );
});
