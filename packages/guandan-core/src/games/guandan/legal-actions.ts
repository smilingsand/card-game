// Shared Guandan core source.
import { validateAction, type TurnAction, type TurnState } from "./turns";
/** 规则边界：只将通过统一 validateAction 的候选动作交给 BotView。 */
export function getLegalActions(
  state: TurnState,
  candidates: readonly TurnAction[],
): readonly TurnAction[] {
  return candidates.filter((action) => validateAction(state, action).ok);
}
