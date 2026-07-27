import type { Card } from "@card-game/guandan-core";
import type { CSSProperties } from "react";
import { CardFace } from "./CardFace";
import type { TablePublicAction } from "./table-contract";

export type PublicActionView = TablePublicAction;

export function PublicActions({
  actions,
  className,
  levelRank,
  style
}: {
  readonly actions: readonly TablePublicAction[];
  readonly className: string;
  readonly levelRank: Card["rank"];
  readonly style?: CSSProperties;
}) {
  return (
    <span className={className} style={style}>
      {actions.map((action) => (
        <span key={action.key} className="public-action" aria-label={action.ariaLabel}>
          {action.pass ? (
            <span className="pass-word">不要</span>
          ) : (
            action.cards.map(({ card, wildcardAs }) => (
              <CardFace key={card.id} card={card} levelRank={levelRank} wildcardAs={wildcardAs} />
            ))
          )}
        </span>
      ))}
    </span>
  );
}
