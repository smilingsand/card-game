import type { ActionFeatureSnapshot } from "./action-feature-extractor";
import type { SituationPhase } from "./situation-analyzer";

export type StrategyProfileId = "normal" | "expert" | "experimental";
export type EvidenceLevel =
  "rules_based" | "expert_source" | "heuristic" | "needs_expert_validation";
export type StrategyMaturity = "default_eligible" | "experimental";
export type RuleAdjustmentKind = "bonus" | "penalty" | "hard_exclusion";

/**
 * 由上游分析器写入的只读语义事实。知识库只消费这些事实，绝不调用规则引擎、
 * 不生成动作、不读取 BotView 或任何隐藏状态。未提供的信号一律视为 false。
 */
export interface StrategySignals {
  readonly preservesNaturalPattern?: boolean;
  readonly hasNaturalAlternative?: boolean;
  readonly usesWildcardCompletedPattern?: boolean;
  readonly usesTwoWildcards?: boolean;
  readonly breaksNaturalBomb?: boolean;
  readonly breaksStraight?: boolean;
  readonly breaksSteelPlate?: boolean;
  readonly breaksConsecutivePairs?: boolean;
  readonly breaksTripleWithPair?: boolean;
  readonly reducesUnrecoverableLowSingles?: boolean;
  readonly createsIsolatedTriple?: boolean;
  readonly createsWeakPairs?: boolean;
  readonly preservesRecoveryPoint?: boolean;
  readonly rolePrefersTurnReduction?: boolean;
  readonly rolePrefersControl?: boolean;
  readonly directFinish?: boolean;
  readonly endgameBlock?: boolean;
  readonly opponentHasManyCards?: boolean;
  readonly lowOpponentThreat?: boolean;
  readonly opponentHasOneCard?: boolean;
  readonly opponentHasTwoCards?: boolean;
  readonly opponentHasFiveCards?: boolean;
  readonly targetLikelyPair?: boolean;
  readonly targetLikelyStraightOrTripleWithPair?: boolean;
  readonly teammateHolding?: boolean;
  readonly teammateSprinting?: boolean;
  readonly teammateUnableToControl?: boolean;
  readonly spendsControlSequence?: boolean;
  readonly hasManyLowSingles?: boolean;
  readonly preservesSameTypeRecovery?: boolean;
}

export interface StrategyFeatureSnapshot extends ActionFeatureSnapshot {
  readonly phase: SituationPhase;
  readonly signals: StrategySignals;
}

export interface ExpertValidationQualification {
  readonly rationale: boolean;
  readonly fixture: boolean;
  readonly hitMissExceptionTests: boolean;
  readonly frozenRulesCompatible: boolean;
  readonly simulationAndRegressionClean: boolean;
  readonly independentlyToggleable: boolean;
  readonly explanationShowsEvidence: boolean;
}

export interface RuleAdjustment {
  readonly ruleId: string;
  readonly score: number;
  readonly kind: RuleAdjustmentKind;
  readonly reason: string;
  readonly evidence: EvidenceLevel;
  readonly maturity: StrategyMaturity;
}

export interface ExpertStrategyRule {
  readonly id: string;
  readonly version: number;
  readonly evidence: EvidenceLevel;
  readonly maturity: StrategyMaturity;
  readonly phases: readonly SituationPhase[];
  readonly priority: number;
  readonly qualification?: ExpertValidationQualification;
  readonly evaluate: (
    features: Readonly<StrategyFeatureSnapshot>
  ) => readonly Omit<RuleAdjustment, "ruleId" | "evidence" | "maturity">[];
}

export interface StrategyProfileSnapshot {
  readonly id: StrategyProfileId;
  readonly version: string;
  readonly rulesVersion: string;
  readonly weightsVersion: string;
  readonly enabledRuleIds: readonly string[];
}

export interface EvaluateExpertStrategyRulesInput {
  readonly profile: StrategyProfileSnapshot;
  readonly features: StrategyFeatureSnapshot;
  readonly registry?: readonly ExpertStrategyRule[];
}

