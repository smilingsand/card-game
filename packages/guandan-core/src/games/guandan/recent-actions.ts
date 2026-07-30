// Shared Guandan core source.
import type { Event, Seat } from "../../platform/types";
import type { TurnAction } from "./turns";

export function actionFromPublicEvent(event: Event): TurnAction | undefined {
  return (event.payload as { readonly action?: TurnAction }).action;
}

function currentTrickActions(events: readonly Event[]): readonly TurnAction[] {
  const actions = events
    .map(actionFromPublicEvent)
    .filter((action): action is TurnAction => !!action);
  let start = 0;
  for (let index = 0; index <= actions.length - 3; index += 1) {
    if (
      actions.slice(index, index + 3).every((action) => action.type === "pass")
    )
      start = index + 3;
  }
  return actions.slice(start).slice(-4);
}

/** 最近刚清墩的公开动作；仅用于在清空桌面前短暂展示最后一次“不要”。 */
export function latestCompletedTrickActions(
  events: readonly Event[],
): readonly TurnAction[] {
  const actions = events
    .map(actionFromPublicEvent)
    .filter((action): action is TurnAction => !!action);
  const finalPasses = actions.slice(-3);
  if (
    finalPasses.length !== 3 ||
    !finalPasses.every((action) => action.type === "pass")
  )
    return [];
  return actions.slice(-4);
}

/** 最近一圈中每个座位只显示其最后一次动作，避免旧的“不要”重复残留。 */
export function latestRecentActionsBySeat(
  events: readonly Event[],
): readonly TurnAction[] {
  const latestBySeat = new Map<Seat, TurnAction>();
  for (const action of currentTrickActions(events))
    latestBySeat.set(action.actor, action);
  return [...latestBySeat.values()];
}

/** Chronological layers for the visible actions in the current trick. Higher means later. */
export function latestRecentActionLayerBySeat(
  events: readonly Event[],
): ReadonlyMap<Seat, number> {
  const visible = new Set(latestRecentActionsBySeat(events));
  const layers = new Map<Seat, number>();
  events.forEach((event, index) => {
    const action = actionFromPublicEvent(event);
    if (action && visible.has(action)) layers.set(action.actor, index + 1);
  });
  return layers;
}
