import type { Card, Seat } from "@card-game/guandan-core";

export const logicalSeatOrder = [
  "south",
  "east",
  "north",
  "west"
] as const satisfies readonly Seat[];

export type TableDisplayPosition = "bottom" | "right" | "top" | "left";
export type TableGamePhase = "playing" | "tribute" | "completed";

export interface HandViewGroup {
  readonly key: string;
  readonly cards: readonly Card[];
}

export interface TablePublicAction {
  readonly key: string;
  readonly ariaLabel: string;
  readonly pass: boolean;
  readonly cards: readonly {
    readonly card: Card;
    readonly wildcardAs?: { readonly rank: Card["rank"] };
  }[];
}

/** 共享牌桌只能消费此个人视角模型，不能取得会话、全量牌表或隐藏状态。 */
export interface TableViewModel {
  readonly viewerLogicalSeat: Seat;
  readonly displayPositions: Readonly<Record<Seat, TableDisplayPosition>>;
  readonly ownHand: readonly HandViewGroup[];
  readonly selectedCardIds: readonly string[];
  readonly selectableCardIds: readonly string[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly publicActions: Readonly<Record<Seat, readonly TablePublicAction[]>>;
  readonly highestPlay?: TablePublicAction;
  readonly currentActorSeat: Seat;
  readonly teammateSeat: Seat;
  readonly canPlay: boolean;
  readonly canPass: boolean;
  readonly canHint: boolean;
  readonly isActionPending: boolean;
  readonly playerNames: Readonly<Record<Seat, string>>;
  readonly gamePhase: TableGamePhase;
  readonly handLayout: "stacked" | "flat";
}

export interface TableInteractionCallbacks {
  readonly onToggleCard: (cardId: string) => void;
  readonly onPlay: (selectedCardIds: readonly string[]) => void;
  readonly onPass: () => void;
  readonly onHint: () => void;
  readonly onReorderCard: (movingCardId: string, targetCardId: string) => void;
  readonly onChangeLayout: (layout: "stacked" | "flat") => void;
}

export function createDisplayPositions(
  viewerLogicalSeat: Seat
): Readonly<Record<Seat, TableDisplayPosition>> {
  const viewerIndex = logicalSeatOrder.indexOf(viewerLogicalSeat);
  if (viewerIndex < 0) throw new Error(`unknown seat: ${viewerLogicalSeat}`);
  const at = (offset: number) => logicalSeatOrder[(viewerIndex + offset) % logicalSeatOrder.length];
  return {
    [at(0)]: "bottom",
    [at(1)]: "right",
    [at(2)]: "top",
    [at(3)]: "left"
  } as Record<Seat, TableDisplayPosition>;
}

export function teammateOf(seat: Seat): Seat {
  return logicalSeatOrder[(logicalSeatOrder.indexOf(seat) + 2) % logicalSeatOrder.length];
}
