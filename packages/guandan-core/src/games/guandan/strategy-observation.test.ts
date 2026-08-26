// Shared Guandan core test.
import { expect, expectTypeOf, test } from "vitest";
import type { BotView } from "./bot-view";
import { projectPublicActions } from "./public-action-projection";
import {
  createStrategyObservation,
  type StrategyObservation,
} from "./strategy-observation";

const publicCard = {
  id: "public-A",
  deckIndex: 0,
  suit: "hearts" as const,
  rank: "A" as const,
};
const hiddenCard = {
  id: "hidden-big-joker",
  deckIndex: 1,
  suit: "joker" as const,
  rank: "big-joker" as const,
};
const play = {
  type: "play" as const,
  actor: "south" as const,
  cardIds: [publicCard.id],
  interpretation: {
    type: "single" as const,
    comparisonKey: [14],
    cardIds: [publicCard.id],
    wildcardAs: {},
  },
};
const event = {
  sequence: 4,
  type: "action.applied",
  actorId: "south",
  payload: { action: play },
};
const view = (overrides: Partial<BotView> = {}): BotView => ({
  selfSeat: "east",
  leader: "south",
  highestSeat: "south",
  levelRank: "2",
  selfHand: [{ id: "self-3", deckIndex: 2, suit: "spades", rank: "3" }],
  publicEvents: [event],
  remainingCardCounts: { east: 1, south: 8, west: 6, north: 10 },
  legalActions: [],
  ...overrides,
});

test("P7-01：公开动作投影只携带已经打出的牌面，并按 sequence 重放", () => {
  const cards = new Map([
    [publicCard.id, publicCard],
    [hiddenCard.id, hiddenCard],
  ]);
  const projected = projectPublicActions(
    [
      event,
      {
        ...event,
        sequence: 2,
        payload: { action: { type: "pass" as const, actor: "west" as const } },
      },
    ],
    cards,
  );

  expect(projected).toEqual([
    { sequence: 2, actor: "west", type: "pass", cards: [] },
    {
      sequence: 4,
      actor: "south",
      type: "play",
      patternType: "single",
      cards: [{ id: "public-A", suit: "hearts", rank: "A" }],
    },
  ]);
  expect(JSON.stringify(projected)).not.toContain(hiddenCard.id);
  expect(JSON.stringify(projected)).not.toContain("deckIndex");
});

test("P7-01：观察可从公开投影纯函数重建，旧 BotView 没有牌面投影时保持兼容", () => {
  const publicActions = projectPublicActions(
    [event],
    new Map([[publicCard.id, publicCard]]),
  );
  const observation = createStrategyObservation(view({ publicActions }));
  const replayed = createStrategyObservation(
    view({ publicActions: [...publicActions].reverse() }),
  );
  const legacy = createStrategyObservation(view());

  expect(replayed).toEqual(observation);
  expect(observation).toMatchObject({
    version: "guandan-strategy-observation-v1",
    seats: { self: "east", teammate: "west", opponents: ["south", "north"] },
    turn: { leader: "south", highestSeat: "south", mode: "respond" },
    publicCards: { count: 1, rankCounts: { A: 1 }, suitCounts: { hearts: 1 } },
    actionStats: {
      south: {
        plays: 1,
        passes: 0,
        cardsPlayed: 1,
        patternCounts: { single: 1 },
      },
    },
  });
  expect(legacy.publicCards.count).toBe(0);
  expect(legacy.actionStats.south.plays).toBe(0);
  expect("opponentHands" in observation).toBe(false);
  expect("seed" in observation).toBe(false);
});

test("P7-01：四座观察共享同一公开事实，但只标识当前观察者的座位关系", () => {
  const publicActions = projectPublicActions(
    [event],
    new Map([[publicCard.id, publicCard]]),
  );
  const observations = (["east", "south", "west", "north"] as const).map(
    (selfSeat) => createStrategyObservation(view({ selfSeat, publicActions })),
  );

  expect(observations.map((observation) => observation.publicCards)).toEqual([
    observations[0].publicCards,
    observations[0].publicCards,
    observations[0].publicCards,
    observations[0].publicCards,
  ]);
  expect(observations.map((observation) => observation.seats.teammate)).toEqual(
    ["west", "north", "east", "south"],
  );
  expectTypeOf<StrategyObservation>().not.toHaveProperty("opponentHands");
  expectTypeOf<StrategyObservation>().not.toHaveProperty("seed");
});

test("P7-01：赛局上下文是只读公开事实的一部分", () => {
  const observation = createStrategyObservation(
    view({
      matchContext: {
        roundNumber: 3,
        teamLevels: { northSouth: "A", eastWest: "9" },
        aStageTeams: ["northSouth"],
        tribute: {
          phase: "awaiting-tribute",
          kind: "single",
          antiTribute: false,
        },
        firstLeadSource: "tribute",
      },
    }),
  );

  expect(observation.match).toEqual({
    roundNumber: 3,
    teamLevels: { northSouth: "A", eastWest: "9" },
    aStageTeams: ["northSouth"],
    tribute: { phase: "awaiting-tribute", kind: "single", antiTribute: false },
    firstLeadSource: "tribute",
  });
});
