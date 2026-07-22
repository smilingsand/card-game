import { expect, test } from "vitest";
import type { Card } from "../../platform/types";
import { diagnoseNormalVNextAction } from "./normal-vnext-metrics";
import type { TurnAction } from "./turns";
const card = (id: string, rank: Card["rank"]): Card => ({ id, deckIndex: 0, suit: rank.includes("joker") ? "joker" : "spades", rank });
const single = (id: string): TurnAction => ({ type: "play", actor: "east", cardIds: [id], interpretation: { type: "single", comparisonKey: [7], cardIds: [id], wildcardAs: {} } });
const view = (hand: readonly Card[], legalActions: readonly TurnAction[], highestSeat: "south" | "west" = "south") => ({ selfSeat: "east" as const, leader: "south" as const, highestSeat, levelRank: "2" as const, selfHand: hand, publicEvents: [], remainingCardCounts: { east: hand.length, south: 8, west: 8, north: 8 }, legalActions });
test("C2：指标触发与反例均为固定 BotView", () => {
  const pass: TurnAction = { type: "pass", actor: "east" }, low = single("low");
  expect(diagnoseNormalVNextAction(view([card("low", "7")], [pass, low]), pass)).toContain("low_cost_beat_missed");
  expect(diagnoseNormalVNextAction(view([card("a", "7"), card("b", "7"), card("c", "7")], [pass, single("a")]), single("a"))).toContain("triple_split_for_single");
  expect(diagnoseNormalVNextAction(view([card("a", "7"), card("b", "7"), card("c", "7"), card("d", "7")], [pass, single("a")]), single("a"))).toContain("bomb_split_for_normal_play");
  expect(diagnoseNormalVNextAction(view([card("joker", "small-joker"), card("low", "7")], [pass, single("joker"), low]), single("joker"))).toContain("joker_over_low_single");
  expect(diagnoseNormalVNextAction(view([card("low", "7")], [pass, low], "west"), low)).toContain("teammate_overtake");
  expect(diagnoseNormalVNextAction(view([card("low", "7")], [pass, low]), low)).toEqual([]);
});
