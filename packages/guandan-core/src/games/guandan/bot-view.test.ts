// Shared Guandan core test.
import { expect, expectTypeOf, test } from "vitest";
import { createBotView, type BotView } from "./bot-view";
import { getLegalActions } from "./legal-actions";
import type { Card } from "../../platform/types";
const card: Card = { id: "e", deckIndex: 0, suit: "spades", rank: "2" };
test("BotView仅投影自身手牌和公开信息", () => {
  const view = createBotView({
    selfSeat: "east",
    leader: "south",
    highestSeat: "west",
    levelRank: "7",
    hand: [card],
    publicEvents: [],
    remainingCardCounts: { east: 1, south: 1, west: 1, north: 1 },
    legalActions: [],
  });
  expect(view).toEqual({
    selfSeat: "east",
    leader: "south",
    highestSeat: "west",
    levelRank: "7",
    selfHand: [card],
    publicEvents: [],
    remainingCardCounts: { east: 1, south: 1, west: 1, north: 1 },
    legalActions: [],
  });
  expect("seed" in view).toBe(false);
  expect("opponentHands" in view).toBe(false);
});
test("类型不暴露对手手牌或seed", () => {
  expectTypeOf<BotView>().not.toHaveProperty("seed");
  expectTypeOf<BotView>().not.toHaveProperty("opponentHands");
});
test("规则边界过滤非法候选后才交给BotView", () => {
  const state = {
    hands: { east: ["e"], south: [], west: [], north: [] },
    current: "east" as const,
    leader: "east" as const,
    passes: 0,
    finished: [] as const,
  };
  const legal = getLegalActions(state, [
    {
      type: "play",
      actor: "east",
      cardIds: ["e"],
      interpretation: {
        type: "single",
        comparisonKey: [2],
        cardIds: ["e"],
        wildcardAs: {},
      },
    },
    {
      type: "play",
      actor: "east",
      cardIds: ["missing"],
      interpretation: {
        type: "single",
        comparisonKey: [2],
        cardIds: ["missing"],
        wildcardAs: {},
      },
    },
  ]);
  expect(legal).toHaveLength(1);
  expect(
    createBotView({
      selfSeat: "east",
      leader: "east",
      levelRank: "2",
      hand: [card],
      publicEvents: [],
      remainingCardCounts: { east: 1, south: 0, west: 0, north: 0 },
      legalActions: legal,
    }).legalActions,
  ).toEqual(legal);
});
