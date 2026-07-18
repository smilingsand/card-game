import { expect, test } from "vitest";
import type { PatternType } from "../patterns";
import type { TurnAction } from "../turns";
import { canonicalizeSemanticCandidates } from "./semantic-action-candidates";

const play = (
  type: PatternType,
  comparisonKey: readonly number[],
  wildcardAs: Record<string, { rank: "3" | "4" | "8"; suit: "spades" | "hearts" }> = {}
): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: ["wild", "a", "b", "c"],
  interpretation: { type, cardIds: ["wild", "a", "b", "c"], comparisonKey, wildcardAs }
});

test("严格等价的逢人配解释合并为 canonical 与可追溯 alias", () => {
  const groups = canonicalizeSemanticCandidates([
    play("normal-bomb", [4, 8], { wild: { rank: "8", suit: "spades" } }),
    play("normal-bomb", [4, 8], { wild: { rank: "8", suit: "hearts" } })
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0].semanticCandidates).toHaveLength(1);
  expect(groups[0].semanticCandidates[0].aliases).toHaveLength(1);
});

test("同一实体牌但不同比较语义不得合并", () => {
  const groups = canonicalizeSemanticCandidates([
    play("normal-bomb", [4, 8]),
    play("normal-bomb", [4, 9])
  ]);
  expect(groups[0].semanticCandidates).toHaveLength(2);
});

test("同一实体牌但不同牌型不得合并", () => {
  const groups = canonicalizeSemanticCandidates([
    play("normal-bomb", [4, 8]),
    play("straight-flush", [8])
  ]);
  expect(groups[0].semanticCandidates).toHaveLength(2);
});
