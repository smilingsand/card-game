// Shared Guandan core source.
import type { Card } from "../../platform/types";
import type { BotView } from "./bot-view";
import { chooseNormalBotAction, type NormalBotDecision } from "./normal-bot";
import { createStrategyObservation } from "./strategy-observation";
import type { TurnAction } from "./turns";

const teammate: Record<BotView["selfSeat"], BotView["selfSeat"]> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south",
};
const nextSeat: Record<BotView["selfSeat"], BotView["selfSeat"]> = {
  south: "east",
  east: "north",
  north: "west",
  west: "south",
};
const bombs = new Set(["normal-bomb", "straight-flush", "four-jokers"]);
const normalRanks = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;
const BREAK_PAIR_COST = 240;
const BREAK_TRIPLE_COST = 600;
const BREAK_STRAIGHT_COST = 800;
const BREAK_CONSECUTIVE_PAIR_COST = 900;
const BREAK_STEEL_PLATE_COST = 1_000;
const BREAK_BOMB_COST = 100_000;
const CONTROL_A_COST = 120;
const CONTROL_LEVEL_COST = 140;
const CONTROL_HEART_LEVEL_COST = 220;
const CONTROL_SMALL_JOKER_COST = 300;
const CONTROL_BIG_JOKER_COST = 360;
const LOW_VALUE_STRUCTURE_RANK_COST = 10;
const LEAD_BOMB_SPLIT_ROUTE_ADVANTAGE = 2;
const WILDCARD_DOWNGRADE_COST = 700;
const RESPONSE_ANALYSIS_CANDIDATE_LIMIT = 24;
const NATURAL_FOLLOW_CONTEST_BONUS_PER_CARD = 20;
const LOW_VALUE_CONSECUTIVE_PAIR_MAX_KEY = 10;

type PlayAction = Extract<TurnAction, { readonly type: "play" }>;
type PatternType = PlayAction["interpretation"]["type"];

export interface NextSeatEndgameThreat {
  readonly seat: BotView["selfSeat"];
  readonly remainingCards: number;
  readonly mode: "caution" | "forced" | "none";
  readonly likelyPatternTypes: readonly PatternType[];
}

export interface CooperationSignal {
  readonly teammate: BotView["selfSeat"];
  readonly teammateRemainingCards: number;
  readonly mode: "yield" | "feed" | "neutral";
  readonly reason: string;
}

export interface NormalVNextBombEconomics {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly publicControlExposure: Readonly<
    Partial<Record<Card["rank"], number>>
  >;
}

export interface NormalVNextCostBreakdown {
  readonly rankCost: number;
  readonly structureDamageCost: number;
  readonly controlResourceCost: number;
  readonly wildcardOpportunityCost: number;
  readonly responseCost: number;
}

export interface NormalVNextCandidateScore {
  readonly action: PlayAction;
  /** Smaller is better: cost minus directly explainable public-information benefits. */
  readonly score: number;
  readonly breakdown: {
    readonly rankCost: number;
    readonly structureDamageCost: number;
    readonly controlResourceCost: number;
    readonly wildcardOpportunityCost: number;
    readonly attachmentCost: number;
    readonly handSheddingBenefit: number;
    readonly leadConsecutivePairOverlapBenefit: number;
    readonly interceptionBenefit: number;
    readonly publicControlExposureBenefit: number;
    readonly selfRouteCost: number;
    readonly bombEconomicsBenefit: number;
  };
  readonly reasons: readonly string[];
}

interface NormalVNextScoreContext {
  readonly publicControlExposure: number;
}

export interface NormalVNextContestBreakdown {
  readonly structureDamageCost: number;
  readonly controlResourceCost: number;
  readonly handSheddingBenefit: number;
  readonly contestBenefit: number;
  readonly passBias: number;
  readonly highValuePenalty: number;
  readonly actionScore: number;
  readonly passScore: number;
  readonly recommended: "contest" | "pass";
}

export interface NormalVNextHandAnalysis {
  readonly singles: number;
  readonly pairs: number;
  readonly triples: number;
  readonly threeWithPairPotential: number;
  readonly straights: number;
  readonly consecutivePairs: number;
  readonly steelPlates: number;
  readonly bombs: number;
  readonly wildcardCount: number;
  readonly controlCards: number;
}

export interface NormalVNextSelfRouteEstimate {
  readonly action: PlayAction;
  readonly remainingCards: number;
  readonly directFinish: boolean;
  readonly deadSingles: number;
  readonly naturalGroups: number;
  readonly controlCardsRetained: number;
  readonly estimatedSelfTurns: number;
}

function isPlay(action: TurnAction): action is PlayAction {
  return action.type === "play";
}

function rankCost(card: Card, levelRank: BotView["levelRank"]): number {
  if (card.rank === "big-joker") return 170;
  if (card.rank === "small-joker") return 160;
  if (card.rank === levelRank) return 150;
  return normalRanks.indexOf(card.rank as (typeof normalRanks)[number]) + 2;
}

function comparisonCost(action: PlayAction): readonly number[] {
  return action.interpretation.type === "three-with-pair"
    ? [action.interpretation.comparisonKey[0] ?? 0]
    : action.interpretation.comparisonKey;
}

