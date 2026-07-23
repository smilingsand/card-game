import type { Seat } from "@card-game/guandan-core";

export type TablePosition = "bottom" | "left" | "top" | "right";

export const LOGICAL_SEAT_ORDER: readonly Seat[] = ["south", "east", "north", "west"];

/**
 * Converts a viewer's fixed logical seat into display-only table positions.
 * It must never be used to rewrite action actors or the server event order.
 */
export function projectSeatsForViewer(viewerSeat: Seat): Record<TablePosition, Seat> {
  const index = LOGICAL_SEAT_ORDER.indexOf(viewerSeat);
  if (index < 0) throw new Error("invalid_viewer_seat");
  const at = (offset: number) =>
    LOGICAL_SEAT_ORDER[(index + offset + LOGICAL_SEAT_ORDER.length) % LOGICAL_SEAT_ORDER.length]!;
  return {
    bottom: at(0),
    left: at(-1),
    top: at(2),
    right: at(1)
  };
}
