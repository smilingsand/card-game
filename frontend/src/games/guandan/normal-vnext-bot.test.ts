import { expect, test } from "vitest";
import {
  analyzeNextSeatEndgameThreat,
  analyzeNormalVNextHand,
  chooseNormalVNextBotAction,
  describeNormalVNextAction
} from "./normal-vnext-bot";
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

const pair = (ids: readonly string[], key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: { type: "pair", comparisonKey: [key], cardIds: [...ids], wildcardAs: {} }
});

const normalBomb = (ids: readonly string[], key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: { type: "normal-bomb", comparisonKey: [key], cardIds: [...ids], wildcardAs: {} }
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

test("B：对手剩余 5 张时，三张拆分的有限成本可用于争牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [card("seven-1", "7"), card("seven-2", "7"), card("seven-3", "7")],
        legalActions: [pass, splitTriple],
        remainingCardCounts: { east: 3, south: 5, west: 8, north: 8 }
      })
    )?.action
  ).toBe(splitTriple);
});

test("B：轻量手牌分析只从 BotView 统计结构与控制资源", () => {
  const analysis = analyzeNormalVNextHand(
    baseView({
      selfHand: [
        card("3a", "3"),
        card("3b", "3"),
        card("4a", "4"),
        card("4b", "4"),
        card("4c", "4"),
        card("5a", "5"),
        card("5b", "5"),
        card("5c", "5"),
        card("5d", "5"),
        { ...card("wild", "2"), suit: "hearts" },
        card("ace", "A"),
        card("joker", "small-joker")
      ]
    })
  );

  expect(analysis).toMatchObject({
    pairs: 1,
    triples: 1,
    bombs: 1,
    wildcardCount: 1,
    controlCards: 3
  });
});

test("C1：responseCost 合同保持 A/B 权重与稳定 tie-break", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const seven = single("seven", 7);
  const eight = single("eight", 8);
  const view = baseView({
    selfHand: [card("seven", "7"), card("eight", "8")],
    legalActions: [pass, eight, seven]
  });
  const cost = describeNormalVNextAction(seven, view);
  expect(cost).toMatchObject({ rankCost: 7, structureDamageCost: 0, controlResourceCost: 0, wildcardOpportunityCost: 0, responseCost: 7 });
  const first = chooseNormalVNextBotAction(view);
  const second = chooseNormalVNextBotAction(view);
  expect(first?.action).toBe(seven);
  expect(second).toEqual(first);
});

test("下家剩 1 张时，领出不以小单张给其顺牌", () => {
  const low = single("four", 4);
  const high = single("ace", 14);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: undefined,
      selfHand: [card("four", "4"), card("ace", "A")],
      legalActions: [low, high],
      remainingCardCounts: { east: 2, south: 8, west: 8, north: 1 }
    })
  );

  expect(decision?.action).toBe(high);
});

test("下家剩 2 张且可能成对时，领出对子选择更大牌点", () => {
  const low = pair(["four-a", "four-b"], 4);
  const high = pair(["king-a", "king-b"], 13);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [card("four-a", "4"), card("four-b", "4"), card("king-a", "K"), card("king-b", "K")],
        legalActions: [low, high],
        remainingCardCounts: { east: 4, south: 8, west: 8, north: 2 }
      })
    )?.action
  ).toBe(high);
});

test("下家剩 4、5 张时公开推测包含炸弹与三带二风险", () => {
  const four = analyzeNextSeatEndgameThreat(
    baseView({ remainingCardCounts: { east: 3, south: 8, west: 8, north: 4 } })
  );
  const five = analyzeNextSeatEndgameThreat(
    baseView({ remainingCardCounts: { east: 3, south: 8, west: 8, north: 5 } })
  );
  expect(four.likelyPatternTypes).toContain("normal-bomb");
  expect(five.likelyPatternTypes).toEqual(expect.arrayContaining(["normal-bomb", "three-with-pair"]));
});

test("下家剩 4 张疑似炸弹时，不以弱单张开路", () => {
  const low = single("four", 4);
  const high = single("king", 13);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [card("four", "4"), card("king", "K")],
        legalActions: [low, high],
        remainingCardCounts: { east: 2, south: 8, west: 8, north: 4 }
      })
    )?.action
  ).toBe(high);
});

test("下家剩 5 张时，三带二风险下优先出较大主三张", () => {
  const low = threeWithPair(["five-a", "five-b", "five-c", "three-a", "three-b"], 5);
  const high = threeWithPair(["ten-a", "ten-b", "ten-c", "four-a", "four-b"], 10);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [
          card("five-a", "5"), card("five-b", "5"), card("five-c", "5"), card("three-a", "3"), card("three-b", "3"),
          card("ten-a", "10"), card("ten-b", "10"), card("ten-c", "10"), card("four-a", "4"), card("four-b", "4")
        ],
        legalActions: [low, high],
        remainingCardCounts: { east: 10, south: 8, west: 8, north: 5 }
      })
    )?.action
  ).toBe(high);
});

test("下家剩 3 张时可拆自己的炸弹夺回牌权", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const bomb = normalBomb(["seven-a", "seven-b", "seven-c", "seven-d"], 7);
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [
        card("seven-a", "7"), card("seven-b", "7"), card("seven-c", "7"), card("seven-d", "7"), card("other", "4")
      ],
      legalActions: [pass, bomb],
      remainingCardCounts: { east: 5, south: 8, west: 8, north: 3 }
    })
  );
  expect(decision?.action).toBe(bomb);
  expect(decision?.reasons).toContain("next-seat forced block: 3 cards");
});

test("普通中局不会错误触发下家尾局领牌策略", () => {
  const low = single("four", 4);
  const high = single("ace", 14);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [card("four", "4"), card("ace", "A")],
        legalActions: [low, high],
        remainingCardCounts: { east: 2, south: 8, west: 8, north: 7 }
      })
    )?.action
  ).toBe(low);
});

test("下家即将走完但无可压制牌时，仍返回合法 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  expect(
    chooseNormalVNextBotAction(
      baseView({
        legalActions: [pass],
        remainingCardCounts: { east: 3, south: 8, west: 8, north: 1 }
      })
    )?.action
  ).toBe(pass);
});

test("尾局阻断没有可选候选时，回退到合法 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  expect(
    chooseNormalVNextBotAction(
      baseView({
        legalActions: [pass],
        remainingCardCounts: { east: 3, south: 8, west: 8, north: 3 }
      })
    )?.action
  ).toBe(pass);
});

test("尾局领牌没有理想阻断牌时，仍选择规则层提供的合法出牌", () => {
  const onlyPlay = single("four", 4);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [card("four", "4")],
        legalActions: [onlyPlay],
        remainingCardCounts: { east: 1, south: 8, west: 8, north: 1 }
      })
    )?.action
  ).toBe(onlyPlay);
});