function compareNumberLists(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function selectedCards(action: PlayAction, view: BotView): readonly Card[] {
  const hand = new Map(view.selfHand.map((card) => [card.id, card]));
  return action.cardIds
    .map((cardId) => hand.get(cardId))
    .filter((card): card is Card => card !== undefined);
}

function naturalGroupsForCards(
  cards: readonly Card[],
  levelRank: BotView["levelRank"],
): ReadonlyMap<Card["rank"], readonly Card[]> {
  return cards
    .filter(
      (card) =>
        card.suit !== "joker" &&
        !(card.suit === "hearts" && card.rank === levelRank),
    )
    .reduce<Map<Card["rank"], Card[]>>((groups, card) => {
      groups.set(card.rank, [...(groups.get(card.rank) ?? []), card]);
      return groups;
    }, new Map());
}

function naturalGroups(
  view: BotView,
): ReadonlyMap<Card["rank"], readonly Card[]> {
  return naturalGroupsForCards(view.selfHand, view.levelRank);
}

function sequences(length: number): readonly (readonly Card["rank"][])[] {
  const standard = Array.from(
    { length: normalRanks.length - length + 1 },
    (_, start) => normalRanks.slice(start, start + length),
  );
  return length === 5 ? [...standard, ["A", "2", "3", "4", "5"]] : standard;
}

/** Lightweight, deterministic hand summary. It is advisory only and never creates actions. */
export function analyzeNormalVNextHand(view: BotView): NormalVNextHandAnalysis {
  const groups = naturalGroups(view);
  const counts = [...groups.values()].map((group) => group.length);
  const hasPattern = (copies: number, length: number) =>
    sequences(length).filter((sequence) =>
      sequence.every((rank) => (groups.get(rank)?.length ?? 0) >= copies),
    ).length;
  const wildcardCount = view.selfHand.filter(
    (card) => card.suit === "hearts" && card.rank === view.levelRank,
  ).length;
  const controlCards = view.selfHand.filter(
    (card) =>
      card.rank === "A" ||
      card.rank === view.levelRank ||
      card.rank === "small-joker" ||
      card.rank === "big-joker",
  ).length;
  const triples = counts.filter((count) => count === 3).length;
  return {
    singles: counts.filter((count) => count === 1).length,
    pairs: counts.filter((count) => count === 2).length,
    triples,
    threeWithPairPotential: Math.min(
      triples,
      counts.filter((count) => count >= 2).length,
    ),
    straights: hasPattern(1, 5),
    consecutivePairs: hasPattern(2, 3),
    steelPlates: hasPattern(3, 2),
    bombs: counts.filter((count) => count >= 4).length,
    wildcardCount,
    controlCards,
  };
}

/**
 * Fixed, one-ply route estimate over our own hand only. It never generates an
 * opponent action and has no wall-clock or mutable-state budget.
 */
export function estimateNormalVNextSelfRoute(
  action: TurnAction,
  view: BotView,
): NormalVNextSelfRouteEstimate | undefined {
  if (!isLegalCandidate(action, view)) return undefined;
  const selectedIds = new Set(action.cardIds);
  const remaining = view.selfHand.filter((card) => !selectedIds.has(card.id));
  const groups = naturalGroupsForCards(remaining, view.levelRank);
  const counts = [...groups.values()].map((group) => group.length);
  const deadSingles = counts.filter((count) => count === 1).length;
  const naturalGroups = counts.filter((count) => count >= 2).length;
  const controlCardsRetained = remaining.filter(
    (card) =>
      card.rank === "A" ||
      card.rank === view.levelRank ||
      card.rank === "small-joker" ||
      card.rank === "big-joker",
  ).length;
  return {
    action,
    remainingCards: remaining.length,
    directFinish: remaining.length === 0,
    deadSingles,
    naturalGroups,
    controlCardsRetained,
    estimatedSelfTurns:
      remaining.length === 0 ? 0 : deadSingles + naturalGroups,
  };
}

function naturalStructureCount(
  groups: ReadonlyMap<Card["rank"], readonly Card[]>,
  copies: number,
  length: number,
): number {
  return sequences(length).filter((sequence) =>
    sequence.every((rank) => (groups.get(rank)?.length ?? 0) >= copies),
  ).length;
}

function naturalStructureAllowance(
  action: PlayAction,
  view: BotView,
): {
  readonly straight: number;
  readonly consecutivePairs: number;
  readonly steelPlates: number;
} {
  const selected = selectedCards(action, view);
  const natural = selected.every(
    (card) =>
      card.suit !== "joker" &&
      !(card.suit === "hearts" && card.rank === view.levelRank),
  );
  if (!natural) return { straight: 0, consecutivePairs: 0, steelPlates: 0 };
  return {
    straight: action.interpretation.type === "straight" ? 1 : 0,
    consecutivePairs:
      action.interpretation.type === "three-consecutive-pairs" ? 1 : 0,
    steelPlates: action.interpretation.type === "steel-plate" ? 1 : 0,
  };
}

/** Cost of destroying an existing natural group; it never certifies legality. */
function structureDamageCost(action: PlayAction, view: BotView): number {
  const groups = naturalGroups(view);
  const selectedIds = new Set(action.cardIds);
  const remainingGroups = naturalGroupsForCards(
    view.selfHand.filter((card) => !selectedIds.has(card.id)),
    view.levelRank,
  );
  const selectedByRank = selectedCards(action, view).reduce<
    Map<Card["rank"], number>
  >((counts, card) => {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    return counts;
  }, new Map());
  let cost = 0;
  for (const [rank, count] of selectedByRank) {
    const available = groups.get(rank)?.length ?? 0;
    if (count < available) {
      if (available >= 4) cost += BREAK_BOMB_COST;
      else if (available === 3) cost += BREAK_TRIPLE_COST;
      else if (available === 2) cost += BREAK_PAIR_COST;
    }
  }
  const allowance = naturalStructureAllowance(action, view);
  cost +=
    Math.max(
      0,
      naturalStructureCount(groups, 1, 5) -
        naturalStructureCount(remainingGroups, 1, 5) -
        allowance.straight,
    ) * BREAK_STRAIGHT_COST;
  cost +=
    Math.max(
      0,
      naturalStructureCount(groups, 2, 3) -
        naturalStructureCount(remainingGroups, 2, 3) -
        allowance.consecutivePairs,
    ) * BREAK_CONSECUTIVE_PAIR_COST;
  cost +=
    Math.max(
      0,
      naturalStructureCount(groups, 3, 2) -
        naturalStructureCount(remainingGroups, 3, 2) -
        allowance.steelPlates,
    ) * BREAK_STEEL_PLATE_COST;
  return cost;
}

function controlResourceCost(action: PlayAction, view: BotView): number {
  let cost = bombs.has(action.interpretation.type) ? 200 : 0;
  for (const card of selectedCards(action, view)) {
    if (card.rank === "A") cost += CONTROL_A_COST;
    else if (card.rank === view.levelRank)
      cost +=
        card.suit === "hearts" ? CONTROL_HEART_LEVEL_COST : CONTROL_LEVEL_COST;
    else if (card.rank === "small-joker") cost += CONTROL_SMALL_JOKER_COST;
    else if (card.rank === "big-joker") cost += CONTROL_BIG_JOKER_COST;
    else if (rankCost(card, view.levelRank) >= 13) cost += 15;
  }
  return cost;
}

function wildcardOpportunityCost(action: PlayAction, view: BotView): number {
  const wildcards = selectedCards(action, view).filter(
    (card) => card.suit === "hearts" && card.rank === view.levelRank,
  );
  if (wildcards.length === 0) return 0;
  const downgradedWildcards = wildcards.filter((card) => {
    const assignedRank = action.interpretation.wildcardAs[card.id]?.rank;
    return assignedRank !== undefined && assignedRank !== view.levelRank;
  }).length;
  return 420 + downgradedWildcards * WILDCARD_DOWNGRADE_COST;
}

function actionRankCost(action: PlayAction, view: BotView): number {
  if (action.interpretation.type !== "single")
    return comparisonCost(action).reduce((sum, value) => sum + value, 0);
  const card = selectedCards(action, view)[0];
  return card ? rankCost(card, view.levelRank) : Number.MAX_SAFE_INTEGER;
}

function attachmentCost(action: PlayAction, view: BotView): number {
  if (action.interpretation.type !== "three-with-pair") return 0;
  const grouped = new Map<string, Card[]>();
  for (const card of selectedCards(action, view)) {
    const assignedRank =
      action.interpretation.wildcardAs[card.id]?.rank ?? card.rank;
    grouped.set(assignedRank, [...(grouped.get(assignedRank) ?? []), card]);
  }
  const pair = [...grouped.values()].find((group) => group.length === 2);
  return pair
    ? Math.max(...pair.map((card) => rankCost(card, view.levelRank)))
    : Number.MAX_SAFE_INTEGER;
}

function responseCost(action: PlayAction, view: BotView): number {
  return (
    actionRankCost(action, view) +
    structureDamageCost(action, view) +
    controlResourceCost(action, view) +
    wildcardOpportunityCost(action, view) +
    attachmentCost(action, view)
  );
}

/** Read-only C diagnostic. It shares the production response-cost calculation exactly. */
export function describeNormalVNextAction(
  action: TurnAction,
  view: BotView,
): NormalVNextCostBreakdown | undefined {
  if (!isPlay(action)) return undefined;
  const rank = actionRankCost(action, view);
  const structure = structureDamageCost(action, view);
  const control = controlResourceCost(action, view);
  const wildcard = wildcardOpportunityCost(action, view);
  return {
    rankCost: rank,
    structureDamageCost: structure,
    controlResourceCost: control,
    wildcardOpportunityCost: wildcard,
    responseCost:
      rank + structure + control + wildcard + attachmentCost(action, view),
  };
}

function isLegalCandidate(
  action: TurnAction,
  view: BotView,
): action is PlayAction {
  return (
    isPlay(action) &&
    view.legalActions.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(action),
    )
  );
}

