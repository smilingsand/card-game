import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import { createBotView } from "../bot-view";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import { createInitialSimulationBotView } from "../simulation";
import type { TurnState } from "../turns";
import { createDefaultStrategyProfile } from "./decision-explanation";
import {
  assertExpertDecisionEquivalent,
  baselineExpertDecision,
  optimizedExpertDecision
} from "./expert-decision-differential";
import { EXPERIMENTAL_DECISION_BUDGET, EXPERT_DECISION_BUDGET } from "./expert-decision";

const card = (id: string, rank: Card["rank"]): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit: "spades"
});

function fixtureInput(seed = 0) {
  const ranks: Card["rank"][] = ["3", "4", "5", "6", "7", "8", "9"];
  const hand = Array.from({ length: 5 }, (_, index) =>
    card(`s${seed}-${index}`, ranks[(seed + index) % ranks.length])
  );
  const state: TurnState = {
    hands: { east: [], south: hand.map(({ id }) => id), west: [], north: [] },
    current: "south",
    leader: "south",
    passes: 0,
    finished: []
  };
  return {
    view: createBotView({
      selfSeat: "south",
      leader: "south",
      levelRank: "2",
      hand,
      publicEvents: [],
      remainingCardCounts: { east: 10, south: 5, west: 10, north: 10 },
      legalActions: getCompleteLegalCandidates({ state, selfHand: hand, levelRank: "2" })
    }),
    profile: createDefaultStrategyProfile("expert"),
    performanceBudget: EXPERT_DECISION_BUDGET
  } as const;
}

test("基线和优化器以同一个完整 BotView、profile 与预算逐字段等价", () => {
  const input = fixtureInput();
  const originalActions = input.view.legalActions;
  const { baseline, optimized } = assertExpertDecisionEquivalent(input);
  expect(baseline.mode).toBe("baseline-test-only");
  expect(baseline.fingerprint.legalActionKeys).toHaveLength(originalActions.length);
  expect(optimized.fingerprint.legalActionKeys).toEqual(baseline.fingerprint.legalActionKeys);
  expect(input.view.legalActions).toBe(originalActions);
  expect(optimized.fingerprint).toEqual(baseline.fingerprint);
});

test("随机固定失败 seed 使用完整候选集，且差分包含 full score 与完整解释", () => {
  for (const seed of [1, 3, 7, 11]) {
    const input = fixtureInput(seed);
    const { baseline, optimized } = assertExpertDecisionEquivalent(input);
    expect(baseline.fingerprint.candidates).toEqual(optimized.fingerprint.candidates);
    expect(baseline.fingerprint.selectedAction).toBe(optimized.fingerprint.selectedAction);
  }
});

test("experimental 与 expert 使用各自版本配置但均可与完整基线重放", () => {
  const expert = fixtureInput(5);
  const experimental = {
    ...expert,
    profile: createDefaultStrategyProfile("experimental"),
    performanceBudget: EXPERIMENTAL_DECISION_BUDGET
  } as const;
  expect(assertExpertDecisionEquivalent(expert).optimized.fingerprint.profile.id).toBe("expert");
  expect(assertExpertDecisionEquivalent(experimental).optimized.fingerprint.profile.id).toBe(
    "experimental"
  );
});

test.runIf(process.env.P25_FULL_DIFFERENTIAL === "1")(
  "seed=0 完整 BotView 差分：合法集合、候选、评分、规则、解释和最终动作均一致",
  () => {
    const input = {
      view: createInitialSimulationBotView(0),
      profile: createDefaultStrategyProfile("expert"),
      performanceBudget: EXPERT_DECISION_BUDGET
    } as const;
    const { baseline, optimized } = assertExpertDecisionEquivalent(input);
    console.info(
      JSON.stringify({
        legalActionCount: input.view.legalActions.length,
        baselineMilliseconds: baseline.elapsedMilliseconds,
        optimizedMilliseconds: optimized.elapsedMilliseconds,
        selectedAction: optimized.decision.selectedAction
      })
    );
  },
  0
);

test("baseline 是测试专用，不能被正常 profile 或生产入口代替", () => {
  const input = fixtureInput(2);
  const baseline = baselineExpertDecision(input);
  const optimized = optimizedExpertDecision(input);
  expect(baseline.mode).toBe("baseline-test-only");
  expect(optimized.mode).toBe("optimized-production");
  expect(baseline.decision.explanation.profile.id).toBe("expert");
});
