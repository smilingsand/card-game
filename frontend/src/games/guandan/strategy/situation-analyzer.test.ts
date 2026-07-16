import { expect, test } from "vitest";
import type { Event, Seat } from "../../../platform/types";
import type { BotView } from "../bot-view";
import { EXPERT_SCENARIOS } from "../expert-fixtures";
import { analyzeSituation } from "./situation-analyzer";

const fixture = (id: string) => {
  const value = EXPERT_SCENARIOS.find((item) => item.id === id);
  if (!value) throw new Error(`missing fixture ${id}`);
  return value;
};

const play = (
  sequence: number,
  actor: Seat,
  type: "single" | "pair" | "normal-bomb" | "four-jokers",
  comparisonKey: readonly number[]
): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: {
    action: {
      type: "play",
      actor,
      cardIds: [`${actor}-${sequence}`],
      interpretation: { type, cardIds: [`${actor}-${sequence}`], comparisonKey, wildcardAs: {} }
    }
  }
});

const pass = (sequence: number, actor: Seat): Event => ({
  sequence,
  type: "action.applied",
  actorId: actor,
  payload: { action: { type: "pass", actor } }
});

const viewFor = (id: string, overrides: Partial<BotView> = {}): BotView => {
  const value = fixture(id);
  return {
    selfSeat: value.publicSituation.selfSeat,
    leader: value.publicSituation.leader,
    highestSeat: value.publicSituation.highestSeat,
    levelRank: value.levelRank,
    selfHand: value.selfHand,
    publicEvents: [],
    remainingCardCounts: value.publicSituation.remainingCardCounts,
    legalActions: [],
    ...overrides
  };
};

test("S31/S34 根据公开余牌与冲刺状态区分低威胁和对手一张的阻断威胁", () => {
  const lowThreat = analyzeSituation(viewFor("S31"));
  const endgameThreat = analyzeSituation(viewFor("S34"));

  expect(lowThreat.phase).toBe("middle");
  expect(lowThreat.opponentThreat.level).not.toBe("critical");
  expect(endgameThreat.opponentThreat).toMatchObject({
    level: "critical",
    immediateFinishSeats: ["south"]
  });
  expect(endgameThreat.phase).toBe("endgame");
});

test("S36/S50 区分队友压住、队友冲刺及 support 角色，并给出可解释事实", () => {
  const teammateHolding = analyzeSituation(
    viewFor("S36", {
      highestSeat: "west",
      publicEvents: [play(4, "west", "pair", [14])]
    })
  );
  const teammateSprint = analyzeSituation(
    viewFor("S50", {
      remainingCardCounts: { east: 8, south: 7, west: 2, north: 8 },
      publicEvents: [play(6, "west", "pair", [10])]
    })
  );

  expect(teammateHolding.teammate).toMatchObject({ seat: "west", isHolding: true });
  expect(teammateSprint.teammate).toMatchObject({ isSprinting: true });
  expect(teammateSprint.role.kind).toBe("support");
  expect(teammateSprint.reasoning.some((item) => item.kind === "fact")).toBe(true);
});

test("S49 及真实 action.applied 事件统计公开牌型和高位比较键，并将过牌限定为概率证据", () => {
  const situation = analyzeSituation(
    viewFor("S49", {
      publicEvents: [
        play(2, "south", "four-jokers", [4]),
        play(3, "north", "normal-bomb", [4, 15]),
        pass(4, "south"),
        pass(5, "south")
      ]
    })
  );

  expect(situation.publicCards.patternCounts).toMatchObject({ "four-jokers": 1, "normal-bomb": 1 });
  expect(situation.publicCards.highComparisonPlayCount).toBe(1);
  expect(situation.publicCards.controlPatternPlayCount).toBe(2);
  const south = situation.playerTendencies.find((item) => item.seat === "south");
  expect(
    south?.evidence.some((item) => item.kind === "inference" && /过牌/.test(item.reason))
  ).toBe(true);
  expect(south?.evidence.some((item) => /不表示无牌/.test(item.reason))).toBe(true);
});

test("S31/S34/S36/S49/S50 的分析稳定、输入不变且不会泄露隐藏手牌或 seed", () => {
  const original = viewFor("S31", {
    publicEvents: [play(2, "south", "single", [5]), pass(3, "north")]
  });
  const before = structuredClone(original);
  const first = analyzeSituation(original);
  const reordered = analyzeSituation({
    ...original,
    publicEvents: [...original.publicEvents].reverse()
  });

  expect(first).toEqual(analyzeSituation(original));
  expect(first).toEqual(reordered);
  expect(first.fingerprint).toBe(reordered.fingerprint);
  expect(first.publicEventSequence).toBe(3);
  expect(original).toEqual(before);
  expect("opponentHands" in first).toBe(false);
  expect("seed" in first).toBe(false);
});

test("公开事件为空时安全退化，不把推断写成确定事实", () => {
  const situation = analyzeSituation(viewFor("S50", { publicEvents: [] }));

  expect(situation.publicEventSequence).toBe(0);
  expect(situation.publicCards.totalActions).toBe(0);
  expect(situation.playerTendencies.every((item) => item.confidence === 0)).toBe(true);
  expect(situation.reasoning.every((item) => item.kind === "fact")).toBe(true);
});
