import type { Rank } from "../../../platform/types";
import type { TurnAction } from "../turns";
import { rankExpertCandidateEntries } from "./candidate-generator";
import type { HandPlanPerformanceBudget } from "./hand-plan-generator";
import type { HandStructureAnalysis } from "./hand-structure-analyzer";
import { expertHandAnalysisCache } from "./hand-analysis-cache";
import type { HandPlan } from "./hand-plan-generator";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;
type LeadPlay = Extract<TurnAction, { readonly type: "play" }>;

function comparePriority(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = right[index] - left[index];
    if (difference) return difference;
  }
  return 0;
}

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
  /**
   * Audit record for the only permitted FollowUp early-stop: every omitted
   * legal lead is below the exact deterministic Top-N boundary.  This never
   * means that a top-level expert candidate was skipped.
   */
  readonly candidateSelection: FollowUpCandidateSelectionProof;
}

export interface FollowUpCandidateSelectionProof {
  readonly boundProven: boolean;
  readonly reason: "no_eligible_lead" | "all_eligible_leads_required" | "exact_top_n_boundary";
  readonly eligibleCandidateCount: number;
  readonly evaluatedCandidateCount: number;
  readonly skippedCandidateCount: number;
  readonly cutoffActionKey: string | null;
  readonly strongestSkippedActionKey: string | null;
  /** The ranking key intentionally excludes wildcard alias serialization.
   * Equal keys are therefore resolved by the original complete A-layer order. */
  readonly boundaryTieResolvedByStableInputOrder: boolean;
  /** Lexicographic ranking tuple: selected cutoff is the lower bound; the
   * strongest omitted candidate is the upper bound. Action key is final tie-break. */
  readonly selectedLowerBound: readonly number[] | null;
  readonly skippedUpperBound: readonly number[] | null;
}

/**
 * Exact, decision-scoped cache for the expensive analysis after a prospective
 * next lead.  The key is deliberately a normalized remaining-hand state plus
 * every configuration value which can affect hand-plan output.  It is shared
 * by all FollowUpPlanner invocations in one expert decision, never across a
 * profile/version boundary.
 */
export interface FollowUpSuccessorAnalysis {
  readonly estimatedTurnsAfterNextLead: number;
  readonly retainsControlPotential: boolean;
  readonly createsRunoutPath: boolean;
}

export interface FollowUpSuccessorAnalysisCache {
  get(key: string): FollowUpSuccessorAnalysis | undefined;
  set(key: string, value: FollowUpSuccessorAnalysis): void;
}

