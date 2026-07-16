import { expect, test } from "vitest";
import type { TurnAction } from "../turns";
import type { StrategyFeatureSnapshot } from "./expert-strategy-knowledge-base";
import { scoreAction, selectAction, type CandidateActionScore } from "./action-scorer";

const play = (id: string): TurnAction =>
  ({ type: "play", actor: "east", cardIds: [id], interpretation: { type: "single" } }) as never;
const pass: TurnAction = { type: "pass", actor: "east" };

const features = (action: TurnAction, overrides: Partial<StrategyFeatureSnapshot> = {}) => ({
  actionType: action.type,
  cardsPlayed: action.type === "play" ? action.cardIds.length : 0,
  isPass: action.type === "pass",
  blocksOpponent: false,
  helpsPartner: false,
  postAction: {
    delta: {
      estimatedTurns: 0,
      structuralIntegrity: 0,
      finishability: 0,
      deadHandRisk: 0,
      lowSingleCount: 0,
      weakPairCount: 0,
      controlCount: 0,
      recoveryCount: 0
    },
    lowValueWildcardUse: false
  },
  control: {
    spendsLastControlResource: false,
    preservesRecoveryPoint: false,
    opportunityCost: { score: 0, reasons: [] },
    exception: null
  },
  followUp: { noUsefulFollowUp: false, createsRunoutPath: false, retainsControlPotential: false },
  contest: { contestValue: 0, shouldContest: false },
  phase: "middle" as const,
  signals: {},
  ...overrides
});

test("同分时按 legalActions 原始顺序稳定选择，且返回原数组元素", () => {
  const first = play("first");
  const second = play("second");
  const legalActions = [first, second] as const;
  const selected = selectAction({
    legalActions,
    candidates: [
      scoreAction({ action: second, features: features(second) }),
      scoreAction({ action: first, features: features(first) })
    ]
  });
  expect(selected).toBe(first);
});

test("pass 是正常候选，低成本且有规则收益时可胜出", () => {
  const bid = play("bid");
  const scoredPass = scoreAction({
    action: pass,
    features: features(pass),
    adjustments: [
      {
        ruleId: "P25-R31",
        score: 4,
        kind: "bonus",
        reason: "合理过牌",
        evidence: "expert_source",
        maturity: "default_eligible"
      }
    ]
  });
  const selected = selectAction({
    legalActions: [bid, pass],
    candidates: [scoreAction({ action: bid, features: features(bid) }), scoredPass]
  });
  expect(selected).toBe(pass);
  expect(scoredPass.components.immediatePlayValue).toBe(0);
});

test("硬排除不依赖固定极值：有非排除合法动作时跳过，例外时仍可从原合法动作选择", () => {
  const harmful = play("harmful");
  const safe = play("safe");
  const excluded = scoreAction({
    action: harmful,
    features: features(harmful),
    adjustments: [
      {
        ruleId: "P25-R07",
        score: -1000,
        kind: "hard_exclusion",
        reason: "拆天然炸弹",
        evidence: "expert_source",
        maturity: "default_eligible"
      }
    ]
  });
  expect(excluded.finalScore).toBe(1);
  expect(
    selectAction({
      legalActions: [harmful, safe],
      candidates: [excluded, scoreAction({ action: safe, features: features(safe) })]
    })
  ).toBe(safe);
  expect(selectAction({ legalActions: [harmful], candidates: [excluded] })).toBe(harmful);
});

test("选择器拒绝非 legalActions 候选，并在相同输入下确定性返回", () => {
  const legal = play("legal");
  const foreign = play("foreign");
  const foreignScore = scoreAction({ action: foreign, features: features(foreign) });
  expect(() => selectAction({ legalActions: [legal], candidates: [foreignScore] })).toThrow(
    /legalActions/
  );
  const candidate: CandidateActionScore = scoreAction({ action: legal, features: features(legal) });
  expect(selectAction({ legalActions: [legal], candidates: [candidate] })).toBe(
    selectAction({ legalActions: [legal], candidates: [candidate] })
  );
});
