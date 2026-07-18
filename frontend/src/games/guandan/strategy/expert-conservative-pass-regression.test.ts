import { expect, test } from "vitest";
import type { Card, Event, Seat } from "../../../platform/types";
import { createBotView } from "../bot-view";
import type { TurnAction } from "../turns";
import { createDefaultStrategyProfile } from "./decision-explanation";
import { chooseExpertBotDecision, clearExpertDecisionCache } from "./expert-decision";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});
const publicPlay = (
  sequence: number,
  actor: Seat,
  type: "single" | "pair",
  comparisonKey: readonly number[]
): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: {
    action: {
      type: "play",
      actor,
      cardIds: [`${actor}-${sequence}`],
      interpretation: { type, cardIds: [`${actor}-${sequence}`], comparisonKey, wildcardAs: {} }
    }
  }
});
const pass = (actor: Seat): TurnAction => ({ type: "pass", actor });
const play = (
  actor: Seat,
  cardIds: readonly string[],
  type: "single" | "pair",
  comparisonKey: readonly number[]
): TurnAction => ({
  type: "play",
  actor,
  cardIds,
  interpretation: { type, cardIds, comparisonKey, wildcardAs: {} }
});

function decide(input: {
  readonly hand: readonly Card[];
  readonly actions: readonly TurnAction[];
  readonly events?: readonly Event[];
  readonly remaining?: Readonly<Record<Seat, number>>;
}) {
  clearExpertDecisionCache();
  return chooseExpertBotDecision({
    view: createBotView({
      selfSeat: "south",
      leader: "east",
      highestSeat: "east",
      levelRank: "2",
      hand: input.hand,
      publicEvents: input.events ?? [publicPlay(1, "east", "single", [3])],
      remainingCardCounts: input.remaining ?? {
        east: 8,
        south: input.hand.length,
        west: 10,
        north: 10
      },
      legalActions: input.actions
    }),
    profile: createDefaultStrategyProfile("expert")
  });
}

test("small single with a natural response is contested rather than mechanically passed", () => {
  const result = decide({
    hand: [card("s4", "4"), card("s7", "7"), card("s9", "9")],
    actions: [pass("south"), play("south", ["s4"], "single", [4])]
  });
  expect(result.selectedAction).toMatchObject({ type: "play", cardIds: ["s4"] });
  expect(
    result.explanation.candidates.find((candidate) => candidate.action.type === "play")
  ).toMatchObject({
    postActionStatus: "completed",
    followUpStatus: "completed"
  });
});

test("small pair with a natural response is contested rather than mechanically passed", () => {
  const result = decide({
    hand: [
      card("p4a", "4"),
      card("p4b", "4", "hearts"),
      card("p8a", "8"),
      card("p8b", "8", "hearts")
    ],
    actions: [pass("south"), play("south", ["p4a", "p4b"], "pair", [4])],
    events: [publicPlay(1, "east", "pair", [3])]
  });
  expect(result.selectedAction).toMatchObject({ type: "play", cardIds: ["p4a", "p4b"] });
  const naturalPair = result.explanation.candidates.find(
    (candidate) => candidate.action.type === "play"
  );
  const skipped = result.explanation.candidates.find(
    (candidate) => candidate.action.type === "pass"
  );
  expect(naturalPair).toMatchObject({
    postActionStatus: "completed",
    followUpStatus: "completed",
    notFinallyEligible: false
  });
  expect(naturalPair!.finalScore).toBeGreaterThan(skipped!.finalScore);
});

test("two consecutive opponent control rounds raise the contest priority of a natural response", () => {
  const result = decide({
    hand: [card("s6", "6"), card("s9", "9"), card("q", "Q"), card("k", "K")],
    actions: [pass("south"), play("south", ["s6"], "single", [6])],
    events: [
      publicPlay(1, "east", "single", [3]),
      { sequence: 2, type: "action.applied", actorId: "north", payload: { action: pass("north") } },
      { sequence: 3, type: "action.applied", actorId: "west", payload: { action: pass("west") } },
      { sequence: 4, type: "action.applied", actorId: "south", payload: { action: pass("south") } },
      publicPlay(5, "east", "single", [5])
    ],
    remaining: { east: 8, south: 4, west: 10, north: 10 }
  });
  expect(result.selectedAction).toMatchObject({ type: "play", cardIds: ["s6"] });
  expect(
    result.explanation.candidates.find((candidate) => candidate.action.type === "play")?.signals
  ).toMatchObject({
    opponentHasCurrentControl: true
  });
});

test("opponent in the public runout range is blocked by a natural response rather than mechanically passed", () => {
  const result = decide({
    hand: [card("s6", "6"), card("s9", "9"), card("q", "Q"), card("k", "K")],
    actions: [pass("south"), play("south", ["s6"], "single", [6])],
    remaining: { east: 5, south: 4, west: 10, north: 10 }
  });
  expect(result.selectedAction).toMatchObject({ type: "play", cardIds: ["s6"] });
});

test("breaking a natural bomb at low threat still prefers pass", () => {
  const result = decide({
    hand: [
      card("k1", "K"),
      card("k2", "K", "hearts"),
      card("k3", "K", "clubs"),
      card("k4", "K", "diamonds"),
      card("s3", "3")
    ],
    actions: [pass("south"), play("south", ["k1"], "single", [13])],
    events: [publicPlay(1, "east", "single", [10])],
    remaining: { east: 12, south: 5, west: 12, north: 12 }
  });
  expect(result.selectedAction).toMatchObject({ type: "pass" });
});

test("regression: north single 4 is answered by the minimum natural 8, never A or jokers", () => {
  clearExpertDecisionCache();
  const hand = [
    card("eight", "8"),
    card("ace", "A"),
    card("small-joker", "small-joker", "joker"),
    card("big-joker", "big-joker", "joker")
  ];
  const actions = [
    pass("west"),
    play("west", ["eight"], "single", [8]),
    play("west", ["ace"], "single", [14]),
    play("west", ["small-joker"], "single", [16]),
    play("west", ["big-joker"], "single", [17])
  ];
  const result = chooseExpertBotDecision({
    view: createBotView({
      selfSeat: "west",
      leader: "north",
      highestSeat: "north",
      levelRank: "2",
      hand,
      publicEvents: [publicPlay(1, "north", "single", [4])],
      remainingCardCounts: { east: 10, south: 10, west: 4, north: 8 },
      legalActions: actions
    }),
    profile: createDefaultStrategyProfile("expert")
  });
  expect(result.selectedAction).toMatchObject({ type: "play", cardIds: ["eight"] });
  const byCard = (id: string) =>
    result.explanation.candidates.find(
      (candidate) => candidate.action.type === "play" && candidate.action.cardIds[0] === id
    );
  expect(byCard("eight")).toMatchObject({
    postActionStatus: "completed",
    followUpStatus: "completed"
  });
  expect(byCard("eight")!.finalScore).toBeGreaterThan(byCard("ace")!.finalScore);
  expect(byCard("eight")!.finalScore).toBeGreaterThan(byCard("big-joker")!.finalScore);
});
