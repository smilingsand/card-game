// Shared Guandan core test.
import { expect, test } from "vitest";
import { chooseBasicBotAction } from "./basic-bot";
import type { TurnAction } from "./turns";
const view = (actions: TurnAction[], hand = 3) => ({
  selfSeat: "east" as const,
  leader: "east" as const,
  levelRank: "2" as const,
  selfHand: Array.from({ length: hand }, (_, i) => ({
    id: `c${i}`,
    deckIndex: 0,
    suit: "spades" as const,
    rank: "2" as const,
  })),
  publicEvents: [],
  remainingCardCounts: { east: hand, south: 3, west: 3, north: 3 },
  legalActions: actions,
});
const play = (id: string, key: number) => ({
  type: "play" as const,
  actor: "east" as const,
  cardIds: [id],
  interpretation: {
    type: "single" as const,
    comparisonKey: [key],
    cardIds: [id],
    wildcardAs: {},
  },
});
test("选择最小代价的合法压制且确定", () => {
  const actions = [play("b", 8), play("a", 7)];
  expect(chooseBasicBotAction(view(actions))).toBe(actions[1]);
  expect(chooseBasicBotAction(view(actions))).toBe(actions[1]);
});
test("对手压住且存在合法压制时必须接牌，尾盘也优先出牌", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const action = play("a", 7);
  const opponentLead = {
    ...view([pass, action], 3),
    highestSeat: "south" as const,
  };
  expect(chooseBasicBotAction(opponentLead)).toBe(action);
  expect(chooseBasicBotAction(view([pass, action], 1))).toBe(action);
});
test("对手压住但没有合法压制时可以过牌", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const input = { ...view([pass]), highestSeat: "south" as const };
  expect(chooseBasicBotAction(input)).toBe(pass);
});
test("对家当前领出且过牌合法时不压队友", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const input = { ...view([pass, play("a", 7)]), highestSeat: "west" as const };
  expect(chooseBasicBotAction(input)).toBe(pass);
});
test("同等压制时优先不拆对子", () => {
  const paired = {
    ...view([play("c0", 7), play("x", 7)]),
    selfHand: [
      { id: "c0", deckIndex: 0, suit: "spades" as const, rank: "7" as const },
      { id: "c1", deckIndex: 0, suit: "clubs" as const, rank: "7" as const },
      { id: "x", deckIndex: 0, suit: "hearts" as const, rank: "8" as const },
    ],
  };
  expect(chooseBasicBotAction(paired)).toBe(paired.legalActions[1]);
});
test("同等压制时优先不拆三张", () => {
  const triplet = {
    ...view([play("c0", 7), play("x", 7)]),
    selfHand: [
      { id: "c0", deckIndex: 0, suit: "spades" as const, rank: "7" as const },
      { id: "c1", deckIndex: 0, suit: "clubs" as const, rank: "7" as const },
      { id: "c2", deckIndex: 0, suit: "diamonds" as const, rank: "7" as const },
      { id: "x", deckIndex: 0, suit: "hearts" as const, rank: "8" as const },
    ],
  };
  expect(chooseBasicBotAction(triplet)).toBe(triplet.legalActions[1]);
});
test("级牌单张可压制时保持级牌点数，不低配成较小牌", () => {
  const lowerWildcard = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["h2"],
    interpretation: {
      type: "single" as const,
      comparisonKey: [10],
      cardIds: ["h2"],
      wildcardAs: { h2: { rank: "10" as const, suit: "spades" as const } },
    },
  };
  const naturalLevel = {
    ...lowerWildcard,
    interpretation: {
      ...lowerWildcard.interpretation,
      comparisonKey: [15],
      wildcardAs: { h2: { rank: "2" as const, suit: "hearts" as const } },
    },
  };
  const input = {
    ...view([lowerWildcard, naturalLevel], 3),
    highestSeat: "south" as const,
    selfHand: [
      { id: "h2", deckIndex: 0, suit: "hearts" as const, rank: "2" as const },
      {
        id: "other-3",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "3" as const,
      },
      {
        id: "other-4",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "4" as const,
      },
    ],
  };

  expect(chooseBasicBotAction(input)).toBe(naturalLevel);
});
test("低位单张没有回收牌时，优先保留它并走无需回收的顺子", () => {
  const lowSingle = play("low-3", 3);
  const straight = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["s-5", "s-6", "s-7", "s-8", "s-9"],
    interpretation: {
      type: "straight" as const,
      comparisonKey: [9],
      cardIds: ["s-5", "s-6", "s-7", "s-8", "s-9"],
      wildcardAs: {},
    },
  };
  const input = {
    ...view([lowSingle, straight], 6),
    selfHand: [
      {
        id: "low-3",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "3" as const,
      },
      { id: "s-4", deckIndex: 0, suit: "spades" as const, rank: "4" as const },
      { id: "s-5", deckIndex: 0, suit: "spades" as const, rank: "5" as const },
      { id: "s-6", deckIndex: 0, suit: "spades" as const, rank: "6" as const },
      { id: "s-7", deckIndex: 0, suit: "spades" as const, rank: "7" as const },
      { id: "s-8", deckIndex: 0, suit: "spades" as const, rank: "8" as const },
    ],
  };

  expect(chooseBasicBotAction(input)).toBe(straight);
});
test("低位三带二有同型回收牌时，可以优先领出", () => {
  const threeWithPair = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["triple-3a", "triple-3b", "triple-3c", "pair-4a", "pair-4b"],
    interpretation: {
      type: "three-with-pair" as const,
      comparisonKey: [3],
      cardIds: ["triple-3a", "triple-3b", "triple-3c", "pair-4a", "pair-4b"],
      wildcardAs: {},
    },
  };
  const straight = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["s-5", "s-6", "s-7", "s-8", "s-9"],
    interpretation: {
      type: "straight" as const,
      comparisonKey: [9],
      cardIds: ["s-5", "s-6", "s-7", "s-8", "s-9"],
      wildcardAs: {},
    },
  };
  const input = {
    ...view([threeWithPair, straight], 11),
    selfHand: [
      {
        id: "triple-3a",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "3" as const,
      },
      {
        id: "triple-3b",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "3" as const,
      },
      {
        id: "triple-3c",
        deckIndex: 0,
        suit: "clubs" as const,
        rank: "3" as const,
      },
      {
        id: "pair-4a",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "4" as const,
      },
      {
        id: "pair-4b",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "4" as const,
      },
      { id: "s-5", deckIndex: 0, suit: "spades" as const, rank: "5" as const },
      { id: "s-6", deckIndex: 0, suit: "spades" as const, rank: "6" as const },
      { id: "s-7", deckIndex: 0, suit: "spades" as const, rank: "7" as const },
      { id: "s-8", deckIndex: 0, suit: "spades" as const, rank: "8" as const },
      { id: "s-9", deckIndex: 0, suit: "spades" as const, rank: "9" as const },
      {
        id: "triple-ja",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "J" as const,
      },
      {
        id: "triple-jb",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "J" as const,
      },
      {
        id: "triple-jc",
        deckIndex: 0,
        suit: "clubs" as const,
        rank: "J" as const,
      },
      {
        id: "pair-ka",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "K" as const,
      },
      {
        id: "pair-kb",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "K" as const,
      },
    ],
  };

  expect(chooseBasicBotAction(input)).toBe(threeWithPair);
});
test("炸弹不作为低位对子回收牌", () => {
  const lowPair = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["pair-3a", "pair-3b"],
    interpretation: {
      type: "pair" as const,
      comparisonKey: [3],
      cardIds: ["pair-3a", "pair-3b"],
      wildcardAs: {},
    },
  };
  const straight = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["s-4", "s-5", "s-6", "s-7", "s-8"],
    interpretation: {
      type: "straight" as const,
      comparisonKey: [8],
      cardIds: ["s-4", "s-5", "s-6", "s-7", "s-8"],
      wildcardAs: {},
    },
  };
  const input = {
    ...view([lowPair, straight], 11),
    selfHand: [
      {
        id: "pair-3a",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "3" as const,
      },
      {
        id: "pair-3b",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "3" as const,
      },
      { id: "s-4", deckIndex: 0, suit: "spades" as const, rank: "4" as const },
      { id: "s-5", deckIndex: 0, suit: "spades" as const, rank: "5" as const },
      { id: "s-6", deckIndex: 0, suit: "spades" as const, rank: "6" as const },
      { id: "s-7", deckIndex: 0, suit: "spades" as const, rank: "7" as const },
      { id: "s-8", deckIndex: 0, suit: "spades" as const, rank: "8" as const },
      {
        id: "bomb-ka",
        deckIndex: 0,
        suit: "spades" as const,
        rank: "K" as const,
      },
      {
        id: "bomb-kb",
        deckIndex: 0,
        suit: "hearts" as const,
        rank: "K" as const,
      },
      {
        id: "bomb-kc",
        deckIndex: 0,
        suit: "clubs" as const,
        rank: "K" as const,
      },
      {
        id: "bomb-kd",
        deckIndex: 0,
        suit: "diamonds" as const,
        rank: "K" as const,
      },
    ],
  };

  expect(chooseBasicBotAction(input)).toBe(straight);
});
test("尾盘公开剩余牌临界时选择拦截动作", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const input = {
    ...view([pass, play("a", 7)]),
    remainingCardCounts: { east: 3, south: 1, west: 3, north: 3 },
  };
  expect(chooseBasicBotAction(input)).toBe(input.legalActions[1]);
});
test("输出来自合法动作集且在10ms预算内", () => {
  const actions = [play("a", 7)];
  const input = view(actions);
  const start = performance.now();
  const selected = chooseBasicBotAction(input);
  expect(input.legalActions).toContain(selected);
  expect(performance.now() - start).toBeLessThan(10);
});
