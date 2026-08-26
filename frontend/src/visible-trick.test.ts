import { expect, test } from "vitest";
import type { Event } from "@card-game/guandan-core";
import { actionFromPublicEvent, latestRecentActionsBySeat } from "@card-game/guandan-core";
import { selectVisibleTrickEvents } from "./visible-trick";

const play = (actor: "south" | "west" | "north" | "east", sequence: number): Event => ({
  sequence,
  type: "action.applied",
  payload: {
    action: {
      type: "play",
      actor,
      cardIds: [`${actor}-${sequence}`],
      interpretation: {
        type: "single",
        comparisonKey: [3],
        cardIds: [`${actor}-${sequence}`],
        wildcardAs: {}
      }
    }
  }
});

test("头家走完后的清墩不会把最后一手带入下一家或下一局", () => {
  const completedTrick = [play("south", 1)];
  const start = { roundNumber: 1, eventIndex: 0 };

  expect(selectVisibleTrickEvents(completedTrick, start, 1, true)).toEqual([]);

  const nextLead = [...completedTrick, play("north", 2)];
  const visibleNextLead = selectVisibleTrickEvents(
    nextLead,
    { roundNumber: 1, eventIndex: 1 },
    1,
    false
  );
  expect(visibleNextLead.map(actionFromPublicEvent).map((action) => action?.actor)).toEqual([
    "north"
  ]);

  const nextRound = [play("west", 1)];
  const visibleNextRound = selectVisibleTrickEvents(
    nextRound,
    { roundNumber: 1, eventIndex: 9 },
    2,
    false
  );
  expect(latestRecentActionsBySeat(visibleNextRound).map((action) => action.actor)).toEqual([
    "west"
  ]);
});
