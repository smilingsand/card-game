// Shared Guandan core source.
import type { Card, Rank, Suit } from "../../platform/types";
import { monotonicNow } from "../../platform/clock";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import type { TurnAction, TurnState } from "./turns";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;
type Requirement = {
  readonly rank: LevelRank;
  readonly count: number;
  readonly suit?: Suit;
};
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
  "A",
];
const RUN: readonly LevelRank[] = ["A", ...RANKS, "A"];
const SUITS: readonly Exclude<Suit, "joker">[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
];

const cardSetKey = (cardIds: readonly string[]) =>
  [...cardIds].sort().join(",");
const interpretationKey = (interpretation: PatternInterpretation) =>
  `${interpretation.type}|${JSON.stringify(interpretation.wildcardAs)}|${interpretation.comparisonKey.join(",")}`;
function choose<T>(
  items: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  if (size < 0 || size > items.length) return [];
  if (size === 0) return [[]];
  return items.flatMap((item, index) =>
    choose(items.slice(index + 1), size - 1).map((tail) => [item, ...tail]),
  );
}

/** 牌型导向、有限且确定性地枚举完整规则候选；绝不枚举整手牌任意子集。 */
function fulfill(
  requirements: readonly Requirement[],
  fixedByRank: ReadonlyMap<LevelRank, readonly Card[]>,
  wildcards: readonly Card[],
): readonly (readonly Card[])[] {
  const result: Card[][] = [];
  const visit = (
    index: number,
    selected: readonly Card[],
    wildcardCount: number,
  ): void => {
    if (wildcardCount > wildcards.length) return;
    if (index === requirements.length) {
      for (const wildcardCards of choose(wildcards, wildcardCount))
        result.push([...selected, ...wildcardCards]);
      return;
    }
    const requirement = requirements[index];
    const available = (fixedByRank.get(requirement.rank) ?? []).filter(
      (card) =>
        requirement.suit === undefined || card.suit === requirement.suit,
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
          wildcardCount + requirement.count - fixedCount,
        );
  };
  visit(0, [], 0);
  return result;
}

export interface RuleCompleteLegalActionsInput {
  readonly state: TurnState;
  readonly selfHand: readonly Card[];
  readonly levelRank: LevelRank;
  /** Bump this when the frozen rule implementation changes. */
  readonly rulesVersion?: string;
}

/**
 * This cache is deliberately below the strategy layer: it memoizes the complete
 * rules result, never a ranked subset.  The key includes all rule-visible turn
 * context and the physical identity/rank/suit of the acting hand, so a miss is
 * required whenever following/leading semantics can differ.
 */
export const COMPLETE_LEGAL_ACTIONS_RULES_VERSION = "guandan-v5";
const completeLegalActionsCache = new Map<string, readonly TurnAction[]>();
const COMPLETE_LEGAL_ACTIONS_CACHE_CAPACITY = 256;

/**
 * Last cold A-layer generation only.  This is deliberately diagnostic data,
 * not a decision input: it makes it possible to prove that an optimisation
 * still enumerates every rule-shaped physical proposal before recognition.
 */
export interface CompleteLegalActionsGenerationStatistics {
  readonly generatedPhysicalSetCount: number;
  readonly uniquePhysicalSetCount: number;
  readonly duplicatePhysicalSetCount: number;
  readonly recognizeCallCount: number;
  readonly rawInterpretationCount: number;
  readonly interpretationCountByType: Readonly<Record<string, number>>;
  readonly recognizedSetCountByWildcardCount: Readonly<Record<string, number>>;
  readonly enumerationMilliseconds: number;
  readonly recognitionMilliseconds: number;
  readonly legalFilterMilliseconds: number;
}

let lastGenerationStatistics:
  CompleteLegalActionsGenerationStatistics | undefined;

