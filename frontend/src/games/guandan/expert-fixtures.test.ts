import { expect, test } from "vitest";
import { EXPERT_SCENARIOS, validateExpertFixtures } from "./expert-fixtures";

test("P2.5A 专家固定牌例满足 schema、唯一性和覆盖契约", () => {
  expect(validateExpertFixtures()).toEqual([]);
  expect(EXPERT_SCENARIOS.map(({ id }) => id)).toEqual(
    Array.from({ length: 50 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`)
  );
});

test("八个阻断反例有明确推荐和拒绝动作", () => {
  for (const id of ["S01", "S03", "S11", "S18", "S21", "S31", "S34", "S39"])
    expect(
      EXPERT_SCENARIOS.find((scenario) => scenario.id === id)?.rejected.length
    ).toBeGreaterThan(0);
});

test("候选覆盖牌例含可机器验证的指定牌型", () => {
  const patterns = (id: string) =>
    EXPERT_SCENARIOS.find((scenario) => scenario.id === id)?.candidateExpectations.map(
      ({ pattern }) => pattern
    );
  expect(patterns("S47")).toEqual(["three-consecutive-pairs", "steel-plate", "straight"]);
  expect(patterns("S48")).toEqual(["pair", "straight-flush", "joker-bomb"]);
});
