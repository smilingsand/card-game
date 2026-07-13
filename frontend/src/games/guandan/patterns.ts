import type { Card, Rank, Suit } from "../../platform/types";

export type PatternType =
  | "single"
  | "pair"
  | "triple"
  | "three-with-pair"
  | "three-consecutive-pairs"
  | "steel-plate"
  | "straight"
  | "normal-bomb"
  | "straight-flush"
  | "four-jokers";
export type PatternErrorCode = "empty_cards" | "duplicate_card_id" | "no_legal_pattern";
export interface PatternInterpretation {
  readonly type: PatternType;
  readonly cardIds: readonly string[];
  readonly wildcardAs: Readonly<Record<string, { readonly rank: Rank; readonly suit: Suit }>>;
}
export type PatternRecognition =
  | { readonly ok: true; readonly interpretations: readonly PatternInterpretation[] }
  | { readonly ok: false; readonly code: PatternErrorCode };

const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RUN = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

function consecutive(ranks: readonly Rank[], length: number): boolean {
  const unique = new Set(ranks);
  if (unique.size !== length) return false;
  return Array.from({ length: RUN.length - length + 1 }, (_, index) =>
    RUN.slice(index, index + length)
  ).some((window) => window.every((rank) => unique.has(rank)));
}
function classify(cards: readonly { rank: Rank; suit: Suit }[]): PatternType | undefined {
  const ranks = cards.map((card) => card.rank);
  const counts = [
    ...new Map(ranks.map((rank) => [rank, ranks.filter((item) => item === rank).length])).values()
  ].sort();
  const sameSuit = new Set(cards.map((card) => card.suit)).size === 1;
  if (
    cards.length === 4 &&
    cards.every((card) => card.rank === "small-joker" || card.rank === "big-joker")
  )
    return "four-jokers";
  if (cards.length === 1) return "single";
  if (cards.length === 2 && counts.join() === "2") return "pair";
  if (cards.length === 3 && counts.join() === "3") return "triple";
  if (cards.length === 5 && counts.join() === "2,3") return "three-with-pair";
  if (cards.length === 6 && counts.join() === "2,2,2" && consecutive(ranks, 3))
    return "three-consecutive-pairs";
  if (cards.length === 6 && counts.join() === "3,3" && consecutive(ranks, 2)) return "steel-plate";
  if (cards.length === 5 && consecutive(ranks, 5)) return sameSuit ? "straight-flush" : "straight";
  if (cards.length >= 4 && cards.length <= 10 && counts.length === 1) return "normal-bomb";
  return undefined;
}
/** 返回全部逢人配投影；输入 Card 永不被修改。 */
export function recognizePatterns(
  cards: readonly Card[],
  levelRank: Exclude<Rank, "small-joker" | "big-joker">
): PatternRecognition {
  if (cards.length === 0) return { ok: false, code: "empty_cards" };
  if (new Set(cards.map((card) => card.id)).size !== cards.length)
    return { ok: false, code: "duplicate_card_id" };
  const wildcards = cards.filter((card) => card.suit === "hearts" && card.rank === levelRank);
  const fixed = cards.filter((card) => !wildcards.includes(card));
  const targets = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
  const results: PatternInterpretation[] = [];
  const visit = (index: number, assigned: { rank: Rank; suit: Suit }[]): void => {
    if (index < wildcards.length) {
      for (const target of targets) visit(index + 1, [...assigned, target]);
      return;
    }
    const projected = [...fixed, ...wildcards.map((card, i) => ({ ...card, ...assigned[i] }))];
    const type = classify(projected);
    if (!type) return;
    const wildcardAs = Object.fromEntries(wildcards.map((card, i) => [card.id, assigned[i]]));
    const key = `${type}:${JSON.stringify(wildcardAs)}`;
    if (!results.some((item) => `${item.type}:${JSON.stringify(item.wildcardAs)}` === key))
      results.push({ type, cardIds: cards.map((card) => card.id), wildcardAs });
  };
  visit(0, []);
  return results.length
    ? { ok: true, interpretations: results }
    : { ok: false, code: "no_legal_pattern" };
}
