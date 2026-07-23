// Shared Guandan core source.
import type { Card, Rank, Seat, Suit } from "./types";
import { createSecureSeedRandom, type SecureSeed } from "./secure-seed";

export interface DeckConfig {
  readonly deckCount: number;
  readonly includeJokers: boolean;
}

export interface FourPlayerDeal {
  readonly east: readonly Card[];
  readonly south: readonly Card[];
  readonly west: readonly Card[];
  readonly north: readonly Card[];
}

const MAX_UINT32 = 0xffff_ffff;
const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const STANDARD_SUITS: readonly Exclude<Suit, "joker">[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
];
const STANDARD_RANKS: readonly Exclude<Rank, "small-joker" | "big-joker">[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];
const JOKER_RANKS: readonly Extract<Rank, "small-joker" | "big-joker">[] = [
  "small-joker",
  "big-joker",
];

function assertDeckCount(deckCount: number): void {
  if (!Number.isSafeInteger(deckCount) || deckCount < 1) {
    throw new RangeError("deckCount must be a positive safe integer");
  }
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new RangeError("seed must be an unsigned 32-bit integer");
  }
}

function assertUniqueCardIds(cards: readonly Card[]): void {
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new RangeError("cards must have unique physical IDs");
  }
}

/** 生成指定副数的标准扑克；ID 表示实体牌而非牌面。 */
export function generateDeck(config: DeckConfig): readonly Card[] {
  assertDeckCount(config.deckCount);

  const cards: Card[] = [];
  for (let deckIndex = 0; deckIndex < config.deckCount; deckIndex += 1) {
    const deckNumber = deckIndex + 1;
    for (const suit of STANDARD_SUITS) {
      for (const rank of STANDARD_RANKS) {
        cards.push({
          id: `deck-${deckNumber}-${suit}-${rank}`,
          deckIndex,
          suit,
          rank,
        });
      }
    }
    if (config.includeJokers) {
      for (const rank of JOKER_RANKS) {
        cards.push({
          id: `deck-${deckNumber}-joker-${rank}`,
          deckIndex,
          suit: "joker",
          rank,
        });
      }
    }
  }

  return cards;
}

/** ADR-0002 固化的 Mulberry32 伪随机数发生器。 */
function createMulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / (MAX_UINT32 + 1);
  };
}

/** 返回新数组，按 ADR-0002 使用带 seed 的 Fisher-Yates 洗牌。 */
export function shuffleDeck(
  cards: readonly Card[],
  seed: number | SecureSeed,
): readonly Card[] {
  if (typeof seed === "number") assertSeed(seed);
  assertUniqueCardIds(cards);

  const shuffled = [...cards];
  // Keep the legacy number path byte-for-byte stable for P1/P2 replays.
  const random =
    typeof seed === "number" ? createMulberry32(seed) : createSecureSeedRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

/** 按 east、south、west、north 的轮次循环发牌。 */
export function dealFourPlayers(cards: readonly Card[]): FourPlayerDeal {
  if (cards.length % SEATS.length !== 0) {
    throw new RangeError("cards must be divisible among four players");
  }
  assertUniqueCardIds(cards);

  const hands: Record<Seat, Card[]> = {
    east: [],
    south: [],
    west: [],
    north: [],
  };
  for (const [index, card] of cards.entries()) {
    hands[SEATS[index % SEATS.length]].push(card);
  }

  return hands;
}

/** 检查发出的牌与原始牌组具有相同且唯一的一组实体牌 ID。 */
export function validateDealConservation(
  deck: readonly Card[],
  deal: FourPlayerDeal,
): boolean {
  const dealtCards = SEATS.flatMap((seat) => deal[seat]);
  const deckIds = deck.map((card) => card.id);
  const dealtIds = dealtCards.map((card) => card.id);

  return (
    new Set(deckIds).size === deckIds.length &&
    new Set(dealtIds).size === dealtIds.length &&
    deckIds.length === dealtIds.length &&
    deckIds.every((id) => dealtIds.includes(id))
  );
}
