// Shared Guandan core test.
import { expect, test } from "vitest";
import { chooseNormalBotAction } from "./normal-bot";
import type { TurnAction } from "./turns";

const play = (id: string, key: number, type = "single") => ({
  type: "play" as const,
  actor: "east" as const,
  cardIds: [id],
  interpretation: {
    type: type as "single",
    comparisonKey: [key],
    cardIds: [id],
    wildcardAs: {},
  },
});
const view = (actions: TurnAction[], extra = {}) => ({
  selfSeat: "east" as const,
  leader: "east" as const,
  levelRank: "2" as const,
  selfHand: [
    { id: "low", deckIndex: 0, suit: "spades" as const, rank: "3" as const },
    { id: "bomb", deckIndex: 1, suit: "spades" as const, rank: "K" as const },
  ],
  publicEvents: [],
  remainingCardCounts: { east: 8, south: 8, west: 3, north: 8 },
  legalActions: actions,
  ...extra,
});
test("对家压住时让牌且给出解释", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const result = chooseNormalBotAction(
    view([pass, play("low", 4)], { highestSeat: "west" as const }),
  );
  expect(result?.action).toBe(pass);
  expect(result?.reasons).toContain("让对家保持牌权");
});
test("对手接近出完时拦截，普通局面保留炸弹", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const result = chooseNormalBotAction(
    view([pass, play("low", 4), play("bomb", 16, "normal-bomb")], {
      highestSeat: "south" as const,
      remainingCardCounts: { east: 8, south: 1, west: 3, north: 8 },
    }),
  );
  expect(result?.action).not.toBe(pass);
  expect(result?.reasons).toContain("拦截对手残局");
});
test("对手领出且有普通压制时不能无意义过牌", () => {
  const pass = { type: "pass" as const, actor: "east" as const };
  const result = chooseNormalBotAction(
    view([pass, play("low", 4)], { highestSeat: "south" as const }),
  );
  expect(result?.action).not.toBe(pass);
});