/**
 * Scores only a rule-engine legal play. The breakdown is stable and can be
 * shown to diagnostics without exposing hidden cards or mutable search state.
 */
export function scoreNormalVNextCandidate(
  action: TurnAction,
  view: BotView,
): NormalVNextCandidateScore | undefined {
  if (!isLegalCandidate(action, view)) return undefined;
  return scoreLegalNormalVNextCandidate(action, view);
}

/** Internal fast path: callers already iterate rule-engine legalActions. */
function scoreLegalNormalVNextCandidate(
  action: PlayAction,
  view: BotView,
  scoreContext = createNormalVNextScoreContext(view),
): NormalVNextCandidateScore {
  const rank = actionRankCost(action, view);
  const structure = structureDamageCost(action, view);
  const control = controlResourceCost(action, view);
  const wildcard = wildcardOpportunityCost(action, view);
  const attachment = attachmentCost(action, view);
  const leadConsecutivePairOverlapBenefit =
    leadingConsecutivePairOverlapBenefit(action, view);
  const handSheddingBenefit = isNaturalMiddleStructure(action, view)
    ? action.cardIds.length * 60
    : isNaturalOrdinaryFollowResponse(action, view)
      ? action.cardIds.length * NATURAL_FOLLOW_CONTEST_BONUS_PER_CARD
      : 0;
  const interceptionBenefit =
    view.highestSeat !== undefined &&
    view.highestSeat !== teammate[view.selfSeat] &&
    opponentThreat(view, 3)
      ? action.cardIds.length * 30
      : 0;
  const spentControlCards = selectedCards(action, view).filter(
    (card) =>
      card.rank === "A" ||
      card.rank === view.levelRank ||
      card.rank === "small-joker" ||
      card.rank === "big-joker",
  ).length;
  // Publicly exposed controls reduce the value of retaining an equivalent
  // unseen control resource. This is a public-card estimate, not a hand guess.
  const publicControlExposureBenefit =
    Math.min(6, scoreContext.publicControlExposure) * spentControlCards * 30;
  const route = estimateNormalVNextSelfRoute(action, view)!;
  const selfRouteCost =
    route.estimatedSelfTurns * 18 +
    route.deadSingles * 14 -
    route.naturalGroups * 8 -
    route.controlCardsRetained * 3;
  const bombEconomicsBenefit = shouldPrioritizeBomb(action, view) ? 1_200 : 0;
  const reasons: string[] = ["规则层合法候选"];
  if (structure > 0) reasons.push("保留现有复合结构");
  if (control > 0) reasons.push("保留控制资源");
  if (wildcard > 0) reasons.push("保留红桃级牌逢人配");
  if (leadConsecutivePairOverlapBenefit > 0)
    reasons.push("领牌：完整低连对抵销重叠连对损伤");
  if (handSheddingBenefit > 0) reasons.push("自然牌型卸载收益");
  if (interceptionBenefit > 0) reasons.push("公开残局拦截收益");
  if (publicControlExposureBenefit > 0)
    reasons.push("公开已出控制牌降低保留成本");
  reasons.push("己方路线评估");
  if (bombEconomicsBenefit > 0)
    reasons.push("炸弹经济：普通响应的结构或路线损失更高");
  return {
    action,
    score:
      rank +
      structure +
      control +
      wildcard +
      attachment -
      handSheddingBenefit -
      leadConsecutivePairOverlapBenefit -
      interceptionBenefit -
      publicControlExposureBenefit +
      selfRouteCost -
      bombEconomicsBenefit,
    breakdown: {
      rankCost: rank,
      structureDamageCost: structure,
      controlResourceCost: control,
      wildcardOpportunityCost: wildcard,
      attachmentCost: attachment,
      handSheddingBenefit,
      leadConsecutivePairOverlapBenefit,
      interceptionBenefit,
      publicControlExposureBenefit,
      selfRouteCost,
      bombEconomicsBenefit,
    },
    reasons,
  };
}

