import type { Event, Rank, Seat } from "../../platform/types";
import type { BotView } from "./bot-view";

const teammateOf: Record<Seat, Seat> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south"
};
type PublicAction = {
  readonly type: "play";
  readonly actor: Seat;
  readonly cardIds: readonly string[];
  readonly interpretation: { readonly comparisonKey: readonly number[] };
};
function publicAction(event: Event): PublicAction | undefined {
  if (
    event.type !== "action.applied" ||
    typeof event.payload !== "object" ||
    event.payload === null
  )
    return undefined;
  const action = (event.payload as { readonly action?: unknown }).action;
  if (!action || typeof action !== "object") return undefined;
  const candidate = action as Partial<PublicAction>;
  return candidate.type === "play" &&
    Array.isArray(candidate.cardIds) &&
    Array.isArray(candidate.interpretation?.comparisonKey)
    ? (candidate as PublicAction)
    : undefined;
}
export interface StrategyAnalysis {
  readonly facts: {
    readonly rankGroups: readonly { readonly rank: Rank; readonly count: number }[];
    readonly remainingCardCounts: Readonly<Record<Seat, number>>;
    readonly publicHighCards: Readonly<Record<Seat, number>>;
  };
  readonly role: {
    readonly kind: "attack" | "support";
    readonly confidence: number;
    readonly reason: string;
  };
}
export function analyzeStrategy(view: BotView): StrategyAnalysis {
  const rankGroups = [
    ...view.selfHand.reduce(
      (counts, card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1),
      new Map<Rank, number>()
    )
  ]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => a.rank.localeCompare(b.rank));
  const publicHighCards: Record<Seat, number> = { east: 0, south: 0, west: 0, north: 0 };
  for (const event of view.publicEvents) {
    const action = publicAction(event);
    if (action && (action.interpretation.comparisonKey.at(-1) ?? 0) >= 14)
      publicHighCards[action.actor] += action.cardIds.length;
  }
  const teammate = teammateOf[view.selfSeat],
    selfCount = view.remainingCardCounts[view.selfSeat],
    teammateCount = view.remainingCardCounts[teammate];
  const role =
    selfCount < teammateCount
      ? {
          kind: "attack" as const,
          confidence: Math.min(0.9, 0.5 + (teammateCount - selfCount) / 27),
          reason: "己方剩余手数少于对家"
        }
      : selfCount === teammateCount
        ? { kind: "support" as const, confidence: 0.25, reason: "己方与对家剩余手数相同" }
        : {
            kind: "support" as const,
            confidence: Math.min(0.9, 0.5 + (selfCount - teammateCount) / 27),
            reason: "对家剩余手数少于己方"
          };
  return {
    facts: { rankGroups, remainingCardCounts: { ...view.remainingCardCounts }, publicHighCards },
    role
  };
}
