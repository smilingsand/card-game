// Shared Guandan core test.
import { expect, test } from "vitest";
import type { Card, Seat } from "../../platform/types";
import type { TributePlan } from "./match";
import { applyTributeExchange } from "./tribute";

function card(
  id: string,
  rank: Card["rank"],
  suit: Card["suit"] = "spades",
): Card {
  return { id, rank, suit, deckIndex: 0 };
}

function hands(overrides: Partial<Record<Seat, readonly Card[]>> = {}) {
  return { east: [], south: [], west: [], north: [], ...overrides } as const;
}

test("单下交换实体牌，并记录公开的贡牌和还贡牌", () => {
  const plan: TributePlan = {
    kind: "single",
    antiTribute: false,
    proof: [],
    obligations: [{ from: "west", to: "south", cardId: "west-a" }],
  };
  const result = applyTributeExchange(
    "2",
    plan,
    hands({
      south: [card("south-9", "9")],
      west: [card("west-a", "A"), card("west-3", "3")],
    }),
    [{ from: "south", to: "west", cardId: "south-9" }],
  );

  expect(result.hands.south.map((item) => item.id)).toEqual(["west-a"]);
  expect(result.hands.west.map((item) => item.id)).toEqual([
    "west-3",
    "south-9",
  ]);
  expect(result.records).toEqual([
    {
      from: "west",
      to: "south",
      tributeCardId: "west-a",
      returnedCardId: "south-9",
    },
  ]);
});

test("双下按贡牌归属分别交换两组实体牌", () => {
  const plan: TributePlan = {
    kind: "double",
    antiTribute: false,
    proof: [],
    obligations: [
      { from: "west", to: "south", cardId: "west-a" },
      { from: "east", to: "north", cardId: "east-k" },
    ],
  };
  const result = applyTributeExchange(
    "2",
    plan,
    hands({
      south: [card("south-9", "9")],
      north: [card("north-8", "8")],
      east: [card("east-k", "K")],
      west: [card("west-a", "A")],
    }),
    [
      { from: "south", to: "west", cardId: "south-9" },
      { from: "north", to: "east", cardId: "north-8" },
    ],
  );

  expect(result.hands.south.map((item) => item.id)).toEqual(["west-a"]);
  expect(result.hands.north.map((item) => item.id)).toEqual(["east-k"]);
  expect(result.hands.east.map((item) => item.id)).toEqual(["north-8"]);
  expect(result.hands.west.map((item) => item.id)).toEqual(["south-9"]);
});

test("拒绝红桃级牌贡牌、非最大贡牌，以及大于 10 的还贡牌", () => {
  const invalidTribute: TributePlan = {
    kind: "single",
    antiTribute: false,
    proof: [],
    obligations: [{ from: "west", to: "south", cardId: "west-level-heart" }],
  };
  const validTribute: TributePlan = {
    ...invalidTribute,
    obligations: [{ from: "west", to: "south", cardId: "west-a" }],
  };
  const initial = hands({
    south: [card("south-j", "J")],
    west: [card("west-level-heart", "2", "hearts"), card("west-a", "A")],
  });

  expect(() =>
    applyTributeExchange("2", invalidTribute, initial, [
      { from: "south", to: "west", cardId: "south-j" },
    ]),
  ).toThrow("largest eligible");
  expect(() =>
    applyTributeExchange("2", validTribute, initial, [
      { from: "south", to: "west", cardId: "south-j" },
    ]),
  ).toThrow("must not exceed 10");
});
