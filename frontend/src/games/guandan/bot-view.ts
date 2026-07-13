import type { Card, Event, Rank, Seat } from "../../platform/types";
import type { TurnAction } from "./turns";
export interface BotView {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat?: Seat;
  readonly levelRank: Exclude<Rank, "small-joker" | "big-joker">;
  readonly selfHand: readonly Card[];
  readonly publicEvents: readonly Event[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}
export function createBotView(input: {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat?: Seat;
  readonly levelRank: Exclude<Rank, "small-joker" | "big-joker">;
  readonly hand: readonly Card[];
  readonly publicEvents: readonly Event[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}): BotView {
  return {
    selfSeat: input.selfSeat,
    leader: input.leader,
    highestSeat: input.highestSeat,
    levelRank: input.levelRank,
    selfHand: [...input.hand],
    publicEvents: [...input.publicEvents],
    remainingCardCounts: { ...input.remainingCardCounts },
    legalActions: [...input.legalActions]
  };
}
