import type { Seat } from "@card-game/guandan-core";
import { createDisplayPositions, logicalSeatOrder } from "../components/table/table-contract";

export type TablePosition = "bottom" | "left" | "top" | "right";

export const LOGICAL_SEAT_ORDER = logicalSeatOrder;

/**
 * Compatibility helper for lobby/tests. The active multiplayer table consumes
 * createDisplayPositions directly through useMultiplayerTableAdapter.
 */
export function projectSeatsForViewer(viewerSeat: Seat): Record<TablePosition, Seat> {
  const positions = createDisplayPositions(viewerSeat);
  return Object.fromEntries(
    (["bottom", "left", "top", "right"] as const).map((position) => [
      position,
      (Object.entries(positions).find(([, display]) => display === position)?.[0] ??
        viewerSeat) as Seat
    ])
  ) as Record<TablePosition, Seat>;
}
