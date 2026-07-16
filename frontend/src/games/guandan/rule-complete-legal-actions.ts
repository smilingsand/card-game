import type { Card, Rank, Suit } from "../../platform/types";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import type { TurnAction, TurnState } from "./turns";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;
type Requirement = { readonly rank: LevelRank; readonly count: number; readonly suit?: Suit };
const RANKS: readonly LevelRank[] = [
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
const RUN: readonly LevelRank[] = ["A", ...RANKS, "A"];
const SUITS: readonly Exclude<Suit, "joker">[] = ["spades", "hearts", "diamonds", "clubs"];

const cardSetKey = (cardIds: readonly string[]) => [...cardIds].sort().join(",");
const interpretationKey = (interpretation: PatternInterpretation) =>
  `${interpretation.type}|${JSON.stringify(interpretation.wildcardAs)}|${interpretation.comparisonKey.join(",")}`;
function choose<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size < 0 || size > items.length) return [];
  if (size === 0) return [[]];
  return items.flatMap((item, index) =>
    choose(items.slice(index + 1), size - 1).map((tail) => [item, ...tail])
  );
}

/** 牌型导向、有限且确定性地枚举完整规则候选；绝不枚举整手牌任意子集。 */
function fulfill(
  requirements: readonly Requirement[],
  fixedByRank: ReadonlyMap<LevelRank, readonly Card[]>,
  wildcards: readonly Card[]
): readonly (readonly Card[])[] {
  const result: Card[][] = [];
  const visit = (index: number, selected: readonly Card[], wildcardCount: number): void => {
    if (wildcardCount > wildcards.length) return;
    if (index === requirements.length) {
      for (const wildcardCards of choose(wildcards, wildcardCount))
        result.push([...selected, ...wildcardCards]);
      return;
    }
    const requirement = requirements[index];
    const available = (fixedByRank.get(requirement.rank) ?? []).filter(
      (card) => requirement.suit === undefined || card.suit === requirement.suit
    );
    for (
      let fixedCount = 0;
      fixedCount <= Math.min(requirement.count, available.length);
      fixedCount += 1
    )
      for (const fixedCards of choose(available, fixedCount))
        visit(
          index + 1,
          [...selected, ...fixedCards],
          wildcardCount + requirement.count - fixedCount
        );
  };
  visit(0, [], 0);
  return result;
}

export interface RuleCompleteLegalActionsInput {
  readonly state: TurnState;
  readonly selfHand: readonly Card[];
  readonly levelRank: LevelRank;
}

/**
 * A 层：规则完整合法动作。候选只按冻结的牌型结构展开、再经 getLegalActions 裁决；
 * 与专家 HandPlan/Top-N 完全隔离，因而不会被策略性能预算裁剪。
 */
export function getCompleteLegalCandidates(
  input: RuleCompleteLegalActionsInput
): readonly TurnAction[] {
  const wildcards = input.selfHand.filter(
    (card) => card.rank === input.levelRank && card.suit === "hearts"
  );
  const fixedByRank = new Map<LevelRank, Card[]>();
  for (const card of input.selfHand) {
    if (wildcards.includes(card) || card.rank === "small-joker" || card.rank === "big-joker")
      continue;
    fixedByRank.set(card.rank, [...(fixedByRank.get(card.rank) ?? []), card]);
  }
  for (const cards of fixedByRank.values())
    cards.sort((left, right) => left.id.localeCompare(right.id));
  const sets: (readonly Card[])[] = input.selfHand.map((card) => [card]);
  for (const rank of RANKS) {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10])
      sets.push(...fulfill([{ rank, count }], fixedByRank, wildcards));
  }
  for (let start = 0; start <= RUN.length - 5; start += 1) {
    const window = RUN.slice(start, start + 5);
    sets.push(
      ...fulfill(
        window.map((rank) => ({ rank, count: 1 })),
        fixedByRank,
        wildcards
      )
    );
    for (const suit of SUITS)
      sets.push(
        ...fulfill(
          window.map((rank) => ({ rank, count: 1, suit })),
          fixedByRank,
          wildcards
        )
      );
  }
  for (let start = 0; start <= RUN.length - 3; start += 1)
    sets.push(
      ...fulfill(
        RUN.slice(start, start + 3).map((rank) => ({ rank, count: 2 })),
        fixedByRank,
        wildcards
      )
    );
  for (let start = 0; start <= RUN.length - 2; start += 1)
    sets.push(
      ...fulfill(
        RUN.slice(start, start + 2).map((rank) => ({ rank, count: 3 })),
        fixedByRank,
        wildcards
      )
    );
  for (const tripleRank of RANKS)
    for (const pairRank of RANKS)
      if (tripleRank !== pairRank)
        sets.push(
          ...fulfill(
            [
              { rank: tripleRank, count: 3 },
              { rank: pairRank, count: 2 }
            ],
            fixedByRank,
            wildcards
          )
        );
  const jokers = input.selfHand.filter((card) => card.suit === "joker");
  if (jokers.length === 4) sets.push(jokers);

  const proposals: TurnAction[] = sets.flatMap((cards) => {
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
  if (input.state.highest) proposals.push({ type: "pass", actor: input.state.current });
  const unique = new Map<string, TurnAction>();
  for (const action of getLegalActions(input.state, proposals)) {
    const key =
      action.type === "pass"
        ? `pass:${action.actor}`
        : `play:${action.actor}:${cardSetKey(action.cardIds)}:${interpretationKey(action.interpretation)}`;
    if (!unique.has(key)) unique.set(key, action);
  }
  return [...unique.values()].sort((left, right) => {
    const leftKey =
      left.type === "pass"
        ? `pass:${left.actor}`
        : `play:${left.actor}:${cardSetKey(left.cardIds)}:${interpretationKey(left.interpretation)}`;
    const rightKey =
      right.type === "pass"
        ? `pass:${right.actor}`
        : `play:${right.actor}:${cardSetKey(right.cardIds)}:${interpretationKey(right.interpretation)}`;
    return leftKey.localeCompare(rightKey);
  });
}
