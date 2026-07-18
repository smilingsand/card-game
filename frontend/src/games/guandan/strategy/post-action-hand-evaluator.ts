import type { Card, Rank } from "../../../platform/types";
import type { TurnAction } from "../turns";
import {
  type HandStructureAnalysis,
  type HandStructureGroup,
  type HandStructureKind
} from "./hand-structure-analyzer";
import { type HandPlan, type HandPlanPerformanceBudget } from "./hand-plan-generator";
import { expertHandAnalysisCache } from "./hand-analysis-cache";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;

export interface PostActionPerformanceBudget {
  /** 由 profile/config 注入的重组工作量；不是规则或算法内联默认值。 */
  readonly postActionReplanCount: { readonly default: number; readonly max: number };
}

export interface PostActionHandSnapshot {
  readonly estimatedTurns: number;
  readonly naturalBombCount: number;
  readonly wildcardBombCount: number;
  readonly completeCombinationCount: number;
  readonly lowSingleCount: number;
  readonly weakPairCount: number;
  readonly controlCount: number;
  readonly recoveryCount: number;
  readonly structuralIntegrity: number;
  readonly finishability: number;
  readonly deadHandRisk: number;
}

export interface HandQualityDelta {
  readonly estimatedTurns: number;
  readonly structuralIntegrity: number;
  readonly finishability: number;
  readonly deadHandRisk: number;
  readonly lowSingleCount: number;
  readonly weakPairCount: number;
  readonly controlCount: number;
  readonly recoveryCount: number;
}

export type DestroyedGroupSeverity = "severe" | "high" | "medium";
type DestroyableHandStructureKind = Exclude<HandStructureKind, "single">;

export interface DestroyedHandGroup {
  readonly kind: DestroyableHandStructureKind;
  readonly source: HandStructureGroup["source"];
  readonly cardIds: readonly string[];
  readonly severity: DestroyedGroupSeverity;
}

export interface EvaluatePostActionHandInput {
  /** 已由规则层验证合法的动作；本模块只做实体牌归属防御性校验。 */
  readonly action: TurnAction;
  readonly selfHand: readonly Card[];
  readonly levelRank: LevelRank;
  readonly structure?: HandStructureAnalysis;
  readonly handPlans?: readonly HandPlan[];
  readonly performanceBudget: PostActionPerformanceBudget;
  readonly handPlanPerformanceBudget: HandPlanPerformanceBudget;
  /** 上游局面模块提供的例外标签；本模块不自行判定或放行尾局例外。 */
  readonly exceptionContext?: "endgame_block" | "direct_finish" | "team_support";
}

export interface PostActionHandEvaluation {
  readonly actionId: string;
  readonly semantics: "play_removes_exact_cards" | "pass_keeps_hand";
  readonly remainingHand: readonly Card[];
  /** Immutable analysis already required for the post-action score; downstream planners may reuse it. */
  readonly afterAnalysis?: {
    readonly structure: HandStructureAnalysis;
    readonly handPlans: readonly HandPlan[];
  };
  readonly before: PostActionHandSnapshot;
  readonly after: PostActionHandSnapshot;
  readonly delta: HandQualityDelta;
  readonly destroyedGroups: readonly DestroyedHandGroup[];
  readonly producedDeadCards: readonly string[];
  readonly lowValueWildcardUse: boolean;
  /** 仅记录上游给出的例外证据，不改变合法性或惩罚。 */
  readonly acceptableExceptions: readonly string[];
  readonly replanCount: number;
}

function validateReplanBudget(budget: PostActionPerformanceBudget): number {
  const { default: requested, max } = budget.postActionReplanCount;
  if (!Number.isInteger(requested) || !Number.isInteger(max) || requested < 1 || max < requested)
    throw new Error("PostAction 重组性能预算必须是递增的正整数配置");
  return requested;
}

