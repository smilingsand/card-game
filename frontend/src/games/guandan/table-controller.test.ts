import { expect, test } from "vitest";
import type { Card } from "../../platform/types";
import {
  chooseTableBotAction,
  createTableGame,
  getSelectedPlayActions,
  submitTableAction,
  type TableGame
} from "./table-controller";

const card = (id: string, rank: Card["rank"]): Card => ({
  id,
  deckIndex: 0,
  suit: "spades",
  rank
});

test("首局东座机器人通过 BotView 和统一规则入口领出", () => {
  const game = createTableGame(73);

  const opening = chooseTableBotAction(game);
  expect(opening).toMatchObject({ type: "play", actor: "east" });
  if (!opening) return;

  expect(submitTableAction(game, opening)).toMatchObject({ ok: true, state: { current: "south" } });
});

test("东家领出后，南家有可压制单张时会接牌", () => {
  const east = card("east-3", "3");
  const eastOther = card("east-2", "2");
  const south = card("south-4", "4");
  const game: TableGame = {
    cardsById: new Map([
      [east.id, east],
      [eastOther.id, eastOther],
      [south.id, south]
    ]),
    state: {
      hands: {
        east: [east.id, eastOther.id],
        south: [south.id, "south-other"],
        west: ["west-1", "west-2"],
        north: ["north-1", "north-2"]
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
  expect(result).toMatchObject({ ok: true, state: { current: "south" } });
  if (!result.ok) return;

  const response = chooseTableBotAction({ ...game, state: result.state });
  expect(response).toMatchObject({ type: "play", actor: "south", cardIds: [south.id] });
});