function createNormalVNextScoreContext(view: BotView): NormalVNextScoreContext {
  const observation = createStrategyObservation(view);
  const controlRanks: readonly Card["rank"][] = [
    "A",
    view.levelRank,
    "small-joker",
    "big-joker",
  ];
  return {
    publicControlExposure: controlRanks.reduce(
      (count, rank) => count + (observation.publicCards.rankCounts[rank] ?? 0),
      0,
    ),
  };
}

function isNaturalMiddleStructure(action: PlayAction, view: BotView): boolean {
  if (
    !(["pair", "triple", "three-with-pair"] as readonly PatternType[]).includes(
      action.interpretation.type,
    )
  )
    return false;
  if (
    structureDamageCost(action, view) !== 0 ||
    controlResourceCost(action, view) !== 0 ||
    wildcardOpportunityCost(action, view) !== 0
  )
    return false;
  const groups = naturalGroups(view);
  const selectedByRank = selectedCards(action, view).reduce<
    Map<Card["rank"], number>
  >(
    (counts, card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1),
    new Map(),
  );
  return [...selectedByRank].every(
    ([rank, count]) => count === (groups.get(rank)?.length ?? 0),
  );
}

/**
 * A low, complete natural consecutive-pair lead may overlap one additional
 * consecutive pair in the hand. That overlap is a future option rather than a
 * broken card group, so do not let its cost force a higher lead. This is
 * deliberately limited to leading; response and all bomb/other-structure
 * protections continue to use the full structural cost.
 */
function leadingConsecutivePairOverlapBenefit(
  action: PlayAction,
  view: BotView,
): number {
  if (
    view.highestSeat !== undefined ||
    action.interpretation.type !== "three-consecutive-pairs" ||
    (comparisonCost(action).at(-1) ?? Number.MAX_SAFE_INTEGER) >
      LOW_VALUE_CONSECUTIVE_PAIR_MAX_KEY
  )
    return 0;
  const selected = selectedCards(action, view);
  if (
    selected.some(
      (card) =>
        card.suit === "joker" ||
        card.rank === view.levelRank,
    )
  )
    return 0;
  const groups = naturalGroups(view);
  const selectedByRank = selected.reduce<Map<Card["rank"], number>>(
    (counts, card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1),
    new Map(),
  );
  if (
    selectedByRank.size !== 3 ||
    [...selectedByRank].some(
      ([rank, count]) => count !== 2 || (groups.get(rank)?.length ?? 0) !== 2,
    )
  )
    return 0;
  const remainingGroups = naturalGroupsForCards(
    view.selfHand.filter((card) => !action.cardIds.includes(card.id)),
    view.levelRank,
  );
  const overlappingPairsLost = Math.max(
    0,
    naturalStructureCount(groups, 2, 3) -
      naturalStructureCount(remainingGroups, 2, 3) -
      1,
  );
  return overlappingPairsLost * BREAK_CONSECUTIVE_PAIR_COST;
}

/**
 * A complete, non-control response should normally be used to contest an
 * opponent's lead. This deliberately covers every ordinary pattern, while
 * leaving each pattern's established comparison order intact.
 */
function isNaturalOrdinaryFollowResponse(
  action: PlayAction,
  view: BotView,
): boolean {
  if (view.highestSeat === undefined || bombs.has(action.interpretation.type))
    return false;
  if (
    structureDamageCost(action, view) !== 0 ||
    wildcardOpportunityCost(action, view) !== 0
  )
    return false;
  const selected = selectedCards(action, view);
  if (
    selected.some(
      (card) =>
        card.rank === "A" ||
        card.rank === view.levelRank ||
        card.rank === "small-joker" ||
        card.rank === "big-joker",
    )
  )
    return false;
  const groups = naturalGroups(view);
  const selectedByRank = selected.reduce<Map<Card["rank"], number>>(
    (counts, card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1),
    new Map(),
  );
  return [...selectedByRank].every(
    ([rank, count]) => count === (groups.get(rank)?.length ?? 0),
  );
}

/** Read-only contest diagnostic used by the normal-vNext selector and fixed cases. */
export function describeNormalVNextContest(
  action: TurnAction,
  view: BotView,
): NormalVNextContestBreakdown | undefined {
  if (!isPlay(action)) return undefined;
  const structure = structureDamageCost(action, view);
  const control = controlResourceCost(action, view);
  const naturalMiddle = isNaturalMiddleStructure(action, view);
  const selected = selectedCards(action, view);
  const selectedByRank = selected.reduce<Map<Card["rank"], readonly Card[]>>(
    (groups, card) =>
      groups.set(card.rank, [...(groups.get(card.rank) ?? []), card]),
    new Map(),
  );
  const primaryCards =
    action.interpretation.type === "three-with-pair"
      ? ([...selectedByRank.values()].find((cards) => cards.length >= 3) ??
        selected)
      : selected;
  const hasHighControl = primaryCards.some(
    (card) =>
      card.rank === "A" ||
      card.rank === view.levelRank ||
      card.rank === "small-joker" ||
      card.rank === "big-joker",
  );
  const handSheddingBenefit = naturalMiddle ? action.cardIds.length * 60 : 0;
  const contestBenefit = naturalMiddle ? 120 : 0;
  const passBias = 160;
  const highValuePenalty = hasHighControl ? 320 : 0;
  const actionScore =
    handSheddingBenefit +
    contestBenefit -
    responseCost(action, view) -
    highValuePenalty;
  return {
    structureDamageCost: structure,
    controlResourceCost: control,
    handSheddingBenefit,
    contestBenefit,
    passBias,
    highValuePenalty,
    actionScore,
    passScore: passBias,
    recommended: actionScore > passBias ? "contest" : "pass",
  };
}

