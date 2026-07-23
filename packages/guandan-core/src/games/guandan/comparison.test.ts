// Shared Guandan core test.
import { expect, test } from "vitest";
import { canFollow, compareInterpretations } from "./comparison";
import type { PatternInterpretation } from "./patterns";
const p = (
  type: PatternInterpretation["type"],
  comparisonKey: readonly number[],
  count = 1,
): PatternInterpretation => ({
  type,
  comparisonKey,
  cardIds: Array.from({ length: count }, (_, i) => `${i}`),
  wildcardAs: {},
});
test("固定层级与同型比较", () => {
  expect(
    compareInterpretations(
      p("normal-bomb", [6, 3], 6),
      p("straight-flush", [14], 5),
    ),
  ).toEqual({ ok: true, result: "greater" });
  expect(
    compareInterpretations(
      p("straight-flush", [14], 5),
      p("normal-bomb", [5, 15], 5),
    ),
  ).toEqual({ ok: true, result: "greater" });
  expect(
    compareInterpretations(
      p("four-jokers", [4], 4),
      p("normal-bomb", [10, 15], 10),
    ),
  ).toEqual({
    ok: true,
    result: "greater",
  });
  expect(compareInterpretations(p("pair", [8], 2), p("pair", [7], 2))).toEqual({
    ok: true,
    result: "greater",
  });
});
test("跟牌拒绝不可比较、相等、张数不一致", () => {
  expect(canFollow(p("pair", [8], 2), p("pair", [7], 2))).toBe(true);
  expect(canFollow(p("pair", [7], 2), p("pair", [7], 2))).toBe(false);
  expect(canFollow(p("straight", [8], 5), p("pair", [7], 2))).toBe(false);
});
test("可比较结果满足反对称、相等对称且 canFollow 等价于 greater", () => {
  const set = [
    p("single", [3]),
    p("single", [7]),
    p("single", [15]),
    p("normal-bomb", [4, 3], 4),
    p("straight-flush", [12], 5),
    p("normal-bomb", [6, 3], 6),
  ];
  for (const left of set)
    for (const right of set) {
      const forward = compareInterpretations(left, right),
        backward = compareInterpretations(right, left);
      if (forward.ok && backward.ok) {
        expect(["greater", "equal", "less"]).toContain(forward.result);
        expect(backward.result).toBe(
          forward.result === "greater"
            ? "less"
            : forward.result === "less"
              ? "greater"
              : "equal",
        );
        expect(canFollow(left, right)).toBe(forward.result === "greater");
      }
    }
});
test("代表性解释集合中的 greater 关系具有传递性", () => {
  const ordered = [
    p("single", [3]),
    p("single", [7]),
    p("single", [15]),
    p("normal-bomb", [4, 3], 4),
    p("straight-flush", [12], 5),
    p("normal-bomb", [6, 3], 6),
    p("four-jokers", [4], 4),
  ];
  for (let low = 0; low < ordered.length; low += 1)
    for (let middle = low + 1; middle < ordered.length; middle += 1)
      for (let high = middle + 1; high < ordered.length; high += 1) {
        expect(
          compareInterpretations(ordered[middle], ordered[low]),
        ).toMatchObject({
          ok: true,
          result: "greater",
        });
        expect(
          compareInterpretations(ordered[high], ordered[middle]),
        ).toMatchObject({
          ok: true,
          result: "greater",
        });
        expect(
          compareInterpretations(ordered[high], ordered[low]),
        ).toMatchObject({
          ok: true,
          result: "greater",
        });
      }
});
