// Shared Guandan core test.
import { expect, test } from "vitest";
import {
  analyzeNextSeatEndgameThreat,
  analyzeNormalVNextHand,
  chooseNormalVNextBotAction,
  describeNormalVNextContest,
  describeNormalVNextAction,
  describeNormalVNextBombEconomics,
  analyzeCooperationSignal,
  estimateNormalVNextSelfRoute,
  scoreNormalVNextCandidate,
} from "./normal-vnext-bot";
import type { Card } from "../../platform/types";
import type { TurnAction } from "./turns";

const card = (id: string, rank: Card["rank"]): Card => ({
  id,
  deckIndex: 0,
  suit: rank.includes("joker") ? "joker" : "spades",
  rank,
});

const single = (id: string, key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [id],
  interpretation: {
    type: "single",
    comparisonKey: [key],
    cardIds: [id],
    wildcardAs: {},
  },
});

const threeWithPair = (
  ids: readonly string[],
  mainKey: number,
): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type: "three-with-pair",
    comparisonKey: [mainKey],
    cardIds: [...ids],
    wildcardAs: {},
  },
});

const pair = (ids: readonly string[], key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type: "pair",
    comparisonKey: [key],
    cardIds: [...ids],
    wildcardAs: {},
  },
});

const triple = (ids: readonly string[], key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type: "triple",
    comparisonKey: [key],
    cardIds: [...ids],
    wildcardAs: {},
  },
});

const normalBomb = (ids: readonly string[], key: number): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type: "normal-bomb",
    comparisonKey: [key],
    cardIds: [...ids],
    wildcardAs: {},
  },
});

const pattern = (
  ids: readonly string[],
  type: Extract<TurnAction, { type: "play" }>["interpretation"]["type"],
  key: number,
): TurnAction => ({
  type: "play",
  actor: "east",
  cardIds: [...ids],
  interpretation: {
    type,
    comparisonKey: [key],
    cardIds: [...ids],
    wildcardAs: {},
  },
});

const baseView = (overrides: Record<string, unknown> = {}) => ({
  selfSeat: "east" as const,
  leader: "south" as const,
  highestSeat: "south" as const,
  levelRank: "2" as const,
  selfHand: [
    card("four", "4"),
    card("ace", "A"),
    card("little", "small-joker"),
  ],
  publicEvents: [],
  remainingCardCounts: { east: 3, south: 8, west: 8, north: 8 },
  legalActions: [] as TurnAction[],
  ...overrides,
});

test("normal-vNext：敌方持权时以最低普通单张压制并保留 A 与王", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);
  const ace = single("ace", 14);
  const littleJoker = single("little", 16);

  const decision = chooseNormalVNextBotAction(
    baseView({ legalActions: [pass, ace, littleJoker, low] }),
  );

  expect(decision?.action).toBe(low);
});

test("P7-12：大量配牌投影的三带二跟牌仍取最小普通压制", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ordinary = threeWithPair(
    ["seven-a", "seven-b", "seven-c", "three-a", "three-b"],
    7,
  );
  const wildcardVariants = Array.from({ length: 160 }, (_, index) => ({
    ...threeWithPair(
      ["eight-a", "eight-b", "heart-level", "four-a", "four-b"],
      8,
    ),
    interpretation: {
      type: "three-with-pair" as const,
      comparisonKey: [8],
      cardIds: ["eight-a", "eight-b", "heart-level", "four-a", "four-b"],
      wildcardAs: {
        "heart-level": {
          rank: "8" as const,
          suit: (["spades", "hearts", "diamonds", "clubs"] as const)[index % 4],
        },
      },
    },
  }));
  const view = baseView({
    selfHand: [
      card("seven-a", "7"),
      card("seven-b", "7"),
      card("seven-c", "7"),
      card("three-a", "3"),
      card("three-b", "3"),
      card("eight-a", "8"),
      card("eight-b", "8"),
      { ...card("heart-level", "2"), suit: "hearts" },
      card("four-a", "4"),
      card("four-b", "4"),
    ],
    legalActions: [pass, ...wildcardVariants, ordinary],
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(ordinary);
});

test("P7-09：仅剩两个完整炸弹时，领出不拆成三带二留下四张散牌", () => {
  const fragmented = threeWithPair(
    ["seven-a", "seven-b", "seven-c", "three-a", "three-b"],
    7,
  );
  const sevenBomb = normalBomb(
    ["seven-a", "seven-b", "seven-c", "seven-d", "seven-e"],
    7,
  );
  const threeBomb = normalBomb(["three-a", "three-b", "three-c", "three-d"], 3);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: undefined,
      selfHand: [
        card("seven-a", "7"),
        card("seven-b", "7"),
        card("seven-c", "7"),
        card("seven-d", "7"),
        card("seven-e", "7"),
        card("three-a", "3"),
        card("three-b", "3"),
        card("three-c", "3"),
        card("three-d", "3"),
      ],
      legalActions: [fragmented, sevenBomb, threeBomb],
      remainingCardCounts: { east: 9, south: 12, west: 12, north: 12 },
    }),
  );

  expect(decision?.action).not.toBe(fragmented);
  expect(decision?.action).toBe(threeBomb);
});

