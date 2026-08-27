// Shared Guandan core test.
import { expect, test } from "vitest";
import { applyAction, type TurnState } from "./turns";
const p = (value: number, id: string) => ({
  type: "single" as const,
  comparisonKey: [value],
  cardIds: [id],
  wildcardAs: {},
});
const state = (hands: TurnState["hands"]): TurnState => ({
  hands,
  current: "east",
  leader: "east",
  passes: 0,
  finished: [],
});
test("典型出牌、跟牌和全过清轮", () => {
  let s = state({ east: ["e"], south: ["s"], west: ["w"], north: ["n"] });
  let r = applyAction(s, {
    type: "play",
    actor: "east",
    cardIds: ["e"],
    interpretation: p(3, "e"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  s = r.state;
  expect(s.finished).toEqual(["east"]);
  r = applyAction(s, {
    type: "play",
    actor: "north",
    cardIds: ["n"],
    interpretation: p(4, "n"),
  });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "west" });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "south" });
  expect(r).toMatchObject({
    ok: true,
    state: { leader: "south", current: "south", highest: undefined },
  });
});

test("座位按逆时针东到北到西到南轮转", () => {
  let s = state({ east: ["e"], south: ["s"], west: ["w"], north: ["n"] });
  let r = applyAction(s, {
    type: "play",
    actor: "east",
    cardIds: ["e"],
    interpretation: p(3, "e"),
  });
  expect(r).toMatchObject({ ok: true, state: { current: "north" } });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "north" });
  expect(r).toMatchObject({ ok: true, state: { current: "west" } });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "west" });
  expect(r).toMatchObject({ ok: true, state: { current: "south" } });
});
test("末手出完且其余可行动者全过时对家接风，完成者不能行动", () => {
  let s = state({ east: ["e"], south: ["s"], west: ["w"], north: ["n"] });
  let r = applyAction(s, {
    type: "play",
    actor: "east",
    cardIds: ["e"],
    interpretation: p(3, "e"),
  });
  if (!r.ok) return;
  s = r.state;
  expect(applyAction(s, { type: "pass", actor: "east" })).toEqual({
    ok: false,
    code: "not_current_player",
  });
  r = applyAction(s, { type: "pass", actor: "south" });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "west" });
  if (!r.ok) return;
  s = r.state;
  r = applyAction(s, { type: "pass", actor: "north" });
  expect(r).toMatchObject({
    ok: true,
    state: { leader: "west", current: "west" },
  });
});
test("最后一名出完进入受控终局而不轮转", () => {
  const s = {
    ...state({ east: ["e"], south: [], west: [], north: [] }),
    finished: ["south", "west", "north"] as const,
  };
  expect(
    applyAction(s, {
      type: "play",
      actor: "east",
      cardIds: ["e"],
      interpretation: p(3, "e"),
    }),
  ).toMatchObject({
    ok: true,
    state: { completed: true, finished: ["south", "west", "north", "east"] },
  });
});
test("第三家出完时自动记末游并立即结束本局", () => {
  const s: TurnState = {
    ...state({ east: [], south: ["s"], west: ["w"], north: [] }),
    current: "west",
    leader: "west",
    finished: ["east", "north"],
  };

  expect(
    applyAction(s, {
      type: "play",
      actor: "west",
      cardIds: ["w"],
      interpretation: p(3, "w"),
    }),
  ).toMatchObject({
    ok: true,
    state: {
      completed: true,
      finished: ["east", "north", "west", "south"],
      hands: { south: ["s"] },
    },
  });
});
test("已出完领出者及其对家均不可接风时，清轮跳过完成座位", () => {
  let s: TurnState = {
    ...state({ east: [], south: ["s"], west: [], north: ["n"] }),
    current: "south",
    leader: "east",
    highest: p(3, "e"),
    highestSeat: "east",
    finished: ["east", "west"],
  };
  const firstPass = applyAction(s, { type: "pass", actor: "south" });
  if (!firstPass.ok) return;
  s = firstPass.state;

  expect(applyAction(s, { type: "pass", actor: "north" })).toMatchObject({
    ok: true,
    state: { leader: "south", current: "south", highest: undefined },
  });
});
