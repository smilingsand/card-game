import { expect, test } from "vitest";
import { extractActionFeatures } from "./action-feature-extractor";

const derived = {
  postAction: {
    delta: {
      estimatedTurns: -1,
      structuralIntegrity: 2,
      finishability: 3,
      deadHandRisk: -4,
      lowSingleCount: 0,
      weakPairCount: 0,
      controlCount: 0,
      recoveryCount: 0
    },
    lowValueWildcardUse: false
  },
  control: {
    spendsLastControlResource: false,
    preservesRecoveryPoint: true,
    opportunityCost: { score: 1, reasons: [] },
    exception: null
  },
  followUp: { noUsefulFollowUp: false, createsRunoutPath: true, retainsControlPotential: true },
  contest: { contestValue: 5, shouldContest: true }
} as const;

test("统一快照直接引用既有派生结果，不重算且保持输入不变", () => {
  const input = {
    action: {
      type: "play" as const,
      actor: "east" as const,
      cardIds: ["a", "b"],
      interpretation: { type: "pair" } as never
    },
    situation: {
      opponentThreat: { level: "high" },
      teammate: { isHolding: false, isSprinting: false }
    } as never,
    ...derived
  };
  const before = structuredClone(input);
  const result = extractActionFeatures(input);
  expect(result.postAction).toBe(input.postAction);
  expect(result.control).toBe(input.control);
  expect(result.followUp).toBe(input.followUp);
  expect(result.contest).toBe(input.contest);
  expect(result).toEqual(extractActionFeatures(input));
  expect(input).toEqual(before);
  expect("opponentHands" in result).toBe(false);
});

test("pass 也是统一评估对象，且不伪造出牌/控制收益", () => {
  const result = extractActionFeatures({
    action: { type: "pass", actor: "east" },
    situation: {
      opponentThreat: { level: "low" },
      teammate: { isHolding: true, isSprinting: false }
    } as never,
    ...derived
  });
  expect(result).toMatchObject({
    actionType: "pass",
    cardsPlayed: 0,
    isPass: true,
    blocksOpponent: false,
    helpsPartner: true
  });
});
