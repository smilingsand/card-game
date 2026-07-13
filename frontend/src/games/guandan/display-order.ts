import type { Card, CardId, Rank, Suit } from "../../platform/types";

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
  if (rank === "small-joker") return 16;
  if (rank === "big-joker") return 17;
  if (rank === levelRank) return 15;
  return normalRanks.indexOf(rank);
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
  return [...hand].sort((leftId, rightId) => {
    const left = cardsById.get(leftId);
    const right = cardsById.get(rightId);
    if (!left || !right) return leftId.localeCompare(rightId);
    return (
      rankOrder(left.rank, levelRank) - rankOrder(right.rank, levelRank) ||
      suitOrder.indexOf(left.suit) - suitOrder.indexOf(right.suit) ||
      left.deckIndex - right.deckIndex ||
      left.id.localeCompare(right.id)
    );
  });
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
