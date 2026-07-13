import type { Card, Event, Seat } from "../../platform/types";
import type { TurnAction } from "./turns";
export interface BotView {
  readonly selfHand: readonly Card[];
  readonly publicEvents: readonly Event[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}
export function createBotView(input: {
  readonly hand: readonly Card[];
  readonly publicEvents: readonly Event[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}): BotView {
  return {
    selfHand: [...input.hand],
    publicEvents: [...input.publicEvents],
    remainingCardCounts: { ...input.remainingCardCounts },
    legalActions: [...input.legalActions]
  };
}
