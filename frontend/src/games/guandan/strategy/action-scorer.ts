import type { TurnAction } from "../turns";
import type { ActionFeatureSnapshot } from "./action-feature-extractor";
import type { RuleAdjustment, StrategyProfileSnapshot } from "./expert-strategy-knowledge-base";

export interface ScoreComponents {
  readonly immediatePlayValue: number;
  readonly postActionStructureValue: number;
  readonly finishabilityValue: number;
  readonly contestValue: number;
  readonly controlBudgetValue: number;
  readonly followUpValue: number;
  readonly teamworkValue: number;
  readonly memoryValue: number;
  readonly expertRuleAdjustment: number;
  readonly wildcardOpportunityCost: number;
  readonly combinationDestructionPenalty: number;
  readonly deadHandRiskPenalty: number;
}

export interface CandidateActionScore {
  readonly action: TurnAction;
  readonly profile: Pick<
    StrategyProfileSnapshot,
    "id" | "version" | "rulesVersion" | "weightsVersion"
  >;
  readonly components: ScoreComponents;
  readonly finalScore: number;
  readonly adjustments: readonly RuleAdjustment[];
  readonly hardExcluded: boolean;
}

export interface ScoreActionInput {
  readonly action: TurnAction;
  readonly features: ActionFeatureSnapshot;
  readonly adjustments?: readonly RuleAdjustment[];
  readonly profile?: Pick<
    StrategyProfileSnapshot,
    "id" | "version" | "rulesVersion" | "weightsVersion"
  >;
}

export interface SelectActionInput {
  readonly legalActions: readonly TurnAction[];
  readonly candidates: readonly CandidateActionScore[];
}

const defaultProfile: CandidateActionScore["profile"] = {
  id: "normal",
  version: "1",
  rulesVersion: "p2.5a-1",
  weightsVersion: "p2.5a-1"
};

/**
 * 将已计算的动作特征和知识库修正汇总为可解释分项；不读取游戏状态也不生成动作。
 * hard_exclusion 是选择阶段的资格标记而不是数值极值，故不会把“应争夺”硬编码为一个分数。
 */
export function scoreAction(input: ScoreActionInput): CandidateActionScore {
  const adjustments = input.adjustments ?? [];
  const { features } = input;
  const components: ScoreComponents = {
    immediatePlayValue: features.cardsPlayed,
    postActionStructureValue: features.postAction.delta.structuralIntegrity,
    finishabilityValue:
      features.postAction.delta.finishability - features.postAction.delta.estimatedTurns,
    contestValue: features.contest.contestValue,
    controlBudgetValue:
      (features.control.preservesRecoveryPoint ? 1 : 0) -
      (features.control.spendsLastControlResource ? 1 : 0),
    followUpValue:
      (features.followUp.createsRunoutPath ? 1 : 0) +
      (features.followUp.retainsControlPotential ? 1 : 0) -
      (features.followUp.noUsefulFollowUp ? 1 : 0),
    teamworkValue: features.helpsPartner ? 1 : 0,
    memoryValue: 0,
    expertRuleAdjustment: adjustments
      .filter((adjustment) => adjustment.kind !== "hard_exclusion")
      .reduce((total, adjustment) => total + adjustment.score, 0),
    wildcardOpportunityCost: features.postAction.lowValueWildcardUse ? 1 : 0,
    combinationDestructionPenalty: 0,
    deadHandRiskPenalty: Math.max(0, -features.postAction.delta.deadHandRisk)
  };
  const finalScore =
    components.immediatePlayValue +
    components.postActionStructureValue +
    components.finishabilityValue +
    components.contestValue +
    components.controlBudgetValue +
    components.followUpValue +
    components.teamworkValue +
    components.memoryValue +
    components.expertRuleAdjustment -
    components.wildcardOpportunityCost -
    components.combinationDestructionPenalty -
    components.deadHandRiskPenalty;
  return {
    action: input.action,
    profile: input.profile ?? defaultProfile,
    components,
    finalScore,
    adjustments,
    hardExcluded: adjustments.some((adjustment) => adjustment.kind === "hard_exclusion")
  };
}

/**
 * 仅从规则引擎给出的原始 legalActions 中选择。优先非硬排除候选；如果全都被排除，
 * 保留可解释的例外退路并仍按分数及 legalActions 原始顺序确定性选择。
 */
export function selectAction(input: SelectActionInput): TurnAction {
  if (input.legalActions.length === 0) throw new Error("legalActions 不能为空");
  const indexed = input.candidates.map((candidate) => {
    const legalIndex = input.legalActions.indexOf(candidate.action);
    if (legalIndex < 0) throw new Error("候选动作必须来自 legalActions 原数组");
    return { candidate, legalIndex };
  });
  if (indexed.length === 0) throw new Error("至少需要一个 legalActions 候选");
  const eligible = indexed.filter(({ candidate }) => !candidate.hardExcluded);
  const pool = eligible.length > 0 ? eligible : indexed;
  const selected = pool.reduce((best, current) =>
    current.candidate.finalScore > best.candidate.finalScore ||
    (current.candidate.finalScore === best.candidate.finalScore &&
      current.legalIndex < best.legalIndex)
      ? current
      : best
  );
  return input.legalActions[selected.legalIndex];
}
