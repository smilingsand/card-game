import type { Card, Rank, Seat } from "../../platform/types";

const LEVELS: readonly Exclude<Rank, "small-joker" | "big-joker">[] = [
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
  "A"
];

export interface MatchLevels {
  readonly northSouth: Exclude<Rank, "small-joker" | "big-joker">;
  readonly eastWest: Exclude<Rank, "small-joker" | "big-joker">;
}

export interface TributeObligation {
  readonly from: Seat;
  readonly to: Seat;
  readonly cardId: string;
}

export interface TributePlan {
  readonly kind: "none" | "single" | "double";
  readonly antiTribute: boolean;
  readonly proof: readonly string[];
  readonly obligations: readonly TributeObligation[];
}

function teamOf(seat: Seat): keyof MatchLevels {
  return seat === "north" || seat === "south" ? "northSouth" : "eastWest";
}

function nextLevel(
  level: MatchLevels[keyof MatchLevels],
  delta: number
): MatchLevels[keyof MatchLevels] {
  return LEVELS[Math.min(LEVELS.indexOf(level) + delta, LEVELS.length - 1)];
}

export function levelForLeader(levels: MatchLevels, leader: Seat): MatchLevels[keyof MatchLevels] {
  return levels[teamOf(leader)];
}

export function levelsAfterRound(levels: MatchLevels, finish: readonly Seat[]): MatchLevels {
  const winnerTeam = teamOf(finish[0]);
  const teammate = (seat: Seat) =>
    ({ east: "west", west: "east", south: "north", north: "south" })[seat] as Seat;
  const delta = finish[1] === teammate(finish[0]) ? 3 : finish[2] === teammate(finish[0]) ? 2 : 1;
  return { ...levels, [winnerTeam]: nextLevel(levels[winnerTeam], delta) };
}

function value(card: Card, level: MatchLevels[keyof MatchLevels]): number {
  if (card.rank === "big-joker") return 17;
  if (card.rank === "small-joker") return 16;
  if (card.rank === level) return 15;
  return LEVELS.indexOf(card.rank) + 2;
}

function highestTributeCard(
  hand: readonly Card[],
  level: MatchLevels[keyof MatchLevels]
): Card | undefined {
  return [...hand]
    .filter((card) => !(card.rank === level && card.suit === "hearts"))
    .sort((a, b) => value(b, level) - value(a, level) || a.id.localeCompare(b.id))[0];
}

function bigJokers(hand: readonly Card[]): readonly Card[] {
  return hand.filter((card) => card.rank === "big-joker");
}

export function createTributePlan(
  level: MatchLevels[keyof MatchLevels],
  finish: readonly Seat[],
  hands: Readonly<Record<Seat, readonly Card[]>>
): TributePlan {
  const head = finish[0];
  const second = finish[1];
  const losers = [finish[2], finish[3]] as const;
  const double = teamOf(losers[0]) === teamOf(losers[1]);
  const loserSeats = double ? losers : [finish[3]];
  const proof = loserSeats.flatMap((seat) => bigJokers(hands[seat])).slice(0, 2);
  const antiTribute = double
    ? proof.length >= 2 &&
      (bigJokers(hands[loserSeats[0]]).length >= 2 || bigJokers(hands[loserSeats[1]]).length >= 1)
    : proof.length >= 2;
  if (antiTribute)
    return {
      kind: "none",
      antiTribute: true,
      proof: proof.map((card) => card.id),
      obligations: []
    };

  const tributes = loserSeats
    .map((from) => ({ from, card: highestTributeCard(hands[from], level) }))
    .filter((entry): entry is { from: Seat; card: Card } => entry.card !== undefined);
  if (!double)
    return {
      kind: "single",
      antiTribute: false,
      proof: [],
      obligations: [{ from: tributes[0].from, to: head, cardId: tributes[0].card.id }]
    };
  const [high, low] = [...tributes].sort((a, b) => value(b.card, level) - value(a.card, level));
  return {
    kind: "double",
    antiTribute: false,
    proof: [],
    obligations: [
      { from: high.from, to: head, cardId: high.card.id },
      { from: low.from, to: second, cardId: low.card.id }
    ]
  };
}
