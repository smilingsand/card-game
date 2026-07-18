import { expect, test } from "vitest";
import {
  DecisionCache,
  createDecisionFingerprint,
  evaluateWithBoundedEarlyStop
} from "./decision-cache";

test("完整指纹的每个语义字段变化都会生成不同缓存键", () => {
  const base = {
    view: {
      selfSeat: "east" as const,
      selfHand: [{ id: "card-2", rank: "2" as const, suit: "spades" as const, deckIndex: 0 }],
      levelRank: "2" as const,
      publicEvents: [{ sequence: 1, type: "turn", payload: { action: "a" } }],
      remainingCardCounts: { east: 1, south: 2, west: 3, north: 4 },
      leader: "east" as const,
      highestSeat: "south" as const
    },
    currentWinningPlaySummary: "winner-a",
    legalActionSummary: "legal-a",
    profile: { id: "expert", version: "1", rulesVersion: "r1", weightsVersion: "w1" }
  };
  const key = createDecisionFingerprint(base);
  const variants = [
    { ...base, view: { ...base.view, selfSeat: "south" as const } },
    { ...base, view: { ...base.view, selfHand: [{ ...base.view.selfHand[0], id: "other" }] } },
    { ...base, view: { ...base.view, levelRank: "3" as const } },
    {
      ...base,
      view: {
        ...base.view,
        publicEvents: [{ sequence: 2, type: "turn", payload: { action: "a" } }]
      }
    },
    {
      ...base,
      view: { ...base.view, remainingCardCounts: { ...base.view.remainingCardCounts, west: 4 } }
    },
    { ...base, view: { ...base.view, leader: "south" as const } },
    { ...base, view: { ...base.view, highestSeat: "west" as const } },
    { ...base, currentWinningPlaySummary: "winner-b" },
    { ...base, legalActionSummary: "legal-b" },
    { ...base, profile: { ...base.profile, version: "2" } },
    { ...base, profile: { ...base.profile, rulesVersion: "r2" } },
    { ...base, profile: { ...base.profile, weightsVersion: "w2" } }
  ];
  expect(variants.map((value) => createDecisionFingerprint(value))).not.toContain(key);
});

const fingerprint = (eventSequence: number) =>
  createDecisionFingerprint({
    view: {
      selfSeat: "east",
      selfHand: [{ id: "card-2", rank: "2", suit: "spades", deckIndex: 0 }],
      levelRank: "2",
      publicEvents: eventSequence ? [{ sequence: eventSequence, type: "turn", payload: {} }] : [],
      remainingCardCounts: { east: 1, south: 2, west: 3, north: 4 },
      leader: "east"
    },
    profile: { id: "expert", version: "1", rulesVersion: "r1", weightsVersion: "w1" }
  });

test("完整决策指纹在公开事件变化时失效，缓存统计和容量可审计", () => {
  const cache = new DecisionCache<string>(1);
  const first = fingerprint(1),
    second = fingerprint(2);
  cache.set(first, "first");
  expect(cache.get(first)).toBe("first");
  expect(cache.get(second)).toBeUndefined();
  cache.set(second, "second");
  expect(cache.get(first)).toBeUndefined();
  cache.invalidate(second);
  expect(cache.statistics()).toEqual({
    hits: 1,
    misses: 2,
    evictions: 1,
    invalidations: 1,
    size: 0
  });
});

test("early stop 只在严格上下界证明后发生，稳定排序不依赖墙钟", () => {
  const result = evaluateWithBoundedEarlyStop({
    items: [
      { id: "b", quality: 1, upperBound: 4, value: "b" },
      { id: "a", quality: 1, upperBound: 3, value: "a" }
    ],
    evaluate: (value) => ({ value, lowerBound: value === "a" ? 5 : 1 })
  });
  expect(result).toEqual({
    evaluated: ["a"],
    reason: "bound_proven",
    bestLowerBound: 5,
    remainingUpperBound: 4
  });
});