test("P7-10：即使不是短手牌，领出也不为普通三带二拆开完整炸弹", () => {
  const fragmented = threeWithPair(
    ["seven-a", "seven-b", "seven-c", "three-a", "three-b"],
    7,
  );
  const sevenBomb = normalBomb(
    ["seven-a", "seven-b", "seven-c", "seven-d", "seven-e"],
    7,
  );
  const threeBomb = normalBomb(["three-a", "three-b", "three-c", "three-d"], 3);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: undefined,
      selfHand: [
        card("seven-a", "7"),
        card("seven-b", "7"),
        card("seven-c", "7"),
        card("seven-d", "7"),
        card("seven-e", "7"),
        card("three-a", "3"),
        card("three-b", "3"),
        card("three-c", "3"),
        card("three-d", "3"),
        card("four", "4"),
        card("five", "5"),
        card("six", "6"),
        card("eight", "8"),
      ],
      legalActions: [fragmented, sevenBomb, threeBomb],
      remainingCardCounts: { east: 13, south: 20, west: 20, north: 20 },
    }),
  );

  expect(decision?.action).not.toBe(fragmented);
  expect(decision?.action).toBe(threeBomb);
});

test("P7-13：领牌不以三连对同时拆开多副完整天然炸弹", () => {
  const consecutivePairs = pattern(
    ["four-a", "four-b", "five-a", "five-b", "six-a", "six-b"],
    "three-consecutive-pairs",
    6,
  );
  const fourBomb = normalBomb(
    ["four-a", "four-b", "four-c", "four-d", "four-e", "four-f"],
    4,
  );
  const fiveBomb = normalBomb(["five-a", "five-b", "five-c", "five-d"], 5);
  const sixBomb = normalBomb(["six-a", "six-b", "six-c", "six-d"], 6);
  const selfHand = [
    ...["a", "b", "c", "d", "e", "f"].map((suffix) =>
      card(`four-${suffix}`, "4"),
    ),
    ...["a", "b", "c", "d"].map((suffix) => card(`five-${suffix}`, "5")),
    ...["a", "b", "c", "d"].map((suffix) => card(`six-${suffix}`, "6")),
    card("other", "9"),
  ];
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfSeat: "west",
      leader: "west",
      highestSeat: undefined,
      selfHand,
      legalActions: [consecutivePairs, fourBomb, fiveBomb, sixBomb],
      remainingCardCounts: {
        east: selfHand.length,
        south: 5,
        west: 20,
        north: 20,
      },
    }),
  );

  expect(decision?.action).not.toBe(consecutivePairs);
  expect([fourBomb, fiveBomb, sixBomb]).toContain(decision?.action);
});

test("P7-10：拆炸后能减少至少两手路线时，允许以复合牌获得显著收益", () => {
  const straight = pattern(
    ["three", "four", "five", "six", "seven-a"],
    "straight",
    7,
  );
  const sevenBomb = normalBomb(["seven-a", "seven-b", "seven-c", "seven-d"], 7);
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: undefined,
      selfHand: [
        card("three", "3"),
        card("four", "4"),
        card("five", "5"),
        card("six", "6"),
        card("seven-a", "7"),
        card("seven-b", "7"),
        card("seven-c", "7"),
        card("seven-d", "7"),
      ],
      legalActions: [straight, sevenBomb],
      remainingCardCounts: { east: 8, south: 20, west: 20, north: 20 },
    }),
  );

  expect(decision?.action).toBe(straight);
});

test("P7-11：级牌对子可压过时，不把两张红桃级牌降配成普通对", () => {
  const nativeLevelPair: TurnAction = {
    type: "play",
    actor: "east",
    cardIds: ["heart-level-a", "heart-level-b"],
    interpretation: {
      type: "pair",
      comparisonKey: [15],
      cardIds: ["heart-level-a", "heart-level-b"],
      wildcardAs: {
        "heart-level-a": { rank: "2", suit: "hearts" },
        "heart-level-b": { rank: "2", suit: "hearts" },
      },
    },
  };
  const downgradedNinePair: TurnAction = {
    type: "play",
    actor: "east",
    cardIds: ["heart-level-a", "heart-level-b"],
    interpretation: {
      type: "pair",
      comparisonKey: [9],
      cardIds: ["heart-level-a", "heart-level-b"],
      wildcardAs: {
        "heart-level-a": { rank: "9", suit: "spades" },
        "heart-level-b": { rank: "9", suit: "hearts" },
      },
    },
  };
  const view = baseView({
    selfHand: [
      { ...card("heart-level-a", "2"), suit: "hearts" as const },
      { ...card("heart-level-b", "2"), suit: "hearts" as const },
    ],
    legalActions: [
      { type: "pass", actor: "east" },
      downgradedNinePair,
      nativeLevelPair,
    ],
    remainingCardCounts: { east: 2, south: 20, west: 20, north: 20 },
  });

  expect(
    scoreNormalVNextCandidate(nativeLevelPair, view)?.breakdown
      .wildcardOpportunityCost,
  ).toBe(420);
  expect(
    scoreNormalVNextCandidate(downgradedNinePair, view)?.breakdown
      .wildcardOpportunityCost,
  ).toBe(1_820);
  expect(chooseNormalVNextBotAction(view)?.action).toBe(nativeLevelPair);
});