export interface PlanFollowUpInput {
  /** 当前动作仅用于将路线结果与动作绑定；不以其推测对手后续出牌。 */
  readonly action: TurnAction;
  readonly postAction: Pick<PostActionHandEvaluation, "remainingHand" | "afterAnalysis">;
  readonly situation: SituationAnalysis;
  /** 必须是规则引擎已裁决、且假定己方已取得领出权的完整候选。 */
  readonly legalLeadActions: readonly TurnAction[];
  readonly levelRank: LevelRank;
  readonly handPlanPerformanceBudget: HandPlanPerformanceBudget;
  readonly performanceBudget: FollowUpPerformanceBudget;
  /** Optional exact cache supplied by the expert decision orchestration. */
  readonly successorAnalysisCache?: FollowUpSuccessorAnalysisCache;
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

function controlPotential(structure: HandStructureAnalysis): boolean {
  return (
    structure.control.jokerCardIds.length > 0 ||
    structure.control.levelCardIds.length > 0 ||
    structure.control.aceCardIds.length > 0 ||
    structure.control.bombCardIds.length > 0 ||
    structure.control.straightFlushCardIds.length > 0
  );
}

function successorAnalysisKey(
  remainingHand: readonly { readonly id: string }[],
  levelRank: LevelRank,
  budget: HandPlanPerformanceBudget
): string {
  return [
    levelRank,
    `top=${budget.handPlanTopN.default}/${budget.handPlanTopN.max}`,
    remainingHand
      .map((card) => card.id)
      .sort()
      .join(",")
  ].join("|");
}

/**
 * 只前看“己方已经重新取得领出权”的下一手：候选必须由规则引擎提供，
 * 按 HandPlan 质量稳定排序并截断，不构造动作也不采样任何对手隐藏信息。
 */
export function planFollowUp(input: PlanFollowUpInput): FollowUpPlan {
  const beforeStructure =
    input.postAction.afterAnalysis?.structure ??
    expertHandAnalysisCache.structure({
      hand: input.postAction.remainingHand,
      levelRank: input.levelRank,
      rulesVersion: "guandan-v5"
    });
  const beforePlans: readonly HandPlan[] =
    input.postAction.afterAnalysis?.handPlans ??
    expertHandAnalysisCache.handPlans({
      structure: beforeStructure,
      performanceBudget: input.handPlanPerformanceBudget,
      rulesVersion: "guandan-v5"
    });
  const estimatedTurnsBeforeNextLead = beforePlans[0]?.metrics.estimatedTurns ?? 0;
  const handIds = new Set(input.postAction.remainingHand.map((card) => card.id));
  const eligible: readonly LeadPlay[] = input.legalLeadActions.filter((action) =>
    isOwnedPlay(action, handIds)
  );
  const allRanked = rankExpertCandidateEntries({
    legalActions: eligible,
    structure: beforeStructure,
    handPlans: beforePlans
  });
  const limit = candidateLimit(input.performanceBudget, eligible.length);
  const ranked = allRanked.slice(0, limit);
  const cutoff = ranked.at(-1);
  const strongestSkipped = allRanked[limit];
  const candidateSelection: FollowUpCandidateSelectionProof = !cutoff
    ? {
        boundProven: true,
        reason: "no_eligible_lead",
        eligibleCandidateCount: eligible.length,
        evaluatedCandidateCount: 0,
        skippedCandidateCount: 0,
        cutoffActionKey: null,
        strongestSkippedActionKey: null,
        boundaryTieResolvedByStableInputOrder: false,
        selectedLowerBound: null,
        skippedUpperBound: null
      }
    : !strongestSkipped
      ? {
          boundProven: true,
          reason: "all_eligible_leads_required",
          eligibleCandidateCount: eligible.length,
          evaluatedCandidateCount: ranked.length,
          skippedCandidateCount: 0,
          cutoffActionKey: cutoff.actionKey,
          strongestSkippedActionKey: null,
          boundaryTieResolvedByStableInputOrder: false,
          selectedLowerBound: cutoff.priority,
          skippedUpperBound: null
        }
      : {
          // `rankExpertCandidates` applies this order to every legal lead.
          // Equal keys are strict aliases for this pre-analysis ranking and
          // retain their original complete A-layer order as the final stable
          // tie-break; any inverse comparison rejects the early-stop.
          boundProven: comparePriority(cutoff.priority, strongestSkipped.priority) <= 0,
          reason: "exact_top_n_boundary",
          eligibleCandidateCount: eligible.length,
          evaluatedCandidateCount: ranked.length,
          skippedCandidateCount: allRanked.length - ranked.length,
          cutoffActionKey: cutoff.actionKey,
          strongestSkippedActionKey: strongestSkipped.actionKey,
          boundaryTieResolvedByStableInputOrder:
            comparePriority(cutoff.priority, strongestSkipped.priority) === 0,
          selectedLowerBound: cutoff.priority,
          skippedUpperBound: strongestSkipped.priority
        };
  if (!candidateSelection.boundProven)
    throw new Error("FollowUp early-stop 缺少严格排序上下界证明，拒绝跳过合法领出候选");
  const scored = ranked.map(({ action }, index) => {
    // `eligible` is narrowed by isOwnedPlay above; the generic ranking API
    // intentionally accepts TurnAction, so restore that proven narrowing at
    // the boundary rather than widening any subsequent rule operation.
    const leadAction = action as LeadPlay;
    const playedIds = new Set(leadAction.cardIds);
    const remainingHand = input.postAction.remainingHand.filter((card) => !playedIds.has(card.id));
    const key = successorAnalysisKey(
      remainingHand,
      input.levelRank,
      input.handPlanPerformanceBudget
    );
    let analysis = input.successorAnalysisCache?.get(key);
    if (!analysis) {
      const structure = expertHandAnalysisCache.structure({
        hand: remainingHand,
        levelRank: input.levelRank,
        rulesVersion: "guandan-v5"
      });
      const plans = expertHandAnalysisCache.handPlans({
        structure,
        performanceBudget: input.handPlanPerformanceBudget,
        rulesVersion: "guandan-v5"
      });
      const estimatedTurnsAfterNextLead = plans[0]?.metrics.estimatedTurns ?? 0;
      analysis = {
        estimatedTurnsAfterNextLead,
        retainsControlPotential: controlPotential(structure),
        createsRunoutPath: remainingHand.length === 0 || estimatedTurnsAfterNextLead <= 1
      };
      input.successorAnalysisCache?.set(key, analysis);
    }
    return {
      action: leadAction,
      index,
      ...analysis
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
      evaluatedCandidateCount: 0,
      candidateSelection
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
    evaluatedCandidateCount: scored.length,
    candidateSelection
  };
}
