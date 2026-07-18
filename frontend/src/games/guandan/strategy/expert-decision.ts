import type { Seat } from "../../../platform/types";
import type { BotView } from "../bot-view";
import type { TurnState } from "../turns";
import { extractActionFeatures } from "./action-feature-extractor";
import { scoreAction } from "./action-scorer";
import { rankExpertCandidates } from "./candidate-generator";
import { createContestContext, evaluateContestAction } from "./contest-evaluator";
import { evaluateControlResources } from "./control-resource-evaluator";
import { createDecision, type StrategyDecision } from "./decision-explanation";
import {
  evaluateExpertStrategyRules,
  type StrategyProfileSnapshot
} from "./expert-strategy-knowledge-base";
import { planFollowUp } from "./follow-up-planner";
import type { HandPlanPerformanceBudget } from "./hand-plan-generator";
import { expertHandAnalysisCache, withoutExpertHandAnalysisCache } from "./hand-analysis-cache";
import {
  evaluatePostActionHand,
  type PostActionPerformanceBudget
} from "./post-action-hand-evaluator";
import { analyzeSituation } from "./situation-analyzer";
import {
  createCompleteLeadCatalogIndex,
  getCompleteLegalCandidates
} from "../rule-complete-legal-actions";
import { DecisionCache, createDecisionFingerprint, type CacheStatistics } from "./decision-cache";
import {
  canonicalizeSemanticCandidates,
  canonicalPhysicalActionKey
} from "./semantic-action-candidates";
import {
  selectFollowUpCandidates,
  type FollowUpMandatoryReason
} from "./follow-up-candidate-selection";
import { evaluateDeadHandRiskProxy } from "./dead-hand-risk-proxy";

export interface ExpertDecisionBudget
  extends HandPlanPerformanceBudget, PostActionPerformanceBudget {
  /** ADR-0018: candidates admitted to successor-hand analysis. */
  readonly postActionCandidateCount?: { readonly default: number; readonly max: number };
  readonly followUpCandidateCount: { readonly default: number; readonly max: number };
}

export const EXPERT_DECISION_BUDGET: ExpertDecisionBudget = {
  handPlanTopN: { default: 4, max: 4 },
  postActionReplanCount: { default: 1, max: 1 },
  // ADR-0021 p2.5a-depth-24-v1: mandatory candidates may expand this
  // deterministic deep-evaluation set to 32, but ordinary candidates do not.
  postActionCandidateCount: { default: 24, max: 32 },
  followUpCandidateCount: { default: 24, max: 32 }
};

export const EXPERIMENTAL_DECISION_BUDGET: ExpertDecisionBudget = {
  ...EXPERT_DECISION_BUDGET,
  postActionCandidateCount: { default: 32, max: 32 },
  followUpCandidateCount: { default: 32, max: 32 }
};

/**
 * Benchmark/research-only reference budget. It is deliberately supplied as a
 * budget override, never a selectable normal/expert production profile.
 */
export function createExperimentalFullBenchmarkBudget(
  candidateCount: number
): ExpertDecisionBudget {
  return {
    ...EXPERIMENTAL_DECISION_BUDGET,
    postActionCandidateCount: { default: candidateCount, max: candidateCount },
    followUpCandidateCount: { default: candidateCount, max: candidateCount }
  };
}

/** Exact public-decision cache; it never stores an approximate or normal result. */
export const expertDecisionCache = new DecisionCache<StrategyDecision>(512);

export function getExpertDecisionCacheStatistics(): CacheStatistics {
  return expertDecisionCache.statistics();
}

/** Test/diagnostic hook. Production reuse remains capacity-bounded LRU. */
export function clearExpertDecisionCache(): void {
  expertDecisionCache.clear();
}

