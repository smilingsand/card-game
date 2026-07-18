import { expect, test } from "vitest";
import { chooseNormalVNextBotAction } from "./normal-vnext-bot";
import type { Card } from "../../platform/types";
import type { TurnAction } from "./turns";

const card = (id: string, rank: Card["rank"]): Card => ({
  id,
  deckIndex: 0,
  suit: rank.includes("joker") ? "joker" : "spades",
  rank
});

const single = (id: string, key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [id],
  interpretation: { type: "single", comparisonKey: [key], cardIds: [id], wildcardAs: {} }
});

const threeWithPair = (ids: readonly string[], mainKey: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type: "three-with-pair",
    comparisonKey: [mainKey],
    cardIds: [...ids],
    wildcardAs: {}
  }
});

const baseView = (overrides: Record<string, unknown> = {}) => ({
  selfSeat: "east" as const,
  leader: "south" as const,
  highestSeat: "south" as const,
  levelRank: "2" as const,
  selfHand: [card("four", "4"), card("ace", "A"), card("little", "small-joker")],
  publicEvents: [],
  remainingCardCounts: { east: 3, south: 8, west: 8, north: 8 },
  legalActions: [] as TurnAction[],
  ...overrides
});

test("normal-vNext：敌方持权时以最低普通单张压制并保留 A 与王", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);
  const ace = single("ace", 14);
  const littleJoker = single("little", 16);

  const decision = chooseNormalVNextBotAction(
    baseView({ legalActions: [pass, ace, littleJoker, low] })
  );

  expect(decision?.action).toBe(low);
});

test("normal-vNext：没有低单时保留规则不阻止使用 A", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ace = single("ace", 14);
  const littleJoker = single("little", 16);

  expect(
    chooseNormalVNextBotAction(baseView({ legalActions: [pass, littleJoker, ace] }))?.action
  ).toBe(ace);
});

test("normal-vNext：直接出完时可以使用 A", () => {
  const ace = single("ace", 14);
  const decision = chooseNormalVNextBotAction(
    baseView({ selfHand: [card("ace", "A")], legalActions: [ace] })
  );

  expect(decision?.action).toBe(ace);
  expect(decision?.reasons).toContain("直接出完例外");
});

test("normal-vNext：队友持权时默认 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);

  expect(
    chooseNormalVNextBotAction(baseView({ highestSeat: "west", legalActions: [pass, low] }))?.action
  ).toBe(pass);
});

test("normal-vNext：对手持权不会错误触发队友让牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);

  expect(chooseNormalVNextBotAction(baseView({ legalActions: [pass, low] }))?.action).toBe(low);
});

test("normal-vNext：队友持权但可直接出完时接管", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const runout = threeWithPair(["t1", "t2", "t3", "p1", "p2"], 8);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: "west",
      selfHand: [
        card("t1", "8"),
        card("t2", "8"),
        card("t3", "8"),
        card("p1", "3"),
        card("p2", "3")
      ],
      legalActions: [pass, runout]
    })
  );

  expect(decision?.action).toBe(runout);
  expect(decision?.reasons).toContain("直接出完例外");
});

test("normal-vNext：三带二先选最小主三张", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const smallerMain = threeWithPair(["m1", "m2", "m3", "high1", "high2"], 6);
  const largerMain = threeWithPair(["l1", "l2", "l3", "low1", "low2"], 9);
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [
        card("m1", "6"),
        card("m2", "6"),
        card("m3", "6"),
        card("high1", "A"),
        card("high2", "A"),
        card("l1", "9"),
        card("l2", "9"),
        card("l3", "9"),
        card("low1", "3"),
        card("low2", "3")
      ],
      legalActions: [pass, largerMain, smallerMain]
    })
  );

  expect(decision?.action).toBe(smallerMain);
});

