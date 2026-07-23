// Shared Guandan core source.
import type { Seat } from "../../platform/types";
import type { BotView } from "./bot-view";
import type { TurnAction } from "./turns";

export const NORMAL_VNEXT_METRIC_IDS = [
  "illegal_action",
  "forced_pass",
  "low_cost_beat_missed",
  "teammate_overtake",
  "joker_over_low_single",
  "triple_split_for_single",
  "bomb_split_for_normal_play",
  "high_pair_used_as_kicker",
  "endgame_block_missed",
] as const;
export type NormalVNextMetricId = (typeof NORMAL_VNEXT_METRIC_IDS)[number];
const teammate: Record<Seat, Seat> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south",
};

/** Pure diagnostic classifier; it never feeds back into normal-vNext selection. */
export function diagnoseNormalVNextAction(
  view: BotView,
  selectedAction: TurnAction,
): readonly NormalVNextMetricId[] {
  const alerts: NormalVNextMetricId[] = [];
  if (
    !view.legalActions.some(
      (action) => JSON.stringify(action) === JSON.stringify(selectedAction),
    )
  )
    return ["illegal_action"];
  const plays = view.legalActions.filter((action) => action.type === "play");
  if (selectedAction.type === "pass") {
    if (plays.length === 0) alerts.push("forced_pass");
    if (plays.some((action) => action.interpretation.type === "single"))
      alerts.push("low_cost_beat_missed");
    if (
      Object.entries(view.remainingCardCounts).some(
        ([seat, count]) =>
          seat !== view.selfSeat &&
          seat !== teammate[view.selfSeat] &&
          count <= 3,
      )
    )
      alerts.push("endgame_block_missed");
    return alerts;
  }
  if (view.highestSeat === teammate[view.selfSeat])
    alerts.push("teammate_overtake");
  if (selectedAction.interpretation.type === "single") {
    const card = view.selfHand.find(
      (item) => item.id === selectedAction.cardIds[0],
    );
    const copies = card
      ? view.selfHand.filter((item) => item.rank === card.rank).length
      : 0;
    if (copies === 3) alerts.push("triple_split_for_single");
    if (copies >= 4) alerts.push("bomb_split_for_normal_play");
    if (
      card?.suit === "joker" &&
      plays.some(
        (item) =>
          item.interpretation.type === "single" && item.cardIds[0] !== card.id,
      )
    )
      alerts.push("joker_over_low_single");
  }
  if (
    selectedAction.interpretation.type === "three-with-pair" &&
    selectedAction.cardIds.some(
      (id) => view.selfHand.find((card) => card.id === id)?.rank === "A",
    )
  )
    alerts.push("high_pair_used_as_kicker");
  return alerts;
}