export interface ChooseExpertBotDecisionInput {
  /** A 层已经由规则引擎完整裁决的 BotView；本入口绝不读取桌面完整状态。 */
  readonly view: BotView;
  readonly profile: StrategyProfileSnapshot;
  readonly performanceBudget?: ExpertDecisionBudget;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function actionSummary(action: import("../turns").TurnAction): Record<string, unknown> {
  return action.type === "play"
    ? {
        actor: action.actor,
        cardIds: [...action.cardIds].sort(),
        interpretation: action.interpretation,
        type: action.type
      }
    : { actor: action.actor, type: action.type };
}

function rankValue(
  rank: import("../../../platform/types").Rank,
  levelRank: import("../../../platform/types").Rank
): number {
  if (rank === "big-joker") return 17;
  if (rank === "small-joker") return 16;
  if (rank === levelRank) return 15;
  return ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].indexOf(rank) + 2;
}

/**
 * Three-with-pair compares only its main triple in the rule layer, but the
 * attachment remains a real resource choice.  This extracts an exact,
 * light-stage attachment value from own cards and the already-public action
 * interpretation; it never recognises a successor hand.
 */
function threeWithPairAttachmentValue(input: {
  readonly action: import("../turns").TurnAction;
  readonly selfHand: readonly import("../../../platform/types").Card[];
  readonly levelRank: import("../../../platform/types").Rank;
}): number | undefined {
  if (input.action.type !== "play" || input.action.interpretation.type !== "three-with-pair")
    return undefined;
  const cardsById = new Map(input.selfHand.map((card) => [card.id, card]));
  const counts = new Map<number, number>();
  for (const cardId of input.action.cardIds) {
    const card = cardsById.get(cardId);
    if (!card) return undefined;
    const projected = input.action.interpretation.wildcardAs[cardId]?.rank ?? card.rank;
    const value = rankValue(projected, input.levelRank);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].find(([, count]) => count === 2)?.[0];
}

function fingerprintFor(input: ChooseExpertBotDecisionInput, budget: ExpertDecisionBudget): string {
  const lastEvent = input.view.publicEvents.at(-1);
  return createDecisionFingerprint({
    view: input.view,
    currentWinningPlaySummary:
      input.view.highestSeat === undefined || lastEvent === undefined
        ? undefined
        : stableJson(lastEvent.payload),
    legalActionSummary: stableJson({
      legalActions: input.view.legalActions
        .map(actionSummary)
        .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
      performanceBudget: budget
    }),
    profile: input.profile
  });
}

function leadState(view: BotView, handIds: readonly string[]): TurnState {
  const emptyHands = { east: [], south: [], west: [], north: [] } as Record<Seat, string[]>;
  emptyHands[view.selfSeat] = [...handIds];
  return {
    hands: emptyHands,
    current: view.selfSeat,
    leader: view.selfSeat,
    passes: 0,
    finished: []
  };
}

