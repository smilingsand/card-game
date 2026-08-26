// Shared Guandan core source.
import type { Card, Event, Seat } from "../../platform/types";
import type { TurnAction } from "./turns";

export interface PublicCardFace {
  readonly id: string;
  readonly suit: Card["suit"];
  readonly rank: Card["rank"];
}

export interface PublicActionProjection {
  readonly sequence: number;
  readonly actor: Seat;
  readonly type: TurnAction["type"];
  readonly cards: readonly PublicCardFace[];
  readonly patternType?: Extract<
    TurnAction,
    { readonly type: "play" }
  >["interpretation"]["type"];
}

function actionFromEvent(event: Event): TurnAction | undefined {
  if (
    event.type !== "action.applied" ||
    typeof event.payload !== "object" ||
    event.payload === null
  )
    return undefined;
  const action = (event.payload as { readonly action?: unknown }).action;
  if (!action || typeof action !== "object") return undefined;
  const candidate = action as Partial<TurnAction>;
  return candidate.type === "play" || candidate.type === "pass"
    ? (candidate as TurnAction)
    : undefined;
}

/**
 * Projects only already-played cards into a public, serializable form.
 * `cardsById` stays at the trusted table boundary and is never returned.
 */
export function projectPublicActions(
  events: readonly Event[],
  cardsById: ReadonlyMap<string, Card>,
): readonly PublicActionProjection[] {
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap<PublicActionProjection>((event) => {
      const action = actionFromEvent(event);
      if (!action) return [];
      if (action.type === "pass")
        return [
          {
            sequence: event.sequence,
            actor: action.actor,
            type: "pass",
            cards: [],
          },
        ];
      const cards = action.cardIds.flatMap((id) => {
        const card = cardsById.get(id);
        return card ? [{ id: card.id, suit: card.suit, rank: card.rank }] : [];
      });
      return [
        {
          sequence: event.sequence,
          actor: action.actor,
          type: "play",
          patternType: action.interpretation.type,
          cards,
        },
      ];
    });
}
