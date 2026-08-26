// Shared Guandan core source.
import type { Card, Event, Rank, Seat } from "../../platform/types";
import type { PublicActionProjection } from "./public-action-projection";
import type { TurnAction } from "./turns";

export interface StrategyMatchContext {
  readonly roundNumber: number;
  readonly teamLevels: Readonly<{
    readonly northSouth: Exclude<Rank, "small-joker" | "big-joker">;
    readonly eastWest: Exclude<Rank, "small-joker" | "big-joker">;
  }>;
  readonly aStageTeams: readonly ("northSouth" | "eastWest")[];
  readonly tribute: Readonly<{
    readonly phase: "ready" | "awaiting-tribute" | "awaiting-return";
    readonly kind: "none" | "single" | "double";
    readonly antiTribute: boolean;
  }>;
  readonly firstLeadSource:
    "initial-south" | "round-leader" | "tribute" | "anti-tribute";
}
export interface BotView {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat?: Seat;
  readonly levelRank: Exclude<Rank, "small-joker" | "big-joker">;
  readonly selfHand: readonly Card[];
  readonly publicEvents: readonly Event[];
  /** 已经出现在桌面的可见牌面；不含牌堆、未出牌或任何对手手牌。 */
  readonly publicActions?: readonly PublicActionProjection[];
  /** 赛局公共上下文；单局工具可能不提供，策略必须兼容缺失值。 */
  readonly matchContext?: StrategyMatchContext;
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}
export function createBotView(input: {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat?: Seat;
  readonly levelRank: Exclude<Rank, "small-joker" | "big-joker">;
  readonly hand: readonly Card[];
  readonly publicEvents: readonly Event[];
  readonly publicActions?: readonly PublicActionProjection[];
  readonly matchContext?: StrategyMatchContext;
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly legalActions: readonly TurnAction[];
}): BotView {
  return {
    selfSeat: input.selfSeat,
    leader: input.leader,
    highestSeat: input.highestSeat,
    levelRank: input.levelRank,
    selfHand: [...input.hand],
    publicEvents: [...input.publicEvents],
    ...(input.publicActions ? { publicActions: [...input.publicActions] } : {}),
    ...(input.matchContext ? { matchContext: input.matchContext } : {}),
    remainingCardCounts: { ...input.remainingCardCounts },
    legalActions: [...input.legalActions],
  };
}
