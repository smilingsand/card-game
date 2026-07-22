import type { Card, Rank } from "../../../platform/types";
import type { TurnAction } from "../turns";
import { rankExpertCandidates } from "./candidate-generator";
import { generateHandPlans, type HandPlanPerformanceBudget } from "./hand-plan-generator";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;
type LeadPlay = Extract<TurnAction, { readonly type: "play" }>;

export interface FollowUpPerformanceBudget {
  readonly followUpCandidateCount: { readonly default: number; readonly max: number };
}

export interface FollowUpPlan {
  readonly actionId: string;
  readonly phase: SituationAnalysis["phase"];
  readonly nextLeadAction: Extract<TurnAction, { readonly type: "play" }> | null;
  readonly nextLead: {
    readonly cardIds: readonly string[];
    readonly pattern: string;
  } | null;
  readonly estimatedTurnsBeforeNextLead: number;
  readonly estimatedTurnsAfterNextLead: number;
  readonly estimatedTurnsDelta: number;
  readonly retainsControlPotential: boolean;
  readonly createsRunoutPath: boolean;
  readonly noUsefulFollowUp: boolean;
  readonly evaluatedCandidateCount: number;
}

export interface PlanFollowUpInput {
  /** 当前动作仅用于将路线结果与动作绑定；不以其推测对手后续出牌。 */
  readonly action: TurnAction;
  readonly postAction: Pick<PostActionHandEvaluation, "remainingHand">;
  readonly situation: SituationAnalysis;
  /** 必须是规则引擎已裁决、且假定己方已取得领出权的完整候选。 */
  readonly legalLeadActions: readonly TurnAction[];
  readonly levelRank: LevelRank;
  readonly handPlanPerformanceBudget: HandPlanPerformanceBudget;
  readonly performanceBudget: FollowUpPerformanceBudget;
}

const actionId = (action: TurnAction) =>
  action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${[...action.cardIds].sort().join(",")}`;

function candidateLimit(budget: FollowUpPerformanceBudget, available: number): number {
  const { default: requested, max } = budget.followUpCandidateCount;
  if (!Number.isInteger(requested) || !Number.isInteger(max) || requested < 1 || max < requested)
    throw new Error("FollowUp 候选性能预算必须是递增的正整数配置");
  return Math.min(requested, max, available);
}

function isOwnedPlay(
  action: TurnAction,
  handIds: ReadonlySet<string>
): action is Extract<TurnAction, { readonly type: "play" }> {
  return (
    action.type === "play" &&
    new Set(action.cardIds).size === action.cardIds.length &&
    action.cardIds.every((id) => handIds.has(id))
  );
}

function controlPotential(hand: readonly Card[], levelRank: LevelRank): boolean {
  const structure = analyzeHandStructure(hand, levelRank);
  return (
    structure.control.jokerCardIds.length > 0 ||
    structure.control.levelCardIds.length > 0 ||
    structure.control.aceCardIds.length > 0 ||
    structure.control.bombCardIds.length > 0 ||
    structure.control.straightFlushCardIds.length > 0
  );
}

/**
 * 只前看“己方已经重新取得领出权”的下一手：候选必须由规则引擎提供，
 * 按 HandPlan 质量稳定排序并截断，不构造动作也不采样任何对手隐藏信息。
 */
export function planFollowUp(input: PlanFollowUpInput): FollowUpPlan {
  const beforeStructure = analyzeHandStructure(input.postAction.remainingHand, input.levelRank);
  const beforePlans = generateHandPlans({
    structure: beforeStructure,
    performanceBudget: input.handPlanPerformanceBudget
  });
  const estimatedTurnsBeforeNextLead = beforePlans[0]?.metrics.estimatedTurns ?? 0;
  const handIds = new Set(input.postAction.remainingHand.map((card) => card.id));
  const eligible: readonly LeadPlay[] = input.legalLeadActions.filter((action) =>
    isOwnedPlay(action, handIds)
  );
  const ranked = (
    rankExpertCandidates({
      legalActions: eligible,
      structure: beforeStructure,
      handPlans: beforePlans
    }) as readonly LeadPlay[]
  ).slice(0, candidateLimit(input.performanceBudget, eligible.length));

  const scored = ranked.map((action, index) => {
    const playedIds = new Set(action.cardIds);
    const remainingHand = input.postAction.remainingHand.filter((card) => !playedIds.has(card.id));
    const structure = analyzeHandStructure(remainingHand, input.levelRank);
    const plans = generateHandPlans({
      structure,
      performanceBudget: input.handPlanPerformanceBudget
    });
    const estimatedTurnsAfterNextLead = plans[0]?.metrics.estimatedTurns ?? 0;
    const retainsControlPotential = controlPotential(remainingHand, input.levelRank);
    return {
      action,
      index,
      estimatedTurnsAfterNextLead,
      retainsControlPotential,
      createsRunoutPath: remainingHand.length === 0 || estimatedTurnsAfterNextLead <= 1
    };
  });
  const best = [...scored].sort((left, right) => {
    if (left.createsRunoutPath !== right.createsRunoutPath)
      return Number(right.createsRunoutPath) - Number(left.createsRunoutPath);
    if (left.estimatedTurnsAfterNextLead !== right.estimatedTurnsAfterNextLead)
      return left.estimatedTurnsAfterNextLead - right.estimatedTurnsAfterNextLead;
    if (left.retainsControlPotential !== right.retainsControlPotential)
      return Number(right.retainsControlPotential) - Number(left.retainsControlPotential);
    const leftKey = [...left.action.cardIds].sort().join(",");
    const rightKey = [...right.action.cardIds].sort().join(",");
    return leftKey.localeCompare(rightKey) || left.index - right.index;
  })[0];

  if (!best)
    return {
      actionId: actionId(input.action),
      phase: input.situation.phase,
      nextLeadAction: null,
      nextLead: null,
      estimatedTurnsBeforeNextLead,
      estimatedTurnsAfterNextLead: estimatedTurnsBeforeNextLead,
      estimatedTurnsDelta: 0,
      retainsControlPotential: false,
      createsRunoutPath: false,
      noUsefulFollowUp: true,
      evaluatedCandidateCount: 0
    };

  return {
    actionId: actionId(input.action),
    phase: input.situation.phase,
    nextLeadAction: best.action,
    nextLead: {
      cardIds: [...best.action.cardIds].sort(),
      pattern: best.action.interpretation.type
    },
    estimatedTurnsBeforeNextLead,
    estimatedTurnsAfterNextLead: best.estimatedTurnsAfterNextLead,
    estimatedTurnsDelta: best.estimatedTurnsAfterNextLead - estimatedTurnsBeforeNextLead,
    retainsControlPotential: best.retainsControlPotential,
    createsRunoutPath: best.createsRunoutPath,
    noUsefulFollowUp: false,
    evaluatedCandidateCount: scored.length
  };
}
