import { expect, test } from "vitest";
import type { Seat } from "../../../platform/types";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import type { TurnState } from "../turns";
import { planFollowUp } from "./follow-up-planner";
import type { SituationAnalysis } from "./situation-analyzer";

const seats: readonly Seat[] = ["east", "south", "west", "north"];
const planBudget = { handPlanTopN: { default: 8, max: 16 } } as const;
const followUpBudget = { followUpCandidateCount: { default: 10, max: 16 } } as const;

function fixture(id: "S39" | "S42") {
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

const situation = { phase: "middle" } as SituationAnalysis;

test("S39：仅从规则引擎已验证的领出候选中稳定选择顺子路线，并报告实体牌、手数变化与控制保持", () => {
  const value = fixture("S39");
  const remainingHand = value.selfHand.slice(1);
  const legalLeadActions = getCompleteLegalCandidates({
    state: leadState(remainingHand.map((card) => card.id)),
    selfHand: remainingHand,
    levelRank: value.levelRank
  });
  const result = planFollowUp({
    action: {
      type: "play",
      actor: "east",
      cardIds: [value.selfHand[0].id],
      interpretation: undefined as never
    },
    postAction: { remainingHand } as never,
    situation,
    legalLeadActions,
    levelRank: value.levelRank,
    handPlanPerformanceBudget: planBudget,
    performanceBudget: followUpBudget
  });

  expect(result).toMatchObject({
    noUsefulFollowUp: false,
    nextLead: { pattern: "straight", cardIds: expect.any(Array) },
    retainsControlPotential: true,
    createsRunoutPath: true
  });
  expect(result.estimatedTurnsDelta).toBeLessThanOrEqual(0);
  expect(legalLeadActions).toContainEqual(result.nextLeadAction);
  expect(result.candidateSelection.boundProven).toBe(true);
  expect(result.candidateSelection.evaluatedCandidateCount).toBe(result.evaluatedCandidateCount);
  expect(result.candidateSelection.eligibleCandidateCount).toBeGreaterThanOrEqual(
    result.evaluatedCandidateCount
  );
  expect(result).toEqual(
    planFollowUp({
      action: {
        type: "play",
        actor: "east",
        cardIds: [value.selfHand[0].id],
        interpretation: undefined as never
      },
      postAction: { remainingHand } as never,
      situation,
      legalLeadActions: [...legalLeadActions].reverse(),
      levelRank: value.levelRank,
      handPlanPerformanceBudget: planBudget,
      performanceBudget: followUpBudget
    })
  );
});

test("FollowUp 仅在精确排序边界证明后省略 Top-N 之外的后继分析", () => {
  const value = fixture("S39");
  const legalLeadActions = getCompleteLegalCandidates({
    state: leadState(value.selfHand.map((card) => card.id)),
    selfHand: value.selfHand,
    levelRank: value.levelRank
  });
  const result = planFollowUp({
    action: { type: "pass", actor: "east" },
    postAction: { remainingHand: value.selfHand } as never,
    situation,
    legalLeadActions,
    levelRank: value.levelRank,
    handPlanPerformanceBudget: planBudget,
    performanceBudget: { followUpCandidateCount: { default: 1, max: 16 } }
  });

  expect(result.candidateSelection).toMatchObject({
    boundProven: true,
    reason: "exact_top_n_boundary",
    evaluatedCandidateCount: 1,
    skippedCandidateCount: expect.any(Number),
    cutoffActionKey: expect.any(String),
    strongestSkippedActionKey: expect.any(String),
    selectedLowerBound: expect.any(Array),
    skippedUpperBound: expect.any(Array)
  });
  expect(result.candidateSelection.skippedCandidateCount).toBeGreaterThan(0);
});

test("same normalized successor hand reuses exact internal FollowUp analysis", () => {
  const value = fixture("S39");
  const remainingHand = value.selfHand.slice(1);
  const legalLeadActions = getCompleteLegalCandidates({
    state: leadState(remainingHand.map((card) => card.id)),
    selfHand: remainingHand,
    levelRank: value.levelRank
  });
  const values = new Map<string, never>();
  let hits = 0;
  let writes = 0;
  const successorAnalysisCache = {
    get(key: string) {
      const cached = values.get(key);
      if (cached) hits += 1;
      return cached;
    },
    set(key: string, cached: never) {
      writes += 1;
      values.set(key, cached);
    }
  };
  const input = {
    action: { type: "pass", actor: "east" } as const,
    postAction: { remainingHand } as never,
    situation,
    legalLeadActions,
    levelRank: value.levelRank,
    handPlanPerformanceBudget: planBudget,
    performanceBudget: followUpBudget,
    successorAnalysisCache
  };
  const cold = planFollowUp(input);
  const warm = planFollowUp(input);

  expect(warm).toEqual(cold);
  expect(writes).toBeGreaterThan(0);
  expect(hits).toBeGreaterThan(0);
});

test("公开局面变化不复用完整 FollowUp 结果；缓存只复用纯后继手牌分析", () => {
  const value = fixture("S39");
  const remainingHand = value.selfHand.slice(1);
  const legalLeadActions = getCompleteLegalCandidates({
    state: leadState(remainingHand.map((card) => card.id)),
    selfHand: remainingHand,
    levelRank: value.levelRank
  });
  const values = new Map<string, never>();
  let hits = 0;
  const successorAnalysisCache = {
    get(key: string) {
      const cached = values.get(key);
      if (cached) hits += 1;
      return cached;
    },
    set(key: string, cached: never) {
      values.set(key, cached);
    }
  };
  const common = {
    action: { type: "pass", actor: "east" } as const,
    postAction: { remainingHand } as never,
    legalLeadActions,
    levelRank: value.levelRank,
    handPlanPerformanceBudget: planBudget,
    performanceBudget: followUpBudget,
    successorAnalysisCache
  };
  const middle = planFollowUp({ ...common, situation });
  const endgame = planFollowUp({ ...common, situation: { phase: "endgame" } as SituationAnalysis });

  expect(hits).toBeGreaterThan(0);
  expect(middle.phase).toBe("middle");
  expect(endgame.phase).toBe("endgame");
  expect(endgame).not.toEqual(middle);
});

test("S42：没有可用合法领出时明确降级为 noUsefulFollowUp；pass 或未验证动作不会被用作下一手", () => {
  const value = fixture("S42");
  const unknown = {
    type: "play",
    actor: "east",
    cardIds: ["not-in-hand"],
    interpretation: undefined
  } as never;
  const result = planFollowUp({
    action: { type: "pass", actor: "east" },
    postAction: { remainingHand: value.selfHand } as never,
    situation,
    legalLeadActions: [{ type: "pass", actor: "east" }, unknown],
    levelRank: value.levelRank,
    handPlanPerformanceBudget: planBudget,
    performanceBudget: followUpBudget
  });

  expect(result).toMatchObject({ noUsefulFollowUp: true, nextLeadAction: null, nextLead: null });
  expect(result.evaluatedCandidateCount).toBe(0);
});

test("FollowUp 预算必须是版本化有效配置，稳定排序后才截断", () => {
  const value = fixture("S39");
  expect(() =>
    planFollowUp({
      action: { type: "pass", actor: "east" },
      postAction: { remainingHand: value.selfHand } as never,
      situation,
      legalLeadActions: [],
      levelRank: value.levelRank,
      handPlanPerformanceBudget: planBudget,
      performanceBudget: { followUpCandidateCount: { default: 17, max: 16 } }
    })
  ).toThrow(/FollowUp/);
});
