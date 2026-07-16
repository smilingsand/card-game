import { selectAction, type CandidateActionScore, type ScoreComponents } from "./action-scorer";
import {
  createStrategyProfile,
  STRATEGY_RULES,
  type RuleAdjustment,
  type StrategyProfileId,
  type StrategyProfileSnapshot
} from "./expert-strategy-knowledge-base";
import type { StrategyFeatureSnapshot } from "./expert-strategy-knowledge-base";
import type { TurnAction } from "../turns";

/**
 * P2.5 的解释是决策链的即时、可重复派生物。它只消费候选评分及其只读特征，
 * 绝不写入 TurnState、事件流、快照或存档；持久化调用方也不得把它作为游戏事实保存。
 */
export interface DecisionExplanation {
  readonly profile: Pick<
    StrategyProfileSnapshot,
    "id" | "version" | "rulesVersion" | "weightsVersion"
  >;
  readonly candidates: readonly ExplainedCandidate[];
  readonly finalReason: readonly string[];
}

export interface ExplainedCandidate {
  readonly action: TurnAction;
  readonly finalScore: number;
  readonly components: ScoreComponents;
  readonly matchedRules: readonly RuleAdjustment[];
  readonly hardExcluded: boolean;
  readonly postAction: {
    readonly estimatedTurns: number;
    readonly structuralIntegrity: number;
    readonly finishability: number;
    readonly deadHandRisk: number;
    readonly lowSingleCount: number;
    readonly weakPairCount: number;
    readonly controlCount: number;
    readonly recoveryCount: number;
  };
  readonly control: {
    readonly spendsLastControlResource: boolean;
    readonly preservesRecoveryPoint: boolean;
    readonly opportunityCost: number;
    readonly reasons: readonly string[];
  };
  readonly followUp: {
    readonly noUsefulFollowUp: boolean;
    readonly createsRunoutPath: boolean;
    readonly retainsControlPotential: boolean;
  };
}

export interface DecisionCandidateInput {
  readonly score: CandidateActionScore;
  readonly features: StrategyFeatureSnapshot;
}

export interface CreateDecisionInput {
  readonly legalActions: readonly TurnAction[];
  readonly candidates: readonly DecisionCandidateInput[];
  readonly profile: StrategyProfileSnapshot;
  /** 调用方已知的、不会改变选择的补充原因（例如 normal 回归基线）。 */
  readonly decisionReasons?: readonly string[];
  /** 仅暴露诊断计数；不得参与评分、规则命中或 tie-break。 */
  readonly includeDebugDetails?: boolean;
}

export interface StrategyDecision {
  readonly selectedAction: TurnAction;
  readonly explanation: DecisionExplanation;
  readonly debug?: { readonly candidateCount: number; readonly hardExcludedCount: number };
}

const PROFILE_VERSION = "p2.5a-1";

/**
 * 三个 profile 是显式、版本化快照。experimental 默认不继承 expert 规则，
 * 以免尚未验证的规则通过隐式回退进入默认机器人。
 */
export function createDefaultStrategyProfile(id: StrategyProfileId): StrategyProfileSnapshot {
  return createStrategyProfile({
    id,
    version: PROFILE_VERSION,
    rulesVersion: PROFILE_VERSION,
    weightsVersion: PROFILE_VERSION,
    enabledRuleIds: id === "expert" ? STRATEGY_RULES.map((rule) => rule.id) : []
  });
}

function explainCandidate(input: DecisionCandidateInput): ExplainedCandidate {
  const { score, features } = input;
  return {
    action: score.action,
    finalScore: score.finalScore,
    components: score.components,
    matchedRules: score.adjustments,
    hardExcluded: score.hardExcluded,
    postAction: {
      estimatedTurns: features.postAction.delta.estimatedTurns,
      structuralIntegrity: features.postAction.delta.structuralIntegrity,
      finishability: features.postAction.delta.finishability,
      deadHandRisk: features.postAction.delta.deadHandRisk,
      lowSingleCount: features.postAction.delta.lowSingleCount,
      weakPairCount: features.postAction.delta.weakPairCount,
      controlCount: features.postAction.delta.controlCount,
      recoveryCount: features.postAction.delta.recoveryCount
    },
    control: {
      spendsLastControlResource: features.control.spendsLastControlResource,
      preservesRecoveryPoint: features.control.preservesRecoveryPoint,
      opportunityCost: features.control.opportunityCost.score,
      reasons: features.control.opportunityCost.reasons
    },
    followUp: { ...features.followUp }
  };
}