function directFinish(action: TurnAction, view: BotView): boolean {
  return isPlay(action) && action.cardIds.length === view.selfHand.length;
}

/** Public-information-only estimate for the player immediately after us. */
export function analyzeNextSeatEndgameThreat(
  view: BotView,
): NextSeatEndgameThreat {
  const seat = nextSeat[view.selfSeat];
  const remainingCards = view.remainingCardCounts[seat];
  const likelyByCount: Partial<Record<number, readonly PatternType[]>> = {
    1: ["single"],
    2: ["single", "pair"],
    3: ["single", "pair", "triple"],
    4: ["single", "pair", "triple", "normal-bomb"],
    5: [
      "single",
      "pair",
      "triple",
      "three-with-pair",
      "straight",
      "normal-bomb",
    ],
    6: ["single", "pair", "triple", "three-with-pair", "normal-bomb"],
  };
  const likelyPatternTypes = likelyByCount[remainingCards] ?? [];
  return {
    seat,
    remainingCards,
    mode:
      remainingCards >= 1 && remainingCards <= 3
        ? "forced"
        : remainingCards >= 1 && remainingCards <= 6
          ? "caution"
          : "none",
    likelyPatternTypes,
  };
}

/** Cooperation is a public signal, never a guess about the teammate's cards. */
export function analyzeCooperationSignal(view: BotView): CooperationSignal {
  const teammateSeat = teammate[view.selfSeat];
  const teammateRemainingCards = view.remainingCardCounts[teammateSeat];
  if (view.highestSeat === teammateSeat)
    return {
      teammate: teammateSeat,
      teammateRemainingCards,
      mode: "yield",
      reason: "队友持权",
    };
  if (teammateRemainingCards >= 1 && teammateRemainingCards <= 2)
    return {
      teammate: teammateSeat,
      teammateRemainingCards,
      mode: "feed",
      reason: "队友临门",
    };
  return {
    teammate: teammateSeat,
    teammateRemainingCards,
    mode: "neutral",
    reason: "无公开协同信号",
  };
}

/** Bombs stay expensive unless their value is visible from the BotView. */
export function describeNormalVNextBombEconomics(
  action: TurnAction,
  view: BotView,
): NormalVNextBombEconomics | undefined {
  if (!isPlay(action) || !bombs.has(action.interpretation.type))
    return undefined;
  const publicControlExposure: Partial<Record<Card["rank"], number>> = {};
  for (const publicAction of view.publicActions ?? [])
    for (const card of publicAction.cards)
      if (["A", view.levelRank, "small-joker", "big-joker"].includes(card.rank))
        publicControlExposure[card.rank] =
          (publicControlExposure[card.rank] ?? 0) + 1;
  const reasons: string[] = [];
  const cooperation = analyzeCooperationSignal(view);
  if (
    view.highestSeat === cooperation.teammate &&
    cooperation.teammateRemainingCards <= 2
  )
    reasons.push("保队友临门牌权");
  if (opponentThreat(view, 2)) reasons.push("阻断公开临门对手");
  if (directFinish(action, view)) reasons.push("炸后直接收尾");
  return { allowed: reasons.length > 0, reasons, publicControlExposure };
}

/**
 * A bomb can move ahead of ordinary responses only when the public reason is
 * positive and every ordinary response damages a structure while leaving a
 * strictly worse one-ply route. This deliberately prevents a mere opponent
 * card-count threat from spending a bomb over a cheap normal response.
 */
function shouldPrioritizeBomb(action: PlayAction, view: BotView): boolean {
  const economics = describeNormalVNextBombEconomics(action, view);
  if (!economics?.allowed || directFinish(action, view)) return false;
  const ordinaryResponses = view.legalActions.filter(
    (candidate): candidate is PlayAction =>
      isPlay(candidate) && !bombs.has(candidate.interpretation.type),
  );
  if (ordinaryResponses.length === 0) return false;
  const bombRoute = estimateNormalVNextSelfRoute(action, view)!;
  return ordinaryResponses.every((candidate) => {
    const route = estimateNormalVNextSelfRoute(candidate, view)!;
    return (
      structureDamageCost(candidate, view) > 0 &&
      route.estimatedSelfTurns > bombRoute.estimatedSelfTurns
    );
  });
}

function isNaturalWholeBomb(action: PlayAction, view: BotView): boolean {
  if (action.interpretation.type !== "normal-bomb") return false;
  const selected = selectedCards(action, view);
  return (
    selected.length === action.cardIds.length &&
    selected.length >= 4 &&
    selected.every(
      (card) =>
        card.suit !== "joker" &&
        !(card.suit === "hearts" && card.rank === view.levelRank) &&
        card.rank === selected[0]?.rank,
    ) &&
    (naturalGroups(view).get(selected[0]?.rank ?? "2")?.length ?? 0) ===
      selected.length
  );
}

/**
 * Natural bombs are a hard leading constraint, not merely a score bonus.
 * Direct finishes and a route that saves at least two future plays remain the
 * only non-forced exceptions; forced public endgame blocks are handled by the
 * caller before applying this filter.
 */