test("P7-11：有普通对 9、10、K、A 时，以最低普通对压过对 8", () => {
  const nine = pair(["nine-a", "nine-b"], 9);
  const ten = pair(["ten-a", "ten-b"], 10);
  const king = pair(["king-a", "king-b"], 13);
  const ace = pair(["ace-a", "ace-b"], 14);
  const downgradedNinePair: TurnAction = {
    type: "play",
    actor: "east",
    cardIds: ["heart-level-a", "heart-level-b"],
    interpretation: {
      type: "pair",
      comparisonKey: [9],
      cardIds: ["heart-level-a", "heart-level-b"],
      wildcardAs: {
        "heart-level-a": { rank: "9", suit: "spades" },
        "heart-level-b": { rank: "9", suit: "hearts" },
      },
    },
  };
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [
        card("nine-a", "9"),
        card("nine-b", "9"),
        card("ten-a", "10"),
        card("ten-b", "10"),
        card("king-a", "K"),
        card("king-b", "K"),
        card("ace-a", "A"),
        card("ace-b", "A"),
        { ...card("heart-level-a", "2"), suit: "hearts" as const },
        { ...card("heart-level-b", "2"), suit: "hearts" as const },
      ],
      legalActions: [
        { type: "pass", actor: "east" },
        ace,
        downgradedNinePair,
        king,
        ten,
        nine,
      ],
      remainingCardCounts: { east: 10, south: 20, west: 20, north: 20 },
    }),
  );

  expect(decision?.action).toBe(nine);
});

test("P7-02：候选评分逐项公开成本、收益与可复核总分", () => {
  const low = single("four", 4);
  const heartLevel = single("heart-2", 15);
  const scoredView = baseView({
    selfHand: [
      card("four", "4"),
      { ...card("heart-2", "2"), suit: "hearts" as const },
    ],
    legalActions: [low, heartLevel],
  });

  const lowScore = scoreNormalVNextCandidate(low, scoredView);
  const heartScore = scoreNormalVNextCandidate(heartLevel, scoredView);

  expect(lowScore).toMatchObject({
    action: low,
    breakdown: {
      rankCost: 4,
      structureDamageCost: 0,
      controlResourceCost: 0,
      wildcardOpportunityCost: 0,
      handSheddingBenefit: 0,
      interceptionBenefit: 0,
      publicControlExposureBenefit: 0,
      selfRouteCost: -3,
      bombEconomicsBenefit: 0,
    },
  });
  expect(lowScore?.score).toBe(
    lowScore!.breakdown.rankCost +
      lowScore!.breakdown.structureDamageCost +
      lowScore!.breakdown.controlResourceCost +
      lowScore!.breakdown.wildcardOpportunityCost +
      lowScore!.breakdown.attachmentCost -
      lowScore!.breakdown.handSheddingBenefit -
      lowScore!.breakdown.interceptionBenefit -
      lowScore!.breakdown.publicControlExposureBenefit +
      lowScore!.breakdown.selfRouteCost -
      lowScore!.breakdown.bombEconomicsBenefit,
  );
  expect(heartScore?.score).toBeGreaterThan(lowScore!.score);
  expect(heartScore?.reasons).toContain("保留红桃级牌逢人配");
});

test("P7-09：红桃级牌作为非收尾候选的机会成本显著高于普通小牌", () => {
  const ordinary = single("four", 4);
  const heartLevel = single("heart-2", 15);
  const view = baseView({
    selfHand: [
      card("four", "4"),
      { ...card("heart-2", "2"), suit: "hearts" as const },
    ],
    legalActions: [ordinary, heartLevel],
  });

  expect(
    scoreNormalVNextCandidate(heartLevel, view)?.breakdown
      .wildcardOpportunityCost,
  ).toBe(420);
  expect(chooseNormalVNextBotAction(view)?.action).toBe(ordinary);
});

test("P7-09：开局跟小单时选择最小充分普通单张，不用最大单张过度压制", () => {
  const smallest = single("five", 5);
  const largest = single("king", 13);
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [card("five", "5"), card("king", "K")],
      legalActions: [{ type: "pass", actor: "east" }, largest, smallest],
      remainingCardCounts: { east: 2, south: 27, west: 27, north: 27 },
    }),
  );

  expect(decision?.action).toBe(smallest);
});

test("P7-09：首轮领出有普通结构可选时，不先消耗 AAA222 高控制钢板", () => {
  const lowStraight = pattern(
    ["three", "four", "five", "six", "seven"],
    "straight",
    7,
  );
  const highSteelPlate = pattern(
    ["ace-a", "ace-b", "ace-c", "level-a", "level-b", "level-c"],
    "steel-plate",
    15,
  );
  const decision = chooseNormalVNextBotAction(
    baseView({
      highestSeat: undefined,
      selfHand: [
        card("three", "3"),
        card("four", "4"),
        card("five", "5"),
        card("six", "6"),
        card("seven", "7"),
        card("ace-a", "A"),
        card("ace-b", "A"),
        card("ace-c", "A"),
        card("level-a", "2"),
        card("level-b", "2"),
        card("level-c", "2"),
      ],
      legalActions: [highSteelPlate, lowStraight],
      remainingCardCounts: { east: 11, south: 27, west: 27, north: 27 },
    }),
  );

  expect(decision?.action).toBe(lowStraight);
});

test("P7-02：评分器只接收规则层合法候选，并以稳定 tie-break 排序", () => {
  const first = single("four-a", 4);
  const second = single("four-b", 4);
  const illegal = single("ace", 14);
  const scoredView = baseView({
    selfHand: [card("four-a", "4"), card("four-b", "4"), card("ace", "A")],
    legalActions: [second, first],
  });

  expect(scoreNormalVNextCandidate(illegal, scoredView)).toBeUndefined();
  expect(chooseNormalVNextBotAction(scoredView)?.action).toBe(first);
});

