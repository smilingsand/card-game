import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import { createBotView } from "../bot-view";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import { createInitialSimulationBotView } from "../simulation";
import type { TurnState } from "../turns";
import { createDefaultStrategyProfile } from "./decision-explanation";
import {
  EXPERIMENTAL_DECISION_BUDGET,
  EXPERT_DECISION_BUDGET,
  createExperimentalFullBenchmarkBudget,
  chooseExpertBotDecision
} from "./expert-decision";
import { compareExpertDepthQuality } from "./expert-depth-quality";

const hand: readonly Card[] = ["3", "4", "5", "6", "7"].map((rank, index) => ({
  id: `quality-${rank}`,
  deckIndex: index,
  rank: rank as Card["rank"],
  suit: "spades"
}));
const state: TurnState = {
  hands: { east: [], south: hand.map((card) => card.id), west: [], north: [] },
  current: "south",
  leader: "south",
  passes: 0,
  finished: []
};
const view = createBotView({
  selfSeat: "south",
  leader: "south",
  levelRank: "2",
  hand,
  publicEvents: [],
  remainingCardCounts: { east: 10, south: 5, west: 10, north: 10 },
  legalActions: getCompleteLegalCandidates({ state, selfHand: hand, levelRank: "2" })
});

test("ADR-0021 冻结 expert 24/32、experimental 32/32，full 仅由显式对照预算取得", () => {
  expect(EXPERT_DECISION_BUDGET).toMatchObject({
    postActionCandidateCount: { default: 24, max: 32 },
    followUpCandidateCount: { default: 24, max: 32 }
  });
  expect(EXPERIMENTAL_DECISION_BUDGET).toMatchObject({
    postActionCandidateCount: { default: 32, max: 32 },
    followUpCandidateCount: { default: 32, max: 32 }
  });
  const full = createExperimentalFullBenchmarkBudget(view.legalActions.length);
  expect(full.postActionCandidateCount).toEqual({
    default: view.legalActions.length,
    max: view.legalActions.length
  });
});

test("质量差异报告保留差异局面及全部九项专家指标，绝不静默接受", () => {
  const profile = createDefaultStrategyProfile("expert");
  const expert = chooseExpertBotDecision({
    view,
    profile,
    performanceBudget: EXPERT_DECISION_BUDGET
  });
  const experimentalFull = chooseExpertBotDecision({
    view,
    profile,
    performanceBudget: createExperimentalFullBenchmarkBudget(view.legalActions.length)
  });
  const report = compareExpertDepthQuality([
    { id: "fixed-five-card", seed: 0, actionIndex: 0, expert, experimentalFull }
  ]);
  expect(report.totalCaseCount).toBe(1);
  expect(report.actionDifferenceRate).toBeGreaterThanOrEqual(0);
  expect(Object.keys(report.metrics)).toHaveLength(9);
  expect(report.differences).toHaveLength(report.actionDifferenceCount);
  if (report.actionDifferenceCount > 0) {
    expect(report.requiresQualityReview).toBe(true);
    expect(report.differences[0]).toMatchObject({ id: "fixed-five-card", seed: 0 });
  }
});

test.runIf(process.env.P25_FULL_QUALITY === "1")(
  "seed=0：expert 深度 24 与 experimental-full 的动作差异和九项指标均被完整记录",
  () => {
    const seed = 0;
    const seedView = createInitialSimulationBotView(seed);
    const profile = createDefaultStrategyProfile("expert");
    const expert = chooseExpertBotDecision({
      view: seedView,
      profile,
      performanceBudget: EXPERT_DECISION_BUDGET
    });
    const experimentalFull = chooseExpertBotDecision({
      view: seedView,
      profile,
      performanceBudget: createExperimentalFullBenchmarkBudget(seedView.legalActions.length)
    });
    const report = compareExpertDepthQuality([
      { id: "seed-0-initial", seed, actionIndex: 0, expert, experimentalFull }
    ]);
    console.info(JSON.stringify(report));
    expect(report.totalCaseCount).toBe(1);
    expect(Object.keys(report.metrics)).toHaveLength(9);
    expect(report.differences).toHaveLength(report.actionDifferenceCount);
  },
  0
);
