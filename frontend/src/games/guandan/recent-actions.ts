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
    if (actions.slice(index, index + 3).every((action) => action.type === "pass"))
      start = index + 3;
  }
  return actions.slice(start).slice(-4);
}

/** 最近一圈中每个座位只显示其最后一次动作，避免旧的“不要”重复残留。 */
export function latestRecentActionsBySeat(events: readonly Event[]): readonly TurnAction[] {
  const latestBySeat = new Map<Seat, TurnAction>();
  for (const action of currentTrickActions(events)) latestBySeat.set(action.actor, action);
  return [...latestBySeat.values()];
}