test("P7-03：协同信号只由公开座位、手数和当前牌权构成", () => {
  expect(
    analyzeCooperationSignal(
      baseView({
        highestSeat: "west",
        remainingCardCounts: { east: 8, south: 5, west: 2, north: 7 },
      }),
    ),
  ).toMatchObject({ mode: "yield", teammate: "west", reason: "队友持权" });
  expect(
    analyzeCooperationSignal(
      baseView({
        highestSeat: "south",
        remainingCardCounts: { east: 8, south: 7, west: 1, north: 6 },
      }),
    ),
  ).toMatchObject({
    mode: "feed",
    teammateRemainingCards: 1,
    reason: "队友临门",
  });
});

test("P7-03：炸弹经济只允许公开可解释的保队友、断对手或直接收尾场景", () => {
  const bomb = normalBomb(["b1", "b2", "b3", "b4"], 7);
  const threatView = baseView({
    selfHand: [
      card("b1", "7"),
      card("b2", "7"),
      card("b3", "7"),
      card("b4", "7"),
      card("x", "4"),
    ],
    legalActions: [bomb],
    remainingCardCounts: { east: 5, south: 2, west: 8, north: 8 },
    publicActions: [
      {
        sequence: 1,
        actor: "south",
        type: "play",
        patternType: "single",
        cards: [{ id: "shown-A", suit: "hearts", rank: "A" }],
      },
    ],
  });
  const economics = describeNormalVNextBombEconomics(bomb, threatView);

  expect(economics).toMatchObject({
    allowed: true,
    reasons: expect.arrayContaining(["阻断公开临门对手"]),
    publicControlExposure: { A: 1 },
  });
  expect("opponentHands" in economics!).toBe(false);
});

test("P7-04：路线评估只看己方候选后的手牌，且固定输入可重放", () => {
  const sixes = pair(["six-a", "six-b"], 6);
  const view = baseView({
    selfHand: [card("six-a", "6"), card("six-b", "6"), card("ace", "A")],
    legalActions: [sixes],
  });
  const first = estimateNormalVNextSelfRoute(sixes, view);
  const second = estimateNormalVNextSelfRoute(sixes, view);

  expect(first).toEqual(second);
  expect(first).toMatchObject({
    remainingCards: 1,
    deadSingles: 1,
    naturalGroups: 0,
    controlCardsRetained: 1,
    estimatedSelfTurns: 1,
  });
  expect("opponentHands" in first!).toBe(false);
});

test("P7-06：公开已出控制牌进入最终候选选择，不读取对手手牌", () => {
  const king = single("king", 13);
  const ace = single("ace", 14);
  const view = baseView({
    selfHand: [card("king", "K"), card("ace", "A")],
    legalActions: [king, ace],
    publicActions: Array.from({ length: 5 }, (_, sequence) => ({
      sequence: sequence + 1,
      actor: "south" as const,
      type: "play" as const,
      patternType: "single" as const,
      cards: [
        {
          id: `shown-ace-${sequence}`,
          suit: "spades" as const,
          rank: "A" as const,
        },
      ],
    })),
  });

  const decision = chooseNormalVNextBotAction(view);

  expect(decision?.action).toBe(ace);
  expect(decision?.reasons).toContain("公开已出控制牌降低保留成本");
});

test("P7-06：己方路线评估进入最终候选选择", () => {
  const splitPair = single("six-a", 6);
  const preservePair = single("seven", 7);
  const view = baseView({
    selfHand: [card("six-a", "6"), card("six-b", "6"), card("seven", "7")],
    legalActions: [splitPair, preservePair],
  });

  const decision = chooseNormalVNextBotAction(view);

  expect(decision?.action).toBe(preservePair);
  expect(decision?.reasons).toContain("己方路线评估");
});

test("P7-06：高收益炸弹经济可越过更伤结构且路线更差的普通响应", () => {
  const ordinary = single("six-a", 6);
  const bomb = normalBomb(["b1", "b2", "b3", "b4"], 7);
  const view = baseView({
    selfHand: [
      card("six-a", "6"),
      card("six-b", "6"),
      card("b1", "7"),
      card("b2", "7"),
      card("b3", "7"),
      card("b4", "7"),
    ],
    legalActions: [ordinary, bomb],
    remainingCardCounts: { east: 6, south: 2, west: 8, north: 8 },
  });

  const decision = chooseNormalVNextBotAction(view);

  expect(decision?.action).toBe(bomb);
  expect(decision?.reasons).toContain("炸弹经济：普通响应的结构或路线损失更高");
});

test("normal-vNext：没有低单时保留规则不阻止使用 A", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ace = single("ace", 14);
  const littleJoker = single("little", 16);

  expect(
    chooseNormalVNextBotAction(
      baseView({ legalActions: [pass, littleJoker, ace] }),
    )?.action,
  ).toBe(ace);
});

test("normal-vNext：直接出完时可以使用 A", () => {
  const ace = single("ace", 14);
  const decision = chooseNormalVNextBotAction(
    baseView({ selfHand: [card("ace", "A")], legalActions: [ace] }),
  );

  expect(decision?.action).toBe(ace);
  expect(decision?.reasons).toContain("直接出完例外");
});

test("normal-vNext：队友持权时默认 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);

  expect(
    chooseNormalVNextBotAction(
      baseView({ highestSeat: "west", legalActions: [pass, low] }),
    )?.action,
  ).toBe(pass);
});

