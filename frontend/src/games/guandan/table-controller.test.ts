import { expect, test } from "vitest";
import type { Card } from "../../platform/types";
import {
  chooseTableHintAction,
  chooseTableBotAction,
  createTableGame,
  getSelectedPlayActions,
  submitTableAction,
  type TableGame
} from "./table-controller";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  suit,
  rank
});

test("首局由南座领出，且后续按逆时针进入东座", () => {
  const game = createTableGame(73);

  const opening = chooseTableBotAction(game);
  expect(opening).toMatchObject({ type: "play", actor: "south" });
  if (!opening) return;

  expect(submitTableAction(game, opening)).toMatchObject({ ok: true, state: { current: "east" } });
});

test("东家领出后，北家有可压制单张时会接牌", () => {
  const east = card("east-3", "3");
  const eastOther = card("east-2", "2");
  const north = card("north-4", "4");
  const game: TableGame = {
    cardsById: new Map([
      [east.id, east],
      [eastOther.id, eastOther],
      [north.id, north]
    ]),
    state: {
      hands: {
        east: [east.id, eastOther.id],
        south: ["south-1", "south-2"],
        west: ["west-1", "west-2"],
        north: [north.id, "north-other"]
      },
      current: "east",
      leader: "east",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const opening = getSelectedPlayActions(game, [east.id])[0];
  expect(opening).toBeDefined();
  if (!opening) return;

  const result = submitTableAction(game, opening);
  expect(result).toMatchObject({ ok: true, state: { current: "north" } });
  if (!result.ok) return;

  const responseGame = { ...game, state: result.state };
  const response = chooseTableBotAction(responseGame);
  expect(response).toMatchObject({ type: "play", actor: "north", cardIds: [north.id] });
  expect(chooseTableHintAction(responseGame)).toEqual(response);
  expect(chooseTableBotAction(responseGame)).toMatchObject({
    type: "play",
    actor: "north",
    cardIds: [north.id]
  });
});

test("机器人从合法动作中枚举并压制三带二", () => {
  const southCards = [
    card("south-5a", "5", "spades"),
    card("south-5b", "5", "hearts"),
    card("south-5c", "5", "diamonds"),
    card("south-4a", "4", "spades"),
    card("south-4b", "4", "hearts")
  ];
  const westCards = [
    card("west-8a", "8", "spades"),
    card("west-8b", "8", "hearts"),
    card("west-8c", "8", "diamonds"),
    card("west-9a", "9", "spades"),
    card("west-9b", "9", "hearts")
  ];
  const game: TableGame = {
    cardsById: new Map([...southCards, ...westCards].map((item) => [item.id, item])),
    state: {
      hands: {
        east: ["east-other"],
        south: southCards.map((item) => item.id),
        west: westCards.map((item) => item.id),
        north: ["north-other"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const lead = getSelectedPlayActions(
    game,
    southCards.map((item) => item.id)
  )[0];
  expect(lead).toMatchObject({ interpretation: { type: "three-with-pair" } });
  if (!lead) return;

  const led = submitTableAction(game, lead);
  expect(led).toMatchObject({ ok: true, state: { current: "east" } });
  if (!led.ok) return;
  const beforeWest = submitTableAction(
    { ...game, state: led.state },
    { type: "pass", actor: "east" }
  );
  expect(beforeWest).toMatchObject({ ok: true, state: { current: "north" } });
  if (!beforeWest.ok) return;
  const westTurn = submitTableAction(
    { ...game, state: beforeWest.state },
    { type: "pass", actor: "north" }
  );
  expect(westTurn).toMatchObject({ ok: true, state: { current: "west" } });
  if (!westTurn.ok) return;

  expect(chooseTableBotAction({ ...game, state: westTurn.state })).toMatchObject({
    type: "play",
    actor: "west",
    cardIds: expect.arrayContaining(westCards.map((item) => item.id)),
    interpretation: { type: "three-with-pair", comparisonKey: [8] }
  });
});

test("机器人领出时不把完整三张拆成单张", () => {
  const southCards = [
    card("south-9a", "9", "spades"),
    card("south-9b", "9", "clubs"),
    card("south-9c", "9", "diamonds")
  ];
  const game: TableGame = {
    cardsById: new Map(southCards.map((item) => [item.id, item])),
    state: {
      hands: {
        east: ["east-1", "east-2", "east-3"],
        south: southCards.map((item) => item.id),
        west: ["west-1", "west-2", "west-3"],
        north: ["north-1", "north-2", "north-3"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };

  expect(chooseTableBotAction(game)).toMatchObject({
    type: "play",
    actor: "south",
    cardIds: southCards.map((item) => item.id),
    interpretation: { type: "triple" }
  });
});

test("低位单张没有回收牌时，机器人会枚举并领出自然顺子", () => {
  const southCards = [
    card("south-3", "3"),
    card("south-5", "5"),
    card("south-6", "6", "hearts"),
    card("south-7", "7", "diamonds"),
    card("south-8", "8", "clubs"),
    card("south-9", "9")
  ];
  const game: TableGame = {
    cardsById: new Map(southCards.map((item) => [item.id, item])),
    state: {
      hands: {
        east: ["east-1", "east-2", "east-3"],
        south: southCards.map((item) => item.id),
        west: ["west-1", "west-2", "west-3"],
        north: ["north-1", "north-2", "north-3"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };

  expect(chooseTableBotAction(game)).toMatchObject({
    type: "play",
    actor: "south",
    cardIds: ["south-5", "south-6", "south-7", "south-8", "south-9"],
    interpretation: { type: "straight" }
  });
});

test("提示与机器人共用策略，首轮有普通牌时不领出炸弹", () => {
  const southCards = [
    card("south-ja", "J", "spades"),
    card("south-jb", "J", "hearts"),
    card("south-jc", "J", "clubs"),
    card("south-jd", "J", "diamonds"),
    card("south-a", "A")
  ];
  const game: TableGame = {
    cardsById: new Map(southCards.map((item) => [item.id, item])),
    state: {
      hands: {
        east: ["east-1", "east-2", "east-3"],
        south: southCards.map((item) => item.id),
        west: ["west-1", "west-2", "west-3"],
        north: ["north-1", "north-2", "north-3"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };

  expect(chooseTableHintAction(game)).toEqual(chooseTableBotAction(game));
  expect(chooseTableHintAction(game)).toMatchObject({
    type: "play",
    actor: "south",
    cardIds: ["south-a"],
    interpretation: { type: "single" }
  });
});

test("机器人跟炸时使用完整更大炸弹，不拆五张炸为四张", () => {
  const southCards = [
    card("south-6a", "6", "spades"),
    card("south-6b", "6", "hearts"),
    card("south-6c", "6", "clubs"),
    card("south-6d", "6", "diamonds")
  ];
  const eastCards = [
    card("east-8a", "8", "spades"),
    card("east-8b", "8", "hearts"),
    card("east-8c", "8", "clubs"),
    card("east-8d", "8", "diamonds"),
    card("east-8e", "8", "spades")
  ];
  const game: TableGame = {
    cardsById: new Map([...southCards, ...eastCards].map((item) => [item.id, item])),
    state: {
      hands: {
        east: eastCards.map((item) => item.id),
        south: southCards.map((item) => item.id),
        west: ["west-other"],
        north: ["north-other"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const southBomb = getSelectedPlayActions(
    game,
    southCards.map((item) => item.id)
  )[0];
  expect(southBomb).toMatchObject({ interpretation: { type: "normal-bomb" } });
  if (!southBomb) return;

  const played = submitTableAction(game, southBomb);
  expect(played).toMatchObject({ ok: true, state: { current: "east" } });
  if (!played.ok) return;

  expect(chooseTableBotAction({ ...game, state: played.state })).toMatchObject({
    type: "play",
    actor: "east",
    cardIds: eastCards.map((item) => item.id),
    interpretation: { type: "normal-bomb", comparisonKey: [5, 8] }
  });
});

test("机器人可以用完整炸弹压制不同牌型", () => {
  const southCards = [card("south-aa", "A", "spades"), card("south-ab", "A", "hearts")];
  const eastCards = [
    card("east-3a", "3", "spades"),
    card("east-3b", "3", "hearts"),
    card("east-3c", "3", "clubs"),
    card("east-3d", "3", "diamonds")
  ];
  const game: TableGame = {
    cardsById: new Map([...southCards, ...eastCards].map((item) => [item.id, item])),
    state: {
      hands: {
        east: eastCards.map((item) => item.id),
        south: southCards.map((item) => item.id),
        west: ["west-other"],
        north: ["north-other"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const southPair = getSelectedPlayActions(
    game,
    southCards.map((item) => item.id)
  )[0];
  expect(southPair).toMatchObject({ interpretation: { type: "pair" } });
  if (!southPair) return;

  const played = submitTableAction(game, southPair);
  if (!played.ok) return;

  expect(chooseTableBotAction({ ...game, state: played.state })).toMatchObject({
    type: "play",
    actor: "east",
    cardIds: eastCards.map((item) => item.id),
    interpretation: { type: "normal-bomb", comparisonKey: [4, 3] }
  });
});

test("normal strategy uses a matching three-with-pair instead of an unnecessary bomb", () => {
  const southCards = [
    card("south-4a", "4", "spades"),
    card("south-4b", "4", "hearts"),
    card("south-4c", "4", "diamonds"),
    card("south-3a", "3", "spades"),
    card("south-3b", "3", "hearts")
  ];
  const westResponse = [
    card("west-5a", "5", "spades"),
    card("west-5b", "5", "hearts"),
    card("west-5c", "5", "diamonds"),
    card("west-3a", "3", "clubs"),
    card("west-3b", "3", "diamonds")
  ];
  const westBomb = [
    card("west-ja", "J", "spades"),
    card("west-jb", "J", "hearts"),
    card("west-jc", "J", "clubs"),
    card("west-jd", "J", "diamonds")
  ];
  const game: TableGame = {
    cardsById: new Map(
      [...southCards, ...westResponse, ...westBomb].map((item) => [item.id, item])
    ),
    state: {
      hands: {
        east: ["east-other"],
        south: southCards.map((item) => item.id),
        west: [...westResponse, ...westBomb].map((item) => item.id),
        north: ["north-other"]
      },
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const lead = getSelectedPlayActions(
    game,
    southCards.map((item) => item.id)
  )[0];
  expect(lead).toMatchObject({ interpretation: { type: "three-with-pair", comparisonKey: [4] } });
  if (!lead) return;
  const afterLead = submitTableAction(game, lead);
  if (!afterLead.ok) return;
  const afterEastPass = submitTableAction(
    { ...game, state: afterLead.state },
    { type: "pass", actor: "east" }
  );
  if (!afterEastPass.ok) return;
  const afterNorthPass = submitTableAction(
    { ...game, state: afterEastPass.state },
    { type: "pass", actor: "north" }
  );
  if (!afterNorthPass.ok) return;

  expect(chooseTableBotAction({ ...game, state: afterNorthPass.state })).toMatchObject({
    type: "play",
    actor: "west",
    cardIds: expect.arrayContaining(westResponse.map((item) => item.id)),
    interpretation: { type: "three-with-pair", comparisonKey: [5] }
  });
});

test("normal-vNext blocks the next seat with the largest joker when it has one card", () => {
  const eastAce = card("east-a", "A");
  const bigJoker = card("north-big", "big-joker", "joker");
  const smallJokerOne = card("north-small-1", "small-joker", "joker");
  const smallJokerTwo = card("north-small-2", "small-joker", "joker");
  const game: TableGame = {
    cardsById: new Map(
      [eastAce, bigJoker, smallJokerOne, smallJokerTwo].map((item) => [item.id, item])
    ),
    state: {
      hands: {
        east: [eastAce.id],
        south: ["south-other"],
        west: ["west-other"],
        north: [bigJoker.id, smallJokerOne.id, smallJokerTwo.id]
      },
      current: "east",
      leader: "east",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const lead = getSelectedPlayActions(game, [eastAce.id])[0];
  if (!lead) return;
  const afterLead = submitTableAction(game, lead);
  if (!afterLead.ok) return;
  expect(chooseTableBotAction({ ...game, state: afterLead.state })).toMatchObject({
    type: "play",
    actor: "north",
    cardIds: [bigJoker.id],
    interpretation: { type: "single", comparisonKey: [17] }
  });
});

test("normal-vNext blocks the next seat with the largest joker before preserving a straight", () => {
  const eastNine = card("east-9", "9");
  const northStraight = [
    card("north-10", "10"),
    card("north-j", "J"),
    card("north-q", "Q"),
    card("north-k", "K"),
    card("north-a", "A")
  ];
  const smallJoker = card("north-small", "small-joker", "joker");
  const bigJoker = card("north-big", "big-joker", "joker");
  const game: TableGame = {
    cardsById: new Map(
      [eastNine, ...northStraight, smallJoker, bigJoker].map((item) => [item.id, item])
    ),
    state: {
      hands: {
        east: [eastNine.id],
        south: ["south-other"],
        west: ["west-other"],
        north: [...northStraight, smallJoker, bigJoker].map((item) => item.id)
      },
      current: "east",
      leader: "east",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
  const lead = getSelectedPlayActions(game, [eastNine.id])[0];
  if (!lead) return;
  const afterLead = submitTableAction(game, lead);
  if (!afterLead.ok) return;
  expect(chooseTableBotAction({ ...game, state: afterLead.state })).toMatchObject({
    type: "play",
    actor: "north",
    cardIds: [bigJoker.id],
    interpretation: { type: "single", comparisonKey: [17] }
  });
});
