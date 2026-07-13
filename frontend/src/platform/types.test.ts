import { expect, expectTypeOf, test } from "vitest";
import type { Action, Card, Event, Player, Rank, Seat, Suit, Team } from "./types";

test("公共平台类型可表示拥有唯一实体 ID 的卡牌和桌面参与者", () => {
  const firstSeven: Card = {
    id: "deck-1-hearts-7",
    deckIndex: 0,
    suit: "hearts",
    rank: "7"
  };
  const secondSeven: Card = {
    ...firstSeven,
    id: "deck-2-hearts-7",
    deckIndex: 1
  };
  const player: Player = {
    id: "player-east",
    seat: "east",
    team: "team-a",
    controllerType: "human",
    displayName: "东家"
  };

  expect(firstSeven.id).not.toBe(secondSeven.id);
  expect(player.seat).toBe("east");
  expectTypeOf<Suit>().toEqualTypeOf<"spades" | "hearts" | "diamonds" | "clubs" | "joker">();
  expectTypeOf<Rank>().toMatchTypeOf<string>();
  expectTypeOf<Seat>().toEqualTypeOf<"east" | "south" | "west" | "north">();
  expectTypeOf<Team>().toEqualTypeOf<"team-a" | "team-b">();
});

test("动作和事件可携带插件定义的载荷", () => {
  const action: Action<{ readonly cardIds: readonly string[] }> = {
    type: "play-cards",
    actorId: "player-east",
    payload: { cardIds: ["deck-1-hearts-7"] }
  };
  const event: Event<{ readonly actionType: string }> = {
    sequence: 0,
    type: "action-applied",
    actorId: action.actorId,
    payload: { actionType: action.type }
  };

  expect(event.payload.actionType).toBe("play-cards");
});

// 卡牌身份是必填字段，不能退化为仅由花色和点数识别。
// @ts-expect-error Card 必须包含物理牌唯一 ID。
const cardWithoutId: Card = {
  deckIndex: 0,
  suit: "hearts",
  rank: "7"
};

void cardWithoutId;
