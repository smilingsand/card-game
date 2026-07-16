import type { Card, Rank, Suit } from "../../../platform/types";

export type StructureSource = "natural" | "wildcard_completed" | "split_from_existing_group";
export type HandStructureKind =
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

export interface HandStructureGroup {
  readonly kind: HandStructureKind;
  readonly source: StructureSource;
  readonly cardIds: readonly string[];
  /** 仅逢人配补成的组合记录其投影，不改变实体牌。 */
  readonly wildcardAs: Readonly<Record<string, { readonly rank: Rank; readonly suit: Suit }>>;
}

export interface HandStructureAnalysis {
  readonly fingerprint: string;
  /** 可能组合允许重叠；它们不是同一手牌方案。 */
  readonly groups: readonly HandStructureGroup[];
  readonly loose: {
    readonly singleCardIds: readonly string[];
    readonly lowSingleCardIds: readonly string[];
    readonly weakPairCardIds: readonly string[];
  };
  readonly control: {
    readonly jokerCardIds: readonly string[];
    readonly levelCardIds: readonly string[];
    readonly wildcardCardIds: readonly string[];
    readonly aceCardIds: readonly string[];
    readonly highPairCardIds: readonly string[];
    readonly highTripleCardIds: readonly string[];
    readonly bombCardIds: readonly string[];
    readonly straightFlushCardIds: readonly string[];
  };
  readonly recoveryCardIds: readonly string[];
}

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;

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
const RUN: readonly LevelRank[] = [
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
const SUITS: readonly Exclude<Suit, "joker">[] = ["spades", "hearts", "diamonds", "clubs"];
const LOW_RANKS = new Set<LevelRank>(["2", "3", "4", "5", "6", "7"]);
const HIGH_RANKS = new Set<LevelRank>(["10", "J", "Q", "K", "A"]);

const cardOrder = (left: Card, right: Card) =>
  left.id.localeCompare(right.id) ||
  left.deckIndex - right.deckIndex ||
  left.suit.localeCompare(right.suit);
const ids = (cards: readonly Card[]) => cards.map((card) => card.id).sort();
const asLevelRank = (rank: Rank): rank is LevelRank =>
  rank !== "small-joker" && rank !== "big-joker";

function groupByRank(cards: readonly Card[]): ReadonlyMap<Rank, readonly Card[]> {
  const result = new Map<Rank, Card[]>();
  for (const card of cards) result.set(card.rank, [...(result.get(card.rank) ?? []), card]);
  return new Map([...result].map(([rank, value]) => [rank, value.sort(cardOrder)]));
}

function sourceFor(
  cards: readonly Card[],
  allByRank: ReadonlyMap<Rank, readonly Card[]>,
  wildcards: readonly Card[]
): StructureSource {
  if (cards.some((card) => wildcards.some((wildcard) => wildcard.id === card.id)))
    return "wildcard_completed";
  return cards.some(
    (card) =>
      (allByRank.get(card.rank)?.length ?? 0) >
      cards.filter((item) => item.rank === card.rank).length
  )
    ? "split_from_existing_group"
    : "natural";
}

function addGroup(
  groups: HandStructureGroup[],
  kind: HandStructureKind,
  cards: readonly Card[],
  allByRank: ReadonlyMap<Rank, readonly Card[]>,
  wildcards: readonly Card[],
  wildcardAs: Readonly<Record<string, { readonly rank: Rank; readonly suit: Suit }>> = {}
): void {
  const cardIds = ids(cards);
  const source = sourceFor(cards, allByRank, wildcards);
  const key = `${kind}|${source}|${cardIds.join(",")}|${JSON.stringify(wildcardAs)}`;
  if (
    !groups.some(
      (group) =>
        `${group.kind}|${group.source}|${group.cardIds.join(",")}|${JSON.stringify(group.wildcardAs)}` ===
        key
    )
  )
    groups.push({ kind, source, cardIds, wildcardAs });
}

function wildcardProjection(
  wildcards: readonly Card[],
  rank: LevelRank,
  suit: Suit
): Readonly<Record<string, { readonly rank: Rank; readonly suit: Suit }>> {
  return Object.fromEntries(wildcards.map((card) => [card.id, { rank, suit }]));
}

function rankWindows(length: number): readonly (readonly LevelRank[])[] {
  return Array.from({ length: RUN.length - length + 1 }, (_, start) =>
    RUN.slice(start, start + length)
  );
}

function selectRankCards(
  byRank: ReadonlyMap<Rank, readonly Card[]>,
  rank: LevelRank,
  count: number
): readonly Card[] {
  return (byRank.get(rank) ?? []).slice(0, count);
}

/**
 * 分析仅消费己方实体牌与级牌。组合是有界的“可能组合”索引，允许重叠，绝不代表可同时使用。
 */
export function analyzeHandStructure(
  selfHand: readonly Card[],
  levelRank: LevelRank
): HandStructureAnalysis {
  const ordered = [...selfHand].sort(cardOrder);
  const wildcards = ordered.filter((card) => card.rank === levelRank && card.suit === "hearts");
  const fixed = ordered.filter((card) => !wildcards.some((wildcard) => wildcard.id === card.id));
  const allByRank = groupByRank(ordered);
  const fixedByRank = groupByRank(fixed);
  const groups: HandStructureGroup[] = [];

  for (const rank of RANKS) {
    const cards = fixedByRank.get(rank) ?? [];
    if (cards.length >= 2) addGroup(groups, "pair", cards.slice(0, 2), allByRank, wildcards);
    if (cards.length >= 3) addGroup(groups, "triple", cards.slice(0, 3), allByRank, wildcards);
    if (cards.length >= 4)
      addGroup(
        groups,
        "normal-bomb",
        cards.slice(0, Math.min(cards.length, 10)),
        allByRank,
        wildcards
      );

    for (const needed of [2, 3, 4]) {
      const fixedCards = cards.slice(0, needed - wildcards.length);
      const neededWildcards = needed - fixedCards.length;
      if (neededWildcards > 0 && neededWildcards <= wildcards.length && fixedCards.length > 0) {
        const usedWildcards = wildcards.slice(0, neededWildcards);
        const kind: HandStructureKind =
          needed === 2 ? "pair" : needed === 3 ? "triple" : "normal-bomb";
        addGroup(
          groups,
          kind,
          [...fixedCards, ...usedWildcards],
          allByRank,
          wildcards,
          wildcardProjection(usedWildcards, rank, fixedCards[0]?.suit ?? "spades")
        );
      }
    }
  }

  const jokers = ordered.filter((card) => card.rank === "small-joker" || card.rank === "big-joker");
  if (
    jokers.length === 4 &&
    jokers.filter((card) => card.rank === "small-joker").length === 2 &&
    jokers.filter((card) => card.rank === "big-joker").length === 2
  )
    addGroup(groups, "four-jokers", jokers, allByRank, wildcards);

  for (const ranks of rankWindows(5)) {
    const selected = ranks.flatMap((rank) => selectRankCards(fixedByRank, rank, 1));
    const missing = 5 - selected.length;
    if (missing === 0) addGroup(groups, "straight", selected, allByRank, wildcards);
    else if (missing > 0 && missing <= wildcards.length) {
      const usedWildcards = wildcards.slice(0, missing);
      const missingRanks = ranks.filter((rank) => !selected.some((card) => card.rank === rank));
      addGroup(
        groups,
        "straight",
        [...selected, ...usedWildcards],
        allByRank,
        wildcards,
        Object.fromEntries(
          usedWildcards.map((card, index) => [
            card.id,
            { rank: missingRanks[index], suit: "spades" }
          ])
        )
      );
    }
    for (const suit of SUITS) {
      const suited = ranks.flatMap((rank) =>
        (fixedByRank.get(rank) ?? []).filter((card) => card.suit === suit).slice(0, 1)
      );
      const suitedMissing = 5 - suited.length;
      if (suitedMissing === 0) addGroup(groups, "straight-flush", suited, allByRank, wildcards);
      else if (suitedMissing > 0 && suitedMissing <= wildcards.length) {
        const usedWildcards = wildcards.slice(0, suitedMissing);
        const missingRanks = ranks.filter((rank) => !suited.some((card) => card.rank === rank));
        addGroup(
          groups,
          "straight-flush",
          [...suited, ...usedWildcards],
          allByRank,
          wildcards,
          Object.fromEntries(
            usedWildcards.map((card, index) => [card.id, { rank: missingRanks[index], suit }])
          )
        );
      }
    }
  }

  for (const ranks of rankWindows(3)) {
    const selected = ranks.flatMap((rank) => selectRankCards(fixedByRank, rank, 2));
    const missing = 6 - selected.length;
    if (missing === 0 || (missing > 0 && missing <= wildcards.length)) {
      const usedWildcards = missing === 0 ? [] : wildcards.slice(0, missing);
      const neededRanks = ranks.flatMap((rank) =>
        Array.from({ length: 2 - selectRankCards(fixedByRank, rank, 2).length }, () => rank)
      );
      addGroup(
        groups,
        "three-consecutive-pairs",
        [...selected, ...usedWildcards],
        allByRank,
        wildcards,
        Object.fromEntries(
          usedWildcards.map((card, index) => [
            card.id,
            { rank: neededRanks[index], suit: "spades" }
          ])
        )
      );
    }
  }
  for (const ranks of rankWindows(2)) {
    const selected = ranks.flatMap((rank) => selectRankCards(fixedByRank, rank, 3));
    const missing = 6 - selected.length;
    if (missing === 0 || (missing > 0 && missing <= wildcards.length)) {
      const usedWildcards = missing === 0 ? [] : wildcards.slice(0, missing);
      const neededRanks = ranks.flatMap((rank) =>
        Array.from({ length: 3 - selectRankCards(fixedByRank, rank, 3).length }, () => rank)
      );
      addGroup(
        groups,
        "steel-plate",
        [...selected, ...usedWildcards],
        allByRank,
        wildcards,
        Object.fromEntries(
          usedWildcards.map((card, index) => [
            card.id,
            { rank: neededRanks[index], suit: "spades" }
          ])
        )
      );
    }
  }

  for (const tripleRank of RANKS) {
    for (const pairRank of RANKS) {
      if (tripleRank === pairRank) continue;
      const triple = selectRankCards(fixedByRank, tripleRank, 3);
      const pair = selectRankCards(fixedByRank, pairRank, 2);
      const selected = [...triple, ...pair];
      const missing = 5 - selected.length;
      if (selected.length > 0 && (missing === 0 || (missing > 0 && missing <= wildcards.length))) {
        const usedWildcards = missing === 0 ? [] : wildcards.slice(0, missing);
        const neededRanks = [
          ...Array.from({ length: 3 - triple.length }, () => tripleRank),
          ...Array.from({ length: 2 - pair.length }, () => pairRank)
        ];
        addGroup(
          groups,
          "three-with-pair",
          [...selected, ...usedWildcards],
          allByRank,
          wildcards,
          Object.fromEntries(
            usedWildcards.map((card, index) => [
              card.id,
              { rank: neededRanks[index], suit: "spades" }
            ])
          )
        );
      }
    }
  }

  for (const card of ordered) {
    const source =
      (allByRank.get(card.rank)?.length ?? 0) > 1 ? "split_from_existing_group" : "natural";
    addGroup(groups, "single", [card], allByRank, [], {});
    if (source === "split_from_existing_group") {
      const index = groups.findIndex(
        (group) => group.kind === "single" && group.cardIds[0] === card.id
      );
      if (index >= 0) groups[index] = { ...groups[index], source };
    }
  }

  const looseSingles = fixed.filter((card) => (allByRank.get(card.rank)?.length ?? 0) === 1);
  const weakPairs = RANKS.flatMap((rank) => {
    const cards = fixedByRank.get(rank) ?? [];
    return cards.length === 2 && LOW_RANKS.has(rank) ? cards : [];
  });
  const highPairs = RANKS.flatMap((rank) => {
    const cards = fixedByRank.get(rank) ?? [];
    return cards.length >= 2 && HIGH_RANKS.has(rank) ? cards.slice(0, 2) : [];
  });
  const highTriples = RANKS.flatMap((rank) => {
    const cards = fixedByRank.get(rank) ?? [];
    return cards.length >= 3 && HIGH_RANKS.has(rank) ? cards.slice(0, 3) : [];
  });
  const bombCardIds = Array.from(
    new Set(
      groups
        .filter((group) => group.kind === "normal-bomb" || group.kind === "four-jokers")
        .flatMap((group) => group.cardIds)
    )
  ).sort();
  const straightFlushCardIds = Array.from(
    new Set(
      groups.filter((group) => group.kind === "straight-flush").flatMap((group) => group.cardIds)
    )
  ).sort();
  const control = {
    jokerCardIds: ids(jokers),
    levelCardIds: ids(ordered.filter((card) => card.rank === levelRank)),
    wildcardCardIds: ids(wildcards),
    aceCardIds: ids(ordered.filter((card) => card.rank === "A")),
    highPairCardIds: ids(highPairs),
    highTripleCardIds: ids(highTriples),
    bombCardIds,
    straightFlushCardIds
  };
  const recoveryCardIds = Array.from(
    new Set([
      ...control.jokerCardIds,
      ...control.bombCardIds,
      ...control.straightFlushCardIds,
      ...control.highPairCardIds,
      ...control.highTripleCardIds
    ])
  ).sort();
  const stableGroups = [...groups].sort((left, right) =>
    `${left.kind}|${left.source}|${left.cardIds.join(",")}`.localeCompare(
      `${right.kind}|${right.source}|${right.cardIds.join(",")}`
    )
  );
  const loose = {
    singleCardIds: ids(looseSingles),
    lowSingleCardIds: ids(
      looseSingles.filter((card) => asLevelRank(card.rank) && LOW_RANKS.has(card.rank))
    ),
    weakPairCardIds: ids(weakPairs)
  };
  const fingerprint = JSON.stringify({
    levelRank,
    hand: ordered.map((card) => [card.id, card.deckIndex, card.rank, card.suit]),
    groups: stableGroups.map((group) => [
      group.kind,
      group.source,
      group.cardIds,
      group.wildcardAs
    ]),
    loose,
    control,
    recoveryCardIds
  });
  return { fingerprint, groups: stableGroups, loose, control, recoveryCardIds };
}
