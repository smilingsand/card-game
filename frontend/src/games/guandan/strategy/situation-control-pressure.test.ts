import { expect, test } from "vitest";
import type { Card, Event, Seat } from "../../../platform/types";
import type { BotView } from "../bot-view";
import { analyzeSituation } from "./situation-analyzer";

const play = (sequence: number, actor: Seat, rank: number): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: {
    action: {
      type: "play",
      actor,
      cardIds: [`${actor}-${sequence}`],
      interpretation: {
        type: "single",
        cardIds: [`${actor}-${sequence}`],
        comparisonKey: [rank],
        wildcardAs: {}
      }
    }
  }
});
const pass = (sequence: number, actor: Seat): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: { action: { type: "pass", actor } }
});

test("two public opponent control rounds raise contest pressure without hidden-hand inference", () => {
  const view: BotView = {
    selfSeat: "south",
    leader: "east",
    highestSeat: "east",
    levelRank: "2",
    selfHand: [] as readonly Card[],
    publicEvents: [
      play(1, "east", 4),
      pass(2, "north"),
      pass(3, "west"),
      pass(4, "south"),
      play(5, "east", 5)
    ],
    remainingCardCounts: { east: 8, south: 12, west: 12, north: 12 },
    legalActions: []
  };
  const situation = analyzeSituation(view);
  expect(situation.opponentThreat).toMatchObject({
    currentControlSeat: "east",
    consecutiveControlRounds: 2,
    level: "high"
  });
  expect(situation.opponentThreat.reasons.some((item) => /连续.*牌权/.test(item.reason))).toBe(
    true
  );
});
