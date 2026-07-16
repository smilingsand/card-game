import { expect, test } from "vitest";
import type { TurnAction } from "../turns";
import { scoreAction } from "./action-scorer";
import {
  createDefaultStrategyProfile,
  createDecision,
  type DecisionCandidateInput
} from "./decision-explanation";
import type { StrategyFeatureSnapshot } from "./expert-strategy-knowledge-base";

const play = (id: string): TurnAction =>
  ({ type: "play", actor: "east", cardIds: [id], interpretation: { type: "single" } }) as never;
const pass: TurnAction = { type: "pass", actor: "east" };

const features = (action: TurnAction, deadHandRisk = 0): StrategyFeatureSnapshot => ({
  actionType: action.type,
  cardsPlayed: action.type === "play" ? action.cardIds.length : 0,
  isPass: action.type === "pass",
  blocksOpponent: false,
  helpsPartner: false,
  postAction: {
    delta: {
      estimatedTurns: -1,
      structuralIntegrity: 2,
      finishability: 1,
      deadHandRisk,
      lowSingleCount: 1,
      weakPairCount: 0,
      controlCount: 1,
      recoveryCount: 1
    },
    lowValueWildcardUse: false
  },
  control: {
    spendsLastControlResource: false,
    preservesRecoveryPoint: true,
    opportunityCost: { score: 0, reasons: ["保留回收点"] },
    exception: null
  },
  followUp: { noUsefulFollowUp: false, createsRunoutPath: true, retainsControlPotential: true },
  contest: { contestValue: 2, shouldContest: true },
  phase: "middle",
  signals: {}
});

const candidate = (action: TurnAction, risk = 0): DecisionCandidateInput => ({
  score: scoreAction({
    action,
    features: features(action, risk),
    adjustments: [
      {
        ruleId: "P25-R12",
        score: 3,
        kind: "bonus",
        reason: "减少低散单",
        evidence: "expert_source",
        maturity: "default_eligible"
      }
    ]
  }),
  features: features(action, risk)
});

test("解释完整派生候选、分项、规则证据、动作后/控制/死手风险和后续路线", () => {
  const bid = play("bid");
  const decision = createDecision({
    legalActions: [bid, pass],
    candidates: [candidate(bid, -2), candidate(pass)],
    profile: createDefaultStrategyProfile("expert")
  });

  expect(decision.selectedAction).toBe(pass);
  expect(decision.explanation.candidates).toHaveLength(2);
  expect(decision.explanation.candidates[0]).toMatchObject({
    components: expect.any(Object),
    matchedRules: [
      expect.objectContaining({
        ruleId: "P25-R12",
        evidence: "expert_source",
        maturity: "default_eligible"
      })
    ],
    postAction: { deadHandRisk: -2 },
    control: { preservesRecoveryPoint: true },
    followUp: { createsRunoutPath: true }
  });
  expect(decision.explanation.finalReason).not.toHaveLength(0);
});

test("normal/expert/experimental profile 彼此隔离且均带稳定版本", () => {
  const normal = createDefaultStrategyProfile("normal");
  const expert = createDefaultStrategyProfile("expert");
  const experimental = createDefaultStrategyProfile("experimental");
  expect(normal.version).not.toBe("");
  expect(expert.version).not.toBe("");
  expect(experimental.version).not.toBe("");
  expect(normal.enabledRuleIds).toEqual([]);
  expect(expert.enabledRuleIds.length).toBeGreaterThan(0);
  expect(experimental.enabledRuleIds).toEqual([]);
});

test("调试详情开关只影响诊断载荷，不改变候选排序、解释或选择", () => {
  const bid = play("bid");
  const input = {
    legalActions: [bid, pass],
    candidates: [candidate(bid), candidate(pass)],
    profile: createDefaultStrategyProfile("expert")
  } as const;
  const withoutDebug = createDecision(input);
  const withDebug = createDecision({ ...input, includeDebugDetails: true });
  expect(withDebug.selectedAction).toBe(withoutDebug.selectedAction);
  expect(withDebug.explanation).toEqual(withoutDebug.explanation);
  expect(withoutDebug.debug).toBeUndefined();
  expect(withDebug.debug?.candidateCount).toBe(2);
});

test("解释是瞬时派生值，不包含 TurnState、事件、快照或存档字段", () => {
  const bid = play("bid");
  const decision = createDecision({
    legalActions: [bid],
    candidates: [candidate(bid)],
    profile: createDefaultStrategyProfile("normal")
  });
  const serialized = JSON.stringify(decision.explanation);
  expect(serialized).not.toMatch(/TurnState|publicEvents|snapshot|save|hands/i);
});