function leadCandidatesPreservingNaturalBombs(
  plays: readonly PlayAction[],
  view: BotView,
): readonly PlayAction[] {
  const wholeBombs = plays.filter((action) => isNaturalWholeBomb(action, view));
  if (wholeBombs.length === 0) return plays;
  const preserved = plays.filter((action) => {
    if (
      directFinish(action, view) ||
      structureDamageCost(action, view) < BREAK_BOMB_COST
    )
      return true;
    const route = estimateNormalVNextSelfRoute(action, view)!;
    return wholeBombs.some(
      (bomb) =>
        route.estimatedSelfTurns <=
        estimateNormalVNextSelfRoute(bomb, view)!.estimatedSelfTurns -
          LEAD_BOMB_SPLIT_ROUTE_ADVANTAGE,
    );
  });
  return preserved.length > 0 ? preserved : plays;
}

/**
 * A natural bomb is a protected resource when leading. It can be spent whole
 * rather than split only when every non-bomb lead destroys a bomb and lacks a
 * direct finish or a materially shorter route (two or more future turns).
 */
function shouldPrioritizeLeadIntactBomb(
  action: PlayAction,
  view: BotView,
  plays: readonly PlayAction[],
): boolean {
  if (
    !bombs.has(action.interpretation.type) ||
    !isNaturalWholeBomb(action, view)
  )
    return false;
  const bombRoute = estimateNormalVNextSelfRoute(action, view)!;
  const nonBombs = plays.filter(
    (candidate) => !bombs.has(candidate.interpretation.type),
  );
  return (
    nonBombs.length > 0 &&
    nonBombs.every((candidate) => {
      const route = estimateNormalVNextSelfRoute(candidate, view)!;
      return (
        structureDamageCost(candidate, view) >= BREAK_BOMB_COST &&
        !directFinish(candidate, view) &&
        route.estimatedSelfTurns >
          bombRoute.estimatedSelfTurns - LEAD_BOMB_SPLIT_ROUTE_ADVANTAGE
      );
    })
  );
}

