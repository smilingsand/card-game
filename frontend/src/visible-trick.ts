import type { Event } from "@card-game/guandan-core";

export interface VisibleTrickStart {
  readonly roundNumber: number;
  readonly eventIndex: number;
}

/**
 * Projects public actions onto the currently visible trick.
 *
 * A completed trick is hidden immediately. A round number mismatch means a
 * new table has been created, so the old round's event offset must not be
 * applied to its fresh event stream.
 */
export function selectVisibleTrickEvents(
  events: readonly Event[],
  start: VisibleTrickStart,
  roundNumber: number,
  trickCleared: boolean
): readonly Event[] {
  if (trickCleared) return [];
  if (start.roundNumber !== roundNumber) return events;
  return events.slice(start.eventIndex);
}
