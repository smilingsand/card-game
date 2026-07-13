import type { BotView } from "./bot-view";
import type { TurnAction } from "./turns";

function splitGroupPenalty(action: TurnAction, hand: BotView["selfHand"]): number {
  if (action.type !== "play") return 0;

  return action.cardIds.reduce((penalty, cardId) => {
    const card = hand.find((item) => item.id === cardId);
    if (!card || card.suit === "joker") return penalty;

    const sameRank = hand.filter((item) => item.rank === card.rank && item.suit !== "joker");
    const selectedOfRank = action.cardIds.filter(
      (selectedId) => hand.find((item) => item.id === selectedId)?.rank === card.rank
    );
    return penalty + (sameRank.length >= 2 && selectedOfRank.length < sameRank.length ? 500 : 0);
  }, 0);
}

function score(action: TurnAction, view: BotView, protect: boolean, endgame: boolean): number {
  const handSize = view.selfHand.length;
  if (action.type === "pass" && protect) return -1_000;
  if (action.type === "pass") return handSize <= 2 || endgame ? 1_000 : 0;

  return (
    10 +
    splitGroupPenalty(action, view.selfHand) +
    action.cardIds.length * 100 +
    action.interpretation.comparisonKey.reduce((sum, value) => sum + value, 0)
  );
}

export function chooseBasicBotAction(view: BotView): TurnAction | undefined {
  const teammate = { east: "west", west: "east", south: "north", north: "south" }[view.selfSeat];
  const protect = view.highestSeat === teammate;
  const endgame = Object.values(view.remainingCardCounts).some((count) => count <= 1);

  return [...view.legalActions].sort(
    (a, b) =>
      score(a, view, protect, endgame) - score(b, view, protect, endgame) ||
      JSON.stringify(a).localeCompare(JSON.stringify(b))
  )[0];
}
