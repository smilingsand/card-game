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
import { generateHandPlans, type HandPlanPerformanceBudget } from "./hand-plan-generator";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import {
  evaluatePostActionHand,
  type PostActionPerformanceBudget
} from "./post-action-hand-evaluator";
import { analyzeSituation } from "./situation-analyzer";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";

export interface ExpertDecisionBudget
  extends HandPlanPerformanceBudget, PostActionPerformanceBudget {
  readonly followUpCandidateCount: { readonly default: number; readonly max: number };
}

export const EXPERT_DECISION_BUDGET: ExpertDecisionBudget = {
  handPlanTopN: { default: 4, max: 4 },
  postActionReplanCount: { default: 1, max: 1 },
  followUpCandidateCount: { default: 8, max: 8 }
};

export interface ChooseExpertBotDecisionInput {
  /** A 层已经由规则引擎完整裁决的 BotView；本入口绝不读取桌面完整状态。 */
  readonly view: BotView;
  readonly profile: StrategyProfileSnapshot;
  readonly performanceBudget?: ExpertDecisionBudget;
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
  postAction: ReturnType<typeof evaluatePostActionHand>;
  control: ReturnType<typeof evaluateControlResources>;
}): import("./expert-strategy-knowledge-base").StrategySignals {
  const { situation, postAction, control } = input;
  const destroyed = new Set(postAction.destroyedGroups.map((group) => group.kind));
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
    preservesSameTypeRecovery: control.preservesRecoveryPoint
  };
}

/**
 * expert/experimental 的真实生产决策闭环。输入边界固定为 BotView；缺少 expert
 * profile 或 A 层合法动作会直接报错，绝不回退到 normal。
 */
export function chooseExpertBotDecision(input: ChooseExpertBotDecisionInput): StrategyDecision {
  if (input.profile.id === "normal")
    throw new Error("expert 决策入口不接受 normal profile；请调用 legacy normal path");
  if (input.view.legalActions.length === 0) throw new Error("expert 决策入口需要完整合法动作集合");
  const budget = input.performanceBudget ?? EXPERT_DECISION_BUDGET;
  const structure = analyzeHandStructure(input.view.selfHand, input.view.levelRank);
  const handPlans = generateHandPlans({ structure, performanceBudget: budget });
  const situation = analyzeSituation(input.view);
  const ranked = rankExpertCandidates({
    legalActions: input.view.legalActions,
    structure,
    handPlans
  });
  const contestContext = createContestContext(situation);
  const candidates = ranked.map((action) => {
    const postAction = evaluatePostActionHand({
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
    });
    const control = evaluateControlResources({
      action,
      structure,
      situation,
      postAction,
      levelRank: input.view.levelRank
    });
    const followUp = planFollowUp({
      action,
      postAction,
      situation,
      legalLeadActions: getCompleteLegalCandidates({
        state: leadState(
          input.view,
          postAction.remainingHand.map((card) => card.id)
        ),
        selfHand: postAction.remainingHand,
        levelRank: input.view.levelRank
      }),
      levelRank: input.view.levelRank,
      handPlanPerformanceBudget: budget,
      performanceBudget: budget
    });
    const contest = evaluateContestAction({
      context: contestContext,
      action,
      postAction,
      control,
      followUp
    });
    const features = {
      ...extractActionFeatures({ action, situation, postAction, control, followUp, contest }),
      phase: situation.phase,
      signals: signals({ situation, postAction, control })
    };
    const rules = evaluateExpertStrategyRules({ profile: input.profile, features });
    return {
      score: scoreAction({
        action,
        features,
        adjustments: rules.adjustments,
        profile: input.profile
      }),
      features
    };
  });
  return createDecision({
    legalActions: input.view.legalActions,
    candidates,
    profile: input.profile,
    includeDebugDetails: true
  });
}
