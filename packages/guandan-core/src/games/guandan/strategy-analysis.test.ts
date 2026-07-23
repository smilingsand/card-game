// Shared Guandan core test.
import { expect, test } from "vitest";
import { analyzeStrategy } from "./strategy-analysis";
import type { BotView } from "./bot-view";

const view = (overrides: Partial<BotView> = {}): BotView => ({
  selfSeat: "east",
  leader: "east",
  levelRank: "2",
  selfHand: [
    { id: "3a", deckIndex: 0, suit: "spades", rank: "3" },
    { id: "3b", deckIndex: 1, suit: "clubs", rank: "3" },
    { id: "A", deckIndex: 2, suit: "hearts", rank: "A" },
  ],
  publicEvents: [
    {
      sequence: 0,
      type: "action.applied",
      actorId: "south",
      payload: {
        action: {
          type: "play",
          actor: "south",
          cardIds: ["hidden"],
          interpretation: { comparisonKey: [15] },
        },
      },
    },
  ],
  remainingCardCounts: { east: 3, south: 8, west: 9, north: 7 },
  legalActions: [],
  ...overrides,
});

test("分离己方确定手牌结构与只来自公开动作的高位统计", () => {
  const analysis = analyzeStrategy(view());
  expect(analysis.facts.rankGroups).toEqual([
    { rank: "3", count: 2 },
    { rank: "A", count: 1 },
  ]);
  expect(analysis.facts.publicHighCards.south).toBe(1);
  expect("opponentHands" in analysis).toBe(false);
  expect(analysis.role).toMatchObject({
    kind: "attack",
    reason: "己方剩余手数少于对家",
  });
});

test("手数相同的角色推断保持低置信度", () => {
  const analysis = analyzeStrategy(
    view({ remainingCardCounts: { east: 5, south: 8, west: 5, north: 7 } }),
  );
  expect(analysis.role).toEqual({
    kind: "support",
    confidence: 0.25,
    reason: "己方与对家剩余手数相同",
  });
});
