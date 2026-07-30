import { expect, test } from "vitest";
import { latestCompletedTrickActions } from "./recent-actions";

const play = {
  type: "play" as const,
  actor: "south" as const,
  cardIds: ["south-3"],
  interpretation: {
    type: "single" as const,
    cardIds: ["south-3"],
    wildcardAs: {},
    comparisonKey: [3],
  },
};

test("三家连续过牌后仍可提取刚结束一墩的最后不要", () => {
  const actions = [
    play,
    { type: "pass" as const, actor: "east" as const },
    { type: "pass" as const, actor: "north" as const },
    { type: "pass" as const, actor: "west" as const },
  ];
  const events = actions.map((action, sequence) => ({
    sequence,
    type: "action.applied",
    payload: { action },
  }));

  expect(latestCompletedTrickActions(events)).toEqual(actions);
});

test("未清墩时不把正在进行的一墩标记为已结束", () => {
  const events = [play, { type: "pass" as const, actor: "east" as const }].map(
    (action, sequence) => ({
      sequence,
      type: "action.applied",
      payload: { action },
    }),
  );

  expect(latestCompletedTrickActions(events)).toEqual([]);
});
