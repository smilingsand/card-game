// Shared Guandan core test.
import { expect, test } from "vitest";
import { cloneValue } from "./structured-clone";

test("运行时提供结构化克隆，且保留输入类型", () => {
  const source = { cards: ["south-1"], nested: { turn: 2 } } as const;
  const clone = cloneValue(source);

  expect(clone).toEqual(source);
  expect(clone).not.toBe(source);
  expect(clone.nested).not.toBe(source.nested);
});
