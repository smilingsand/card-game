import type { Card, Rank } from "../../platform/types";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns } from "./patterns";
import type { TurnAction, TurnState } from "./turns";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;
const STRAIGHT_RANKS: readonly Card["rank"][] = [
  "A",
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
  "A"
];
function combinations<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]): void => {
    if (selected.length === size) return void result.push(selected);
    for (let index = start; index <= items.length - (size - selected.length); index += 1)
      visit(index + 1, [...selected, items[index]]);
  };
  visit(0, []);
  return result;
}
function unique(cards: readonly (readonly Card[])[]): readonly (readonly Card[])[] {
  const seen = new Set<string>();
  return cards.filter((candidate) => {
    const key = candidate
      .map((card) => card.id)
      .sort()
      .join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** normal profile 的冻结回归候选路径；P2.5-07 不改变其选择空间。 */
export function getLegacyNormalCandidates(input: {
  readonly state: TurnState;
  readonly selfHand: readonly Card[];
  readonly levelRank: LevelRank;
}): readonly TurnAction[] {
  const groups = [
    ...input.selfHand
      .reduce((byRank, card) => {
        byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
        return byRank;
      }, new Map<Card["rank"], Card[]>())
      .values()
  ];
  const leading = [
    ...input.selfHand.map((card) => [card]),
    ...groups.filter((group) => group.length >= 2 && group.length <= 10),
    ...groups
      .filter((group) => group.length === 3)
      .flatMap((triple) =>
        groups.filter((group) => group.length === 2).map((pair) => [...triple, ...pair])
      ),
    ...Array.from({ length: STRAIGHT_RANKS.length - 4 }, (_, start) => {
      const ranks = STRAIGHT_RANKS.slice(start, start + 5);
      const cards = ranks.map((rank) => groups.find((group) => group[0]?.rank === rank)?.[0]);
      return cards.every((card): card is Card => card !== undefined) ? cards : undefined;
    }).filter((cards): cards is Card[] => cards !== undefined)
  ];
  const following = unique([
    ...combinations(input.selfHand, input.state.highest?.cardIds.length ?? 1),
    ...groups.filter((group) => group[0]?.suit !== "joker" && group.length >= 4)
  ]);
  const candidateCards = input.state.highest ? following : unique(leading);
  const plays = candidateCards.flatMap((cards) => {
    const recognition = recognizePatterns(cards, input.levelRank);
    return recognition.ok
      ? recognition.interpretations.map((interpretation) => ({
          type: "play" as const,
          actor: input.state.current,
          cardIds: cards.map((card) => card.id),
          interpretation
        }))
      : [];
  });
  return getLegalActions(input.state, [
    ...plays,
    ...(input.state.highest ? [{ type: "pass" as const, actor: input.state.current }] : [])
  ]);
}