function signals(input: {
  situation: ReturnType<typeof analyzeSituation>;
  action: import("../turns").TurnAction;
  postAction: ReturnType<typeof evaluatePostActionHand>;
  control: ReturnType<typeof evaluateControlResources>;
  lowestResponseByPattern: ReadonlyMap<string, readonly number[]>;
  lowestThreeWithPairAttachmentByMain: ReadonlyMap<number, number>;
  selfHand: readonly import("../../../platform/types").Card[];
  levelRank: import("../../../platform/types").Rank;
}): import("./expert-strategy-knowledge-base").StrategySignals {
  const { situation, postAction, control } = input;
  const destroyed = new Set(postAction.destroyedGroups.map((group) => group.kind));
  const overbidsLowestLegalResponse =
    input.action.type === "play" &&
    (() => {
      const action = input.action;
      const lowest = input.lowestResponseByPattern.get(action.interpretation.type);
      if (!lowest) return false;
      return action.interpretation.comparisonKey.some(
        (value, index) =>
          value !== lowest[index] &&
          action.interpretation.comparisonKey
            .slice(0, index)
            .every((prefix, prefixIndex) => prefix === lowest[prefixIndex]) &&
          value > lowest[index]
      );
    })();
  const attachmentValue = threeWithPairAttachmentValue({
    action: input.action,
    selfHand: input.selfHand,
    levelRank: input.levelRank
  });
  const mainTriple =
    input.action.type === "play" && input.action.interpretation.type === "three-with-pair"
      ? input.action.interpretation.comparisonKey[0]
      : undefined;
  const overbidsLowestThreeWithPairAttachment =
    mainTriple !== undefined &&
    attachmentValue !== undefined &&
    attachmentValue >
      (input.lowestThreeWithPairAttachmentByMain.get(mainTriple) ?? attachmentValue);
  return {
    preservesNaturalPattern: postAction.destroyedGroups.length === 0,
    hasNaturalAlternative: false,
    usesWildcardCompletedPattern: false,
    usesTwoWildcards: false,
    breaksNaturalBomb: destroyed.has("normal-bomb"),
    breaksStraight: destroyed.has("straight"),
    breaksSteelPlate: destroyed.has("steel-plate"),
    breaksConsecutivePairs: destroyed.has("three-consecutive-pairs"),
    breaksTripleWithPair: destroyed.has("three-with-pair"),
    reducesUnrecoverableLowSingles: postAction.delta.lowSingleCount < 0,
    createsIsolatedTriple: false,
    createsWeakPairs: postAction.delta.weakPairCount > 0,
    preservesRecoveryPoint: control.preservesRecoveryPoint,
    rolePrefersTurnReduction: situation.role.kind === "attack",
    rolePrefersControl: situation.role.kind === "support",
    directFinish: postAction.remainingHand.length === 0,
    endgameBlock: situation.phase === "endgame" && situation.opponentThreat.level === "critical",
    opponentHasManyCards: situation.opponentThreat.level === "low",
    lowOpponentThreat: situation.opponentThreat.level === "low",
    opponentHasOneCard: situation.opponentThreat.immediateFinishSeats.length > 0,
    opponentHasTwoCards: situation.opponentThreat.level === "high",
    opponentHasFiveCards: situation.opponentThreat.level === "medium",
    targetLikelyPair: false,
    targetLikelyStraightOrTripleWithPair: false,
    teammateHolding: situation.teammate.isHolding,
    teammateSprinting: situation.teammate.isSprinting,
    teammateUnableToControl: situation.teammate.remainingCards > 6,
    spendsControlSequence: control.spentResourceCardIds.length >= 2,
    hasManyLowSingles: postAction.before.lowSingleCount >= 3,
    preservesSameTypeRecovery: control.preservesRecoveryPoint,
    opponentHasCurrentControl: situation.opponentThreat.currentControlSeat !== undefined,
    overbidsLowestLegalResponse,
    overbidsLowestThreeWithPairAttachment,
    takesOverTeammateControl: input.action.type === "play" && situation.teammate.isHolding
  };
}

/**
 * ADR-0018 light stage.  This deliberately contains no successor-hand derived
 * value: it is constructed solely from the current BotView, current hand
 * analysis and the already rule-validated action interpretation.
 */
function lightBaseCandidate(input: {
  readonly action: import("../turns").TurnAction;
  readonly situation: ReturnType<typeof analyzeSituation>;
  readonly rankedIndex: number;
  readonly candidateCount: number;
  readonly profile: StrategyProfileSnapshot;
}) {
  const isPass = input.action.type === "pass";
  const threat = input.situation.opponentThreat.level;
  const contestValue = isPass
    ? 0
    : threat === "critical"
      ? 7
      : threat === "high"
        ? 4
        : threat === "medium"
          ? 2
          : 0;
  const features = {
    actionType: input.action.type,
    cardsPlayed: isPass ? 0 : input.action.cardIds.length,
    isPass,
    blocksOpponent: !isPass && (threat === "high" || threat === "critical"),
    helpsPartner: input.situation.teammate.isHolding,
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
    contest: { contestValue, shouldContest: contestValue > 0 },
    phase: input.situation.phase,
    signals: {
      rolePrefersTurnReduction: input.situation.role.kind === "attack",
      rolePrefersControl: input.situation.role.kind === "support",
      opponentHasManyCards: threat === "low",
      lowOpponentThreat: threat === "low",
      opponentHasOneCard: input.situation.opponentThreat.immediateFinishSeats.length > 0,
      opponentHasTwoCards: threat === "high",
      opponentHasFiveCards: threat === "medium",
      teammateHolding: input.situation.teammate.isHolding,
      teammateSprinting: input.situation.teammate.isSprinting
    }
  } satisfies import("./expert-strategy-knowledge-base").StrategyFeatureSnapshot;
  // Rank is a deterministic secondary preference only; card/pattern and public
  // situation values remain the auditable numerical base score.
  const score = scoreAction({ action: input.action, features, profile: input.profile });
  return {
    features,
    score: score.finalScore * 1000 - input.rankedIndex / Math.max(1, input.candidateCount)
  };
}

