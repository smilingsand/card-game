// Shared Guandan core source.
import type { Card, CardId, Rank, Seat } from "../../platform/types";
import type { TributePlan } from "./match";

const NORMAL_RANKS: readonly Rank[] = [
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
];

export interface TributeReturn {
  readonly from: Seat;
  readonly to: Seat;
  readonly cardId: CardId;
}

export interface PublicTributeExchange {
  readonly from: Seat;
  readonly to: Seat;
  readonly tributeCardId: CardId;
  readonly returnedCardId: CardId;
}

export interface TributeExchangeResult {
  readonly hands: Readonly<Record<Seat, readonly Card[]>>;
  readonly records: readonly PublicTributeExchange[];
}

export class TributeExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TributeExchangeError";
  }
}

function cardValue(card: Card, levelRank: Rank): number {
  if (card.rank === "big-joker") return 17;
  if (card.rank === "small-joker") return 16;
  if (card.rank === levelRank) return 15;
  return NORMAL_RANKS.indexOf(card.rank) + 2;
}

function isRedHeartLevel(card: Card, levelRank: Rank): boolean {
  return card.suit === "hearts" && card.rank === levelRank;
}

export function isRequiredTributeCard(
  cardId: CardId,
  hand: readonly Card[],
  levelRank: Rank,
): boolean {
  const chosen = hand.find((card) => card.id === cardId);
  if (!chosen || isRedHeartLevel(chosen, levelRank)) return false;
  const eligible = hand.filter((card) => !isRedHeartLevel(card, levelRank));
  const largest = Math.max(
    ...eligible.map((card) => cardValue(card, levelRank)),
  );
  return cardValue(chosen, levelRank) === largest;
}

export function canReturnTributeCard(card: Card, levelRank: Rank): boolean {
  const tenValue = cardValue({ ...card, rank: "10" }, levelRank);
  return (
    card.rank !== "small-joker" &&
    card.rank !== "big-joker" &&
    cardValue(card, levelRank) <= tenValue
  );
}

function removeCard(hand: readonly Card[], cardId: CardId): readonly Card[] {
  return hand.filter((card) => card.id !== cardId);
}

export function applyTributeExchange(
  levelRank: Rank,
  plan: TributePlan,
  initialHands: Readonly<Record<Seat, readonly Card[]>>,
  returns: readonly TributeReturn[],
): TributeExchangeResult {
  if (plan.kind === "none") {
    if (returns.length !== 0)
      throw new TributeExchangeError("anti-tribute cannot return cards");
    return { hands: initialHands, records: [] };
  }
  if (returns.length !== plan.obligations.length) {
    throw new TributeExchangeError("each tribute requires exactly one return");
  }

  const usedReturns = new Set<CardId>();
  const exchanges = plan.obligations.map((obligation) => {
    if (
      !isRequiredTributeCard(
        obligation.cardId,
        initialHands[obligation.from],
        levelRank,
      )
    ) {
      throw new TributeExchangeError(
        "tribute must be the largest eligible card",
      );
    }
    const returned = returns.find(
      (item) => item.from === obligation.to && item.to === obligation.from,
    );
    if (!returned || usedReturns.has(returned.cardId)) {
      throw new TributeExchangeError("return direction does not match tribute");
    }
    usedReturns.add(returned.cardId);
    const returnCard = initialHands[returned.from].find(
      (card) => card.id === returned.cardId,
    );
    if (!returnCard || !canReturnTributeCard(returnCard, levelRank)) {
      throw new TributeExchangeError("return card must not exceed 10");
    }
    const tributeCard = initialHands[obligation.from].find(
      (card) => card.id === obligation.cardId,
    )!;
    return { obligation, returned, tributeCard, returnCard };
  });

  let hands: Readonly<Record<Seat, readonly Card[]>> = { ...initialHands };
  for (const { obligation, returned } of exchanges) {
    hands = {
      ...hands,
      [obligation.from]: removeCard(hands[obligation.from], obligation.cardId),
      [returned.from]: removeCard(hands[returned.from], returned.cardId),
    };
  }
  for (const { obligation, returned, tributeCard, returnCard } of exchanges) {
    hands = {
      ...hands,
      [obligation.to]: [...hands[obligation.to], tributeCard],
      [returned.to]: [...hands[returned.to], returnCard],
    };
  }
  return {
    hands,
    records: exchanges.map(({ obligation, returned }) => ({
      from: obligation.from,
      to: obligation.to,
      tributeCardId: obligation.cardId,
      returnedCardId: returned.cardId,
    })),
  };
}
