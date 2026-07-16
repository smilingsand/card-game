import type { TurnAction } from "../turns";
import type { ContestEvaluation } from "./contest-evaluator";
import type { ControlResourceEvaluation } from "./control-resource-evaluator";
import type { FollowUpPlan } from "./follow-up-planner";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

export interface ActionFeatureSnapshot {
  readonly actionType: TurnAction["type"];
  readonly cardsPlayed: number;
  readonly isPass: boolean;
  readonly blocksOpponent: boolean;
  readonly helpsPartner: boolean;
  readonly postAction: Pick<PostActionHandEvaluation, "delta" | "lowValueWildcardUse">;
  readonly control: Pick<
    ControlResourceEvaluation,
    "spendsLastControlResource" | "preservesRecoveryPoint" | "opportunityCost" | "exception"
  >;
  readonly followUp: Pick<
    FollowUpPlan,
    "noUsefulFollowUp" | "createsRunoutPath" | "retainsControlPotential"
  >;
  readonly contest: Pick<ContestEvaluation, "contestValue" | "shouldContest">;
}
export interface ExtractActionFeaturesInput {
  readonly action: TurnAction;
  readonly situation: Pick<SituationAnalysis, "opponentThreat" | "teammate">;
  readonly postAction: Pick<PostActionHandEvaluation, "delta" | "lowValueWildcardUse">;
  readonly control: Pick<
    ControlResourceEvaluation,
    "spendsLastControlResource" | "preservesRecoveryPoint" | "opportunityCost" | "exception"
  >;
  readonly followUp: Pick<
    FollowUpPlan,
    "noUsefulFollowUp" | "createsRunoutPath" | "retainsControlPotential"
  >;
  readonly contest: Pick<ContestEvaluation, "contestValue" | "shouldContest">;
}
/** 仅聚合已完成的派生分析；绝不重算、裁决或读取隐藏信息。 */
export function extractActionFeatures(input: ExtractActionFeaturesInput): ActionFeatureSnapshot {
  const isPass = input.action.type === "pass";
  return {
    actionType: input.action.type,
    cardsPlayed: isPass ? 0 : input.action.cardIds.length,
    isPass,
    blocksOpponent: !isPass && ["high", "critical"].includes(input.situation.opponentThreat.level),
    helpsPartner: input.situation.teammate.isHolding || input.control.exception === "team_support",
    postAction: input.postAction,
    control: input.control,
    followUp: input.followUp,
    contest: input.contest
  };
}
