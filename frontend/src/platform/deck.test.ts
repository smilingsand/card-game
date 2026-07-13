import { describe, expect, test } from "vitest";
import { dealFourPlayers, generateDeck, shuffleDeck, validateDealConservation } from "./deck";

const twoDecksWithJokers = { deckCount: 2, includeJokers: true } as const;

function cardIds(cards: readonly { readonly id: string }[]) {
  return cards.map((card) => card.id);
}

describe("牌组生成、洗牌与发牌", () => {
  test("固定 seed 会产生可重放的两副牌洗牌和四人发牌结果", () => {
    const deck = generateDeck(twoDecksWithJokers);
    const firstDeal = dealFourPlayers(shuffleDeck(deck, 1_234_567_890));
    const replayedDeal = dealFourPlayers(shuffleDeck(deck, 1_234_567_890));

    expect(firstDeal).toEqual(replayedDeal);
    expect(cardIds(firstDeal.east).slice(0, 3)).toEqual([
      "deck-1-hearts-4",
      "deck-2-clubs-3",
      "deck-1-joker-big-joker"
    ]);
  });

  test("两副完整牌洗牌后无重复或丢失，四家各有 27 张", () => {
    const deck = generateDeck(twoDecksWithJokers);
    const deal = dealFourPlayers(shuffleDeck(deck, 7));
    const dealtCards = Object.values(deal).flat();

    expect(deck).toHaveLength(108);
    expect(new Set(cardIds(deck))).toHaveLength(108);
    expect(deal.east).toHaveLength(27);
    expect(deal.south).toHaveLength(27);
    expect(deal.west).toHaveLength(27);
    expect(deal.north).toHaveLength(27);
    expect(cardIds(dealtCards).sort()).toEqual(cardIds(deck).sort());
    expect(validateDealConservation(deck, deal)).toBe(true);
  });

  test("10,000 个伪随机 seed 的发牌都保持守恒", () => {
    const deck = generateDeck(twoDecksWithJokers);
    let seed = 0x6d2b79f5;

    for (let index = 0; index < 10_000; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const deal = dealFourPlayers(shuffleDeck(deck, seed));

      expect(validateDealConservation(deck, deal)).toBe(true);
      expect(deal.east).toHaveLength(27);
      expect(deal.south).toHaveLength(27);
      expect(deal.west).toHaveLength(27);
      expect(deal.north).toHaveLength(27);
    }
  });

  test("无效 seed、无法四等分的牌组和重复牌都会被拒绝", () => {
    const deck = generateDeck(twoDecksWithJokers);

    expect(() => shuffleDeck(deck, -1)).toThrow(RangeError);
    expect(() => dealFourPlayers(deck.slice(0, -1))).toThrow(RangeError);
    expect(
      validateDealConservation(deck, {
        east: deck.slice(0, 27),
        south: deck.slice(27, 54),
        west: deck.slice(54, 81),
        north: [...deck.slice(81, 107), deck[0]]
      })
    ).toBe(false);
  });
});
