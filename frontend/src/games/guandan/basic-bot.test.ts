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
    rank: "2" as const
  })),
  publicEvents: [],
  remainingCardCounts: { east: hand, south: 3, west: 3, north: 3 },
  legalActions: actions
});
const play = (id: string, key: number) => ({
  type: "play" as const,
  actor: "east" as const,
  cardIds: [id],
  interpretation: { type: "single" as const, comparisonKey: [key], cardIds: [id], wildcardAs: {} }
});
test("选择最小代价的合法压制且确定", () => {
  const actions = [play("b", 8), play("a", 7)];
  expect(chooseBasicBotAction(view(actions))).toBe(actions[1]);
  expect(chooseBasicBotAction(view(actions))).toBe(actions[1]);
});
test("对手压住且存在合法压制时必须接牌，尾盘也优先出牌", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const action = play("a", 7);
  const opponentLead = { ...view([pass, action], 3), highestSeat: "south" as const };
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
      { id: "x", deckIndex: 0, suit: "hearts" as const, rank: "8" as const }
    ]
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
      { id: "x", deckIndex: 0, suit: "hearts" as const, rank: "8" as const }
    ]
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
      wildcardAs: { h2: { rank: "10" as const, suit: "spades" as const } }
    }
  };
  const naturalLevel = {
    ...lowerWildcard,
    interpretation: {
      ...lowerWildcard.interpretation,
      comparisonKey: [15],
      wildcardAs: { h2: { rank: "2" as const, suit: "hearts" as const } }
    }
  };
  const input = {
    ...view([lowerWildcard, naturalLevel], 3),
    highestSeat: "south" as const,
    selfHand: [
      { id: "h2", deckIndex: 0, suit: "hearts" as const, rank: "2" as const },
      { id: "other-3", deckIndex: 0, suit: "spades" as const, rank: "3" as const },
      { id: "other-4", deckIndex: 0, suit: "spades" as const, rank: "4" as const }
    ]
  };

  expect(chooseBasicBotAction(input)).toBe(naturalLevel);
});
test("尾盘公开剩余牌临界时选择拦截动作", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const input = {
    ...view([pass, play("a", 7)]),
    remainingCardCounts: { east: 3, south: 1, west: 3, north: 3 }
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