function compareDescending(
  left: PlayAction,
  right: PlayAction,
  view: BotView,
): number {
  const comparisonDelta = compareNumberLists(
    comparisonCost(right),
    comparisonCost(left),
  );
  if (comparisonDelta !== 0) return comparisonDelta;
  const rankDelta = actionRankCost(right, view) - actionRankCost(left, view);
  if (rankDelta !== 0) return rankDelta;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function rankThreatLeadCandidates(
  view: BotView,
  threat: NextSeatEndgameThreat,
): readonly PlayAction[] {
  const plays = view.legalActions.filter(isPlay);
  const candidates =
    threat.mode === "forced"
      ? plays
      : leadCandidatesPreservingNaturalBombs(plays, view);
  const likely = new Set(threat.likelyPatternTypes);
  const hasNonBomb = candidates.some(
    (action) => !bombs.has(action.interpretation.type),
  );
  return [...candidates].sort((left, right) => {
    // Bombs remain backloaded when leading; the threat mode is not permission to burn one early.
    const bombDelta =
      Number(hasNonBomb && bombs.has(left.interpretation.type)) -
      Number(hasNonBomb && bombs.has(right.interpretation.type));
    if (bombDelta !== 0) return bombDelta;
    const likelyDelta =
      Number(likely.has(left.interpretation.type)) -
      Number(likely.has(right.interpretation.type));
    if (likelyDelta !== 0) return likelyDelta;
    return compareDescending(left, right, view);
  });
}

function rankForcedBlockCandidates(view: BotView): readonly PlayAction[] {
  const plays = view.legalActions.filter(isPlay);
  const nonBombs = plays.filter(
    (action) => !bombs.has(action.interpretation.type),
  );
  return (nonBombs.length > 0 ? nonBombs : plays).sort((left, right) =>
    compareDescending(left, right, view),
  );
}

/** Final bot safety net: strategy may rank actions, but never removes rule-engine actions. */
function legalActionFallback(view: BotView): TurnAction | undefined {
  return (
    view.legalActions.find(isPlay) ??
    view.legalActions.find((action) => action.type === "pass")
  );
}

function opponentThreat(view: BotView, maximum: number): boolean {
  return Object.entries(view.remainingCardCounts).some(
    ([seat, count]) =>
      seat !== view.selfSeat &&
      seat !== teammate[view.selfSeat] &&
      count >= 1 &&
      count <= maximum,
  );
}

function opponentContestStreak(view: BotView): number {
  let streak = 0;
  for (const event of [...view.publicEvents].reverse()) {
    if (
      event.actorId === view.selfSeat ||
      event.actorId === teammate[view.selfSeat]
    )
      break;
    if (event.type !== "guandan.turn_action") break;
    streak += 1;
  }
  return streak;
}

function allowedStructureDamage(view: BotView): number {
  if (opponentThreat(view, 2)) return BREAK_BOMB_COST;
  if (opponentThreat(view, 3)) return BREAK_STEEL_PLATE_COST;
  if (opponentThreat(view, 5) || opponentContestStreak(view) >= 2)
    return BREAK_TRIPLE_COST;
  return BREAK_PAIR_COST - 1;
}

/**
 * A normal midgame response may spend a low natural pair or triple, but never
 * a control card, wildcard, sequence, bomb, or other high-value structure.
 * This is a bounded exception to the general structure-preservation gate.
 */
function isLowValueNaturalStructureSpend(
  action: PlayAction,
  view: BotView,
): boolean {
  if (structureDamageCost(action, view) > BREAK_TRIPLE_COST) return false;
  const selected = selectedCards(action, view);
  if (
    selected.some(
      (card) =>
        card.rank === "A" ||
        card.rank === view.levelRank ||
        card.rank === "small-joker" ||
        card.rank === "big-joker" ||
        (card.suit === "hearts" && card.rank === view.levelRank) ||
        rankCost(card, view.levelRank) > LOW_VALUE_STRUCTURE_RANK_COST,
    )
  )
    return false;
  const groups = naturalGroups(view);
  const selectedByRank = selected.reduce<Map<Card["rank"], number>>(
    (counts, card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1),
    new Map(),
  );
  let brokeLowNaturalGroup = false;
  for (const [rank, count] of selectedByRank) {
    const available = groups.get(rank)?.length ?? 0;
    if (count >= available) continue;
    if (available < 2 || available > 3) return false;
    brokeLowNaturalGroup = true;
  }
  return brokeLowNaturalGroup;
}

function rankResponseCandidates(
  view: BotView,
  plays: readonly PlayAction[],
): readonly PlayAction[] {
  const scoreContext = createNormalVNextScoreContext(view);
  const scores = new Map<PlayAction, NormalVNextCandidateScore>();
  const economicalBombs = new Map<PlayAction, boolean>();
  const score = (action: PlayAction) => {
    const cached = scores.get(action);
    if (cached) return cached;
    const calculated = scoreLegalNormalVNextCandidate(
      action,
      view,
      scoreContext,
    );
    scores.set(action, calculated);
    return calculated;
  };
  const isEconomicalBomb = (action: PlayAction) => {
    const cached = economicalBombs.get(action);
    if (cached !== undefined) return cached;
    const calculated = shouldPrioritizeBomb(action, view);
    economicalBombs.set(action, calculated);
    return calculated;
  };
  const hasNonBomb = plays.some(
    (action) => !bombs.has(action.interpretation.type),
  );
  return [...plays].sort((left, right) => {
    const economicalBombDelta =
      Number(isEconomicalBomb(right)) - Number(isEconomicalBomb(left));
    if (economicalBombDelta !== 0) return economicalBombDelta;
    const bombDelta =
      Number(hasNonBomb && bombs.has(left.interpretation.type)) -
      Number(hasNonBomb && bombs.has(right.interpretation.type));
    if (bombDelta !== 0) return bombDelta;
    if (
      left.interpretation.type === "three-with-pair" &&
      right.interpretation.type === "three-with-pair"
    ) {
      const mainDelta = compareNumberLists(
        comparisonCost(left),
        comparisonCost(right),
      );
      if (mainDelta !== 0) return mainDelta;
      const attachmentDelta =
        attachmentCost(left, view) - attachmentCost(right, view);
      if (attachmentDelta !== 0) return attachmentDelta;
    }
    const costDelta = score(left).score - score(right).score;
    if (costDelta !== 0) return costDelta;
    const comparisonDelta = compareNumberLists(
      comparisonCost(left),
      comparisonCost(right),
    );
    if (comparisonDelta !== 0) return comparisonDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

/**
 * Following can contain thousands of wildcard interpretations for the same
 * physical response. Rules must retain the complete legal set, but route
 * scoring every projection is neither necessary nor safe for the UI thread.
 * Keep a deterministic, low-resource response pool and score only that pool.
 */
function collectResponseAnalysisCandidates(
  view: BotView,
): readonly PlayAction[] {
  const plays = view.legalActions.filter(isPlay);
  if (plays.length <= RESPONSE_ANALYSIS_CANDIDATE_LIMIT) return plays;

  const priority = new Map<PlayAction, readonly number[]>();
  const compareByPriority = (left: PlayAction, right: PlayAction) => {
    const getPriority = (action: PlayAction) => {
      const cached = priority.get(action);
      if (cached) return cached;
      const calculated = [
        wildcardOpportunityCost(action, view),
        controlResourceCost(action, view),
        actionRankCost(action, view),
        attachmentCost(action, view),
      ] as const;
      priority.set(action, calculated);
      return calculated;
    };
    const delta = compareNumberLists(getPriority(left), getPriority(right));
    if (delta !== 0) return delta;
    const comparisonDelta = compareNumberLists(
      comparisonCost(left),
      comparisonCost(right),
    );
    if (comparisonDelta !== 0) return comparisonDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  };
  const candidates = new Set<PlayAction>();
  const baseline = chooseNormalBotAction(view)?.action;
  if (baseline && isPlay(baseline)) candidates.add(baseline);

  const directFinishCandidate = plays
    .filter((action) => directFinish(action, view))
    .sort(compareByPriority)
    .at(0);
  if (directFinishCandidate) candidates.add(directFinishCandidate);

  const nonBombs = plays.filter(
    (action) => !bombs.has(action.interpretation.type),
  );
  const bestBomb = plays
    .filter((action) => bombs.has(action.interpretation.type))
    .sort(compareByPriority)
    .at(0);
  const standardResponses = (nonBombs.length > 0 ? nonBombs : plays).sort(
    compareByPriority,
  );
  for (const action of standardResponses) {
    if (candidates.size >= RESPONSE_ANALYSIS_CANDIDATE_LIMIT) break;
    candidates.add(action);
  }
  if (bestBomb && candidates.size < RESPONSE_ANALYSIS_CANDIDATE_LIMIT)
    candidates.add(bestBomb);
  return [...candidates];
}

function rankLeadCandidates(
  view: BotView,
  plays: readonly PlayAction[],
): readonly PlayAction[] {
  const candidates = leadCandidatesPreservingNaturalBombs(plays, view);
  const scoreContext = createNormalVNextScoreContext(view);
  const scores = new Map<PlayAction, NormalVNextCandidateScore>();
  const economicalBombs = new Map<PlayAction, boolean>();
  const finishingBombs = new Map<PlayAction, boolean>();
  const score = (action: PlayAction) => {
    const cached = scores.get(action);
    if (cached) return cached;
    const calculated = scoreLegalNormalVNextCandidate(
      action,
      view,
      scoreContext,
    );
    scores.set(action, calculated);
    return calculated;
  };
  const isEconomicalBomb = (action: PlayAction) => {
    const cached = economicalBombs.get(action);
    if (cached !== undefined) return cached;
    const calculated = shouldPrioritizeBomb(action, view);
    economicalBombs.set(action, calculated);
    return calculated;
  };
  const isFinishingBomb = (action: PlayAction) => {
    const cached = finishingBombs.get(action);
    if (cached !== undefined) return cached;
    const calculated = shouldPrioritizeLeadIntactBomb(action, view, plays);
    finishingBombs.set(action, calculated);
    return calculated;
  };
  const hasNonBomb = candidates.some(
    (action) => !bombs.has(action.interpretation.type),
  );
  return [...candidates].sort((left, right) => {
    const finishingBombDelta =
      Number(isFinishingBomb(right)) - Number(isFinishingBomb(left));
    if (finishingBombDelta !== 0) return finishingBombDelta;
    const economicalBombDelta =
      Number(isEconomicalBomb(right)) - Number(isEconomicalBomb(left));
    if (economicalBombDelta !== 0) return economicalBombDelta;
    const bombDelta =
      Number(hasNonBomb && bombs.has(left.interpretation.type)) -
      Number(hasNonBomb && bombs.has(right.interpretation.type));
    if (bombDelta !== 0) return bombDelta;
    const scoreDelta = score(left).score - score(right).score;
    if (scoreDelta !== 0) return scoreDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

/**
 * Leading can have a very large wildcard-expanded legal set. Keep the frozen
 * normal lead as an anchor and evaluate only a fixed, deterministic prefix of
 * additional legal plays; this makes the P7 one-ply analysis bounded.
 */
function collectLeadAnalysisCandidates(
  view: BotView,
  baseline: PlayAction,
): readonly PlayAction[] {
  const candidates: PlayAction[] = [baseline];
  const allowBombs =
    bombs.has(baseline.interpretation.type) || view.selfHand.length <= 10;
  for (const action of view.legalActions) {
    if (!isPlay(action) || action === baseline) continue;
    if (!allowBombs && bombs.has(action.interpretation.type)) continue;
    candidates.push(action);
    if (candidates.length === 24) break;
  }
  for (const action of view.legalActions) {
    if (!isPlay(action) || candidates.includes(action)) continue;
    if (!isNaturalWholeBomb(action, view)) continue;
    candidates.push(action);
    if (candidates.length === 28) break;
  }
  return candidates;
}

function isContestRelevantPattern(action: PlayAction): boolean {
  return (
    action.interpretation.type === "pair" ||
    action.interpretation.type === "triple" ||
    action.interpretation.type === "three-with-pair"
  );
}

/** Preview-only deterministic normal evolution; it reads only BotView and legal actions. */
export function chooseNormalVNextBotAction(
  view: BotView,
): NormalBotDecision | undefined {
  const nextSeatThreat = analyzeNextSeatEndgameThreat(view);
  if (view.highestSeat === undefined) {
    if (nextSeatThreat.mode === "none") {
      const baseline = chooseNormalBotAction(view);
      if (!baseline || !isPlay(baseline.action)) return baseline;
      const selected = rankLeadCandidates(
        view,
        collectLeadAnalysisCandidates(view, baseline.action),
      ).at(0)!;
      const candidateScore = scoreLegalNormalVNextCandidate(selected, view);
      return {
        action: selected,
        score: candidateScore.score,
        reasons: ["领牌：综合公开信息与己方路线", ...candidateScore.reasons],
      };
    }
    const selected =
      rankThreatLeadCandidates(view, nextSeatThreat).at(0) ??
      legalActionFallback(view);
    if (!selected) return undefined;
    return {
      action: selected,
      score: 0,
      reasons: [
        `下家尾局威胁：${nextSeatThreat.remainingCards} 张，避免顺出其可能牌型`,
        "阻断领牌：在相同风险下由大到小出牌",
      ],
    };
  }

  const pass = view.legalActions.find((action) => action.type === "pass");
  const candidates = rankResponseCandidates(
    view,
    collectResponseAnalysisCandidates(view),
  );
  const finish = candidates.find((action) => directFinish(action, view));
  if (analyzeCooperationSignal(view).mode === "yield" && pass && !finish)
    return {
      action: pass,
      score: 0,
      reasons: ["normal-vNext：队友持权，默认不接管"],
    };

  const forcedBlock = nextSeatThreat.mode === "forced";
  const damageLimit = allowedStructureDamage(view);
  const safeCandidates = candidates.filter(
    (action) =>
      directFinish(action, view) ||
      structureDamageCost(action, view) <= damageLimit ||
      isLowValueNaturalStructureSpend(action, view),
  );
  const onlyHighCostStructureResponses =
    candidates.length > 0 &&
    candidates.every(
      (action) =>
        isContestRelevantPattern(action) &&
        (describeNormalVNextContest(action, view)?.highValuePenalty ?? 0) > 0,
    );
  const selected: TurnAction | undefined =
    finish ??
    (forcedBlock
      ? (rankForcedBlockCandidates(view).at(0) ?? pass ?? candidates.at(0))
      : onlyHighCostStructureResponses
        ? pass
        : (safeCandidates.at(0) ?? pass ?? candidates.at(0)));
  const selectedWithFallback = selected ?? legalActionFallback(view);
  if (!selectedWithFallback) return undefined;

  const candidateScore =
    selectedWithFallback.type === "play"
      ? scoreNormalVNextCandidate(selectedWithFallback, view)
      : undefined;
  const reasons = [
    selectedWithFallback.type === "pass"
      ? "normal-vNext：避免高结构损伤，合理 pass"
      : "normal-vNext：最低响应总成本（点数 + 结构 + 控制 + 逢人配）",
  ];
  if (
    selectedWithFallback.type === "play" &&
    selectedWithFallback.interpretation.type === "single"
  )
    reasons.push("优先保留 A、级牌与大小王");
  if (
    selectedWithFallback.type === "play" &&
    selectedWithFallback.interpretation.type === "three-with-pair"
  )
    reasons.push("最小主三张后选择最低资源成本对子");
  if (opponentThreat(view, 3) && selectedWithFallback.type === "play")
    reasons.push("阻断对手 1～3 张残局");
  if (forcedBlock && selectedWithFallback.type === "play")
    reasons.push(
      `next-seat forced block: ${nextSeatThreat.remainingCards} cards`,
    );
  if (
    selectedWithFallback.type === "play" &&
    structureDamageCost(selectedWithFallback, view) > 0
  )
    reasons.push("已计入结构损伤成本");
  if (finish) reasons.push("直接出完例外");
  return {
    action: selectedWithFallback,
    score: candidateScore?.score ?? 0,
    reasons: [...reasons, ...(candidateScore?.reasons ?? [])],
  };
}
