import { expect, test } from "vitest";
import { collectExpertMetrics } from "./simulation-metrics";
import type { SimulationDecisionSample } from "../simulation";

const action = {
  type: "play" as const,
  actor: "east" as const,
  cardIds: ["c1"],
  interpretation: {
    type: "single" as const,
    mainRank: "3" as const,
    strength: 1,
    cardIds: ["c1"],
    wildcardAs: {},
    comparisonKey: [1]
  }
};
const sample: SimulationDecisionSample = {
  seed: 7,
  actionIndex: 2,
  action,
  publicEventSequence: 2,
  decisionMs: 1,
  legalActionCount: 2,
  profile: "expert",
  explanation: {
    profile: { id: "expert", version: "v", rulesVersion: "r", weightsVersion: "w" },
    finalReason: [],
    candidates: [
      {
        action,
        finalScore: 1,
        components: {
          immediatePlayValue: 0,
          postActionStructureValue: 0,
          finishabilityValue: 0,
          contestValue: 0,
          controlBudgetValue: 0,
          followUpValue: 0,
          teamworkValue: 0,
          memoryValue: 0,
          expertRuleAdjustment: 0,
          wildcardOpportunityCost: 0,
          combinationDestructionPenalty: 0,
          deadHandRiskPenalty: 0
        },
        matchedRules: [],
        hardExcluded: false,
        postAction: {
          estimatedTurns: 0,
          structuralIntegrity: 0,
          finishability: 0,
          deadHandRisk: 1,
          lowSingleCount: 2,
          weakPairCount: 0,
          controlCount: 0,
          recoveryCount: 0
        },
        control: {
          spendsLastControlResource: true,
          preservesRecoveryPoint: false,
          opportunityCost: 1,
          reasons: []
        },
        followUp: {
          noUsefulFollowUp: true,
          createsRunoutPath: false,
          retainsControlPotential: false
        },
        signals: { opponentHasManyCards: true, teammateHolding: true }
      }
    ]
  }
};
test("九项指标仅接收真实 expert 解释，诊断保留可重放 seed", () => {
  const report = collectExpertMetrics([
    sample,
    { ...sample, profile: "normal", explanation: undefined }
  ]);
  expect(report.counters.control_exhaustion_with_many_cards).toEqual({
    numerator: 1,
    denominator: 1
  });
  expect(report.counters.dead_hand_risk_created).toEqual({ numerator: 1, denominator: 1 });
  expect(report.diagnostics.every((item) => item.seed === 7 && item.profile === "expert")).toBe(
    true
  );
});
test("伪造 expert 样本缺少完整专家解释会失败，绝不读取 normal 结果", () => {
  expect(() => collectExpertMetrics([{ ...sample, explanation: undefined }])).toThrow(
    /expert decision chain/
  );
});