export function getLastCompleteLegalActionsGenerationStatistics():
  CompleteLegalActionsGenerationStatistics | undefined {
  return lastGenerationStatistics;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function completeLegalActionsCacheKey(
  input: RuleCompleteLegalActionsInput,
): string {
  return stableJson({
    rulesVersion: input.rulesVersion ?? COMPLETE_LEGAL_ACTIONS_RULES_VERSION,
    levelRank: input.levelRank,
    selfHand: input.selfHand
      .map(({ id, rank, suit, deckIndex }) => ({ id, rank, suit, deckIndex }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    // Preserve the full state rather than attempting a fragile dependency
    // reduction.  In particular highest/current/leader/passes/finished are all
    // rules-visible when deciding whether a proposal follows or passes.
    state: {
      hands: Object.fromEntries(
        Object.entries(input.state.hands)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([seat, ids]) => [seat, [...ids].sort()]),
      ),
      current: input.state.current,
      leader: input.state.leader,
      highest: input.state.highest ?? null,
      highestSeat: input.state.highestSeat ?? null,
      passes: input.state.passes,
      finished: [...input.state.finished].sort(),
      completed: input.state.completed ?? false,
    },
  });
}

/** Test/benchmark hook; production capacity is bounded and observable. */
export function clearCompleteLegalActionsCaches(): void {
  completeLegalActionsCache.clear();
  lastGenerationStatistics = undefined;
}

/**
 * A 层：规则完整合法动作。候选只按冻结的牌型结构展开、再经 getLegalActions 裁决；
 * 与专家 HandPlan/Top-N 完全隔离，因而不会被策略性能预算裁剪。
 */
function generateCompleteLegalCandidates(
  input: RuleCompleteLegalActionsInput,
  deduplicatePhysicalSets: boolean,
): readonly TurnAction[] {
  const cacheKey = completeLegalActionsCacheKey(input);
  if (deduplicatePhysicalSets) {
    const cached = completeLegalActionsCache.get(cacheKey);
    if (cached) return cached;
  }
  const enumerationStarted = monotonicNow();
  const wildcards = input.selfHand.filter(
    (card) => card.rank === input.levelRank && card.suit === "hearts",
  );
  const fixedByRank = new Map<LevelRank, Card[]>();
  for (const card of input.selfHand) {
    if (
      wildcards.includes(card) ||
      card.rank === "small-joker" ||
      card.rank === "big-joker"
    )
      continue;
    fixedByRank.set(card.rank, [...(fixedByRank.get(card.rank) ?? []), card]);
  }
  for (const cards of fixedByRank.values())
    cards.sort((left, right) => left.id.localeCompare(right.id));
  const sets: (readonly Card[])[] = [];
  const seenPhysicalSets = new Set<string>();
  let generatedPhysicalSetCount = 0;
  const addSets = (next: readonly (readonly Card[])[]): void => {
    for (const cards of next) {
      generatedPhysicalSetCount += 1;
      const key = cardSetKey(cards.map((card) => card.id));
      // Different rule-shaped generators can reach the identical physical
      // subset.  Recognition is a pure function of that subset and level, so
      // retaining the first occurrence preserves the old proposal order while
      // avoiding an exactly duplicated wildcard projection search.
      if (!deduplicatePhysicalSets || !seenPhysicalSets.has(key)) {
        seenPhysicalSets.add(key);
        sets.push(cards);
      }
    }
  };
  addSets(input.selfHand.map((card) => [card]));
  for (const rank of RANKS) {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10])
      addSets(fulfill([{ rank, count }], fixedByRank, wildcards));
  }
  for (let start = 0; start <= RUN.length - 5; start += 1) {
    const window = RUN.slice(start, start + 5);
    addSets(
      fulfill(
        window.map((rank) => ({ rank, count: 1 })),
        fixedByRank,
        wildcards,
      ),
    );
    for (const suit of SUITS)
      addSets(
        fulfill(
          window.map((rank) => ({ rank, count: 1, suit })),
          fixedByRank,
          wildcards,
        ),
      );
  }
  for (let start = 0; start <= RUN.length - 3; start += 1)
    addSets(
      fulfill(
        RUN.slice(start, start + 3).map((rank) => ({ rank, count: 2 })),
        fixedByRank,
        wildcards,
      ),
    );
  for (let start = 0; start <= RUN.length - 2; start += 1)
    addSets(
      fulfill(
        RUN.slice(start, start + 2).map((rank) => ({ rank, count: 3 })),
        fixedByRank,
        wildcards,
      ),
    );
  for (const tripleRank of RANKS)
    for (const pairRank of RANKS)
      if (tripleRank !== pairRank)
        addSets(
          fulfill(
            [
              { rank: tripleRank, count: 3 },
              { rank: pairRank, count: 2 },
            ],
            fixedByRank,
            wildcards,
          ),
        );
  const jokers = input.selfHand.filter((card) => card.suit === "joker");
  if (jokers.length === 4) addSets([jokers]);

  const enumerationMilliseconds = monotonicNow() - enumerationStarted;
  const recognitionStarted = monotonicNow();
  const interpretationCountByType: Record<string, number> = {};
  const recognizedSetCountByWildcardCount: Record<string, number> = {};
  let rawInterpretationCount = 0;
  const proposals: TurnAction[] = sets.flatMap((cards) => {
    const recognition = recognizePatterns(cards, input.levelRank);
    const wildcardCount = cards.filter(
      (card) => card.rank === input.levelRank && card.suit === "hearts",
    ).length;
    recognizedSetCountByWildcardCount[wildcardCount] =
      (recognizedSetCountByWildcardCount[wildcardCount] ?? 0) + 1;
    return recognition.ok
      ? recognition.interpretations.map((interpretation) => {
          rawInterpretationCount += 1;
          interpretationCountByType[interpretation.type] =
            (interpretationCountByType[interpretation.type] ?? 0) + 1;
          return {
            type: "play" as const,
            actor: input.state.current,
            cardIds: cards.map((card) => card.id),
            interpretation,
          };
        })
      : [];
  });
  const recognitionMilliseconds = monotonicNow() - recognitionStarted;
  const legalFilterStarted = monotonicNow();
  if (input.state.highest)
    proposals.push({ type: "pass", actor: input.state.current });
  const unique = new Map<string, TurnAction>();
  for (const action of getLegalActions(input.state, proposals)) {
    const key =
      action.type === "pass"
        ? `pass:${action.actor}`
        : `play:${action.actor}:${cardSetKey(action.cardIds)}:${interpretationKey(action.interpretation)}`;
    if (!unique.has(key)) unique.set(key, action);
  }
  const result = [...unique.values()].sort((left, right) => {
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
  lastGenerationStatistics = {
    generatedPhysicalSetCount,
    uniquePhysicalSetCount: sets.length,
    duplicatePhysicalSetCount: generatedPhysicalSetCount - sets.length,
    recognizeCallCount: sets.length,
    rawInterpretationCount,
    interpretationCountByType,
    recognizedSetCountByWildcardCount,
    enumerationMilliseconds,
    recognitionMilliseconds,
    legalFilterMilliseconds: monotonicNow() - legalFilterStarted,
  };
  if (deduplicatePhysicalSets) {
    if (completeLegalActionsCache.size >= COMPLETE_LEGAL_ACTIONS_CACHE_CAPACITY)
      completeLegalActionsCache.delete(
        completeLegalActionsCache.keys().next().value as string,
      );
    completeLegalActionsCache.set(cacheKey, result);
  }
  return result;
}

export function getCompleteLegalCandidates(
  input: RuleCompleteLegalActionsInput,
): readonly TurnAction[] {
  return generateCompleteLegalCandidates(input, true);
}

/**
 * Exact leading-action projection for a physical subhand of an already
 * enumerated leading hand. A pattern interpretation depends only on its own
 * selected cards and the level rank; leading legality has no competing play.
 * Therefore the complete leading set for `remainingCardIds` is precisely the
 * stable subsequence of the root leading catalogue whose cards remain owned.
 *
 * The caller must supply a catalogue produced with `getCompleteLegalCandidates`
 * on a leading state for the same actor, level and root hand. This helper does
 * not accept following-state candidates: filtering such a list could lose
 * otherwise legal leads.
 */
export function filterCompleteLeadCatalog(
  rootLeadingActions: readonly TurnAction[],
  remainingCardIds: readonly string[],
): readonly TurnAction[] {
  const remaining = new Set(remainingCardIds);
  return rootLeadingActions.filter(
    (action): action is Extract<TurnAction, { readonly type: "play" }> =>
      action.type === "play" && action.cardIds.every((id) => remaining.has(id)),
  );
}

export interface CompleteLeadCatalogIndex {
  /** Stable, rules-layer order; this is the exact order observed by FollowUp. */
  filter(remainingCardIds: readonly string[]): readonly TurnAction[];
}

/**
 * Compiles a leading catalogue against one root physical hand. The mask is an
 * internal representation only: output remains the original action objects in
 * the original sort order. A play is available exactly when all its bits are
 * present in the subhand mask, which is identical to the Set/every predicate
 * in `filterCompleteLeadCatalog`.
 */
export function createCompleteLeadCatalogIndex(
  rootLeadingActions: readonly TurnAction[],
  rootCardIds: readonly string[],
): CompleteLeadCatalogIndex {
  const bitsByCardId = new Map(
    [...rootCardIds].sort().map((id, index) => [id, 1n << BigInt(index)]),
  );
  const entries = rootLeadingActions.flatMap((action) => {
    if (action.type !== "play") return [];
    let mask = 0n;
    for (const id of action.cardIds) {
      const bit = bitsByCardId.get(id);
      if (bit === undefined)
        throw new Error(
          "root leading catalogue contains a card outside its root hand",
        );
      mask |= bit;
    }
    return [{ action, mask }];
  });
  return {
    filter(remainingCardIds: readonly string[]): readonly TurnAction[] {
      let remainingMask = 0n;
      for (const id of remainingCardIds) {
        const bit = bitsByCardId.get(id);
        if (bit === undefined)
          throw new Error("subhand contains a card outside its root hand");
        remainingMask |= bit;
      }
      return entries
        .filter((entry) => (entry.mask & remainingMask) === entry.mask)
        .map((entry) => entry.action);
    },
  };
}

/**
 * Differential-test baseline only. It retains duplicate rule-shaped physical
 * subsets and therefore repeats pure recognition work exactly as the previous
 * implementation did. Never call this from a decision path.
 */
export function getUnoptimizedCompleteLegalCandidatesForDifferential(
  input: RuleCompleteLegalActionsInput,
): readonly TurnAction[] {
  return generateCompleteLegalCandidates(input, false);
}

/**
 * A 层的规范化产物：规则仍完整枚举并裁决所有解释，而消费方可按实体
 * 出牌集合取得 canonical physical action 与语义候选/alias 的精确分组。
 */
