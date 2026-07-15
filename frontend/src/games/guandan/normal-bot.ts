import type { BotView } from "./bot-view";
import { chooseBasicBotAction } from "./basic-bot";
import type { TurnAction } from "./turns";

const teammate: Record<BotView["selfSeat"], BotView["selfSeat"]> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south"
};
const bombs = new Set(["normal-bomb", "straight-flush", "four-jokers"]);
const STRAIGHT_RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A"
] as const;
export interface NormalBotDecision {
  readonly action: TurnAction;
  readonly score: number;
  readonly reasons: readonly string[];
}

function isBomb(action: TurnAction): boolean {
  return action.type === "play" && bombs.has(action.interpretation.type);
}

function hasNaturalStraightContaining(hand: BotView["selfHand"], rank: string): boolean {
  const ranks = new Set(hand.filter((card) => card.suit !== "joker").map((card) => card.rank));
  return Array.from({ length: STRAIGHT_RANKS.length - 4 }, (_, start) =>
    STRAIGHT_RANKS.slice(start, start + 5)
  ).some(
    (window) =>
      window.includes(rank as (typeof STRAIGHT_RANKS)[number]) &&
      window.every((item) => ranks.has(item))
  );
}

function structuralBreakPenalty(action: TurnAction, view: BotView): number {
  if (action.type !== "play" || action.interpretation.type !== "single") return 0;
  const card = view.selfHand.find((item) => item.id === action.cardIds[0]);
  if (!card) return 0;
  if (
    card.rank === "small-joker" &&
    view.selfHand.filter((item) => item.rank === "small-joker").length >= 2 &&
    view.selfHand.some((item) => item.rank === "big-joker")
  )
    return 2_000;
  if (
    card.suit !== "joker" &&
    view.selfHand.some((item) => item.suit === "joker") &&
    hasNaturalStraightContaining(view.selfHand, card.rank)
  )
    return 1_000;
  return 0;
}

function avoidUnnecessaryBombPenalty(action: TurnAction, hasNonBombLegalPlay: boolean): number {
  if (!isBomb(action)) return 0;
  return hasNonBombLegalPlay ? 10_000 : 0;
}

export function chooseNormalBotAction(view: BotView): NormalBotDecision | undefined {
  if (view.highestSeat === undefined) {
    const action = chooseBasicBotAction(view);
    return action ? { action, score: 0, reasons: ["领出沿用结构化基线"] } : undefined;
  }
  const threat = Object.entries(view.remainingCardCounts).some(
    ([seat, count]) => seat !== teammate[view.selfSeat] && seat !== view.selfSeat && count <= 1
  );
  const phase = view.selfHand.length > 18 ? "开局" : view.selfHand.length > 7 ? "中局" : "残局";
  const hasNonBombLegalPlay = view.legalActions.some(
    (action) => action.type === "play" && !isBomb(action)
  );
  const ranked = view.legalActions
    .map((action) => {
      const reasons: string[] = [];
      let score = action.type === "pass" ? 0 : (action.interpretation.comparisonKey.at(-1) ?? 0);
      if (
        action.type === "pass" &&
        view.highestSeat !== undefined &&
        view.highestSeat !== teammate[view.selfSeat]
      ) {
        score += 1_000;
        reasons.push("对手领出时优先压制");
      }
      if (view.highestSeat === teammate[view.selfSeat] && action.type === "pass") {
        score -= 10_000;
        reasons.push("让对家保持牌权");
      }
      if (threat && view.highestSeat !== teammate[view.selfSeat] && action.type !== "pass") {
        score -= 5_000;
        reasons.push("拦截对手残局");
      }
      if (action.type === "play" && bombs.has(action.interpretation.type) && !threat) {
        score += 500;
        reasons.push("保留炸弹");
      }
      reasons.push(`${phase}权重`);
      if (reasons.length === 1)
        reasons.push(action.type === "pass" ? "无低代价压制" : "最小合法代价");
      const unnecessaryBombPenalty = avoidUnnecessaryBombPenalty(action, hasNonBombLegalPlay);
      if (unnecessaryBombPenalty) {
        score += unnecessaryBombPenalty;
        reasons.push("同型可压时不使用炸弹");
      }
      const breakPenalty = structuralBreakPenalty(action, view);
      if (breakPenalty) {
        score += breakPenalty;
        reasons.push("保留王对子和自然顺子");
      }
      return { action, score, reasons, tieBreak: JSON.stringify(action) };
    })
    .sort((a, b) => a.score - b.score || a.tieBreak.localeCompare(b.tieBreak));
  return ranked[0];
}