function sameAction(left: TurnAction, right: TurnAction): boolean {
  if (left === right) return true;
  if (left.type !== right.type || left.actor !== right.actor) return false;
  if (left.type === "pass" || right.type === "pass") return left.type === right.type;
  return (
    left.cardIds.length === right.cardIds.length &&
    left.cardIds.every((id, index) => id === right.cardIds[index])
  );
}

function finalReason(selected: ExplainedCandidate): readonly string[] {
  const reasons = selected.matchedRules.map((rule) => `${rule.ruleId}: ${rule.reason}`);
  if (selected.postAction.deadHandRisk < 0) reasons.push("动作后降低死手风险");
  if (selected.followUp.createsRunoutPath) reasons.push("保留连续出完路线");
  if (selected.control.preservesRecoveryPoint) reasons.push("保留回收控制点");
  if (reasons.length === 0) reasons.push("在合法候选中按稳定评分和原始合法动作顺序胜出");
  return reasons;
}

/**
 * 机器人和提示应共同调用的唯一策略选择入口。调用方负责在此前完成特征提取、规则评估和评分；
 * 此函数不读取游戏状态，保证显示调试信息的开关不会改变行为。
 */
export function createDecision(input: CreateDecisionInput): StrategyDecision {
  if (input.candidates.length === 0) throw new Error("至少需要一个已评分候选");
  const selectedAction = selectAction({
    legalActions: input.legalActions,
    candidates: input.candidates.map(({ score }) => score)
  });
  const candidates = input.candidates.map(explainCandidate);
  const selected = candidates.find((candidate) => sameAction(candidate.action, selectedAction));
  if (!selected) throw new Error("选中动作必须拥有可派生解释");
  const explanation: DecisionExplanation = {
    profile: {
      id: input.profile.id,
      version: input.profile.version,
      rulesVersion: input.profile.rulesVersion,
      weightsVersion: input.profile.weightsVersion
    },
    candidates,
    finalReason: [...(input.decisionReasons ?? []), ...finalReason(selected)]
  };
  return {
    selectedAction,
    explanation,
    ...(input.includeDebugDetails
      ? {
          debug: {
            candidateCount: input.candidates.length,
            hardExcludedCount: input.candidates.filter(({ score }) => score.hardExcluded).length
          }
        }
      : {})
  };
}

function normalBaselineFeatures(action: TurnAction): StrategyFeatureSnapshot {
  return {
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
    phase: "middle",
    signals: {}
  };
}

/**
 * normal 是 P2.5 的回归基线，仍由既有 normal 策略确定动作。本适配器把该动作纳入
 * 与 expert 相同的决策/解释出口，而不伪造专家评分或改变既有选择。
 */
export function createNormalBaselineDecision(input: {
  readonly legalActions: readonly TurnAction[];
  readonly selectedAction: TurnAction;
  readonly reasons: readonly string[];
  readonly includeDebugDetails?: boolean;
}): StrategyDecision {
  const profile = createDefaultStrategyProfile("normal");
  const features = normalBaselineFeatures(input.selectedAction);
  const score: CandidateActionScore = {
    action: input.selectedAction,
    profile: {
      id: profile.id,
      version: profile.version,
      rulesVersion: profile.rulesVersion,
      weightsVersion: profile.weightsVersion
    },
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
    finalScore: 0,
    adjustments: [],
    hardExcluded: false
  };
  return createDecision({
    legalActions: input.legalActions,
    candidates: [{ score, features }],
    profile,
    decisionReasons: input.reasons,
    includeDebugDetails: input.includeDebugDetails
  });
}