function actionId(action: TurnAction): string {
  return action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${[...action.cardIds].sort().join(",")}`;
}

function metricsSnapshot(plan: HandPlan): PostActionHandSnapshot {
  const metrics = plan.metrics;
  return {
    estimatedTurns: metrics.estimatedTurns,
    naturalBombCount: metrics.naturalBombCount,
    wildcardBombCount: plan.groups.filter(
      (group) => group.kind === "normal-bomb" && group.source === "wildcard_completed"
    ).length,
    completeCombinationCount: plan.groups.filter((group) => group.kind !== "single").length,
    lowSingleCount: metrics.lowSingleCount,
    weakPairCount: metrics.weakPairCount,
    controlCount: metrics.control.count,
    recoveryCount: metrics.recovery.count,
    structuralIntegrity: metrics.structuralIntegrity,
    finishability: metrics.finishability,
    deadHandRisk: metrics.deadHandRisk
  };
}

function snapshotDelta(
  before: PostActionHandSnapshot,
  after: PostActionHandSnapshot
): HandQualityDelta {
  return {
    estimatedTurns: after.estimatedTurns - before.estimatedTurns,
    structuralIntegrity: after.structuralIntegrity - before.structuralIntegrity,
    finishability: after.finishability - before.finishability,
    deadHandRisk: after.deadHandRisk - before.deadHandRisk,
    lowSingleCount: after.lowSingleCount - before.lowSingleCount,
    weakPairCount: after.weakPairCount - before.weakPairCount,
    controlCount: after.controlCount - before.controlCount,
    recoveryCount: after.recoveryCount - before.recoveryCount
  };
}

function severityFor(kind: HandStructureKind): DestroyedGroupSeverity | undefined {
  if (["normal-bomb", "straight-flush", "four-jokers"].includes(kind)) return "severe";
  if (["straight", "three-consecutive-pairs", "steel-plate"].includes(kind)) return "high";
  if (["three-with-pair", "pair"].includes(kind)) return "medium";
  return undefined;
}

function destroyedGroups(
  structure: HandStructureAnalysis,
  playedIds: ReadonlySet<string>
): readonly DestroyedHandGroup[] {
  const result = structure.groups.flatMap((group) => {
    const severity = severityFor(group.kind);
    // Playing an entire already-natural group (for example a natural pair in
    // response to a pair) consumes that group; it does not split or destroy
    // it. Only a partial overlap is structural destruction.
    const overlapCount = group.cardIds.filter((id) => playedIds.has(id)).length;
    if (!severity || overlapCount === 0 || overlapCount === group.cardIds.length) return [];
    return [
      {
        kind: group.kind as DestroyableHandStructureKind,
        source: group.source,
        cardIds: group.cardIds,
        severity
      }
    ];
  });
  const unique = new Map(
    result.map((group) => [`${group.kind}:${group.source}:${group.cardIds.join(",")}`, group])
  );
  return [...unique.values()].sort((left, right) =>
    `${left.kind}:${left.source}:${left.cardIds.join(",")}`.localeCompare(
      `${right.kind}:${right.source}:${right.cardIds.join(",")}`
    )
  );
}

function generatedPlans(
  structure: HandStructureAnalysis,
  budget: HandPlanPerformanceBudget
): readonly HandPlan[] {
  return expertHandAnalysisCache.handPlans({
    structure,
    performanceBudget: budget,
    rulesVersion: "guandan-v5"
  });
}

function lowValueWildcardUse(
  action: TurnAction,
  hand: readonly Card[],
  levelRank: LevelRank
): boolean {
  if (action.type !== "play") return false;
  const wildcardIds = new Set(
    hand.filter((card) => card.rank === levelRank && card.suit === "hearts").map((card) => card.id)
  );
  return action.cardIds.some((id) => wildcardIds.has(id)) && action.cardIds.length <= 4;
}

/**
 * 纯动作后手牌评估：移除已验证 play 的确切实体牌，再重跑结构与有界组牌。
 * 它不验证规则、不读取隐藏信息、不决定是否争牌，也不自行放行任何尾局例外。
 */
export function evaluatePostActionHand(
  input: EvaluatePostActionHandInput
): PostActionHandEvaluation {
  const requestedReplanCount = validateReplanBudget(input.performanceBudget);
  const beforeStructure =
    input.structure ??
    expertHandAnalysisCache.structure({
      hand: input.selfHand,
      levelRank: input.levelRank,
      rulesVersion: "guandan-v5"
    });
  const beforePlans =
    input.handPlans ?? generatedPlans(beforeStructure, input.handPlanPerformanceBudget);
  const beforePlan = beforePlans[0];
  if (!beforePlan) throw new Error("动作后评估需要至少一个当前 HandPlan");

  if (input.action.type === "pass") {
    const before = metricsSnapshot(beforePlan);
    return {
      actionId: actionId(input.action),
      semantics: "pass_keeps_hand",
      remainingHand: [...input.selfHand],
      afterAnalysis: { structure: beforeStructure, handPlans: beforePlans },
      before,
      after: before,
      delta: snapshotDelta(before, before),
      destroyedGroups: [],
      producedDeadCards: [],
      lowValueWildcardUse: false,
      acceptableExceptions: [],
      replanCount: 0
    };
  }

  const uniqueIds = new Set(input.action.cardIds);
  if (uniqueIds.size !== input.action.cardIds.length) throw new Error("动作中包含重复实体牌 ID");
  const handIds = new Set(input.selfHand.map((card) => card.id));
  if (input.action.cardIds.some((id) => !handIds.has(id)))
    throw new Error("动作包含不属于己方手牌的实体牌");

  const remainingHand = input.selfHand.filter((card) => !uniqueIds.has(card.id));
  const afterStructure = expertHandAnalysisCache.structure({
    hand: remainingHand,
    levelRank: input.levelRank,
    rulesVersion: "guandan-v5"
  });
  const afterPlans = generatedPlans(afterStructure, input.handPlanPerformanceBudget).slice(
    0,
    requestedReplanCount
  );
  const afterPlan = afterPlans[0];
  if (!afterPlan) throw new Error("动作后重组未生成 HandPlan");
  const before = metricsSnapshot(beforePlan);
  const after = metricsSnapshot(afterPlan);
  const beforeLowSingles = new Set(beforeStructure.loose.lowSingleCardIds);
  const producedDeadCards = afterStructure.loose.lowSingleCardIds.filter(
    (id) => !beforeLowSingles.has(id)
  );

  return {
    actionId: actionId(input.action),
    semantics: "play_removes_exact_cards",
    remainingHand,
    afterAnalysis: { structure: afterStructure, handPlans: afterPlans },
    before,
    after,
    delta: snapshotDelta(before, after),
    destroyedGroups: destroyedGroups(beforeStructure, uniqueIds),
    producedDeadCards,
    lowValueWildcardUse: lowValueWildcardUse(input.action, input.selfHand, input.levelRank),
    acceptableExceptions: input.exceptionContext
      ? [
          input.exceptionContext === "endgame_block"
            ? "endgame_exception_requires_external_context"
            : `${input.exceptionContext}_requires_external_context`
        ]
      : [],
    replanCount: afterPlans.length
  };
}
