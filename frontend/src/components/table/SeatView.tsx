import type { ReactNode } from "react";
import { PlayerCardCount } from "./CardFace";

export function SeatView({
  ariaLabel,
  className,
  zIndex,
  name,
  handSize,
  finishIndex,
  children
}: {
  readonly ariaLabel: string;
  readonly className: string;
  readonly zIndex: number;
  readonly name: string;
  readonly handSize: number;
  readonly finishIndex: number;
  readonly children?: ReactNode;
}) {
  return (
    <section className={className} aria-label={ariaLabel} style={{ zIndex }}>
      <strong>{name}</strong>
      <PlayerCardCount handSize={handSize} finishIndex={finishIndex} />
      {children}
    </section>
  );
}