test("normal-vNext：对手持权不会错误触发队友让牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);

  expect(
    chooseNormalVNextBotAction(baseView({ legalActions: [pass, low] }))?.action,
  ).toBe(low);
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
        card("p2", "3"),
      ],
      legalActions: [pass, runout],
    }),
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
        card("low2", "3"),
      ],
      legalActions: [pass, largerMain, smallerMain],
    }),
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
        card("extra", "4"),
      ],
      legalActions: [pass, highPair, lowPair],
    }),
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
          card("x", "4"),
        ],
        legalActions: [pass, only],
      }),
    )?.action,
  ).toBe(only);
});

test.each([1, 2, 3])(
  "normal-vNext：对手剩余 %i 张时确定性阻断",
  (remaining) => {
    const pass: TurnAction = { type: "pass", actor: "east" };
    const low = single("four", 4);
    const decision = chooseNormalVNextBotAction(
      baseView({
        legalActions: [pass, low],
        remainingCardCounts: { east: 3, south: remaining, west: 8, north: 8 },
      }),
    );

    expect(decision?.action).toBe(low);
    expect(decision?.reasons).toContain("阻断对手 1～3 张残局");
  },
);

test("normal-vNext：对手剩余四张时不标记为 1～3 张阻断", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const low = single("four", 4);
  const decision = chooseNormalVNextBotAction(
    baseView({
      legalActions: [pass, low],
      remainingCardCounts: { east: 3, south: 4, west: 8, north: 8 },
    }),
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
      remainingCardCounts: { east: 1, south: 2, west: 8, north: 8 },
    }),
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
          card("eight", "8"),
        ],
        legalActions: [pass, splitTriple, independentEight],
      }),
    )?.action,
  ).toBe(independentEight);
});

test("P7-07：普通中局只有低点数 777 能压单张 6 时应接牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("seven-1", "7"),
          card("seven-2", "7"),
          card("seven-3", "7"),
        ],
        legalActions: [pass, splitTriple],
      }),
    )?.action,
  ).toBe(splitTriple);
});

test("P7-07：普通中局允许拆低点数自然对子压制小单", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const six = single("six-a", 6);
  const view = baseView({
    selfHand: [card("six-a", "6"), card("six-b", "6")],
    legalActions: [pass, six],
    remainingCardCounts: { east: 20, south: 20, west: 20, north: 20 },
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(six);
});

test("P7-07：普通中局允许拆低点数自然三张，但继续保护高控制三张", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const lowTriple = single("seven-a", 7);
  const highTriple = single("ace-a", 14);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("seven-a", "7"),
          card("seven-b", "7"),
          card("seven-c", "7"),
        ],
        legalActions: [pass, lowTriple],
        remainingCardCounts: { east: 20, south: 20, west: 20, north: 20 },
      }),
    )?.action,
  ).toBe(lowTriple);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [card("ace-a", "A"), card("ace-b", "A"), card("ace-c", "A")],
        legalActions: [pass, highTriple],
        remainingCardCounts: { east: 20, south: 20, west: 20, north: 20 },
      }),
    )?.action,
  ).toBe(pass);
});

test("A：对手仅剩 1 张时只有 777 能压单张 6，允许拆牌阻断", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("seven-1", "7"),
          card("seven-2", "7"),
          card("seven-3", "7"),
        ],
        legalActions: [pass, splitTriple],
        remainingCardCounts: { east: 3, south: 1, west: 8, north: 8 },
      }),
    )?.action,
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
          card("bomb-4", "7"),
        ],
        legalActions: [pass, splitBomb],
      }),
    )?.action,
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
          card("steel-6", "9"),
        ],
        legalActions: [pass, splitSteel],
      }),
    )?.action,
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
          card("pair-6", "7"),
        ],
        legalActions: [pass, splitPairs],
      }),
    )?.action,
  ).toBe(pass);
});

test("B：对手剩余 5 张时，三张拆分的有限成本可用于争牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitTriple = single("seven-1", 7);

  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [
          card("seven-1", "7"),
          card("seven-2", "7"),
          card("seven-3", "7"),
        ],
        legalActions: [pass, splitTriple],
        remainingCardCounts: { east: 3, south: 5, west: 8, north: 8 },
      }),
    )?.action,
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
        card("joker", "small-joker"),
      ],
    }),
  );

  expect(analysis).toMatchObject({
    pairs: 1,
    triples: 1,
    bombs: 1,
    wildcardCount: 1,
    controlCards: 3,
  });
});

test("C1：responseCost 合同保持 A/B 权重与稳定 tie-break", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const seven = single("seven", 7);
  const eight = single("eight", 8);
  const view = baseView({
    selfHand: [card("seven", "7"), card("eight", "8")],
    legalActions: [pass, eight, seven],
  });
  const cost = describeNormalVNextAction(seven, view);
  expect(cost).toMatchObject({
    rankCost: 7,
    structureDamageCost: 0,
    controlResourceCost: 0,
    wildcardOpportunityCost: 0,
    responseCost: 7,
  });
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
      remainingCardCounts: { east: 2, south: 8, west: 8, north: 1 },
    }),
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
        selfHand: [
          card("four-a", "4"),
          card("four-b", "4"),
          card("king-a", "K"),
          card("king-b", "K"),
        ],
        legalActions: [low, high],
        remainingCardCounts: { east: 4, south: 8, west: 8, north: 2 },
      }),
    )?.action,
  ).toBe(high);
});

