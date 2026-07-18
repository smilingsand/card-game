import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import { evaluateDeadHandRiskProxy } from "./dead-hand-risk-proxy";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  rank,
  suit,
  deckIndex: 0
});

test("ADR-0022 proxy is pure and records low-single/control/structure/wildcard components", () => {
  const view = {
    levelRank: "2" as const,
    selfHand: [
      card("bomb-a", "K"),
      card("bomb-b", "K", "hearts"),
      card("bomb-c", "K", "clubs"),
      card("bomb-d", "K", "diamonds"),
      card("pair-a", "4"),
      card("pair-b", "4", "hearts"),
      card("wild", "2", "hearts"),
      card("joker", "big-joker", "joker")
    ],
    remainingCardCounts: { east: 8, south: 2, west: 8, north: 8 }
  };
  const action = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["bomb-a", "pair-a", "wild", "joker"],
    interpretation: {
      type: "single" as const,
      primaryRank: "K" as const,
      wildcardAs: {},
      cardIds: ["bomb-a", "pair-a", "wild", "joker"],
      comparisonKey: [13]
    }
  };
  const first = evaluateDeadHandRiskProxy({ view, action });
  const second = evaluateDeadHandRiskProxy({ view, action });
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    lowSinglePenalty: 1,
    controlExhaustionPenalty: 4,
    structureBreakPenalty: 6,
    wildcardConsumptionPenalty: 3,
    publicThreatPenalty: 1
  });
  expect(first.total).toBe(15);
});

test("pass proxy remains zero and does not require successor analysis", () => {
  expect(
    evaluateDeadHandRiskProxy({
      view: {
        levelRank: "2",
        selfHand: [card("a", "3")],
        remainingCardCounts: { east: 1, south: 1, west: 1, north: 1 }
      },
      action: { type: "pass", actor: "east" }
    })
  ).toEqual({
    total: 0,
    lowSinglePenalty: 0,
    controlExhaustionPenalty: 0,
    structureBreakPenalty: 0,
    wildcardConsumptionPenalty: 0,
    publicThreatPenalty: 0
  });
});
