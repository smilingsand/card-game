// Shared Guandan core source.
import type { Rank, Seat, Suit } from "../../platform/types";
import type { BotView } from "./bot-view";
import type { PublicActionProjection } from "./public-action-projection";

const seats: readonly Seat[] = ["east", "south", "west", "north"];
const teammateOf: Readonly<Record<Seat, Seat>> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south",
};

type ActionStats = {
  readonly plays: number;
  readonly passes: number;
  readonly cardsPlayed: number;
  readonly patternCounts: Readonly<Record<string, number>>;
};

export interface StrategyObservation {
  readonly version: "guandan-strategy-observation-v1";
  readonly seats: Readonly<{
    readonly self: Seat;
    readonly teammate: Seat;
    readonly opponents: readonly Seat[];
  }>;
  readonly turn: Readonly<{
    readonly leader: Seat;
    readonly highestSeat?: Seat;
    readonly mode: "lead" | "respond";
    readonly recentActions: readonly PublicActionProjection[];
  }>;
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly publicCards: Readonly<{
    readonly count: number;
    readonly rankCounts: Readonly<Partial<Record<Rank, number>>>;
    readonly suitCounts: Readonly<Partial<Record<Suit, number>>>;
    readonly bySeat: Readonly<
      Record<
        Seat,
        readonly {
          readonly id: string;
          readonly suit: Suit;
          readonly rank: Rank;
        }[]
      >
    >;
  }>;
  readonly actionStats: Readonly<Record<Seat, ActionStats>>;
  readonly match?: BotView["matchContext"];
}

const emptyStats = (): ActionStats => ({
  plays: 0,
  passes: 0,
  cardsPlayed: 0,
  patternCounts: {},
});

/** Pure, sequence-ordered reconstruction from the public BotView projection. */
export function createStrategyObservation(view: BotView): StrategyObservation {
  const publicActions = [...(view.publicActions ?? [])].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const rankCounts: Partial<Record<Rank, number>> = {};
  const suitCounts: Partial<Record<Suit, number>> = {};
  const bySeat: Record<Seat, { id: string; suit: Suit; rank: Rank }[]> = {
    east: [],
    south: [],
    west: [],
    north: [],
  };
  const actionStats = Object.fromEntries(
    seats.map((seat) => [seat, emptyStats()]),
  ) as Record<Seat, ActionStats>;
  for (const action of publicActions) {
    const previous = actionStats[action.actor];
    const patternCounts = { ...previous.patternCounts };
    if (action.type === "play" && action.patternType)
      patternCounts[action.patternType] =
        (patternCounts[action.patternType] ?? 0) + 1;
    actionStats[action.actor] = {
      plays: previous.plays + Number(action.type === "play"),
      passes: previous.passes + Number(action.type === "pass"),
      cardsPlayed: previous.cardsPlayed + action.cards.length,
      patternCounts,
    };
    for (const card of action.cards) {
      bySeat[action.actor].push(card);
      rankCounts[card.rank] = (rankCounts[card.rank] ?? 0) + 1;
      suitCounts[card.suit] = (suitCounts[card.suit] ?? 0) + 1;
    }
  }
  const teammate = teammateOf[view.selfSeat];
  return {
    version: "guandan-strategy-observation-v1",
    seats: {
      self: view.selfSeat,
      teammate,
      opponents: seats.filter(
        (seat) => seat !== view.selfSeat && seat !== teammate,
      ),
    },
    turn: {
      leader: view.leader,
      highestSeat: view.highestSeat,
      mode: view.highestSeat ? "respond" : "lead",
      recentActions: publicActions.slice(-4),
    },
    remainingCardCounts: { ...view.remainingCardCounts },
    publicCards: {
      count: publicActions.reduce(
        (count, action) => count + action.cards.length,
        0,
      ),
      rankCounts,
      suitCounts,
      bySeat,
    },
    actionStats,
    match: view.matchContext,
  };
}
