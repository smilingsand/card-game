import { formatCard, type Card } from "@card-game/guandan-core";
import type { DragEvent, KeyboardEvent, TouchEvent } from "react";
import { CardFace } from "./CardFace";
import type { TableInteractionCallbacks, TableViewModel } from "./table-contract";

export type { HandViewGroup } from "./table-contract";

export function HandView({
  groups,
  handLayout,
  selectedCardIds,
  selectableCardIds,
  draggable,
  levelRank,
  onToggleCard,
  onTouchEnd,
  onDragStart,
  onDragEnd,
  onDrop,
  onKeyDown
}: {
  readonly groups: TableViewModel["ownHand"];
  readonly handLayout: TableViewModel["handLayout"];
  readonly selectedCardIds: TableViewModel["selectedCardIds"];
  readonly selectableCardIds: TableViewModel["selectableCardIds"];
  readonly draggable: boolean;
  readonly levelRank: Card["rank"];
  readonly onToggleCard: TableInteractionCallbacks["onToggleCard"];
  readonly onTouchEnd: (event: TouchEvent<HTMLButtonElement>, cardId: string) => void;
  readonly onDragStart: (event: DragEvent<HTMLButtonElement>, cardId: string) => void;
  readonly onDragEnd: () => void;
  readonly onDrop: (event: DragEvent<HTMLButtonElement>, cardId: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, cardId: string) => void;
}) {
  return (
    <div className={`card-groups human-hand ${handLayout}`}>
      {groups.map((group) => (
        <span className="card-stack joined-card-stack" key={group.key}>
          {group.cards.map((card, index) => {
            const selected = selectedCardIds.includes(card.id);
            const compact = handLayout === "stacked" && index > 0;
            return (
              <button
                key={card.id}
                type="button"
                className={`hand-card${compact ? " compact-card" : ""}`}
                aria-pressed={selected}
                aria-label={`选择${formatCard(card)}`}
                aria-describedby="hand-arrangement-help"
                data-card-id={card.id}
                disabled={!selectableCardIds.includes(card.id)}
                aria-disabled={!selectableCardIds.includes(card.id)}
                draggable={draggable}
                onClick={() => onToggleCard(card.id)}
                onTouchEnd={(event) => onTouchEnd(event, card.id)}
                onDragStart={(event) => onDragStart(event, card.id)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDrop(event, card.id)}
                onKeyDown={(event) => onKeyDown(event, card.id)}
              >
                <CardFace card={card} compact={compact} levelRank={levelRank} />
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}