export interface ExpertStrategyEvaluation {
  readonly profile: Pick<
    StrategyProfileSnapshot,
    "id" | "version" | "rulesVersion" | "weightsVersion"
  >;
  readonly rules: readonly Pick<ExpertStrategyRule, "id" | "version" | "evidence" | "maturity">[];
  readonly adjustments: readonly RuleAdjustment[];
  readonly explanation: readonly {
    ruleId: string;
    evidence: EvidenceLevel;
    maturity: StrategyMaturity;
    kind: RuleAdjustmentKind;
    reason: string;
  }[];
}

const allPhases: readonly SituationPhase[] = ["opening", "middle", "endgame"];
const signal = (key: keyof StrategySignals) => (features: StrategyFeatureSnapshot) =>
  features.signals[key] === true;
const not =
  (predicate: (features: StrategyFeatureSnapshot) => boolean) =>
  (features: StrategyFeatureSnapshot) =>
    !predicate(features);
const and =
  (...predicates: readonly ((features: StrategyFeatureSnapshot) => boolean)[]) =>
  (features: StrategyFeatureSnapshot) =>
    predicates.every((predicate) => predicate(features));
const action =
  (actionType: StrategyFeatureSnapshot["actionType"]) => (features: StrategyFeatureSnapshot) =>
    features.actionType === actionType;

