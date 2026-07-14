import type { Card, CardId, Rank, Suit } from "../../platform/types";
import type { PatternInterpretation } from "./patterns";

const normalRanks: readonly Rank[] = [
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
  "2"
];
const suitOrder: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades", "joker"];

function rankOrder(rank: Rank, levelRank: Rank): number {
  if (rank === "big-joker") return 17;
  if (rank === "small-joker") return 16;
  if (rank === levelRank) return 15;
  // 非打 2 局时，2 是最小普通牌，而非原有的次高牌。
  if (rank === "2" && levelRank !== "2") return 1;
  return normalRanks.indexOf(rank) + 2;
}

export interface DisplayCardGroup {
  readonly key: string;
  readonly cardIds: readonly CardId[];
  readonly isBomb: boolean;
}

function cardRank(card: Card, interpretation?: PatternInterpretation): Rank {
  return interpretation?.wildcardAs[card.id]?.rank ?? card.rank;
}

function groupedByRank(
  cardIds: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>,
  interpretation?: PatternInterpretation
): readonly DisplayCardGroup[] {
  const groups = new Map<Rank, CardId[]>();
  for (const cardId of cardIds) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const rank = cardRank(card, interpretation);
    groups.set(rank, [...(groups.get(rank) ?? []), cardId]);
  }
  return [...groups.entries()].map(([rank, ids]) => ({
    key: rank,
    cardIds: ids.sort((leftId, rightId) => {
      const left = cardsById.get(leftId);
      const right = cardsById.get(rightId);
      if (!left || !right) return leftId.localeCompare(rightId);
      return (
        suitOrder.indexOf(left.suit) - suitOrder.indexOf(right.suit) ||
        left.deckIndex - right.deckIndex
      );
    }),
    isBomb: ids.length >= 4
  }));
}

function compareRankGroups(
  levelRank: Rank,
  left: DisplayCardGroup,
  right: DisplayCardGroup
): number {
  return rankOrder(right.key as Rank, levelRank) - rankOrder(left.key as Rank, levelRank);
}

export function groupHumanDisplayCards(
  hand: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>,
  levelRank: Rank
): readonly DisplayCardGroup[] {
  const groups = groupedByRank(hand, cardsById);
  const normal = groups
    .filter((group) => !group.isBomb)
    .sort((left, right) => compareRankGroups(levelRank, left, right));
  const bombs = groups
    .filter((group) => group.isBomb)
    .sort(
      (left, right) =>
        right.cardIds.length - left.cardIds.length || compareRankGroups(levelRank, left, right)
    );
  return [...normal, ...bombs];
}

/**
 * 人工理牌后的牌序仍以实体 ID 为准；仅将相邻的同点数牌组成一个纵列，
 * 从而不会因手动移动而退化为纯横排，也不会重新覆盖用户指定的列顺序。
 */
export function groupOrderedDisplayCards(
  order: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>
): readonly DisplayCardGroup[] {
  const groups: DisplayCardGroup[] = [];
  for (const cardId of order) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const previous = groups.at(-1);
    const previousCard = previous ? cardsById.get(previous.cardIds.at(-1)!) : undefined;
    if (previous && previousCard?.rank === card.rank) {
      groups[groups.length - 1] = { ...previous, cardIds: [...previous.cardIds, cardId] };
      continue;
    }
    groups.push({ key: `${card.rank}-${groups.length}`, cardIds: [cardId], isBomb: false });
  }
  return groups;
}

/**
 * 只为真人阅读生成稳定顺序；不参与牌型、回合或动作判断。
 * 同点数的两副牌按花色、再按牌副序号相邻排列。
 */
export function sortHumanDisplayCards(
  hand: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>,
  levelRank: Rank
): readonly CardId[] {
  return groupHumanDisplayCards(hand, cardsById, levelRank).flatMap((group) => group.cardIds);
}

export function sortPlayedCards(
  cardIds: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>,
  levelRank: Rank,
  interpretation: PatternInterpretation
): readonly CardId[] {
  return [...groupedByRank(cardIds, cardsById, interpretation)]
    .sort(
      (left, right) =>
        right.cardIds.length - left.cardIds.length || compareRankGroups(levelRank, left, right)
    )
    .flatMap((group) => group.cardIds);
}

/** 保留有效手动顺序，出掉的牌移除，新出现的牌稳定追加。 */
export function reconcileHumanDisplayOrder(
  preferredOrder: readonly CardId[] | undefined,
  hand: readonly CardId[],
  cardsById: ReadonlyMap<CardId, Card>,
  levelRank: Rank
): readonly CardId[] {
  const handIds = new Set(hand);
  const validPreferred = (preferredOrder ?? []).filter(
    (cardId, index, all) => handIds.has(cardId) && all.indexOf(cardId) === index
  );
  const remaining = sortHumanDisplayCards(hand, cardsById, levelRank).filter(
    (cardId) => !validPreferred.includes(cardId)
  );
  return [...validPreferred, ...remaining];
}

export function moveHumanDisplayCard(
  order: readonly CardId[],
  movingCardId: CardId,
  targetCardId: CardId
): readonly CardId[] {
  if (
    movingCardId === targetCardId ||
    !order.includes(movingCardId) ||
    !order.includes(targetCardId)
  ) {
    return order;
  }
  const withoutMoving = order.filter((cardId) => cardId !== movingCardId);
  const targetIndex = withoutMoving.indexOf(targetCardId);
  return [
    ...withoutMoving.slice(0, targetIndex),
    movingCardId,
    ...withoutMoving.slice(targetIndex)
  ];
}
