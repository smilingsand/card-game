import { expect, test } from "vitest";
import { recognizePatterns } from "./patterns";
import type { Card, Rank, Suit } from "../../platform/types";

const cards = (...faces: readonly [Rank, Suit][]): Card[] =>
  faces.map(([rank, suit], index) => ({ id: `c-${index}`, deckIndex: 0, rank, suit }));
test("识别冻结的全部牌型并拒绝非法组合", () => {
  const samples: readonly [string, Card[]][] = [
    ["single", cards(["7", "spades"])],
    ["pair", cards(["7", "spades"], ["7", "clubs"])],
    ["triple", cards(["7", "spades"], ["7", "clubs"], ["7", "diamonds"])],
    [
      "three-with-pair",
      cards(["7", "spades"], ["7", "clubs"], ["7", "diamonds"], ["3", "spades"], ["3", "clubs"])
    ],
    [
      "three-consecutive-pairs",
      cards(
        ["3", "spades"],
        ["3", "clubs"],
        ["4", "spades"],
        ["4", "clubs"],
        ["5", "spades"],
        ["5", "clubs"]
      )
    ],
    [
      "steel-plate",
      cards(
        ["3", "spades"],
        ["3", "clubs"],
        ["3", "diamonds"],
        ["4", "spades"],
        ["4", "clubs"],
        ["4", "diamonds"]
      )
    ],
    [
      "straight",
      cards(["A", "spades"], ["2", "clubs"], ["3", "diamonds"], ["4", "spades"], ["5", "clubs"])
    ],
    [
      "straight-flush",
      cards(["3", "spades"], ["4", "spades"], ["5", "spades"], ["6", "spades"], ["7", "spades"])
    ],
    ["normal-bomb", cards(["7", "spades"], ["7", "clubs"], ["7", "diamonds"], ["7", "hearts"])],
    [
      "four-jokers",
      cards(
        ["small-joker", "joker"],
        ["small-joker", "joker"],
        ["big-joker", "joker"],
        ["big-joker", "joker"]
      )
    ]
  ];
  for (const [type, hand] of samples)
    expect(recognizePatterns(hand, "2")).toMatchObject({
      ok: true,
      interpretations: [expect.objectContaining({ type })]
    });
  expect(recognizePatterns(cards(["3", "spades"], ["4", "clubs"]), "2")).toEqual({
    ok: false,
    code: "no_legal_pattern"
  });
});
test("逢人配枚举解释且不改动实体牌", () => {
  const hand = cards(["7", "spades"], ["7", "clubs"], ["2", "hearts"]);
  const before = structuredClone(hand);
  const result = recognizePatterns(hand, "2");
  expect(result).toMatchObject({ ok: true });
  expect(result.ok && result.interpretations.some((item) => item.type === "triple")).toBe(true);
  expect(hand).toEqual(before);
});

test("三带二的比较键只取三张牌点，不受附属对子影响", () => {
  const result = recognizePatterns(
    cards(["7", "spades"], ["7", "clubs"], ["7", "diamonds"], ["A", "spades"], ["A", "clubs"]),
    "2"
  );

  expect(result).toMatchObject({
    ok: true,
    interpretations: [expect.objectContaining({ type: "three-with-pair", comparisonKey: [7] })]
  });
});
