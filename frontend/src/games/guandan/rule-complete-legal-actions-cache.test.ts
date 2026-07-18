import { expect, test } from "vitest";
import type { Card } from "../../platform/types";
import {
  clearCompleteLegalActionsCaches,
  createCompleteLeadCatalogIndex,
  filterCompleteLeadCatalog,
  getCompleteLegalCandidateGroups,
  getCompleteLegalCandidateGroupsCacheStatistics,
  getCompleteLegalCandidates,
  getCompleteLegalActionsCacheStatistics,
  getUnoptimizedCompleteLegalCandidatesForDifferential
} from "./rule-complete-legal-actions";
import { createInitialSimulationBotView } from "./simulation";
import { canonicalizeSemanticCandidates } from "./strategy/semantic-action-candidates";
import type { TurnState } from "./turns";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});

test("physical subset deduplication preserves all raw actions and semantic groups", () => {
  const wildcardHand = [
    card("h2", "2", "hearts"),
    card("s3", "3"),
    card("c3", "3", "clubs"),
    card("s4", "4"),
    card("s5", "5"),
    card("s6", "6"),
    card("s7", "7")
  ];
  const input: {
    readonly state: TurnState;
    readonly selfHand: readonly Card[];
    readonly levelRank: "2";
  } = {
    state: {
      hands: { east: [], south: wildcardHand.map((item) => item.id), west: [], north: [] },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    selfHand: wildcardHand,
    levelRank: "2" as const
  };
  const baseline = getUnoptimizedCompleteLegalCandidatesForDifferential(input);
  clearCompleteLegalActionsCaches();
  const optimized = getCompleteLegalCandidates(input);
  expect(optimized).toEqual(baseline);
  expect(canonicalizeSemanticCandidates(optimized)).toEqual(
    canonicalizeSemanticCandidates(baseline)
  );
});

const hand = [card("s3", "3"), card("s4", "4"), card("s5", "5")];
const state = (): TurnState => ({
  hands: { east: [], south: hand.map((item) => item.id), west: [], north: [] },
  current: "south",
  leader: "south",
  passes: 0,
  finished: []
});

function leadState(
  actor: "east" | "south" | "west" | "north",
  cardIds: readonly string[]
): TurnState {
  return {
    hands: {
      east: actor === "east" ? [...cardIds] : [],
      south: actor === "south" ? [...cardIds] : [],
      west: actor === "west" ? [...cardIds] : [],
      north: actor === "north" ? [...cardIds] : []
    },
    current: actor,
    leader: actor,
    passes: 0,
    finished: []
  };
}

function assertLeadCatalogueProjection(input: {
  readonly hand: readonly Card[];
  readonly actor: "east" | "south" | "west" | "north";
  readonly levelRank: Exclude<Card["rank"], "small-joker" | "big-joker">;
  readonly rootCatalogue: readonly import("./turns").TurnAction[];
  readonly action: import("./turns").TurnAction;
}): void {
  if (input.action.type !== "play") return;
  const removed = new Set(input.action.cardIds);
  const remainingHand = input.hand.filter((item) => !removed.has(item.id));
  const direct = getCompleteLegalCandidates({
    state: leadState(
      input.actor,
      remainingHand.map((item) => item.id)
    ),
    selfHand: remainingHand,
    levelRank: input.levelRank
  });
  const projected = filterCompleteLeadCatalog(
    input.rootCatalogue,
    remainingHand.map((item) => item.id)
  );
  const indexed = createCompleteLeadCatalogIndex(
    input.rootCatalogue,
    input.hand.map((item) => item.id)
  ).filter(remainingHand.map((item) => item.id));
  // Keep both assertions deliberately: a projection must contain neither an
  // extra interpretation nor omit/reorder a direct A-layer interpretation.
  expect(projected).toEqual(direct);
  expect(direct).toEqual(projected);
  expect(indexed).toEqual(direct);
  expect(direct).toEqual(indexed);
}

// seed=0 projects several large subhands and intentionally compares every
// A-layer interpretation. Keep the assertion exhaustive; grant only this
// deterministic equivalence test a bounded 30s timeout.
test("root leading catalogue projects exactly to fixed, random and seed=0 subhands", () => {
  const fixedHand = [
    card("h2", "2", "hearts"),
    card("s3", "3"),
    card("c3", "3", "clubs"),
    card("s4", "4"),
    card("s5", "5"),
    card("s6", "6"),
    card("s7", "7")
  ];
  const fixedCatalogue = getCompleteLegalCandidates({
    state: leadState(
      "south",
      fixedHand.map((item) => item.id)
    ),
    selfHand: fixedHand,
    levelRank: "2"
  });
  for (const action of fixedCatalogue.filter((action) => action.type === "play").slice(0, 8))
    assertLeadCatalogueProjection({
      hand: fixedHand,
      actor: "south",
      levelRank: "2",
      rootCatalogue: fixedCatalogue,
      action
    });

  for (const seed of [7, 29, 0]) {
    const view = createInitialSimulationBotView(seed);
    const indexes = [0, Math.floor(view.legalActions.length / 2), view.legalActions.length - 1];
    for (const index of indexes) {
      const action = view.legalActions[index];
      if (!action) continue;
      assertLeadCatalogueProjection({
        hand: view.selfHand,
        actor: view.selfSeat,
        levelRank: view.levelRank,
        rootCatalogue: view.legalActions,
        action
      });
    }
  }
}, 30_000);

test("A 层严格缓存只复用完整相同的规则上下文，候选和规范分组逐字段一致", () => {
  clearCompleteLegalActionsCaches();
  const input = { state: state(), selfHand: hand, levelRank: "2" } as const;
  const cold = getCompleteLegalCandidates(input);
  const firstStats = getCompleteLegalActionsCacheStatistics();
  const warm = getCompleteLegalCandidates({ ...input, selfHand: [...hand].reverse() });

  expect(warm).toEqual(cold);
  expect(getCompleteLegalActionsCacheStatistics()).toMatchObject({
    hits: firstStats.hits + 1,
    misses: firstStats.misses,
    size: 1
  });

  const coldGroups = getCompleteLegalCandidateGroups(input);
  const firstGroupStats = getCompleteLegalCandidateGroupsCacheStatistics();
  const warmGroups = getCompleteLegalCandidateGroups({ ...input, selfHand: [...hand].reverse() });
  expect(warmGroups).toEqual(coldGroups);
  expect(getCompleteLegalCandidateGroupsCacheStatistics()).toMatchObject({
    hits: firstGroupStats.hits + 1,
    misses: firstGroupStats.misses,
    size: 1
  });
});

test("A 层缓存不跨领出/跟牌语义、规则版本或手牌物理属性复用", () => {
  clearCompleteLegalActionsCaches();
  const input = { state: state(), selfHand: hand, levelRank: "2" } as const;
  getCompleteLegalCandidates(input);
  const afterLead = getCompleteLegalActionsCacheStatistics();

  const following: TurnState = {
    ...state(),
    leader: "east",
    highestSeat: "east",
    highest: { type: "single", cardIds: ["e4"], comparisonKey: [4], wildcardAs: {} }
  };
  const followingActions = getCompleteLegalCandidates({ ...input, state: following });
  expect(getCompleteLegalActionsCacheStatistics().misses).toBe(afterLead.misses + 1);
  expect(followingActions).not.toEqual(getCompleteLegalCandidates(input));

  const afterFollow = getCompleteLegalActionsCacheStatistics();
  getCompleteLegalCandidates({ ...input, rulesVersion: "guandan-v5-test-change" });
  expect(getCompleteLegalActionsCacheStatistics().misses).toBe(afterFollow.misses + 1);

  const afterRules = getCompleteLegalActionsCacheStatistics();
  getCompleteLegalCandidates({
    ...input,
    selfHand: hand.map((item) => (item.id === "s3" ? { ...item, suit: "hearts" as const } : item))
  });
  expect(getCompleteLegalActionsCacheStatistics().misses).toBe(afterRules.misses + 1);
});
