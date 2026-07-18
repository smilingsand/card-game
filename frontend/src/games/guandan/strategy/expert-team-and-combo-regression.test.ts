import { expect, test } from "vitest";
import type { Card, Event, Seat } from "../../../platform/types";
import { createBotView } from "../bot-view";
import type { PatternType } from "../patterns";
import type { TurnAction } from "../turns";
import { createDefaultStrategyProfile } from "./decision-explanation";
import { chooseExpertBotDecision, clearExpertDecisionCache } from "./expert-decision";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});
const play = (
  actor: Seat,
  cardIds: readonly string[],
  type: PatternType,
  comparisonKey: readonly number[]
): TurnAction => ({
  type: "play",
  actor,
  cardIds,
  interpretation: { type, cardIds, comparisonKey, wildcardAs: {} }
});
const pass = (actor: Seat): TurnAction => ({ type: "pass", actor });
const publicPlay = (
  sequence: number,
  actor: Seat,
  type: PatternType,
  comparisonKey: readonly number[]
): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: { action: play(actor, [`${actor}-${sequence}`], type, comparisonKey) }
});

function decide(input: {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat: Seat;
  readonly hand: readonly Card[];
  readonly actions: readonly TurnAction[];
  readonly events: readonly Event[];
  readonly remaining: Readonly<Record<Seat, number>>;
}) {
  clearExpertDecisionCache();
  return chooseExpertBotDecision({
    view: createBotView({
      selfSeat: input.selfSeat,
      leader: input.leader,
      highestSeat: input.highestSeat,
      levelRank: "2",
      hand: input.hand,
      publicEvents: input.events,
      remainingCardCounts: input.remaining,
      legalActions: input.actions
    }),
    profile: createDefaultStrategyProfile("expert")
  });
}

function candidate(result: ReturnType<typeof decide>, firstCardId: string) {
  return result.explanation.candidates.find(
    (item) => item.action.type === "play" && item.action.cardIds.includes(firstCardId)
  );
}

test("opponent 33322 is contested by a natural low-cost three-with-pair rather than pass", () => {
  const result = decide({
    selfSeat: "south",
    leader: "east",
    highestSeat: "east",
    hand: [
      card("4a", "4"),
      card("4b", "4", "hearts"),
      card("4c", "4", "clubs"),
      card("5a", "5"),
      card("5b", "5", "hearts"),
      card("ka", "K")
    ],
    actions: [pass("south"), play("south", ["4a", "4b", "4c", "5a", "5b"], "three-with-pair", [4])],
    events: [publicPlay(1, "east", "three-with-pair", [3])],
    remaining: { east: 10, south: 6, west: 11, north: 11 }
  });
  expect(result.selectedAction).toMatchObject({
    type: "play",
    cardIds: ["4a", "4b", "4c", "5a", "5b"]
  });
  const lowCost = candidate(result, "4a")!;
  const skipped = result.explanation.candidates.find((item) => item.action.type === "pass")!;
  expect(lowCost).toMatchObject({
    postActionStatus: "completed",
    followUpStatus: "completed",
    notFinallyEligible: false
  });
  expect(lowCost.finalScore).toBeGreaterThan(skipped.finalScore);
});

test("does not take over teammate's small-joker control with big joker without an exception", () => {
  const result = decide({
    selfSeat: "west",
    leader: "south",
    highestSeat: "east",
    hand: [card("bj", "big-joker", "joker"), card("8", "8")],
    actions: [pass("west"), play("west", ["bj"], "single", [17])],
    events: [publicPlay(1, "south", "single", [9]), publicPlay(2, "east", "single", [16])],
    remaining: { east: 8, south: 10, west: 2, north: 10 }
  });
  expect(result.selectedAction).toMatchObject({ type: "pass" });
  const bigJoker = candidate(result, "bj")!;
  expect(bigJoker.hardExcluded).toBe(true);
  expect(bigJoker.matchedRules).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: "P25-R43" })])
  );
});

test("three-with-pair keeps the weakest attachment and reserves AA", () => {
  const result = decide({
    selfSeat: "south",
    leader: "east",
    highestSeat: "east",
    hand: [
      card("ta", "10"),
      card("tb", "10", "hearts"),
      card("tc", "10", "clubs"),
      card("3a", "3"),
      card("3b", "3", "hearts"),
      card("aa", "A"),
      card("ab", "A", "hearts"),
      card("k", "K")
    ],
    actions: [
      pass("south"),
      play("south", ["ta", "tb", "tc", "3a", "3b"], "three-with-pair", [10]),
      play("south", ["ta", "tb", "tc", "aa", "ab"], "three-with-pair", [10])
    ],
    events: [publicPlay(1, "east", "three-with-pair", [9])],
    remaining: { east: 9, south: 8, west: 11, north: 11 }
  });
  expect(result.selectedAction).toMatchObject({
    type: "play",
    cardIds: ["ta", "tb", "tc", "3a", "3b"]
  });
  const weakAttachment = candidate(result, "3a")!;
  const aceAttachment = candidate(result, "aa")!;
  expect(weakAttachment.finalScore).toBeGreaterThan(aceAttachment.finalScore);
  expect(aceAttachment.signals.overbidsLowestThreeWithPairAttachment).toBe(true);
  expect(aceAttachment.matchedRules).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: "P25-R44" })])
  );
  expect(aceAttachment.control.opportunityCost).toBeGreaterThan(
    weakAttachment.control.opportunityCost
  );
});
