// Shared Guandan core source.
import { canFollow } from "./comparison";
import type { PatternInterpretation } from "./patterns";
import type { Seat } from "../../platform/types";
/** 冻结规则：东家起，按逆时针东→北→西→南响应。 */
const ORDER: readonly Seat[] = ["east", "north", "west", "south"];
export interface TurnState {
  readonly hands: Readonly<Record<Seat, readonly string[]>>;
  readonly current: Seat;
  readonly leader: Seat;
  readonly highest?: PatternInterpretation;
  readonly highestSeat?: Seat;
  readonly passes: number;
  readonly finished: readonly Seat[];
  readonly completed?: true;
}
export type TurnAction =
  | {
      readonly type: "play";
      readonly actor: Seat;
      readonly cardIds: readonly string[];
      readonly interpretation: PatternInterpretation;
    }
  | { readonly type: "pass"; readonly actor: Seat };
export type TurnResult =
  | { readonly ok: true; readonly state: TurnState }
  | {
      readonly ok: false;
      readonly code:
        | "not_current_player"
        | "finished_player"
        | "cards_not_held"
        | "must_beat"
        | "cannot_pass_lead";
    };
const next = (seat: Seat, finished: readonly Seat[]) => {
  let i = ORDER.indexOf(seat);
  do {
    i = (i + 1) % 4;
  } while (finished.includes(ORDER[i]));
  return ORDER[i];
};
export function validateAction(
  state: TurnState,
  action: TurnAction,
): TurnResult {
  if (action.actor !== state.current)
    return { ok: false, code: "not_current_player" };
  if (state.finished.includes(action.actor))
    return { ok: false, code: "finished_player" };
  if (action.type === "pass")
    return state.highest
      ? { ok: true, state }
      : { ok: false, code: "cannot_pass_lead" };
  if (!action.cardIds.every((id) => state.hands[action.actor].includes(id)))
    return { ok: false, code: "cards_not_held" };
  if (state.highest && !canFollow(action.interpretation, state.highest))
    return { ok: false, code: "must_beat" };
  return { ok: true, state };
}
export function applyAction(state: TurnState, action: TurnAction): TurnResult {
  const valid = validateAction(state, action);
  if (!valid.ok) return valid;
  if (action.type === "play") {
    const hand = state.hands[action.actor].filter(
      (id) => !action.cardIds.includes(id),
    );
    const finished =
      hand.length === 0 ? [...state.finished, action.actor] : state.finished;
    const hands = { ...state.hands, [action.actor]: hand };
    if (finished.length === 4)
      return {
        ok: true,
        state: {
          ...state,
          hands,
          finished,
          completed: true,
          highest: action.interpretation,
          highestSeat: action.actor,
          passes: 0,
        },
      };
    return {
      ok: true,
      state: {
        ...state,
        hands,
        finished,
        current: next(action.actor, finished),
        highest: action.interpretation,
        highestSeat: action.actor,
        passes: 0,
      },
    };
  }
  const passes = state.passes + 1;
  const active =
    4 -
    state.finished.length -
    (state.finished.includes(state.highestSeat!) ? 0 : 1);
  if (passes >= active) {
    const winner = state.highestSeat!;
    const teammate = ORDER[(ORDER.indexOf(winner) + 2) % 4];
    const leader = state.finished.includes(winner)
      ? state.finished.includes(teammate)
        ? next(teammate, state.finished)
        : teammate
      : winner;
    return {
      ok: true,
      state: {
        ...state,
        leader,
        current: leader,
        highest: undefined,
        highestSeat: undefined,
        passes: 0,
      },
    };
  }
  return {
    ok: true,
    state: { ...state, current: next(action.actor, state.finished), passes },
  };
}
