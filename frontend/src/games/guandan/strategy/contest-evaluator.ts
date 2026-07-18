import type { TurnAction } from "../turns";
import type { ControlResourceEvaluation } from "./control-resource-evaluator";
import type { FollowUpPlan } from "./follow-up-planner";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

export interface ContestContext {
  readonly opponentThreat: number;
  readonly opponentControlPressure: number;
  readonly partnerNeed: number;
  readonly publicReasons: readonly string[];
}

export interface ContestEvaluation {
  readonly actionId: string;
  readonly actionType: TurnAction["type"];
  readonly opponentThreat: number;
  readonly partnerNeed: number;
  readonly controlGain: number;
  readonly structuralCost: number;
  readonly controlResourceCost: number;
  readonly followUpValue: number;
  readonly deadHandRiskCost: number;
  readonly contestValue: number;
  readonly shouldContest: boolean;
  readonly reasons: readonly string[];
}

export interface EvaluateContestActionInput {
  readonly context: ContestContext;
  readonly action: TurnAction;
  readonly postAction: Pick<PostActionHandEvaluation, "delta" | "destroyedGroups">;
  readonly control: Pick<
    ControlResourceEvaluation,
    "before" | "after" | "opportunityCost" | "exception"
  >;
  readonly followUp: Pick<
    FollowUpPlan,
    "noUsefulFollowUp" | "createsRunoutPath" | "retainsControlPotential"
  >;
}

const threatValue: Readonly<Record<SituationAnalysis["opponentThreat"]["level"], number>> = {
  low: 0,
  medium: 2,
  high: 4,
  critical: 7
};

const actionId = (action: TurnAction) =>
  action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${[...action.cardIds].sort().join(",")}`;

/** 仅将公开 Situation 压缩为可复用的争夺上下文，不读取任何隐藏牌面。 */
export function createContestContext(situation: SituationAnalysis): ContestContext {
  const consecutiveControlRounds = situation.opponentThreat.consecutiveControlRounds ?? 0;
  const opponentControlPressure =
    situation.opponentThreat.currentControlSeat === undefined
      ? 0
      : 2 + Math.min(3, Math.max(0, consecutiveControlRounds - 1) * 2);
  const opponentThreat = threatValue[situation.opponentThreat.level] + opponentControlPressure;
  const partnerNeed = situation.teammate.isSprinting ? 4 : situation.teammate.isHolding ? -2 : 0;
  const publicReasons = [
    `${situation.opponentThreat.level}_opponent_threat`,
    ...(opponentControlPressure > 0 ? ["opponent_control_pressure"] : []),
    ...(situation.teammate.isSprinting ? ["teammate_sprinting"] : []),
    ...(situation.teammate.isHolding ? ["teammate_holding"] : [])
  ];
  return { opponentThreat, opponentControlPressure, partnerNeed, publicReasons };
}

/**
 * 动作级争夺评估只汇总既有派生结果。它不生成动作，也不会因“存在合法压制”而强制争牌。
 */
export function evaluateContestAction(input: EvaluateContestActionInput): ContestEvaluation {
  const isPass = input.action.type === "pass";
  const destroyedSeverity = input.postAction.destroyedGroups.reduce(
    (total, group) => total + (group.severity === "severe" ? 4 : group.severity === "high" ? 2 : 1),
    0
  );
  const structuralCost =
    Math.max(0, -input.postAction.delta.structuralIntegrity) / 5 + destroyedSeverity;
  const deadHandRiskCost = Math.max(0, input.postAction.delta.deadHandRisk) / 5;
  const controlGain = isPass
    ? 0
    : Math.max(
        0,
        input.control.after.totalUniqueCardIds.length -
          input.control.before.totalUniqueCardIds.length
      ) + (input.followUp.retainsControlPotential ? 1 : 0);
  const controlResourceCost = isPass ? 0 : input.control.opportunityCost.score;
  const followUpValue = isPass
    ? 0
    : (input.followUp.createsRunoutPath ? 5 : 0) +
      (input.followUp.retainsControlPotential ? 1 : 0) -
      (input.followUp.noUsefulFollowUp ? 4 : 0);
  const exceptionValue =
    input.control.exception === "direct_finish"
      ? 8
      : input.control.exception === "endgame_block"
        ? 7
        : input.control.exception === "team_support"
          ? 6
          : 0;
  const contestValue = isPass
    ? 0
    : input.context.opponentThreat +
      input.context.partnerNeed +
      controlGain +
      followUpValue +
      exceptionValue -
      structuralCost -
      controlResourceCost -
      deadHandRiskCost;
  const reasons = [...input.context.publicReasons];
  if (isPass) reasons.push("pass_keeps_option_open");
  if (!isPass && input.context.opponentControlPressure > 0)
    reasons.push("opponent_control_pressure");
  if (!isPass && input.context.opponentThreat >= 7) reasons.push("critical_opponent_threat");
  if (!isPass && input.control.exception === "team_support") reasons.push("team_support_exception");
  if (!isPass && input.followUp.createsRunoutPath) reasons.push("runout_path");
  if (!isPass && input.followUp.noUsefulFollowUp) reasons.push("no_useful_follow_up");
  if (
    !isPass &&
    input.context.opponentThreat === 0 &&
    structuralCost + controlResourceCost >= 4 &&
    input.followUp.noUsefulFollowUp
  )
    reasons.push("low_threat_high_cost_no_follow_up");

  return {
    actionId: actionId(input.action),
    actionType: input.action.type,
    opponentThreat: input.context.opponentThreat,
    partnerNeed: input.context.partnerNeed,
    controlGain,
    structuralCost,
    controlResourceCost,
    followUpValue,
    deadHandRiskCost,
    contestValue,
    shouldContest: !isPass && contestValue > 0,
    reasons
  };
}
