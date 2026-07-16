import { expect, test } from "vitest";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import { generateHandPlans, type HandPlanRole } from "./hand-plan-generator";

const budget = { handPlanTopN: { default: 8, max: 16 } } as const;

const fixture = (id: string) => {
  const value = EXPERT_SCENARIOS.find((item) => item.id === id);
  if (!value) throw new Error(`missing fixture ${id}`);
  return value;
};

const plansFor = (id: string, role?: HandPlanRole) => {
  const value = fixture(id);
  return generateHandPlans({
    structure: analyzeHandStructure(value.selfHand, value.levelRank),
    performanceBudget: budget,
    role
  });
};

test("S01/S03/S11 生成四类完整、稳定的整手方案，并保护天然结构和逢人配机会", () => {
  for (const id of ["S01", "S03", "S11"]) {
    const value = fixture(id);
    const structure = analyzeHandStructure(value.selfHand, value.levelRank);
    const first = generateHandPlans({
      structure,
      performanceBudget: budget
    });
    const second = generateHandPlans({
      structure,
      performanceBudget: budget
    });

    expect(first).toEqual(second);
    expect(first.map((plan) => plan.kind)).toEqual([
      "best_structure",
      "minimum_turns",
      "conservative_control",
      "team_support"
    ]);
    for (const plan of first) {
      const assigned = plan.groups.flatMap((group) => group.cardIds);
      expect(new Set(assigned).size).toBe(value.selfHand.length);
      expect(assigned.slice().sort()).toEqual(
        value.selfHand.map(({ id: cardId }) => cardId).sort()
      );
      expect(plan.metrics).toMatchObject({
        estimatedTurns: expect.any(Number),
        structuralIntegrity: expect.any(Number),
        finishability: expect.any(Number),
        deadHandRisk: expect.any(Number)
      });
    }
  }

  const s03 = plansFor("S03")[0];
  expect(s03.metrics.naturalBombCount).toBeGreaterThan(0);
  expect(s03.metrics.wildcardUsage.count).toBeLessThan(2);
  expect(
    s03.groups.some((group) => group.kind === "normal-bomb" && group.source === "natural")
  ).toBe(true);
});

test("S21/S47/S48 输出低散单、控制/回收与不同 role 的可解释指标", () => {
  expect(plansFor("S21")[0].metrics.lowSingleCount).toBeGreaterThanOrEqual(0);
  expect(plansFor("S21")[0].metrics.deadHandRisk).toBeGreaterThanOrEqual(0);
  expect(plansFor("S21")[0].metrics.control.cardIds.length).toBeGreaterThan(0);
  expect(
    plansFor("S47")
      .flatMap((plan) => plan.groups)
      .map((group) => group.kind)
  ).toEqual(expect.arrayContaining(["steel-plate"]));
  expect(plansFor("S48")[0].metrics.control.cardIds.length).toBeGreaterThan(0);
  expect(plansFor("S48", "support")[3].metrics.roleFit).toBeGreaterThanOrEqual(0);
});

test("Top-N 由已验证的可注入预算提供，四类方案不能被裁剪，且不修改输入", () => {
  const value = fixture("S47");
  const structure = analyzeHandStructure(value.selfHand, value.levelRank);
  const before = structuredClone(structure);

  for (const validBudget of [
    { handPlanTopN: { default: 4, max: 4 } },
    { handPlanTopN: { default: 8, max: 16 } }
  ])
    expect(generateHandPlans({ structure, performanceBudget: validBudget })).toHaveLength(4);
  expect(() =>
    generateHandPlans({
      structure,
      performanceBudget: { handPlanTopN: { default: 3, max: 16 } }
    })
  ).toThrow(/四类/);
  expect(structure).toEqual(before);
});
