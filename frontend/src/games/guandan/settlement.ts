import type { Rank, Seat } from "../../platform/types";
const levels: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export interface SettlementInput {
  readonly level: Rank;
  readonly finish: readonly Seat[];
  readonly antiTribute?: boolean;
  readonly proof?: readonly { readonly id: string; readonly rank: Rank }[];
  readonly doubleTributeTie?: boolean;
}
export interface Settlement {
  readonly rulesVersion: "guandan-v1";
  readonly level: Rank;
  readonly winner: boolean;
  readonly nextLeader: Seat;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: "action.applied";
    readonly payload: unknown;
  }[];
}
export function canReturnTribute(rank: Rank, level: Rank): boolean {
  const order = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
  const value = (item: Rank) =>
    item === level ? 15 : order.indexOf(item as (typeof order)[number]) + 2;
  return value(rank) <= value("10");
}
export function initializeNextRound(level: Rank, leader: Seat) {
  return {
    rulesVersion: "guandan-v1" as const,
    level,
    leader,
    finished: [] as readonly Seat[],
    events: [
      {
        sequence: 0,
        type: "action.applied" as const,
        payload: { kind: "next-round-initialized", level, leader }
      }
    ]
  };
}
export function settleSingleTribute(
  level: Rank,
  winner: Seat,
  loser: Seat,
  tribute: { id: string; rank: Rank },
  returned: { id: string; rank: Rank }
) {
  if (!canReturnTribute(returned.rank, level)) throw new Error("invalid return tribute");
  return {
    nextLeader: loser,
    events: [
      {
        sequence: 0,
        type: "action.applied" as const,
        payload: { kind: "single-tribute", from: loser, to: winner, tribute, returned }
      }
    ]
  };
}
export function settleDoubleTribute(
  level: Rank,
  head: Seat,
  otherWinner: Seat,
  losers: readonly [Seat, Seat],
  tributes: readonly [{ id: string; value: number }, { id: string; value: number }],
  returns: readonly [{ id: string; rank: Rank }, { id: string; rank: Rank }]
) {
  if (!returns.every((card) => canReturnTribute(card.rank, level)))
    throw new Error("invalid return tribute");
  const tie = tributes[0].value === tributes[1].value;
  const high = tributes[0].value >= tributes[1].value ? 0 : 1;
  return {
    nextLeader: tie
      ? ({ east: "north", north: "west", west: "south", south: "east" }[head] as Seat)
      : losers[high],
    events: [
      {
        sequence: 0,
        type: "action.applied" as const,
        payload: { kind: "double-tribute", head, otherWinner, losers, tributes, returns }
      }
    ]
  };
}
export function settleRound(input: SettlementInput): Settlement {
  if (!levels.includes(input.level)) throw new Error("invalid level");
  if (
    input.antiTribute &&
    (!(input.proof?.length === 2) || !input.proof.every((card) => card.rank === "big-joker"))
  )
    throw new Error("two big jokers required");
  const partner = (seat: Seat) =>
    ({ east: "west", west: "east", south: "north", north: "south" })[seat] as Seat;
  const double = partner(input.finish[0]) === input.finish[1];
  const delta = double ? 3 : partner(input.finish[0]) === input.finish[2] ? 2 : 1;
  const index = Math.min(levels.indexOf(input.level) + delta, levels.length - 1);
  const next = input.doubleTributeTie
    ? ({ east: "north", north: "west", west: "south", south: "east" }[input.finish[0]] as Seat)
    : input.finish[0];
  return {
    rulesVersion: "guandan-v1",
    level: levels[index],
    winner: input.level === "A" && double,
    nextLeader: next,
    events: [
      {
        sequence: 0,
        type: "action.applied",
        payload: {
          finish: input.finish,
          antiTribute: !!input.antiTribute,
          proof: input.proof ?? []
        }
      }
    ]
  };
}