test("下家剩 4、5 张时公开推测包含炸弹与三带二风险", () => {
  const four = analyzeNextSeatEndgameThreat(
    baseView({ remainingCardCounts: { east: 3, south: 8, west: 8, north: 4 } }),
  );
  const five = analyzeNextSeatEndgameThreat(
    baseView({ remainingCardCounts: { east: 3, south: 8, west: 8, north: 5 } }),
  );
  expect(four.likelyPatternTypes).toContain("normal-bomb");
  expect(five.likelyPatternTypes).toEqual(
    expect.arrayContaining(["normal-bomb", "three-with-pair"]),
  );
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
        remainingCardCounts: { east: 2, south: 8, west: 8, north: 4 },
      }),
    )?.action,
  ).toBe(high);
});

test("下家剩 5 张时，三带二风险下优先出较大主三张", () => {
  const low = threeWithPair(
    ["five-a", "five-b", "five-c", "three-a", "three-b"],
    5,
  );
  const high = threeWithPair(
    ["ten-a", "ten-b", "ten-c", "four-a", "four-b"],
    10,
  );
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: undefined,
        selfHand: [
          card("five-a", "5"),
          card("five-b", "5"),
          card("five-c", "5"),
          card("three-a", "3"),
          card("three-b", "3"),
          card("ten-a", "10"),
          card("ten-b", "10"),
          card("ten-c", "10"),
          card("four-a", "4"),
          card("four-b", "4"),
        ],
        legalActions: [low, high],
        remainingCardCounts: { east: 10, south: 8, west: 8, north: 5 },
      }),
    )?.action,
  ).toBe(high);
});

test("下家剩 3 张时可拆自己的炸弹夺回牌权", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const bomb = normalBomb(["seven-a", "seven-b", "seven-c", "seven-d"], 7);
  const decision = chooseNormalVNextBotAction(
    baseView({
      selfHand: [
        card("seven-a", "7"),
        card("seven-b", "7"),
        card("seven-c", "7"),
        card("seven-d", "7"),
        card("other", "4"),
      ],
      legalActions: [pass, bomb],
      remainingCardCounts: { east: 5, south: 8, west: 8, north: 3 },
    }),
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
        remainingCardCounts: { east: 2, south: 8, west: 8, north: 7 },
      }),
    )?.action,
  ).toBe(low);
});

test("下家即将走完但无可压制牌时，仍返回合法 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  expect(
    chooseNormalVNextBotAction(
      baseView({
        legalActions: [pass],
        remainingCardCounts: { east: 3, south: 8, west: 8, north: 1 },
      }),
    )?.action,
  ).toBe(pass);
});

test("尾局阻断没有可选候选时，回退到合法 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  expect(
    chooseNormalVNextBotAction(
      baseView({
        legalActions: [pass],
        remainingCardCounts: { east: 3, south: 8, west: 8, north: 3 },
      }),
    )?.action,
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
        remainingCardCounts: { east: 1, south: 8, west: 8, north: 1 },
      }),
    )?.action,
  ).toBe(onlyPlay);
});

test("开中局：22 对自然 66 的争牌收益高于 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const sixes = pair(["six-a", "six-b"], 6);
  const view = baseView({
    selfHand: [card("six-a", "6"), card("six-b", "6"), card("other", "4")],
    legalActions: [pass, sixes],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(sixes);
  expect(describeNormalVNextContest(sixes, view)).toMatchObject({
    structureDamageCost: 0,
    controlResourceCost: 0,
    handSheddingBenefit: 120,
    contestBenefit: 120,
    passBias: 160,
    actionScore: 234,
    recommended: "contest",
  });
});

test("开中局：444 对自然 888 的争牌收益高于 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const eights = triple(["eight-a", "eight-b", "eight-c"], 8);
  const view = baseView({
    selfHand: [
      card("eight-a", "8"),
      card("eight-b", "8"),
      card("eight-c", "8"),
      card("other", "4"),
    ],
    legalActions: [pass, eights],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(eights);
  expect(describeNormalVNextContest(eights, view)).toMatchObject({
    handSheddingBenefit: 180,
    contestBenefit: 120,
    actionScore: 292,
    recommended: "contest",
  });
});

test("开中局：44422 对自然 88866 的争牌收益高于 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const eightsWithSixes = threeWithPair(
    ["eight-a", "eight-b", "eight-c", "six-a", "six-b"],
    8,
  );
  const view = baseView({
    selfHand: [
      card("eight-a", "8"),
      card("eight-b", "8"),
      card("eight-c", "8"),
      card("six-a", "6"),
      card("six-b", "6"),
      card("other", "4"),
    ],
    legalActions: [pass, eightsWithSixes],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(eightsWithSixes);
  expect(describeNormalVNextContest(eightsWithSixes, view)).toMatchObject({
    handSheddingBenefit: 300,
    contestBenefit: 120,
    actionScore: 406,
    recommended: "contest",
  });
});

test("P7-14：中等三带二对完整 KKK44 应主动压制，不把 K 误作最高控制牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const kingsWithFours = threeWithPair(
    ["king-a", "king-b", "king-c", "four-a", "four-b"],
    13,
  );
  const view = baseView({
    selfHand: [
      card("king-a", "K"),
      card("king-b", "K"),
      card("king-c", "K"),
      card("four-a", "4"),
      card("four-b", "4"),
      ...["7", "8", "9", "10"].flatMap((rank) =>
        ["a", "b", "c", "d"].map((suffix) =>
          card(`${rank}-${suffix}`, rank as Card["rank"]),
        ),
      ),
    ],
    legalActions: [pass, kingsWithFours],
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(kingsWithFours);
  expect(describeNormalVNextContest(kingsWithFours, view)).toMatchObject({
    structureDamageCost: 0,
    highValuePenalty: 0,
  });
});

test("开中局：44422 对 AAAKK 的高控制资源组合倾向 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const high = threeWithPair(
    ["ace-a", "ace-b", "ace-c", "king-a", "king-b"],
    14,
  );
  const view = baseView({
    selfHand: [
      card("ace-a", "A"),
      card("ace-b", "A"),
      card("ace-c", "A"),
      card("king-a", "K"),
      card("king-b", "K"),
      card("other", "4"),
    ],
    legalActions: [pass, high],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(pass);
  expect(describeNormalVNextContest(high, view)).toMatchObject({
    controlResourceCost: 390,
    highValuePenalty: 320,
    actionScore: -737,
    recommended: "pass",
  });
});

test("开中局：44422 对含级牌的 222AA 倾向 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const high = threeWithPair(
    ["level-a", "level-b", "level-c", "ace-a", "ace-b"],
    15,
  );
  const view = baseView({
    selfHand: [
      card("level-a", "2"),
      card("level-b", "2"),
      card("level-c", "2"),
      card("ace-a", "A"),
      card("ace-b", "A"),
      card("other", "4"),
    ],
    legalActions: [pass, high],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(pass);
  expect(describeNormalVNextContest(high, view)).toMatchObject({
    controlResourceCost: 660,
    highValuePenalty: 320,
    actionScore: -1009,
    recommended: "pass",
  });
});

test("队友持权时，自然 66 仍不无故抢牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const sixes = pair(["six-a", "six-b"], 6);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        highestSeat: "west",
        selfHand: [card("six-a", "6"), card("six-b", "6"), card("other", "4")],
        legalActions: [pass, sixes],
      }),
    )?.action,
  ).toBe(pass);
});

