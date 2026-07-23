// Shared Guandan core test.
import { expect, test } from "vitest";
import {
  canReturnTribute,
  initializeNextRound,
  settleDoubleTribute,
  settleRound,
  settleSingleTribute,
} from "./settlement";
test("双上/头三/头末分别升3/2/1，打A仅双上获胜", () => {
  expect(
    settleRound({ level: "9", finish: ["east", "west", "south", "north"] }),
  ).toMatchObject({
    level: "Q",
    winner: false,
  });
  expect(
    settleRound({ level: "A", finish: ["east", "west", "south", "north"] }),
  ).toMatchObject({
    winner: true,
  });
  expect(
    settleRound({ level: "9", finish: ["east", "south", "west", "north"] }),
  ).toMatchObject({
    level: "J",
  });
  expect(
    settleRound({ level: "9", finish: ["east", "south", "north", "west"] }),
  ).toMatchObject({
    level: "10",
  });
});
test("抗贡输出可重放事件和下一局首出", () => {
  expect(
    settleRound({
      level: "2",
      finish: ["east", "south", "west", "north"],
      antiTribute: true,
      proof: [
        { id: "bj1", rank: "big-joker" },
        { id: "bj2", rank: "big-joker" },
      ],
    }),
  ).toMatchObject({
    nextLeader: "east",
    events: [expect.objectContaining({ type: "action.applied" })],
  });
});
test("双下同点由头游下家先出，抗贡必须给出两张大王证明", () => {
  expect(
    settleRound({
      level: "2",
      finish: ["east", "west", "south", "north"],
      doubleTributeTie: true,
    }),
  ).toMatchObject({ nextLeader: "north" });
  expect(() =>
    settleRound({
      level: "2",
      finish: ["east", "south", "west", "north"],
      antiTribute: true,
      proof: [{ id: "bj1", rank: "big-joker" }],
    }),
  ).toThrow("two big jokers");
});
test("还贡按当前级牌排序且不大于10", () => {
  expect(canReturnTribute("10", "2")).toBe(true);
  expect(canReturnTribute("J", "2")).toBe(false);
  expect(canReturnTribute("2", "2")).toBe(false);
});
test("单下进贡和还贡产生可重放事件并由进贡者首出", () => {
  expect(
    settleSingleTribute(
      "2",
      "east",
      "north",
      { id: "t", rank: "A" },
      { id: "r", rank: "10" },
    ),
  ).toMatchObject({
    nextLeader: "north",
    events: [
      {
        sequence: 0,
        type: "action.applied",
        payload: { kind: "single-tribute", from: "north", to: "east" },
      },
    ],
  });
  expect(() =>
    settleSingleTribute(
      "2",
      "east",
      "north",
      { id: "t", rank: "A" },
      { id: "r", rank: "J" },
    ),
  ).toThrow("invalid return tribute");
});
test("双下较大贡牌者先出，同点由头游下家先出", () => {
  const input = ["north", "south"] as const;
  expect(
    settleDoubleTribute(
      "2",
      "east",
      "west",
      input,
      [
        { id: "a", value: 9 },
        { id: "b", value: 8 },
      ],
      [
        { id: "r1", rank: "10" },
        { id: "r2", rank: "9" },
      ],
    ),
  ).toMatchObject({
    nextLeader: "north",
    events: [{ payload: { kind: "double-tribute" } }],
  });
  expect(
    settleDoubleTribute(
      "2",
      "east",
      "west",
      input,
      [
        { id: "a", value: 9 },
        { id: "b", value: 9 },
      ],
      [
        { id: "r1", rank: "10" },
        { id: "r2", rank: "9" },
      ],
    ),
  ).toMatchObject({ nextLeader: "north" });
});
test("下一局初始化保留规则版本、等级、首出和重放事件", () => {
  expect(initializeNextRound("J", "south")).toMatchObject({
    rulesVersion: "guandan-v1",
    level: "J",
    leader: "south",
    events: [{ sequence: 0, payload: { kind: "next-round-initialized" } }],
  });
});