type RuleDefinition = readonly [
  string,
  string,
  number,
  RuleAdjustmentKind,
  (features: StrategyFeatureSnapshot) => boolean
];
const coreDefinitions: readonly RuleDefinition[] = [
  [
    "01",
    "天然牌型优先于逢人配补型",
    4,
    "bonus",
    and(signal("preservesNaturalPattern"), signal("usesWildcardCompletedPattern"))
  ],
  [
    "02",
    "自然对子优先于逢人配低对子",
    4,
    "bonus",
    and(signal("hasNaturalAlternative"), signal("preservesNaturalPattern"))
  ],
  [
    "03",
    "天然炸弹优先于逢人配小炸弹",
    5,
    "bonus",
    and(signal("hasNaturalAlternative"), signal("preservesNaturalPattern"))
  ],
  [
    "04",
    "逢人配应显著减少总手数",
    3,
    "bonus",
    and(signal("usesWildcardCompletedPattern"), (f) => f.postAction.delta.estimatedTurns < 0)
  ],
  [
    "05",
    "逢人配优先形成高价值结构",
    3,
    "bonus",
    and(signal("usesWildcardCompletedPattern"), (f) => f.postAction.delta.structuralIntegrity > 0)
  ],
  ["06", "两张逢人配增加机会成本", -3, "penalty", signal("usesTwoWildcards")],
  [
    "07",
    "低威胁下禁止为压低牌拆天然炸弹",
    -1000,
    "hard_exclusion",
    and(signal("breaksNaturalBomb"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  [
    "08",
    "避免轻易拆顺子",
    -4,
    "penalty",
    and(signal("breaksStraight"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  [
    "09",
    "避免轻易拆钢板",
    -5,
    "penalty",
    and(signal("breaksSteelPlate"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  [
    "10",
    "避免轻易拆三连对",
    -5,
    "penalty",
    and(signal("breaksConsecutivePairs"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  [
    "11",
    "避免轻易拆完整三带二",
    -3,
    "penalty",
    and(signal("breaksTripleWithPair"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  ["12", "优先减少无法回收的弱散单", 3, "bonus", signal("reducesUnrecoverableLowSingles")],
  ["13", "避免产生孤立三张", -3, "penalty", signal("createsIsolatedTriple")],
  ["14", "避免产生大量弱对子", -3, "penalty", signal("createsWeakPairs")],
  ["15", "组牌方案保留回收点", 3, "bonus", signal("preservesRecoveryPoint")],
  [
    "16",
    "主攻方案优先减少总手数",
    3,
    "bonus",
    and(signal("rolePrefersTurnReduction"), (f) => f.postAction.delta.estimatedTurns < 0)
  ],
  [
    "17",
    "助攻方案优先保留控制力",
    3,
    "bonus",
    and(signal("rolePrefersControl"), (f) => f.control.preservesRecoveryPoint)
  ],
  [
    "18",
    "尾局可牺牲结构直接出完或阻断",
    7,
    "bonus",
    (f) => f.signals.directFinish === true || f.signals.endgameBlock === true
  ],
  [
    "19",
    "高威胁时允许牺牲结构阻断",
    6,
    "bonus",
    and(signal("endgameBlock"), (f) => f.blocksOpponent)
  ],
  ["20", "最终分组保持实体牌唯一归属", -1000, "hard_exclusion", () => false],
  [
    "21",
    "手牌较多时保留高单回收点",
    4,
    "bonus",
    and((f) => f.phase !== "endgame", signal("preservesRecoveryPoint"))
  ],
  [
    "22",
    "手牌较多时保留高对子回收点",
    3,
    "bonus",
    and((f) => f.phase !== "endgame", signal("preservesSameTypeRecovery"))
  ],
  [
    "23",
    "低价值争夺不消耗最后控制牌",
    -6,
    "penalty",
    and(signal("lowOpponentThreat"), (f) => f.control.spendsLastControlResource)
  ],
  ["24", "避免连续打光王、级牌和 A", -4, "penalty", signal("spendsControlSequence")],
  [
    "25",
    "多低散单时提高控制资源价值",
    3,
    "bonus",
    and(signal("hasManyLowSingles"), (f) => f.control.preservesRecoveryPoint)
  ],
  [
    "26",
    "炸弹作为控制资源保留",
    -5,
    "penalty",
    and(signal("breaksNaturalBomb"), not(signal("endgameBlock")), not(signal("directFinish")))
  ],
  ["27", "取得牌权但无后续则降权", -4, "penalty", (f) => !f.isPass && f.followUp.noUsefulFollowUp],
  ["28", "保留同型大牌回收弱路", 3, "bonus", signal("preservesSameTypeRecovery")],
  [
    "29",
    "尾局阻断提高控制牌使用意愿",
    5,
    "bonus",
    and(signal("endgameBlock"), (f) => f.phase === "endgame")
  ],
  ["30", "直接走完允许耗尽控制牌", 8, "bonus", signal("directFinish")],
  [
    "31",
    "低威胁且对手余牌多时允许过牌",
    4,
    "bonus",
    and(action("pass"), signal("opponentHasManyCards"), signal("lowOpponentThreat"))
  ],
  [
    "32",
    "对手剩一张时优先封锁单张",
    7,
    "bonus",
    and(not(action("pass")), signal("opponentHasOneCard"), (f) => f.blocksOpponent)
  ],
  [
    "33",
    "对手剩两张时重点防对子",
    5,
    "bonus",
    and(not(action("pass")), signal("opponentHasTwoCards"), signal("targetLikelyPair"))
  ],
  [
    "34",
    "对手剩五张时重点防顺子和三带二",
    4,
    "bonus",
    and(
      not(action("pass")),
      signal("opponentHasFiveCards"),
      signal("targetLikelyStraightOrTripleWithPair")
    )
  ],
  [
    "35",
    "队友压住时非必要不过度接牌",
    5,
    "bonus",
    and(action("pass"), signal("teammateHolding"), signal("lowOpponentThreat"))
  ],
  [
    "36",
    "队友冲刺时优先送牌",
    5,
    "bonus",
    and(not(action("pass")), signal("teammateSprinting"), (f) => f.helpsPartner)
  ],
  [
    "37",
    "拆炸压制提高争夺门槛",
    -5,
    "penalty",
    and(signal("breaksNaturalBomb"), not(signal("endgameBlock")))
  ],
  [
    "38",
    "耗尽控制牌压制提高争夺门槛",
    -5,
    "penalty",
    and(
      (f) => f.control.spendsLastControlResource,
      not(signal("endgameBlock")),
      not(signal("directFinish"))
    )
  ],
  [
    "39",
    "压住后无后续路线降低争夺价值",
    -4,
    "penalty",
    and(not(action("pass")), (f) => f.followUp.noUsefulFollowUp)
  ],
  [
    "40",
    "队友无力时自己承担控制",
    4,
    "bonus",
    and(not(action("pass")), signal("teammateUnableToControl"), (f) => f.blocksOpponent)
  ]
];

const toRule = ([number, reason, score, kind, predicate]: RuleDefinition): ExpertStrategyRule => ({
  id: `P25-R${number}`,
  version: 1,
  evidence: "expert_source",
  maturity: "default_eligible",
  phases: allPhases,
  priority: Number(number),
  evaluate: (features) => (predicate(features) ? [{ score, kind, reason }] : [])
});

/** P2.5A 的 1–40 条核心反愚蠢规则；稳定 ID 不得复用。 */
export const STRATEGY_RULES = registerExpertStrategyRules(coreDefinitions.map(toRule));

export function registerExpertStrategyRules(
  rules: readonly ExpertStrategyRule[]
): readonly ExpertStrategyRule[] {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`专家策略规则 ID 重复：${rule.id}`);
    ids.add(rule.id);
  }
  return [...rules].sort((left, right) => left.id.localeCompare(right.id));
}

export function createStrategyProfile(input: {
  readonly id: StrategyProfileId;
  readonly enabledRuleIds: readonly string[];
  readonly version?: string;
  readonly rulesVersion?: string;
  readonly weightsVersion?: string;
}): StrategyProfileSnapshot {
  return {
    id: input.id,
    version: input.version ?? "1",
    rulesVersion: input.rulesVersion ?? "p2.5a-1",
    weightsVersion: input.weightsVersion ?? "p2.5a-1",
    enabledRuleIds: [...new Set(input.enabledRuleIds)].sort()
  };
}

function assertRuleMayLoad(rule: ExpertStrategyRule, profile: StrategyProfileSnapshot): void {
  if (profile.id === "normal") throw new Error("normal profile 不加载专家策略规则");
  if (rule.maturity === "experimental" && profile.id !== "experimental")
    throw new Error(`experimental 规则不得进入 ${profile.id} profile`);
  if (rule.maturity === "default_eligible" && profile.id === "experimental") return;
  if (rule.evidence !== "needs_expert_validation" || profile.id !== "expert") return;
  const qualification = rule.qualification;
  if (!qualification || !Object.values(qualification).every(Boolean))
    throw new Error(`needs_expert_validation 规则 ${rule.id} 未通过七项默认资格门禁`);
}

/**
 * 对已统一的只读特征应用 profile 已启用的策略规则。输出按 rule id 与声明顺序稳定，
 * 供后续评分器和 DecisionExplanation 直接使用；不修改输入或任何游戏状态。
 */
export function evaluateExpertStrategyRules(
  input: EvaluateExpertStrategyRulesInput
): ExpertStrategyEvaluation {
  // STRATEGY_RULES is registered, sorted and immutable at module initialization. Re-registering
  // it for every candidate is observationally redundant; custom registries retain validation.
  const registry = input.registry ? registerExpertStrategyRules(input.registry) : STRATEGY_RULES;
  const enabled = new Set(input.profile.enabledRuleIds);
  if (input.profile.id === "normal" && enabled.size > 0)
    throw new Error("normal profile 不得启用专家策略规则");
  const rules = registry.filter((rule) => enabled.has(rule.id));
  for (const rule of rules) assertRuleMayLoad(rule, input.profile);
  const adjustments = rules.flatMap((rule) => {
    if (!rule.phases.includes(input.features.phase)) return [];
    return rule.evaluate(input.features).map((adjustment) => ({
      ...adjustment,
      ruleId: rule.id,
      evidence: rule.evidence,
      maturity: rule.maturity
    }));
  });
  return {
    profile: input.profile,
    rules: rules.map(({ id, version, evidence, maturity }) => ({
      id,
      version,
      evidence,
      maturity
    })),
    adjustments,
    explanation: adjustments.map(({ ruleId, evidence, maturity, kind, reason }) => ({
      ruleId,
      evidence,
      maturity,
      kind,
      reason
    }))
  };
}
