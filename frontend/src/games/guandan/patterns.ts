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
  readonly comparisonKey: readonly number[];
}
export type PatternRecognition =
  | { readonly ok: true; readonly interpretations: readonly PatternInterpretation[] }
  | { readonly ok: false; readonly code: PatternErrorCode };

const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RUN = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const ALL_RANKS: readonly Rank[] = [...RANKS, "small-joker", "big-joker"];
const RANK_INDEX = new Map(ALL_RANKS.map((rank, index) => [rank, index]));

function consecutiveHighValue(ranks: readonly Rank[], length: number): number | undefined {
  const unique = new Set(ranks);
  const window = Array.from({ length: RUN.length - length + 1 }, (_, index) =>
    RUN.slice(index, index + length)
  ).find((candidate) => candidate.every((rank) => unique.has(rank)));
  const high = window?.at(-1);
  return high === undefined ? undefined : RANKS.indexOf(high) + 2;
}
function consecutiveCounts(
  counts: readonly number[],
  length: number,
  distinctCount: number
): boolean {
  if (distinctCount !== length) return false;
  return Array.from({ length: RUN.length - length + 1 }, (_, index) =>
    RUN.slice(index, index + length)
  ).some((window) => window.every((rank) => (counts[RANK_INDEX.get(rank) ?? -1] ?? 0) > 0));
}
function comparisonKey(
  type: PatternType,
  cards: readonly { rank: Rank }[],
  level: Rank
): readonly number[] {
  const value = (rank: Rank) =>
    rank === "big-joker"
      ? 17
      : rank === "small-joker"
        ? 16
        : rank === level
          ? 15
          : RANKS.indexOf(rank) + 2;
  const values = cards.map((card) => value(card.rank));
  if (type === "four-jokers") return [4];
  if (type === "normal-bomb") return [cards.length, values[0]];
  if (type === "three-with-pair") {
    const tripleRank = cards.find(
      (card) => cards.filter((other) => other.rank === card.rank).length === 3
    )?.rank;
    return tripleRank ? [value(tripleRank)] : [];
  }
  if (
    type === "three-consecutive-pairs" ||
    type === "steel-plate" ||
    type === "straight" ||
    type === "straight-flush"
  ) {
    const high = consecutiveHighValue(
      cards.map((card) => card.rank),
      type === "three-consecutive-pairs" ? 3 : type === "steel-plate" ? 2 : 5
    );
    return high === undefined ? [] : [high];
  }
  return [Math.max(...values)];
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
  // The recursion visits projections in deterministic target order.  This set only replaces the
  // previous linear duplicate scan, preserving the exact interpretations and their order.
  const resultKeys = new Set<string>();
  const fixedCounts = Array.from({ length: ALL_RANKS.length }, () => 0);
  for (const card of fixed) fixedCounts[RANK_INDEX.get(card.rank) as number] += 1;
  const fixedSuit = fixed[0]?.suit;
  const fixedHasMixedSuits = fixed.some((card) => card.suit !== fixedSuit);
  const classifyAssignment = (
    assigned: readonly { rank: Rank; suit: Suit }[]
  ): PatternType | undefined => {
    const counts = [...fixedCounts];
    for (const target of assigned) counts[RANK_INDEX.get(target.rank) as number] += 1;
    const nonZero = counts.filter((count) => count > 0);
    const distinctCount = nonZero.length;
    const length = cards.length;
    const only = nonZero[0];
    const has = (count: number) => nonZero.includes(count);
    if (
      length === 4 &&
      fixed.every((card) => card.rank === "small-joker" || card.rank === "big-joker")
    )
      return "four-jokers";
    if (length === 1) return "single";
    if (length === 2 && distinctCount === 1 && only === 2) return "pair";
    if (length === 3 && distinctCount === 1 && only === 3) return "triple";
    if (length === 5 && distinctCount === 2 && has(2) && has(3)) return "three-with-pair";
    if (
      length === 6 &&
      nonZero.every((count) => count === 2) &&
      consecutiveCounts(counts, 3, distinctCount)
    )
      return "three-consecutive-pairs";
    if (
      length === 6 &&
      nonZero.every((count) => count === 3) &&
      consecutiveCounts(counts, 2, distinctCount)
    )
      return "steel-plate";
    if (length === 5 && consecutiveCounts(counts, 5, distinctCount)) {
      const sameSuit = !fixedHasMixedSuits && assigned.every((target) => target.suit === fixedSuit);
      return sameSuit ? "straight-flush" : "straight";
    }
    if (length >= 4 && length <= 10 && distinctCount === 1) return "normal-bomb";
    return undefined;
  };
  const visit = (index: number, assigned: { rank: Rank; suit: Suit }[]): void => {
    if (index < wildcards.length) {
      for (const target of targets) visit(index + 1, [...assigned, target]);
      return;
    }
    const type = classifyAssignment(assigned);
    if (!type) return;
    const projected = [...fixed, ...wildcards.map((card, i) => ({ ...card, ...assigned[i] }))];
    const wildcardAs = Object.fromEntries(wildcards.map((card, i) => [card.id, assigned[i]]));
    const key = `${type}:${JSON.stringify(wildcardAs)}`;
    if (!resultKeys.has(key)) {
      resultKeys.add(key);
      results.push({
        type,
        cardIds: cards.map((card) => card.id),
        wildcardAs,
        comparisonKey: comparisonKey(type, projected, levelRank)
      });
    }
  };
  visit(0, []);
  return results.length
    ? { ok: true, interpretations: results }
    : { ok: false, code: "no_legal_pattern" };
}