function resolvedPostActionBudget(budget: ExpertDecisionBudget) {
  return budget.postActionCandidateCount ?? EXPERT_DECISION_BUDGET.postActionCandidateCount!;
}

/**
 * expert/experimental 的真实生产决策闭环。输入边界固定为 BotView；缺少 expert
 * profile 或 A 层合法动作会直接报错，绝不回退到 normal。
 */
function chooseExpertBotDecisionInternal(
  input: ChooseExpertBotDecisionInput,
  followUpLeadMode: "catalog" | "direct",
  reuseMode: "production" | "differential-baseline" = "production"
): StrategyDecision {
  if (input.profile.id === "normal")
    throw new Error("expert 决策入口不接受 normal profile；请调用 legacy normal path");
  if (input.view.legalActions.length === 0) throw new Error("expert 决策入口需要完整合法动作集合");
  const budget =
    input.performanceBudget ??
    (input.profile.id === "experimental" ? EXPERIMENTAL_DECISION_BUDGET : EXPERT_DECISION_BUDGET);
  const fingerprint = fingerprintFor(input, budget);
  const cached =
    reuseMode === "production" && followUpLeadMode === "catalog"
      ? expertDecisionCache.get(fingerprint)
      : undefined;
  if (cached) return cached;
  const moduleElapsedMilliseconds: Record<string, number> = {};
  const measure = <T>(module: string, work: () => T): T => {
    const started = performance.now();
    try {
      return work();
    } finally {
      moduleElapsedMilliseconds[module] =
        (moduleElapsedMilliseconds[module] ?? 0) + performance.now() - started;
    }
  };
  const structure = measure("handStructure", () =>
    expertHandAnalysisCache.structure({
      hand: input.view.selfHand,
      levelRank: input.view.levelRank,
      rulesVersion: "guandan-v5"
    })
  );
  const handPlans = measure("handPlan", () =>
    expertHandAnalysisCache.handPlans({
      structure,
      performanceBudget: budget,
      rulesVersion: "guandan-v5"
    })
  );
  const situation = measure("situation", () => analyzeSituation(input.view));
  const physicalActions = measure("semanticCanonicalization", () =>
    canonicalizeSemanticCandidates(input.view.legalActions)
  );
  const semanticActions = physicalActions.flatMap((physical) =>
    physical.semanticCandidates.map((candidate) => ({
      action: candidate.canonicalAction,
      aliases: candidate.aliases,
      physicalKey: physical.physicalKey,
      semanticKey: candidate.semanticKey
    }))
  );
  const ranked = measure("candidateRanking", () =>
    rankExpertCandidates({
      legalActions: semanticActions.map(({ action }) => action),
      structure,
      handPlans
    })
  );
  const contestContext = measure("contestContext", () => createContestContext(situation));
  // A prospective follow-up is always a lead. Every legal lead for H\A is a
  // pattern interpretation already present in the leading catalogue for H;
  // filtering that immutable catalogue by remaining physical ids is therefore
  // exact (and preserves its rule-layer sort order). Avoid re-enumerating and
  // re-recognising the whole A layer once per physical current action.
  const rootLeadingCatalogue =
    followUpLeadMode === "catalog"
      ? measure("followUpLeadCatalogue", () =>
          input.view.highestSeat === undefined
            ? input.view.legalActions
            : getCompleteLegalCandidates({
                state: leadState(
                  input.view,
                  input.view.selfHand.map((card) => card.id)
                ),
                selfHand: input.view.selfHand,
                levelRank: input.view.levelRank
              })
        )
      : undefined;
  const followUpLeadCatalogueSource: "view" | "generated" | undefined =
    followUpLeadMode === "catalog"
      ? input.view.highestSeat === undefined
        ? "view"
        : "generated"
      : undefined;
  const rootLeadingCatalogueIndex =
    followUpLeadMode === "catalog"
      ? createCompleteLeadCatalogIndex(
          rootLeadingCatalogue ?? [],
          input.view.selfHand.map((card) => card.id)
        )
      : undefined;
  let followUpLeadProjectionCount = 0;
  let followUpLeadFilteredActionCount = 0;
  // A prospective follow-up lead can reach the same remaining physical hand
  // through different current actions.  This cache only stores pure hand-plan
  // analysis keyed by that normalized successor hand and the full plan budget;
  // it does not merge semantic candidates or public turn state.
  const followUpSuccessorAnalysis = new Map<
    string,
    import("./follow-up-planner").FollowUpSuccessorAnalysis
  >();
  let followUpSuccessorAnalysisCacheHitCount = 0;
  let followUpSuccessorAnalysisCacheMissCount = 0;
  const followUpSuccessorAnalysisCache = {
    get(key: string) {
      const value = followUpSuccessorAnalysis.get(key);
      if (value) followUpSuccessorAnalysisCacheHitCount += 1;
      else followUpSuccessorAnalysisCacheMissCount += 1;
      return value;
    },
    set(key: string, value: import("./follow-up-planner").FollowUpSuccessorAnalysis) {
      followUpSuccessorAnalysis.set(key, value);
    }
  };
  const derivedByPhysicalAction = new Map<
    string,
    {
      readonly postAction: ReturnType<typeof evaluatePostActionHand>;
      readonly control: ReturnType<typeof evaluateControlResources>;
    }
  >();
  const analyzePhysicalAction = (action: import("../turns").TurnAction) => {
    const key = canonicalPhysicalActionKey(action);
    const cachedAnalysis =
      reuseMode === "production" ? derivedByPhysicalAction.get(key) : undefined;
    if (cachedAnalysis) return cachedAnalysis;
    const postAction = measure("postAction", () =>
      evaluatePostActionHand({
        action,
        selfHand: input.view.selfHand,
        levelRank: input.view.levelRank,
        structure,
        handPlans,
        performanceBudget: budget,
        handPlanPerformanceBudget: budget,
        exceptionContext:
          situation.phase === "endgame" && situation.opponentThreat.level === "critical"
            ? "endgame_block"
            : undefined
      })
    );
    const control = measure("control", () =>
      evaluateControlResources({
        action,
        structure,
        situation,
        postAction,
        levelRank: input.view.levelRank
      })
    );
    const derived: {
      readonly postAction: ReturnType<typeof evaluatePostActionHand>;
      readonly control: ReturnType<typeof evaluateControlResources>;
    } = { postAction, control };
    if (reuseMode === "production") derivedByPhysicalAction.set(key, derived);
    return derived;
  };
  const evaluateSemanticFollowUp = (action: import("../turns").TurnAction) => {
    // A physical successor is shareable for PostAction/Control only.  A
    // semantically distinct interpretation can change public comparison and
    // action semantics, so it must never inherit another interpretation's
    // complete FollowUpPlan merely because the removed card ids match.
    const derived = analyzePhysicalAction(action);
    const followUp = measure("followUp", () =>
      planFollowUp({
        action,
        postAction: derived.postAction,
        situation,
        legalLeadActions: (() => {
          if (followUpLeadMode !== "catalog")
            return getCompleteLegalCandidates({
              state: leadState(
                input.view,
                derived.postAction.remainingHand.map((card) => card.id)
              ),
              selfHand: derived.postAction.remainingHand,
              levelRank: input.view.levelRank
            });
          const projected = rootLeadingCatalogueIndex?.filter(
            derived.postAction.remainingHand.map((card) => card.id)
          );
          if (!projected) throw new Error("expert root leading catalogue index is unavailable");
          followUpLeadProjectionCount += 1;
          followUpLeadFilteredActionCount += projected.length;
          return projected;
        })(),
        levelRank: input.view.levelRank,
        handPlanPerformanceBudget: budget,
        performanceBudget: budget,
        successorAnalysisCache:
          reuseMode === "production" ? followUpSuccessorAnalysisCache : undefined
      })
    );
    return { ...derived, followUp };
  };
  const rankedWithAliases = ranked.map((action) => {
    const semantic = semanticActions.find((candidate) => candidate.action === action);
    if (!semantic) throw new Error("语义候选排序结果必须来自完整 A 层候选");
    return semantic;
  });
  const baseCandidates = rankedWithAliases.map(
    ({ action, aliases, physicalKey, semanticKey }, rankedIndex) => {
      const mandatoryReason: FollowUpMandatoryReason =
        action.type === "play" && action.cardIds.length === input.view.selfHand.length
          ? "finish_now"
          : action.type === "play" && situation.opponentThreat.level === "critical"
            ? "must_beat"
            : action.type === "play" && situation.teammate.isSprinting
              ? "partner_finish_setup"
              : null;
      const light = measure("lightBaseScore", () =>
        lightBaseCandidate({
          action,
          situation,
          rankedIndex,
          candidateCount: rankedWithAliases.length,
          profile: input.profile
        })
      );
      const deadHandRiskProxy = measure("deadHandRiskProxy", () =>
        evaluateDeadHandRiskProxy({ view: input.view, action })
      );
      return {
        action,
        aliases,
        physicalKey,
        semanticKey,
        mandatoryReason,
        deadHandRiskProxy,
        ...light
      };
    }
  );
  // The same pure mandatory/budget selector is used for the ADR-0018 deep
  // admission.  Its inputs are entirely light-stage values and stable keys.
  const postActionSelection = selectFollowUpCandidates({
    candidates: baseCandidates.map((candidate) => ({
      key: `${candidate.physicalKey}|${candidate.semanticKey}`,
      baseScore: candidate.score,
      deadHandRiskProxy: candidate.deadHandRiskProxy.total,
      mandatoryReason: candidate.mandatoryReason
    })),
    budget: resolvedPostActionBudget(budget),
    ordinaryAdmission:
      input.profile.id === "expert" && budget.postActionCandidateCount?.default === 24
        ? { baseScoreCount: 18, riskProxyCount: 6 }
        : undefined
  });
  const postActionByKey = new Map(postActionSelection.entries.map((entry) => [entry.key, entry]));
  const deepCandidates = baseCandidates.filter((candidate) => {
    const entry = postActionByKey.get(`${candidate.physicalKey}|${candidate.semanticKey}`);
    if (!entry) throw new Error("PostAction candidate selection lost a semantic candidate");
    return entry.status === "completed";
  });
  const followUpSelection = selectFollowUpCandidates({
    candidates: deepCandidates.map((candidate) => ({
      key: `${candidate.physicalKey}|${candidate.semanticKey}`,
      baseScore: candidate.score,
      mandatoryReason: candidate.mandatoryReason
    })),
    budget: budget.followUpCandidateCount
  });
  const followUpByKey = new Map(followUpSelection.entries.map((entry) => [entry.key, entry]));
  const lowestResponseByPattern = new Map<string, readonly number[]>();
  const lowestThreeWithPairAttachmentByMain = new Map<number, number>();
  if (input.view.highestSeat !== undefined)
    for (const candidate of baseCandidates) {
      if (candidate.action.type !== "play") continue;
      const key = candidate.action.interpretation.type;
      const previous = lowestResponseByPattern.get(key);
      const comparisonKey = candidate.action.interpretation.comparisonKey;
      const isLower =
        previous === undefined ||
        comparisonKey.some(
          (value, index) =>
            value !== previous[index] &&
            comparisonKey
              .slice(0, index)
              .every((prefix, prefixIndex) => prefix === previous[prefixIndex]) &&
            value < previous[index]
        );
      if (isLower) lowestResponseByPattern.set(key, comparisonKey);
      const attachmentValue = threeWithPairAttachmentValue({
        action: candidate.action,
        selfHand: input.view.selfHand,
        levelRank: input.view.levelRank
      });
      if (
        candidate.action.interpretation.type === "three-with-pair" &&
        attachmentValue !== undefined
      ) {
        const mainTriple = candidate.action.interpretation.comparisonKey[0];
        const previous = lowestThreeWithPairAttachmentByMain.get(mainTriple);
        if (previous === undefined || attachmentValue < previous)
          lowestThreeWithPairAttachmentByMain.set(mainTriple, attachmentValue);
      }
    }
  const candidates = baseCandidates.map((candidate) => {
    const key = `${candidate.physicalKey}|${candidate.semanticKey}`;
    const postActionSelectionEntry = postActionByKey.get(key);
    if (!postActionSelectionEntry)
      throw new Error("PostAction candidate selection lost a semantic candidate");
    if (postActionSelectionEntry.status === "not_evaluated")
      return {
        score: {
          action: candidate.action,
          profile: input.profile,
          components: {
            immediatePlayValue: candidate.score,
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
          finalScore: candidate.score,
          adjustments: [],
          hardExcluded: false
        },
        features: candidate.features,
        aliases: candidate.aliases,
        baseScore: candidate.score,
        lightBaseScore: candidate.score,
        deadHandRiskProxy: candidate.deadHandRiskProxy,
        candidateKey: key,
        postActionStatus: "not_evaluated" as const,
        followUpStatus: "not_evaluated" as const,
        followUpSelectionReason: postActionSelectionEntry.reason,
        screeningReason: postActionSelectionEntry.reason,
        notFinallyEligible: true,
        mandatoryReason: postActionSelectionEntry.mandatoryReason
      } as const;
    const selection = followUpByKey.get(key);
    if (!selection) throw new Error("FollowUp selection lost a deep semantic candidate");
    // Deep-admitted candidates always complete PostAction, even if the
    // subsequent ADR-0017 FollowUp budget defers their route analysis.
    analyzePhysicalAction(candidate.action);
    if (selection.status === "not_evaluated")
      return {
        score: scoreAction({
          action: candidate.action,
          features: candidate.features,
          profile: input.profile
        }),
        features: candidate.features,
        aliases: candidate.aliases,
        baseScore: candidate.score,
        lightBaseScore: candidate.score,
        deadHandRiskProxy: candidate.deadHandRiskProxy,
        candidateKey: key,
        postActionStatus: "completed" as const,
        followUpStatus: "not_evaluated" as const,
        followUpSelectionReason: selection.reason,
        screeningReason: selection.reason,
        notFinallyEligible: true,
        mandatoryReason: selection.mandatoryReason
      } as const;
    const shared = evaluateSemanticFollowUp(candidate.action);
    if (!shared.followUp) throw new Error("completed FollowUp candidate is missing FollowUp");
    const followUp = shared.followUp;
    const contest = measure("contest", () =>
      evaluateContestAction({
        context: contestContext,
        action: candidate.action,
        postAction: shared.postAction,
        control: shared.control,
        followUp
      })
    );
    const features = measure("featureExtraction", () => ({
      ...extractActionFeatures({
        action: candidate.action,
        situation,
        postAction: shared.postAction,
        control: shared.control,
        followUp,
        contest
      }),
      phase: situation.phase,
      signals: signals({
        situation,
        action: candidate.action,
        postAction: shared.postAction,
        control: shared.control,
        lowestResponseByPattern,
        lowestThreeWithPairAttachmentByMain,
        selfHand: input.view.selfHand,
        levelRank: input.view.levelRank
      })
    }));
    const rules = measure("ruleEvaluation", () =>
      evaluateExpertStrategyRules({ profile: input.profile, features })
    );
    return {
      score: measure("scoring", () =>
        scoreAction({
          action: candidate.action,
          features,
          adjustments: rules.adjustments,
          profile: input.profile
        })
      ),
      features,
      aliases: candidate.aliases,
      baseScore: candidate.score,
      lightBaseScore: candidate.score,
      deadHandRiskProxy: candidate.deadHandRiskProxy,
      candidateKey: key,
      postActionStatus: "completed" as const,
      followUpStatus: selection.status,
      followUpSelectionReason: selection.reason,
      screeningReason: selection.reason,
      notFinallyEligible: false as const,
      mandatoryReason: selection.mandatoryReason
    };
  });
  const decision = createDecision({
    legalActions: rankedWithAliases.map(({ action }) => action),
    candidates,
    profile: input.profile,
    includeDebugDetails: true
  });
  const debug = decision.debug
    ? {
        ...decision.debug,
        rawLegalInterpretationCount: input.view.legalActions.length,
        canonicalPhysicalActionCount: physicalActions.length,
        semanticCandidateCount: candidates.length,
        postActionExecutionCount:
          reuseMode === "production"
            ? derivedByPhysicalAction.size
            : candidates.filter((candidate) => candidate.postActionStatus === "completed").length,
        postActionSelection: {
          budget: resolvedPostActionBudget(budget),
          selectedCount: postActionSelection.selectedKeys.length,
          mandatoryOverflow: postActionSelection.mandatoryOverflow
        },
        followUpExecutionCount: candidates.filter(
          (candidate) => candidate.followUpStatus === "completed"
        ).length,
        followUpSelection: {
          budget: budget.followUpCandidateCount,
          selectedCount: followUpSelection.selectedKeys.length,
          mandatoryOverflow: followUpSelection.mandatoryOverflow
        },
        followUpSuccessorAnalysisCacheHitCount,
        followUpSuccessorAnalysisCacheMissCount,
        followUpLeadCatalogueSource,
        followUpLeadProjectionCount,
        followUpLeadFilteredActionCount,
        moduleElapsedMilliseconds
      }
    : undefined;
  const enriched = debug ? { ...decision, debug } : decision;
  if (reuseMode === "production" && followUpLeadMode === "catalog")
    expertDecisionCache.set(fingerprint, enriched);
  return enriched;
}

/** Production expert entry: uses the exact root-leading catalogue projection. */
export function chooseExpertBotDecision(input: ChooseExpertBotDecisionInput): StrategyDecision {
  return chooseExpertBotDecisionInternal(input, "catalog");
}

/**
 * Differential-test oracle only. It deliberately regenerates each physical
 * successor's complete leading A layer, and never reads/writes the decision
 * cache. It must remain observationally identical to the production entry.
 */
export function chooseExpertBotDecisionWithDirectFollowUpLeadLayerForDifferential(
  input: ChooseExpertBotDecisionInput
): StrategyDecision {
  return chooseExpertBotDecisionInternal(input, "direct");
}

/**
 * Test-only reference evaluator. It receives the original complete BotView,
 * deliberately regenerates every FollowUp lead layer, and disables decision,
 * physical-successor and FollowUp-successor reuse. It is not a production
 * profile and must never be called from a bot or hint entry point.
 */
export function baselineExpertDecisionForDifferential(
  input: ChooseExpertBotDecisionInput
): StrategyDecision {
  return withoutExpertHandAnalysisCache(() =>
    chooseExpertBotDecisionInternal(input, "direct", "differential-baseline")
  );
}
