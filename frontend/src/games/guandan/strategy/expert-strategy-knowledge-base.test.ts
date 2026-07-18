import { expect, test } from "vitest";
import {
  createStrategyProfile,
  evaluateExpertStrategyRules,
  registerExpertStrategyRules,
  STRATEGY_RULES,
  type StrategyFeatureSnapshot,
  type StrategyProfileSnapshot
} from "./expert-strategy-knowledge-base";

const features = (overrides: Partial<StrategyFeatureSnapshot> = {}): StrategyFeatureSnapshot => ({
  actionType: "play",
  cardsPlayed: 1,
  isPass: false,
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
    preservesRecoveryPoint: true,
    opportunityCost: { score: 0, reasons: [] },
    exception: null
  },
  followUp: { noUsefulFollowUp: false, createsRunoutPath: false, retainsControlPotential: true },
  contest: { contestValue: 0, shouldContest: false },
  phase: "middle",
  signals: {},
  ...overrides
});

const expert = (enabledRuleIds = STRATEGY_RULES.map((rule) => rule.id)): StrategyProfileSnapshot =>
  createStrategyProfile({ id: "expert", enabledRuleIds });

test("核心目录完整落地 30–40 条稳定规则，注册表排序且拒绝重复 ID", () => {
  expect(STRATEGY_RULES).toHaveLength(42);
  expect(STRATEGY_RULES.map((rule) => rule.id)).toEqual(
    [...STRATEGY_RULES].map((rule) => rule.id).sort()
  );
  expect(() => registerExpertStrategyRules([STRATEGY_RULES[0], STRATEGY_RULES[0]])).toThrow(/重复/);
});

test("天然炸弹保护、尾局阻断和无后续过牌均输出结构化解释", () => {
  const naturalBomb = evaluateExpertStrategyRules({
    profile: expert(),
    features: features({ signals: { breaksNaturalBomb: true } })
  });
  expect(naturalBomb.adjustments).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: "P25-R07", kind: "hard_exclusion" })])
  );

  const endgame = evaluateExpertStrategyRules({
    profile: expert(),
    features: features({
      phase: "endgame",
      blocksOpponent: true,
      signals: { opponentHasOneCard: true, endgameBlock: true }
    })
  });
  expect(endgame.adjustments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: "P25-R18", kind: "bonus" }),
      expect.objectContaining({ ruleId: "P25-R32", kind: "bonus" })
    ])
  );

  const pass = evaluateExpertStrategyRules({
    profile: expert(),
    features: features({
      actionType: "pass",
      isPass: true,
      signals: { opponentHasManyCards: true, lowOpponentThreat: true }
    })
  });
  expect(pass.adjustments).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: "P25-R31", kind: "bonus" })])
  );
  expect(pass.explanation.every((item) => item.evidence)).toBe(true);
});

test("profile 严格隔离：normal 不继承专家规则，experimental 不进入 expert", () => {
  const normal = createStrategyProfile({ id: "normal", enabledRuleIds: [] });
  expect(
    evaluateExpertStrategyRules({
      profile: normal,
      features: features({ signals: { breaksNaturalBomb: true } })
    }).adjustments
  ).toEqual([]);

  const experimentalRule = {
    ...STRATEGY_RULES[0],
    id: "P25-X01",
    maturity: "experimental" as const
  };
  const registry = registerExpertStrategyRules([...STRATEGY_RULES, experimentalRule]);
  const invalidExpert = createStrategyProfile({
    id: "expert",
    enabledRuleIds: [experimentalRule.id]
  });
  expect(() =>
    evaluateExpertStrategyRules({ profile: invalidExpert, features: features(), registry })
  ).toThrow(/experimental/);
});

test("needs_expert_validation 的七项门禁任何一项缺失都不能加载到 expert", () => {
  const validationRule = {
    ...STRATEGY_RULES[0],
    id: "P25-V01",
    evidence: "needs_expert_validation" as const,
    maturity: "default_eligible" as const,
    qualification: {
      rationale: true,
      fixture: true,
      hitMissExceptionTests: true,
      frozenRulesCompatible: true,
      simulationAndRegressionClean: true,
      independentlyToggleable: true,
      explanationShowsEvidence: true
    }
  };
  const registry = registerExpertStrategyRules([validationRule]);
  const profile = createStrategyProfile({ id: "expert", enabledRuleIds: [validationRule.id] });
  expect(
    evaluateExpertStrategyRules({ profile, features: features(), registry }).rules
  ).toHaveLength(1);
  for (const key of Object.keys(
    validationRule.qualification
  ) as (keyof typeof validationRule.qualification)[]) {
    const bad = {
      ...validationRule,
      qualification: { ...validationRule.qualification, [key]: false }
    };
    expect(() =>
      evaluateExpertStrategyRules({
        profile,
        features: features(),
        registry: registerExpertStrategyRules([bad])
      })
    ).toThrow(/七项/);
  }
});
