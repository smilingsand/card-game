import type { BotView } from "./bot-view";
import type { TurnAction } from "./turns";

const teammate: Record<BotView["selfSeat"], BotView["selfSeat"]> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south"
};
const bombs = new Set(["normal-bomb", "straight-flush", "four-jokers"]);
export interface NormalBotDecision {
  readonly action: TurnAction;
  readonly score: number;
  readonly reasons: readonly string[];
}
export function chooseNormalBotAction(view: BotView): NormalBotDecision | undefined {
  const threat = Object.entries(view.remainingCardCounts).some(
    ([seat, count]) => seat !== teammate[view.selfSeat] && seat !== view.selfSeat && count <= 1
  );
  const phase = view.selfHand.length > 18 ? "开局" : view.selfHand.length > 7 ? "中局" : "残局";
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
      return { action, score, reasons };
    })
    .sort(
      (a, b) =>
        a.score - b.score || JSON.stringify(a.action).localeCompare(JSON.stringify(b.action))
    );
  return ranked[0];
}
