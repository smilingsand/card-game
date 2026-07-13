import { describe, expect, it } from "vitest";
import type { Card } from "../../platform/types";
import {
  moveHumanDisplayCard,
  reconcileHumanDisplayOrder,
  sortHumanDisplayCards
} from "./display-order";

function cards(...items: readonly Card[]): ReadonlyMap<string, Card> {
  return new Map(items.map((card) => [card.id, card]));
}

describe("human display order", () => {
  it("按点数分组，级牌后置且大小王最后，保持同牌面实体牌相邻", () => {
    const byId = cards(
      { id: "a", deckIndex: 1, suit: "spades", rank: "A" },
      { id: "two-2", deckIndex: 2, suit: "hearts", rank: "2" },
      { id: "two-1", deckIndex: 1, suit: "clubs", rank: "2" },
      { id: "three", deckIndex: 1, suit: "diamonds", rank: "3" },
      { id: "small", deckIndex: 1, suit: "joker", rank: "small-joker" },
      { id: "big", deckIndex: 1, suit: "joker", rank: "big-joker" }
    );

    expect(sortHumanDisplayCards([...byId.keys()], byId, "2")).toEqual([
      "three",
      "a",
      "two-1",
      "two-2",
      "small",
      "big"
    ]);
  });

  it("保留手动顺序，移除已出牌，并按默认顺序追加新增牌", () => {
    const byId = cards(
      { id: "three", deckIndex: 1, suit: "clubs", rank: "3" },
      { id: "four", deckIndex: 1, suit: "clubs", rank: "4" },
      { id: "five", deckIndex: 1, suit: "clubs", rank: "5" }
    );

    expect(
      reconcileHumanDisplayOrder(["four", "missing", "four"], ["three", "four", "five"], byId, "2")
    ).toEqual(["four", "three", "five"]);
  });

  it("移动仅重排 ID，不改实体牌身份", () => {
    expect(moveHumanDisplayCard(["one", "two", "three"], "three", "one")).toEqual([
      "three",
      "one",
      "two"
    ]);
  });
});