test("三带二有普通对子时，不使用级牌对子作附带牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ordinary = threeWithPair(
    ["eight-a", "eight-b", "eight-c", "three-a", "three-b"],
    8,
  );
  const levelKicker = threeWithPair(
    ["eight-a", "eight-b", "eight-c", "level-a", "level-b"],
    8,
  );
  const view = baseView({
    selfHand: [
      card("eight-a", "8"),
      card("eight-b", "8"),
      card("eight-c", "8"),
      card("three-a", "3"),
      card("three-b", "3"),
      card("level-a", "2"),
      card("level-b", "2"),
    ],
    legalActions: [pass, levelKicker, ordinary],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(ordinary);
  expect(
    describeNormalVNextAction(levelKicker, view)?.controlResourceCost,
  ).toBe(280);
});

test("有普通三张时，不用红桃级牌补成小三张", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ordinary = triple(["eight-a", "eight-b", "eight-c"], 8);
  const wildcardTriple: TurnAction = {
    type: "play",
    actor: "east",
    cardIds: ["seven-a", "seven-b", "heart-level"],
    interpretation: {
      type: "triple",
      comparisonKey: [7],
      cardIds: ["seven-a", "seven-b", "heart-level"],
      wildcardAs: { "heart-level": { rank: "7", suit: "spades" } },
    },
  };
  const view = baseView({
    selfHand: [
      card("eight-a", "8"),
      card("eight-b", "8"),
      card("eight-c", "8"),
      card("seven-a", "7"),
      card("seven-b", "7"),
      { ...card("heart-level", "2"), suit: "hearts" },
    ],
    legalActions: [pass, wildcardTriple, ordinary],
  });
  expect(chooseNormalVNextBotAction(view)?.action).toBe(ordinary);
  expect(
    describeNormalVNextAction(wildcardTriple, view)?.controlResourceCost,
  ).toBe(220);
});

test("对手出小单或小对时，不轻易使用级牌或王接牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const ordinarySingle = single("seven", 7);
  const levelSingle = single("level", 15);
  const ordinaryPair = pair(["six-a", "six-b"], 6);
  const jokerPair = pair(["small", "big"], 17);
  const singleView = baseView({
    selfHand: [
      card("seven", "7"),
      card("level", "2"),
      card("small", "small-joker"),
      card("big", "big-joker"),
    ],
    legalActions: [pass, levelSingle, ordinarySingle],
  });
  const pairView = baseView({
    selfHand: [
      card("six-a", "6"),
      card("six-b", "6"),
      card("small", "small-joker"),
      card("big", "big-joker"),
    ],
    legalActions: [pass, jokerPair, ordinaryPair],
  });
  expect(chooseNormalVNextBotAction(singleView)?.action).toBe(ordinarySingle);
  expect(chooseNormalVNextBotAction(pairView)?.action).toBe(ordinaryPair);
  expect(
    describeNormalVNextAction(levelSingle, singleView)?.controlResourceCost,
  ).toBe(140);
});

test("残局强制阻断时，允许使用唯一的级牌压制", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const levelSingle = single("level", 15);
  expect(
    chooseNormalVNextBotAction(
      baseView({
        selfHand: [card("level", "2")],
        legalActions: [pass, levelSingle],
        remainingCardCounts: { east: 1, south: 8, west: 8, north: 1 },
      }),
    )?.action,
  ).toBe(levelSingle);
});

