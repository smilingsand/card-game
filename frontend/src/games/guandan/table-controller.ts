import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Event, Seat } from "../../platform/types";
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
  /** 所有已提交动作的公开事实；机器人只能从这里记牌。 */
  readonly publicEvents: readonly Event[];
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
      current: "south",
      leader: "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
}

function combinations<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]): void => {
    if (selected.length === size) {
      result.push(selected);
      return;
    }
    for (let index = start; index <= items.length - (size - selected.length); index += 1)
      visit(index + 1, [...selected, items[index]]);
  };
  visit(0, []);
  return result;
}

function leadingCardCandidates(hand: readonly Card[]): readonly (readonly Card[])[] {
  const groups = [
    ...hand
      .reduce((byRank, card) => {
        byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
        return byRank;
      }, new Map<Card["rank"], Card[]>())
      .values()
  ];
  const completeGroups = groups.filter((group) => group.length >= 2 && group.length <= 10);
  const threeWithPairs = groups
    .filter((group) => group.length === 3)
    .flatMap((triple) =>
      groups.filter((group) => group.length === 2).map((pair) => [...triple, ...pair])
    );
  const candidates = [...hand.map((card) => [card]), ...completeGroups, ...threeWithPairs];
  const seen = new Set<string>();
  return candidates.filter((cards) => {
    const key = cards
      .map((card) => card.id)
      .sort()
      .join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function botCardCandidates(game: TableGame): readonly (readonly Card[])[] {
  const hand = game.state.hands[game.state.current]
    .map((cardId) => game.cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  if (!game.state.highest) return leadingCardCandidates(hand);
  return combinations(hand, game.state.highest.cardIds.length);
}

/**
 * 机器人候选只来源于自己的手牌，并先通过规则引擎筛选。
 * 领出时枚举单张、完整同点数组及不拆组的三带二；跟牌时枚举与当前牌
 * 张数相同的组合，因而能覆盖对子、三张、三带二等非单张同牌型压制。
 */
export function getLegalBotActions(game: TableGame): readonly TurnAction[] {
  const plays = botCardCandidates(game).flatMap((cards) => {
    const recognition = recognizePatterns(cards, LEVEL_RANK);
    if (!recognition.ok) return [];
    return recognition.interpretations.map((interpretation) => ({
      type: "play" as const,
      actor: game.state.current,
      cardIds: cards.map((card) => card.id),
      interpretation
    }));
  });
  const candidates: TurnAction[] = [
    ...plays,
    ...(game.state.highest ? [{ type: "pass" as const, actor: game.state.current }] : [])
  ];
  return getLegalActions(game.state, candidates);
}

/** @deprecated P1-15E 起机器人会枚举可跟的非单张牌型；保留旧导出供调用方平滑迁移。 */
export const getLegalSingleActions = getLegalBotActions;

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
  const legalActions = getLegalBotActions(game);
  return chooseBasicBotAction(
    createBotView({
      selfSeat: game.state.current,
      leader: game.state.leader,
      highestSeat: game.state.highestSeat,
      levelRank: LEVEL_RANK,
      hand: game.state.hands[game.state.current]
        .map((cardId) => game.cardsById.get(cardId))
        .filter((card): card is Card => card !== undefined),
      publicEvents: game.publicEvents,
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
