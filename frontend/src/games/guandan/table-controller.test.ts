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

test("提示与机器人共用策略，不拆 J 炸弹为单张", () => {
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
    cardIds: ["south-ja", "south-jb", "south-jc", "south-jd"],
    interpretation: { type: "normal-bomb" }
  });
});