test("P6：完整更大顺子跟牌不是拆顺子，应压制而非 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const straight = pattern(["6", "7", "8", "9", "10"], "straight", 10);
  const view = baseView({
    selfHand: ["3", "6", "7", "8", "9", "10"].map((rank) =>
      card(rank, rank as Card["rank"]),
    ),
    legalActions: [pass, straight],
    remainingCardCounts: { east: 5, south: 24, west: 24, north: 24 },
  });

  expect(describeNormalVNextAction(straight, view)?.structureDamageCost).toBe(
    0,
  );
  expect(chooseNormalVNextBotAction(view)?.action).toBe(straight);
});

test("P6：完整更大连对跟牌不是拆连对，应压制而非 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const consecutivePairs = pattern(
    ["6a", "6b", "7a", "7b", "8a", "8b"],
    "three-consecutive-pairs",
    8,
  );
  const view = baseView({
    selfHand: [
      card("3", "3"),
      card("6a", "6"),
      card("6b", "6"),
      card("7a", "7"),
      card("7b", "7"),
      card("8a", "8"),
      card("8b", "8"),
    ],
    legalActions: [pass, consecutivePairs],
    remainingCardCounts: { east: 7, south: 24, west: 24, north: 24 },
  });

  expect(
    describeNormalVNextAction(consecutivePairs, view)?.structureDamageCost,
  ).toBe(0);
  expect(chooseNormalVNextBotAction(view)?.action).toBe(consecutivePairs);
});

test("P6：完整更大钢板跟牌不是拆钢板，应压制而非 pass", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const steelPlate = pattern(
    ["7a", "7b", "7c", "8a", "8b", "8c"],
    "steel-plate",
    8,
  );
  const view = baseView({
    selfHand: [
      card("3", "3"),
      card("7a", "7"),
      card("7b", "7"),
      card("7c", "7"),
      card("8a", "8"),
      card("8b", "8"),
      card("8c", "8"),
    ],
    legalActions: [pass, steelPlate],
    remainingCardCounts: { east: 7, south: 24, west: 24, north: 24 },
  });

  expect(describeNormalVNextAction(steelPlate, view)?.structureDamageCost).toBe(
    0,
  );
  expect(chooseNormalVNextBotAction(view)?.action).toBe(steelPlate);
});

test("P6：从自然顺子抽取部分牌仍保留明显结构损伤", () => {
  const partial = single("7", 7);
  const view = baseView({
    selfHand: ["6", "7", "8", "9", "10"].map((rank) =>
      card(rank, rank as Card["rank"]),
    ),
    legalActions: [partial],
  });

  expect(
    describeNormalVNextAction(partial, view)?.structureDamageCost,
  ).toBeGreaterThanOrEqual(800);
});

test("P6：普通早中盘跟小单时在多个散单中选择最小足够压制", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const six = single("6", 6);
  const eight = single("8", 8);
  const jack = single("J", 11);
  const ace = single("A", 14);
  const view = baseView({
    selfHand: [card("6", "6"), card("8", "8"), card("J", "J"), card("A", "A")],
    legalActions: [pass, ace, jack, eight, six],
    remainingCardCounts: { east: 24, south: 24, west: 24, north: 24 },
  });

  expect(analyzeNextSeatEndgameThreat(view).mode).toBe("none");
  expect(chooseNormalVNextBotAction(view)?.action).toBe(six);
});

test("P6：普通早中盘保护小对子，使用合理散单而非最大牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitPair = single("6a", 6);
  const eight = single("8", 8);
  const jack = single("J", 11);
  const ace = single("A", 14);
  const view = baseView({
    selfHand: [
      card("6a", "6"),
      card("6b", "6"),
      card("8", "8"),
      card("J", "J"),
      card("A", "A"),
    ],
    legalActions: [pass, ace, jack, eight, splitPair],
    remainingCardCounts: { east: 24, south: 24, west: 24, north: 24 },
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(eight);
});

test("P6：普通早中盘保护自然结构，使用低成本散单而非机械选最大牌", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const splitStraight = single("6", 6);
  const queen = single("Q", 12);
  const ace = single("A", 14);
  const view = baseView({
    selfHand: ["6", "7", "8", "9", "10"]
      .map((rank) => card(rank, rank as Card["rank"]))
      .concat([card("Q", "Q"), card("A", "A")]),
    legalActions: [pass, ace, queen, splitStraight],
    remainingCardCounts: { east: 24, south: 24, west: 24, north: 24 },
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(queen);
});

test("P6：普通早中盘优先普通散单，不无必要使用控制资源", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const six = single("6", 6);
  const ace = single("A", 14);
  const level = single("level", 15);
  const small = single("small", 16);
  const big = single("big", 17);
  const view = baseView({
    selfHand: [
      card("6", "6"),
      card("A", "A"),
      card("level", "2"),
      card("small", "small-joker"),
      card("big", "big-joker"),
    ],
    legalActions: [pass, big, small, level, ace, six],
    remainingCardCounts: { east: 24, south: 24, west: 24, north: 24 },
  });

  expect(chooseNormalVNextBotAction(view)?.action).toBe(six);
});

test("P6：下家只剩三张时仍保留强制阻断", () => {
  const pass: TurnAction = { type: "pass", actor: "east" };
  const six = single("6", 6);
  const ace = single("A", 14);
  const view = baseView({
    selfHand: [card("6", "6"), card("A", "A")],
    legalActions: [pass, ace, six],
    remainingCardCounts: { east: 2, south: 24, west: 24, north: 3 },
  });

  expect(analyzeNextSeatEndgameThreat(view).mode).toBe("forced");
  expect(chooseNormalVNextBotAction(view)?.action).toBe(ace);
});
