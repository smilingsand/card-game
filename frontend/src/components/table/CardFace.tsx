import type { Card } from "@card-game/guandan-core";

export function CardFace({
  card,
  wildcardAs,
  compact = false,
  levelRank = "2"
}: {
  readonly card: Card;
  readonly wildcardAs?: { readonly rank: Card["rank"] };
  readonly compact?: boolean;
  readonly levelRank?: Card["rank"];
}) {
  const suit = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣", joker: "" }[card.suit];
  const rank =
    card.rank === "small-joker" ? "小王" : card.rank === "big-joker" ? "大王" : card.rank;
  const badge = card.rank === levelRank ? (card.suit === "hearts" ? "配" : "级") : undefined;
  return (
    <span className={`card-face size-token-card ${card.suit}${compact ? " compact" : ""}`}>
      {badge ? <span className="card-badge">{badge}</span> : null}
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{suit}</span>
      {wildcardAs ? <span className="wildcard-as">配{wildcardAs.rank}</span> : null}
    </span>
  );
}

const finishNames = ["头家", "二家", "三家", "末家"] as const;

export function PlayerCardCount({
  handSize,
  finishIndex
}: {
  readonly handSize: number;
  readonly finishIndex: number;
}) {
  const finishName = finishNames[finishIndex];
  return (
    <span
      className={
        finishName
          ? "card-count seat-card-count"
          : handSize < 10
            ? "card-count seat-card-count urgent"
            : "card-count seat-card-count"
      }
    >
      {finishName ?? handSize}
    </span>
  );
}
