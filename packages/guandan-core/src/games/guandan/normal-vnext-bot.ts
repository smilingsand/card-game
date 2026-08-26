// Shared Guandan core source.
import type { Card } from "../../platform/types";
import type { BotView } from "./bot-view";
import { chooseNormalBotAction, type NormalBotDecision } from "./normal-bot";
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

type PlayAction = Extract<TurnAction, { readonly type: "play" }>;
type PatternType = PlayAction["interpretation"]["type"];

export interface NextSeatEndgameThreat {
  readonly seat: BotView["selfSeat"];
  readonly remainingCards: number;
  readonly mode: "caution" | "forced" | "none";
  readonly likelyPatternTypes: readonly PatternType[];
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
    readonly interceptionBenefit: number;
  };
  readonly reasons: readonly string[];
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
  return selectedCards(action, view).some(
    (card) => card.suit === "hearts" && card.rank === view.levelRank,
  )
    ? 120
    : 0;
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
  const rank = actionRankCost(action, view);
  const structure = structureDamageCost(action, view);
  const control = controlResourceCost(action, view);
  const wildcard = wildcardOpportunityCost(action, view);
  const attachment = attachmentCost(action, view);
  const handSheddingBenefit = isNaturalMiddleStructure(action, view)
    ? action.cardIds.length * 60
    : 0;
  const interceptionBenefit =
    view.highestSeat !== undefined &&
    view.highestSeat !== teammate[view.selfSeat] &&
    opponentThreat(view, 3)
      ? action.cardIds.length * 30
      : 0;
  const reasons: string[] = ["规则层合法候选"];
  if (structure > 0) reasons.push("保留现有复合结构");
  if (control > 0) reasons.push("保留控制资源");
  if (wildcard > 0) reasons.push("保留红桃级牌逢人配");
  if (handSheddingBenefit > 0) reasons.push("自然复合牌卸载收益");
  if (interceptionBenefit > 0) reasons.push("公开残局拦截收益");
  return {
    action,
    score:
      rank +
      structure +
      control +
      wildcard +
      attachment -
      handSheddingBenefit -
      interceptionBenefit,
    breakdown: {
      rankCost: rank,
      structureDamageCost: structure,
      controlResourceCost: control,
      wildcardOpportunityCost: wildcard,
      attachmentCost: attachment,
      handSheddingBenefit,
      interceptionBenefit,
    },
    reasons,
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
      card.rank === "big-joker" ||
      rankCost(card, view.levelRank) >= 13,
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
  const likely = new Set(threat.likelyPatternTypes);
  const hasNonBomb = plays.some(
    (action) => !bombs.has(action.interpretation.type),
  );
  return [...plays].sort((left, right) => {
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

function rankResponseCandidates(view: BotView): readonly PlayAction[] {
  const plays = view.legalActions.filter(isPlay);
  const hasNonBomb = plays.some(
    (action) => !bombs.has(action.interpretation.type),
  );
  return [...plays].sort((left, right) => {
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
    const costDelta =
      (scoreNormalVNextCandidate(left, view)?.score ??
        Number.MAX_SAFE_INTEGER) -
      (scoreNormalVNextCandidate(right, view)?.score ??
        Number.MAX_SAFE_INTEGER);
    if (costDelta !== 0) return costDelta;
    const comparisonDelta = compareNumberLists(
      comparisonCost(left),
      comparisonCost(right),
    );
    if (comparisonDelta !== 0) return comparisonDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
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
      if (baseline) return baseline;
      const fallback = legalActionFallback(view);
      return fallback
        ? { action: fallback, score: 0, reasons: ["legal-action fallback"] }
        : undefined;
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
  const candidates = rankResponseCandidates(view);
  const finish = candidates.find((action) => directFinish(action, view));
  if (view.highestSeat === teammate[view.selfSeat] && pass && !finish)
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
      structureDamageCost(action, view) <= damageLimit,
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
