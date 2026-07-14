import { expect, test } from "vitest";
import type { Card, Seat } from "../../platform/types";
import { createTributePlan, levelForLeader, levelsAfterRound, type MatchLevels } from "./match";

function card(id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card {
  return { id, rank, suit, deckIndex: 0 };
}

function hands(overrides: Partial<Record<Seat, readonly Card[]>> = {}) {
  return {
    east: [],
    south: [],
    west: [],
    north: [],
    ...overrides
  } as const;
}

test("头游方按双上、头三、头末分别升 3、2、1 级，另一方等级不变", () => {
  const levels: MatchLevels = { northSouth: "5", eastWest: "8" };

  expect(levelsAfterRound(levels, ["south", "north", "east", "west"])).toEqual({
    northSouth: "8",
    eastWest: "8"
  });
  expect(levelsAfterRound(levels, ["south", "east", "north", "west"])).toEqual({
    northSouth: "7",
    eastWest: "8"
  });
  expect(levelsAfterRound(levels, ["south", "east", "west", "north"])).toEqual({
    northSouth: "6",
    eastWest: "8"
  });
});

test("级牌取本局先出方所属队伍的等级", () => {
  const levels: MatchLevels = { northSouth: "6", eastWest: "Q" };

  expect(levelForLeader(levels, "south")).toBe("6");
  expect(levelForLeader(levels, "east")).toBe("Q");
});

test("单下时末游向头游交出除红桃级牌外最大的牌", () => {
  const plan = createTributePlan(
    "2",
    ["south", "east", "north", "west"],
    hands({
      west: [
        card("west-level-heart", "2", "hearts"),
        card("west-small", "small-joker"),
        card("west-a", "A")
      ]
    })
  );

  expect(plan).toMatchObject({
    kind: "single",
    antiTribute: false,
    obligations: [{ from: "west", to: "south", cardId: "west-small" }]
  });
});

test("双下时头游收较大的贡牌，搭档收较小的贡牌", () => {
  const plan = createTributePlan(
    "2",
    ["south", "north", "east", "west"],
    hands({
      east: [card("east-k", "K")],
      west: [card("west-a", "A")]
    })
  );

  expect(plan).toMatchObject({
    kind: "double",
    antiTribute: false,
    obligations: [
      { from: "west", to: "south", cardId: "west-a" },
      { from: "east", to: "north", cardId: "east-k" }
    ]
  });
});

test("单下持两张大王抗贡；双下各有一张或一方两张大王时全体抗贡", () => {
  const single = createTributePlan(
    "2",
    ["south", "east", "north", "west"],
    hands({ west: [card("bj-1", "big-joker", "joker"), card("bj-2", "big-joker", "joker")] })
  );
  const doubleOneEach = createTributePlan(
    "2",
    ["south", "north", "east", "west"],
    hands({
      east: [card("east-bj", "big-joker", "joker")],
      west: [card("west-bj", "big-joker", "joker")]
    })
  );
  const doubleTwo = createTributePlan(
    "2",
    ["south", "north", "east", "west"],
    hands({
      east: [card("east-bj-1", "big-joker", "joker"), card("east-bj-2", "big-joker", "joker")],
      west: [card("west-a", "A")]
    })
  );

  for (const plan of [single, doubleOneEach, doubleTwo]) {
    expect(plan).toMatchObject({ kind: "none", antiTribute: true });
    expect(plan.proof).toHaveLength(2);
  }
});
