import { describe, expect, test } from "vitest";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { HandAnalysisCache, createHandAnalysisFingerprint } from "./hand-analysis-cache";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import { generateHandPlans } from "./hand-plan-generator";

const budget = { handPlanTopN: { default: 4, max: 4 } } as const;
const fixtureById = (id: string) => {
  const fixture = EXPERT_SCENARIOS.find((item) => item.id === id);
  if (!fixture) throw new Error(`missing fixture ${id}`);
  return fixture;
};

describe("HandAnalysisCache", () => {
  test("相同完整实体手牌、级牌、规则版本只分析一次且逐字段等价", () => {
    const fixture = fixtureById("S47");
    const cache = new HandAnalysisCache(2);
    const input = {
      hand: fixture.selfHand,
      levelRank: fixture.levelRank,
      rulesVersion: "guandan-v5"
    } as const;
    const first = cache.structure(input);
    const second = cache.structure({ ...input, hand: [...input.hand].reverse() });
    const cold = analyzeHandStructure(input.hand, input.levelRank);

    expect(second).toBe(first);
    expect(second).toEqual(cold);
    expect(Object.isFrozen(first)).toBe(true);
    expect(cache.statistics().structure).toMatchObject({ hits: 1, misses: 1, size: 1 });
  });

  test("HandPlan key 隔离预算和规则版本，并精确复用相同配置", () => {
    const fixture = fixtureById("S48");
    const cache = new HandAnalysisCache(4);
    const structure = cache.structure({
      hand: fixture.selfHand,
      levelRank: fixture.levelRank,
      rulesVersion: "guandan-v5"
    });
    const first = cache.handPlans({
      structure,
      performanceBudget: budget,
      rulesVersion: "guandan-v5"
    });
    const second = cache.handPlans({
      structure,
      performanceBudget: budget,
      rulesVersion: "guandan-v5"
    });
    const changedVersion = cache.handPlans({
      structure,
      performanceBudget: budget,
      rulesVersion: "guandan-v6"
    });

    expect(second).toBe(first);
    expect(first).toEqual(generateHandPlans({ structure, performanceBudget: budget }));
    expect(changedVersion).toEqual(first);
    expect(cache.statistics().handPlan).toMatchObject({ hits: 1, misses: 2, size: 2 });
  });

  test("实体身份和 LRU 驱逐可观察，不能按点数错误共享", () => {
    const fixture = fixtureById("S47");
    const cache = new HandAnalysisCache(1);
    const first = {
      hand: fixture.selfHand,
      levelRank: fixture.levelRank,
      rulesVersion: "guandan-v5"
    } as const;
    const changedIdentity = {
      ...first,
      hand: first.hand.map((card, index) =>
        index === 0 ? { ...card, id: `${card.id}-other` } : card
      )
    };
    expect(createHandAnalysisFingerprint(first)).not.toBe(
      createHandAnalysisFingerprint(changedIdentity)
    );
    cache.structure(first);
    cache.structure(changedIdentity);
    expect(cache.statistics().structure).toMatchObject({ evictions: 1, size: 1 });
  });
});
