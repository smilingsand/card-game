import { expect, test } from "vitest";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import type { Card } from "../../../platform/types";

const scenario = (id: string) => {
  const value = EXPERT_SCENARIOS.find((item) => item.id === id);
  if (!value) throw new Error(`missing fixture ${id}`);
  return value;
};

test("S01 区分天然对子与红桃级牌补成的对子", () => {
  const fixture = scenario("S01");
  const result = analyzeHandStructure(fixture.selfHand, fixture.levelRank);

  expect(result.groups).toContainEqual(
    expect.objectContaining({
      kind: "pair",
      source: "natural",
      cardIds: ["s01-0", "s01-1"]
    })
  );
  expect(result.groups).toContainEqual(
    expect.objectContaining({
      kind: "pair",
      source: "wildcard_completed",
      cardIds: ["s01-4", "s01-5"]
    })
  );
  expect(result.control.wildcardCardIds).toEqual(["s01-4"]);
});

test("S03 保护天然四炸，并标出两张逢人配制造的小四炸", () => {
  const fixture = scenario("S03");
  const result = analyzeHandStructure(fixture.selfHand, fixture.levelRank);

  expect(result.groups).toContainEqual(
    expect.objectContaining({
      kind: "normal-bomb",
      source: "natural",
      cardIds: ["s03-0", "s03-1", "s03-2", "s03-3"]
    })
  );
  expect(result.groups).toContainEqual(
    expect.objectContaining({
      kind: "normal-bomb",
      source: "wildcard_completed",
      cardIds: ["s03-4", "s03-5", "s03-6", "s03-7"]
    })
  );
});

test("S11 把天然四炸中的单张标记为拆已有组合，而不把它当作散单", () => {
  const fixture = scenario("S11");
  const result = analyzeHandStructure(fixture.selfHand, fixture.levelRank);

  expect(result.groups).toContainEqual(
    expect.objectContaining({
      kind: "single",
      source: "split_from_existing_group",
      cardIds: ["s11-0"]
    })
  );
  expect(result.loose.singleCardIds).toEqual(["s11-4", "s11-5"]);
});

test("S47/S48 识别连对、钢板、顺子、同花顺和四王炸", () => {
  const s47 = scenario("S47");
  const s48 = scenario("S48");

  expect(analyzeHandStructure(s47.selfHand, s47.levelRank).groups.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["three-consecutive-pairs", "steel-plate", "straight"])
  );
  expect(analyzeHandStructure(s48.selfHand, s48.levelRank).groups.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["straight-flush", "four-jokers"])
  );
});

test("覆盖三张、三带二、低散单、弱对子及控制和回收资源", () => {
  const hand: readonly Card[] = [
    ["t0", "A", "spades"],
    ["t1", "A", "clubs"],
    ["t2", "A", "diamonds"],
    ["t3", "K", "spades"],
    ["t4", "K", "clubs"],
    ["t5", "3", "spades"],
    ["t6", "4", "clubs"],
    ["t7", "2", "hearts"]
  ].map(([id, rank, suit], deckIndex) => ({ id, deckIndex, rank, suit })) as readonly Card[];
  const result = analyzeHandStructure(hand, "2");

  expect(result.groups.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["triple", "three-with-pair"])
  );
  expect(result.loose.lowSingleCardIds).toEqual(["t5", "t6"]);
  expect(result.loose.weakPairCardIds).toEqual([]);
  expect(result.control).toMatchObject({
    levelCardIds: ["t7"],
    wildcardCardIds: ["t7"],
    aceCardIds: ["t0", "t1", "t2"],
    highPairCardIds: ["t0", "t1", "t3", "t4"],
    highTripleCardIds: ["t0", "t1", "t2"]
  });
  expect(result.recoveryCardIds).toEqual(expect.arrayContaining(["t0", "t1", "t2", "t3", "t4"]));
});

test("分析稳定、不会修改输入，且契约不接收任何隐藏手牌", () => {
  const fixture = scenario("S01");
  const before = structuredClone(fixture.selfHand);
  const first = analyzeHandStructure(fixture.selfHand, fixture.levelRank);
  const second = analyzeHandStructure(fixture.selfHand, fixture.levelRank);

  expect(fixture.selfHand).toEqual(before);
  expect(second).toEqual(first);
  expect(first.fingerprint).toBe(second.fingerprint);
  expect("opponentHand" in first).toBe(false);
});
