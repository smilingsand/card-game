import type { BotView } from "./bot-view";
import type { TurnAction } from "./turns";

const BOMB_TYPES = new Set(["normal-bomb", "straight-flush", "four-jokers"]);

function isBomb(action: TurnAction): boolean {
  return action.type === "play" && BOMB_TYPES.has(action.interpretation.type);
}

function hasNonBombCards(hand: BotView["selfHand"]): boolean {
  return hand.some(
    (card) =>
      card.suit === "joker" ||
      hand.filter((item) => item.rank === card.rank && item.suit !== "joker").length < 4
  );
}

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

function wildcardDownrankPenalty(action: TurnAction, view: BotView, endgame: boolean): number {
  if (action.type !== "play" || endgame) return 0;

  return Object.entries(action.interpretation.wildcardAs).some(([cardId, assigned]) => {
    const card = view.selfHand.find((item) => item.id === cardId);
    return (
      card?.suit === "hearts" && card.rank === view.levelRank && assigned.rank !== view.levelRank
    );
  })
    ? 10_000
    : 0;
}

function remainingHand(action: TurnAction, view: BotView): BotView["selfHand"] {
  if (action.type !== "play") return view.selfHand;
  const selected = new Set(action.cardIds);
  return view.selfHand.filter((card) => !selected.has(card.id));
}

function hasExactGroup(
  hand: BotView["selfHand"],
  count: number,
  allowedRanks: readonly string[]
): boolean {
  return allowedRanks.some(
    (rank) => hand.filter((card) => card.rank === rank && card.suit !== "joker").length === count
  );
}

function hasThreeWithPairRecovery(hand: BotView["selfHand"], levelRank: string): boolean {
  const highTripleRanks = ["J", "Q", "K", "A", levelRank].filter(
    (rank, index, ranks) => ranks.indexOf(rank) === index
  );
  return highTripleRanks.some(
    (tripleRank) =>
      hasExactGroup(hand, 3, [tripleRank]) &&
      hand.some(
        (card) =>
          card.suit !== "joker" &&
          card.rank !== tripleRank &&
          hand.filter((item) => item.rank === card.rank && item.suit !== "joker").length === 2
      )
  );
}

function hasRequiredRecovery(action: TurnAction, view: BotView): boolean {
  if (action.type !== "play") return true;

  const primaryRank = action.interpretation.comparisonKey.at(-1) ?? 0;
  const hand = remainingHand(action, view);
  switch (action.interpretation.type) {
    case "single":
      return (
        primaryRank >= 14 ||
        hand.some(
          (card) =>
            card.rank === "A" ||
            card.rank === view.levelRank ||
            card.rank === "small-joker" ||
            card.rank === "big-joker"
        )
      );
    case "pair":
      return primaryRank >= 13 || hasExactGroup(hand, 2, ["K", "A", view.levelRank]);
    case "triple":
      return primaryRank >= 11 || hasExactGroup(hand, 3, ["J", "Q", "K", "A", view.levelRank]);
    case "three-with-pair":
      return primaryRank >= 11 || hasThreeWithPairRecovery(hand, view.levelRank);
    default:
      return true;
  }
}

function score(
  action: TurnAction,
  view: BotView,
  protect: boolean,
  mustContest: boolean,
  endgame: boolean,
  leading: boolean
): number {
  const handSize = view.selfHand.length;
  if (action.type === "pass" && protect) return -1_000;
  if (action.type === "pass" && mustContest) return 1_000_000;
  if (action.type === "pass") return handSize <= 2 || endgame ? 1_000 : 0;

  if (leading) {
    const primaryRank = action.interpretation.comparisonKey.at(-1) ?? 0;
    return (
      10 +
      splitGroupPenalty(action, view.selfHand) * 1_000 +
      (hasRequiredRecovery(action, view) ? 0 : 100_000) +
      wildcardDownrankPenalty(action, view, endgame) +
      primaryRank * 100 -
      action.cardIds.length
    );
  }

  return (
    10 +
    splitGroupPenalty(action, view.selfHand) +
    wildcardDownrankPenalty(action, view, endgame) +
    action.cardIds.length * 100 +
    action.interpretation.comparisonKey.reduce((sum, value) => sum + value, 0)
  );
}

export function chooseBasicBotAction(view: BotView): TurnAction | undefined {
  const teammate = { east: "west", west: "east", south: "north", north: "south" }[view.selfSeat];
  const protect = view.highestSeat === teammate;
  const mustContest = view.highestSeat !== undefined && !protect;
  const endgame = Object.values(view.remainingCardCounts).some((count) => count <= 1);
  const leading = view.highestSeat === undefined;
  const legalActions = leading
    ? view.legalActions.filter(
        (action) =>
          action.type !== "play" ||
          !isBomb(action) ||
          action.cardIds.length === view.selfHand.length ||
          !hasNonBombCards(view.selfHand)
      )
    : view.legalActions;

  return [...legalActions].sort(
    (a, b) =>
      score(a, view, protect, mustContest, endgame, leading) -
        score(b, view, protect, mustContest, endgame, leading) ||
      JSON.stringify(a).localeCompare(JSON.stringify(b))
  )[0];
}
