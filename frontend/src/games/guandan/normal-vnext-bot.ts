import type { Card } from "../../platform/types";
import type { BotView } from "./bot-view";
import { chooseNormalBotAction, type NormalBotDecision } from "./normal-bot";
import type { TurnAction } from "./turns";

const teammate: Record<BotView["selfSeat"], BotView["selfSeat"]> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south"
};
const bombs = new Set(["normal-bomb", "straight-flush", "four-jokers"]);
const normalRanks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const BREAK_PAIR_COST = 240;
const BREAK_TRIPLE_COST = 600;
const BREAK_STRAIGHT_COST = 800;
const BREAK_CONSECUTIVE_PAIR_COST = 900;
const BREAK_STEEL_PLATE_COST = 1_000;
const BREAK_BOMB_COST = 100_000;

type PlayAction = Extract<TurnAction, { readonly type: "play" }>;

export interface NormalVNextCostBreakdown {
  readonly rankCost: number;
  readonly structureDamageCost: number;
  readonly controlResourceCost: number;
  readonly wildcardOpportunityCost: number;
  readonly responseCost: number;
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

function compareNumberLists(left: readonly number[], right: readonly number[]): number {
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

function naturalGroups(view: BotView): ReadonlyMap<Card["rank"], readonly Card[]> {
  return view.selfHand
    .filter(
      (card) => card.suit !== "joker" && !(card.suit === "hearts" && card.rank === view.levelRank)
    )
    .reduce<Map<Card["rank"], Card[]>>((groups, card) => {
      groups.set(card.rank, [...(groups.get(card.rank) ?? []), card]);
      return groups;
    }, new Map());
}

function sequences(length: number): readonly (readonly Card["rank"][])[] {
  const standard = Array.from({ length: normalRanks.length - length + 1 }, (_, start) =>
    normalRanks.slice(start, start + length)
  );
  return length === 5 ? [...standard, ["A", "2", "3", "4", "5"]] : standard;
}

/** Lightweight, deterministic hand summary. It is advisory only and never creates actions. */
export function analyzeNormalVNextHand(view: BotView): NormalVNextHandAnalysis {
  const groups = naturalGroups(view);
  const counts = [...groups.values()].map((group) => group.length);
  const hasPattern = (copies: number, length: number) =>
    sequences(length).filter((sequence) =>
      sequence.every((rank) => (groups.get(rank)?.length ?? 0) >= copies)
    ).length;
  const wildcardCount = view.selfHand.filter(
    (card) => card.suit === "hearts" && card.rank === view.levelRank
  ).length;
  const controlCards = view.selfHand.filter(
    (card) =>
      card.rank === "A" ||
      card.rank === view.levelRank ||
      card.rank === "small-joker" ||
      card.rank === "big-joker"
  ).length;
  const triples = counts.filter((count) => count === 3).length;
  return {
    singles: counts.filter((count) => count === 1).length,
    pairs: counts.filter((count) => count === 2).length,
    triples,
    threeWithPairPotential: Math.min(triples, counts.filter((count) => count >= 2).length),
    straights: hasPattern(1, 5),
    consecutivePairs: hasPattern(2, 3),
    steelPlates: hasPattern(3, 2),
    bombs: counts.filter((count) => count >= 4).length,
    wildcardCount,
    controlCards
  };
}

function belongsToNaturalSequence(
  groups: ReadonlyMap<Card["rank"], readonly Card[]>,
  rank: Card["rank"],
  copies: number,
  length: number
): boolean {
  return sequences(length).some(
    (sequence) =>
      sequence.includes(rank) && sequence.every((item) => (groups.get(item)?.length ?? 0) >= copies)
  );
}

/** Cost of destroying an existing natural group; it never certifies legality. */
function structureDamageCost(action: PlayAction, view: BotView): number {
  const groups = naturalGroups(view);
  const selectedByRank = selectedCards(action, view).reduce<Map<Card["rank"], number>>(
    (counts, card) => {
      counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
      return counts;
    },
    new Map()
  );
  let cost = 0;
  for (const [rank, count] of selectedByRank) {
    const available = groups.get(rank)?.length ?? 0;
    if (count < available) {
      if (available >= 4) cost += BREAK_BOMB_COST;
      else if (available === 3) cost += BREAK_TRIPLE_COST;
      else if (available === 2) cost += BREAK_PAIR_COST;
    }
    if (belongsToNaturalSequence(groups, rank, 1, 5)) cost += BREAK_STRAIGHT_COST;
    if (belongsToNaturalSequence(groups, rank, 2, 3)) cost += BREAK_CONSECUTIVE_PAIR_COST;
    if (belongsToNaturalSequence(groups, rank, 3, 2)) cost += BREAK_STEEL_PLATE_COST;
  }
  return cost;
}

function controlResourceCost(action: PlayAction, view: BotView): number {
  let cost = bombs.has(action.interpretation.type) ? 200 : 0;
  for (const card of selectedCards(action, view)) {
    if (card.rank === "A") cost += 30;
    else if (card.rank === view.levelRank) cost += card.suit === "hearts" ? 120 : 60;
    else if (card.rank === "small-joker") cost += 80;
    else if (card.rank === "big-joker") cost += 100;
    else if (rankCost(card, view.levelRank) >= 13) cost += 15;
  }
  return cost;
}

function wildcardOpportunityCost(action: PlayAction, view: BotView): number {
  return selectedCards(action, view).some(
    (card) => card.suit === "hearts" && card.rank === view.levelRank
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
    const assignedRank = action.interpretation.wildcardAs[card.id]?.rank ?? card.rank;
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
  view: BotView
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
    responseCost: rank + structure + control + wildcard + attachmentCost(action, view)
  };
}

function directFinish(action: TurnAction, view: BotView): boolean {
  return isPlay(action) && action.cardIds.length === view.selfHand.length;
}

function opponentThreat(view: BotView, maximum: number): boolean {
  return Object.entries(view.remainingCardCounts).some(
    ([seat, count]) =>
      seat !== view.selfSeat && seat !== teammate[view.selfSeat] && count >= 1 && count <= maximum
  );
}

function opponentContestStreak(view: BotView): number {
  let streak = 0;
  for (const event of [...view.publicEvents].reverse()) {
    if (event.actorId === view.selfSeat || event.actorId === teammate[view.selfSeat]) break;
    if (event.type !== "guandan.turn_action") break;
    streak += 1;
  }
  return streak;
}

function allowedStructureDamage(view: BotView): number {
  if (opponentThreat(view, 2)) return BREAK_BOMB_COST;
  if (opponentThreat(view, 3)) return BREAK_STEEL_PLATE_COST;
  if (opponentThreat(view, 5) || opponentContestStreak(view) >= 2) return BREAK_TRIPLE_COST;
  return BREAK_PAIR_COST - 1;
}

function rankResponseCandidates(view: BotView): readonly PlayAction[] {
  const plays = view.legalActions.filter(isPlay);
  const hasNonBomb = plays.some((action) => !bombs.has(action.interpretation.type));
  return [...plays].sort((left, right) => {
    const bombDelta =
      Number(hasNonBomb && bombs.has(left.interpretation.type)) -
      Number(hasNonBomb && bombs.has(right.interpretation.type));
    if (bombDelta !== 0) return bombDelta;
    if (
      left.interpretation.type === "three-with-pair" &&
      right.interpretation.type === "three-with-pair"
    ) {
      const mainDelta = compareNumberLists(comparisonCost(left), comparisonCost(right));
      if (mainDelta !== 0) return mainDelta;
      const attachmentDelta = attachmentCost(left, view) - attachmentCost(right, view);
      if (attachmentDelta !== 0) return attachmentDelta;
    }
    const costDelta = responseCost(left, view) - responseCost(right, view);
    if (costDelta !== 0) return costDelta;
    const comparisonDelta = compareNumberLists(comparisonCost(left), comparisonCost(right));
    if (comparisonDelta !== 0) return comparisonDelta;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

/** Preview-only deterministic normal evolution; it reads only BotView and legal actions. */
export function chooseNormalVNextBotAction(view: BotView): NormalBotDecision | undefined {
  if (view.highestSeat === undefined) return chooseNormalBotAction(view);

  const pass = view.legalActions.find((action) => action.type === "pass");
  const candidates = rankResponseCandidates(view);
  const finish = candidates.find((action) => directFinish(action, view));
  if (view.highestSeat === teammate[view.selfSeat] && pass && !finish)
    return { action: pass, score: 0, reasons: ["normal-vNext：队友持权，默认不接管"] };

  const damageLimit = allowedStructureDamage(view);
  const safeCandidates = candidates.filter(
    (action) => directFinish(action, view) || structureDamageCost(action, view) <= damageLimit
  );
  const selected: TurnAction | undefined =
    finish ?? safeCandidates.at(0) ?? pass ?? candidates.at(0);
  if (!selected) return undefined;

  const reasons = [
    selected.type === "pass"
      ? "normal-vNext：避免高结构损伤，合理 pass"
      : "normal-vNext：最低响应总成本（点数 + 结构 + 控制 + 逢人配）"
  ];
  if (selected.type === "play" && selected.interpretation.type === "single")
    reasons.push("优先保留 A、级牌与大小王");
  if (selected.type === "play" && selected.interpretation.type === "three-with-pair")
    reasons.push("最小主三张后选择最低资源成本对子");
  if (opponentThreat(view, 3) && selected.type === "play") reasons.push("阻断对手 1～3 张残局");
  if (selected.type === "play" && structureDamageCost(selected, view) > 0)
    reasons.push("已计入结构损伤成本");
  if (finish) reasons.push("直接出完例外");
  return { action: selected, score: 0, reasons };
}