test("normal-vNext：同主三张时选择最低资源成本附带对子", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const lowPair = threeWithPair(["t1", "t2", "t3", "low1", "low2"], 8);
  const highPair = threeWithPair(["t1", "t2", "t3", "high1", "high2"], 8);
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [
        card("t1", "8"),
        card("t2", "8"),
        card("t3", "8"),
        card("low1", "3"),
        card("low2", "3"),
        card("high1", "A"),
        card("high2", "A"),
        card("extra", "4")
      ],
      legalActions: [pass, highPair, lowPair]
    })
  );

  expect(decision?.action).toBe(lowPair);
});

test("normal-vNext：只有一种三带二时不会拒绝唯一合法压制", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const only = threeWithPair(["t1", "t2", "t3", "p1", "p2"], 9);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("t1", "9"),
          card("t2", "9"),
          card("t3", "9"),
          card("p1", "A"),
          card("p2", "A"),
          card("x", "4")
        ],
        legalActions: [pass, only]
      })
    )?.action
  ).toBe(only);
});

test.each([1, 2, 3])("normal-vNext：对手剩余 %i 张时确定性阻断", (remaining) => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);
  const decision = chooseNormalVNextBotAction(
    baseView({
      legalActions: [pass, low],
      remainingCardCounts: { east: 3, south: remaining, west: 8, north: 8 }
    })
  );

  expect(decision?.action).toBe(low);
  expect(decision?.reasons).toContain("阻断对手 1～3 张残局");
});

test("normal-vNext：对手剩余四张时不标记为 1～3 张阻断", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);
  const decision = chooseNormalVNextBotAction(
    baseView({
      legalActions: [pass, low],
      remainingCardCounts: { east: 3, south: 4, west: 8, north: 8 }
    })
  );

  expect(decision?.reasons).not.toContain("阻断对手 1～3 张残局");
});

test("normal-vNext：对手尾局且队友持权时，直接出完例外仍优先", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const runout = single("ace", 14);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: "west",
      selfHand: [card("ace", "A")],
      legalActions: [pass, runout],
      remainingCardCounts: { east: 1, south: 2, west: 8, north: 8 }
    })
  );

  expect(decision?.action).toBe(runout);
  expect(decision?.reasons).toContain("直接出完例外");
});

test("A：对手出 6 时，777 与独立 8 并存应出独立 8", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);
  const independentEight = single("eight", 8);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("seven-1", "7"),
          card("seven-2", "7"),
          card("seven-3", "7"),
          card("eight", "8")
        ],
        legalActions: [pass, splitTriple, independentEight]
      })
    )?.action
  ).toBe(independentEight);
});

test("A：普通中局只有 777 能压单张 6 时允许 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [card("seven-1", "7"), card("seven-2", "7"), card("seven-3", "7")],
        legalActions: [pass, splitTriple]
      })
    )?.action
  ).toBe(pass);
});

test("A：对手仅剩 1 张时只有 777 能压单张 6，允许拆牌阻断", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [card("seven-1", "7"), card("seven-2", "7"), card("seven-3", "7")],
        legalActions: [pass, splitTriple],
        remainingCardCounts: { east: 3, south: 1, west: 8, north: 8 }
      })
    )?.action
  ).toBe(splitTriple);
});

test("A：普通中局不拆炸弹、钢板或完整连对来接小单", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitBomb = single("bomb-1", 7);
  const splitSteel = single("steel-1", 8);
  const splitPairs = single("pair-1", 5);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("bomb-1", "7"),
          card("bomb-2", "7"),
          card("bomb-3", "7"),
          card("bomb-4", "7")
        ],
        legalActions: [pass, splitBomb]
      })
    )?.action
  ).toBe(pass);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("steel-1", "8"),
          card("steel-2", "8"),
          card("steel-3", "8"),
          card("steel-4", "9"),
          card("steel-5", "9"),
          card("steel-6", "9")
        ],
        legalActions: [pass, splitSteel]
      })
    )?.action
  ).toBe(pass);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("pair-1", "5"),
          card("pair-2", "5"),
          card("pair-3", "6"),
          card("pair-4", "6"),
          card("pair-5", "7"),
          card("pair-6", "7")
        ],
        legalActions: [pass, splitPairs]
      })
    )?.action
  ).toBe(pass);
});
