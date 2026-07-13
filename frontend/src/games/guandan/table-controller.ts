import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Seat } from "../../platform/types";
import { chooseBasicBotAction } from "./basic-bot";
import { createBotView } from "./bot-view";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import {
  applyAction,
  validateAction,
  type TurnAction,
  type TurnResult,
  type TurnState
} from "./turns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const LEVEL_RANK = "2" as const;

export interface TableGame {
  readonly cardsById: ReadonlyMap<string, Card>;
  readonly state: TurnState;
}

export function createTableGame(seed = 0): TableGame {
  const cards = shuffleDeck(generateDeck({ deckCount: 2, includeJokers: true }), seed);
  const deal = dealFourPlayers(cards);

  return {
    cardsById: new Map(cards.map((card) => [card.id, card])),
    state: {
      hands: {
        east: deal.east.map((card) => card.id),
        south: deal.south.map((card) => card.id),
        west: deal.west.map((card) => card.id),
        north: deal.north.map((card) => card.id)
      },
      current: "east",
      leader: "east",
      passes: 0,
      finished: []
    }
  };
}

function singleCardCandidates(game: TableGame): readonly TurnAction[] {
  return game.state.hands[game.state.current].flatMap((cardId) => {
    const card = game.cardsById.get(cardId);
    if (!card) return [];
    const recognition = recognizePatterns([card], LEVEL_RANK);
    if (!recognition.ok) return [];
    return recognition.interpretations.map((interpretation) => ({
      type: "play" as const,
      actor: game.state.current,
      cardIds: [cardId],
      interpretation
    }));
  });
}

export function getLegalSingleActions(game: TableGame): readonly TurnAction[] {
  const candidates: TurnAction[] = [
    ...singleCardCandidates(game),
    ...(game.state.highest ? [{ type: "pass" as const, actor: game.state.current }] : [])
  ];
  return getLegalActions(game.state, candidates);
}

/** 牌型识别和跟牌合法性均委托规则引擎；UI 仅传递所选实体牌 ID。 */
export function getSelectedPlayActions(
  game: TableGame,
  selectedCardIds: readonly string[]
): readonly TurnAction[] {
  const cards = selectedCardIds
    .map((cardId) => game.cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  if (cards.length !== selectedCardIds.length) return [];

  const recognition = recognizePatterns(cards, LEVEL_RANK);
  if (!recognition.ok) return [];
  return getLegalActions(
    game.state,
    recognition.interpretations.map((interpretation) => ({
      type: "play" as const,
      actor: game.state.current,
      cardIds: selectedCardIds,
      interpretation
    }))
  );
}

export function submitTableAction(game: TableGame, action: TurnAction): TurnResult {
  const validation = validateAction(game.state, action);
  return validation.ok ? applyAction(game.state, action) : validation;
}

export function chooseTableBotAction(game: TableGame): TurnAction | undefined {
  const legalActions = getLegalSingleActions(game);
  return chooseBasicBotAction(
    createBotView({
      selfSeat: game.state.current,
      leader: game.state.leader,
      highestSeat: game.state.highestSeat,
      levelRank: LEVEL_RANK,
      hand: game.state.hands[game.state.current]
        .map((cardId) => game.cardsById.get(cardId))
        .filter((card): card is Card => card !== undefined),
      publicEvents: [],
      remainingCardCounts: Object.fromEntries(
        SEATS.map((seat) => [seat, game.state.hands[seat].length])
      ) as Record<Seat, number>,
      legalActions
    })
  );
}

export function formatCard(card: Card): string {
  if (card.rank === "small-joker") return "小王";
  if (card.rank === "big-joker") return "大王";
  const suit = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣", joker: "" }[card.suit];
  return `${suit}${card.rank}`;
}

export function formatInterpretation(interpretation: PatternInterpretation): string {
  const names: Record<PatternInterpretation["type"], string> = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    "three-with-pair": "三带二",
    "three-consecutive-pairs": "三连对",
    "steel-plate": "钢板",
    straight: "顺子",
    "normal-bomb": "普通炸弹",
    "straight-flush": "同花顺",
    "four-jokers": "四王炸"
  };
  return names[interpretation.type];
}
