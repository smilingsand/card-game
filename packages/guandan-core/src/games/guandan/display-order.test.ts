// Shared Guandan core test.
import { describe, expect, it } from "vitest";
import type { Card } from "../../platform/types";
import {
  groupHumanDisplayCards,
  groupOrderedDisplayCards,
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  sortHumanDisplayCards,
  sortPlayedCards,
} from "./display-order";

function cards(...items: readonly Card[]): ReadonlyMap<string, Card> {
  return new Map(items.map((card) => [card.id, card]));
}

describe("human display order", () => {
  it("按点数由大到小分组，级牌位于小王右侧，保持同牌面实体牌相邻", () => {
    const byId = cards(
      { id: "a", deckIndex: 1, suit: "spades", rank: "A" },
      { id: "two-2", deckIndex: 2, suit: "hearts", rank: "2" },
      { id: "two-1", deckIndex: 1, suit: "clubs", rank: "2" },
      { id: "three", deckIndex: 1, suit: "diamonds", rank: "3" },
      { id: "small", deckIndex: 1, suit: "joker", rank: "small-joker" },
      { id: "big", deckIndex: 1, suit: "joker", rank: "big-joker" },
    );

    expect(sortHumanDisplayCards([...byId.keys()], byId, "2")).toEqual([
      "big",
      "small",
      "two-1",
      "two-2",
      "a",
      "three",
    ]);
  });

  it("动态级牌为 6 时以 6 为级牌，2 回归为最小普通牌", () => {
    const byId = cards(
      { id: "six", deckIndex: 1, suit: "spades", rank: "6" },
      { id: "ace", deckIndex: 1, suit: "hearts", rank: "A" },
      { id: "two", deckIndex: 1, suit: "clubs", rank: "2" },
    );

    expect(sortHumanDisplayCards([...byId.keys()], byId, "6")).toEqual([
      "six",
      "ace",
      "two",
    ]);
  });

  it("方式 A 将炸弹置于最右侧，剩余牌只按点数分组", () => {
    const byId = cards(
      { id: "king", deckIndex: 1, suit: "spades", rank: "K" },
      { id: "four-a", deckIndex: 1, suit: "spades", rank: "4" },
      { id: "four-b", deckIndex: 1, suit: "hearts", rank: "4" },
      { id: "four-c", deckIndex: 1, suit: "diamonds", rank: "4" },
      { id: "four-d", deckIndex: 2, suit: "clubs", rank: "4" },
    );
    expect(
      groupHumanDisplayCards([...byId.keys()], byId, "2").map(
        (group) => group.key,
      ),
    ).toEqual(["K", "4"]);
  });

  it("公开三带二会先排三张，且红桃级配按代表点数归位", () => {
    const byId = cards(
      { id: "two-a", deckIndex: 1, suit: "spades", rank: "2" },
      { id: "two-b", deckIndex: 1, suit: "clubs", rank: "2" },
      { id: "wild", deckIndex: 1, suit: "hearts", rank: "2" },
      { id: "nine-a", deckIndex: 1, suit: "spades", rank: "9" },
      { id: "nine-b", deckIndex: 1, suit: "clubs", rank: "9" },
    );
    expect(
      sortPlayedCards([...byId.keys()], byId, "2", {
        type: "three-with-pair",
        cardIds: [...byId.keys()],
        wildcardAs: { wild: { rank: "2", suit: "diamonds" } },
        comparisonKey: [15],
      }),
    ).toEqual(["two-b", "wild", "two-a", "nine-b", "nine-a"]);
  });

  it("保留手动顺序，移除已出牌，并按默认顺序追加新增牌", () => {
    const byId = cards(
      { id: "three", deckIndex: 1, suit: "clubs", rank: "3" },
      { id: "four", deckIndex: 1, suit: "clubs", rank: "4" },
      { id: "five", deckIndex: 1, suit: "clubs", rank: "5" },
    );

    expect(
      reconcileHumanDisplayOrder(
        ["four", "missing", "four"],
        ["three", "four", "five"],
        byId,
        "2",
      ),
    ).toEqual(["four", "five", "three"]);
  });

  it("移动仅重排 ID，不改实体牌身份", () => {
    expect(
      moveHumanDisplayCard(["one", "two", "three"], "three", "one"),
    ).toEqual(["three", "one", "two"]);
  });

  it("手动顺序只将相邻同点数牌纵向分组，不会回退到每张牌一列", () => {
    const byId = cards(
      { id: "nine-a", deckIndex: 1, suit: "spades", rank: "9" },
      { id: "nine-b", deckIndex: 1, suit: "hearts", rank: "9" },
      { id: "eight", deckIndex: 1, suit: "clubs", rank: "8" },
      { id: "nine-c", deckIndex: 2, suit: "diamonds", rank: "9" },
    );
    expect(
      groupOrderedDisplayCards(
        ["nine-a", "nine-b", "eight", "nine-c"],
        byId,
      ).map((group) => group.cardIds),
    ).toEqual([["nine-a", "nine-b"], ["eight"], ["nine-c"]]);
  });
});
