import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Event, Rank, Seat } from "../../platform/types";
import { chooseNormalVNextBotAction } from "./normal-vnext-bot";
import { describeNormalVNextAction } from "./normal-vnext-bot";
import { diagnoseNormalVNextAction } from "./normal-vnext-metrics";
import { createBotView } from "./bot-view";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import { getCompleteLegalCandidates } from "./rule-complete-legal-actions";
import {
  applyAction,
  validateAction,
  type TurnAction,
  type TurnResult,
  type TurnState
} from "./turns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const INITIAL_LEVEL_RANK = "2" as const;
/** 当前产品唯一的机器人策略。 */
export type TableStrategyProfile = "normal-vNext";

export interface NormalVNextPreviewDiagnostic {
  readonly action: TurnAction;
  readonly reasons: readonly string[];
  readonly structureDamageCost: number;
  readonly controlResourceCost: number;
  readonly wildcardOpportunityCost: number;
  readonly contest: string;
  readonly alerts: readonly string[];
}

export interface TableGame {
  readonly cardsById: ReadonlyMap<string, Card>;
  readonly state: TurnState;
  readonly levelRank?: Exclude<Rank, "small-joker" | "big-joker">;
  /** 所有已提交动作的公开事实；机器人只能从这里记牌。 */
  readonly publicEvents: readonly Event[];
}

export function createTableGame(
  seed = 0,
  options: {
    readonly levelRank?: Exclude<Rank, "small-joker" | "big-joker">;
    readonly leader?: Seat;
  } = {}
): TableGame {
  const cards = shuffleDeck(generateDeck({ deckCount: 2, includeJokers: true }), seed);
  const deal = dealFourPlayers(cards);

  return {
    cardsById: new Map(cards.map((card) => [card.id, card])),
    levelRank: options.levelRank ?? INITIAL_LEVEL_RANK,
    state: {
      hands: {
        east: deal.east.map((card) => card.id),
        south: deal.south.map((card) => card.id),
        west: deal.west.map((card) => card.id),
        north: deal.north.map((card) => card.id)
      },
      current: options.leader ?? "south",
      leader: options.leader ?? "south",
      passes: 0,
      finished: []
    },
    publicEvents: []
  };
}

/** 机器人和提示使用规则层生成的完整合法动作集合。 */
export function getLegalBotActions(game: TableGame): readonly TurnAction[] {
  const hand = game.state.hands[game.state.current]
    .map((cardId) => game.cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  return getCompleteLegalCandidates({
    state: game.state,
    selfHand: hand,
    levelRank: game.levelRank ?? INITIAL_LEVEL_RANK
  });
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

  const recognition = recognizePatterns(cards, game.levelRank ?? INITIAL_LEVEL_RANK);
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

/**
 * 机器人与提示共享的生产决策入口。normal 仍使用冻结的回归选牌器确定动作，
 * 随后统一进入 P2.5 的 DecisionExplanation 出口；解释不写回 TableGame。
 */
function createTableBotView(game: TableGame, legalActions: readonly TurnAction[]) {
  return createBotView({
    selfSeat: game.state.current,
    leader: game.state.leader,
    highestSeat: game.state.highestSeat,
    levelRank: game.levelRank ?? INITIAL_LEVEL_RANK,
    hand: game.state.hands[game.state.current]
      .map((cardId) => game.cardsById.get(cardId))
      .filter((card): card is Card => card !== undefined),
    publicEvents: game.publicEvents,
    remainingCardCounts: Object.fromEntries(
      SEATS.map((seat) => [seat, game.state.hands[seat].length])
    ) as Record<Seat, number>,
    legalActions
  });
}

/** Read-only Preview diagnostic. It calls the exact normal-vNext production selector once. */
export function inspectTableNormalVNext(game: TableGame): NormalVNextPreviewDiagnostic | undefined {
  const legalActions = getCompleteLegalCandidates({
    state: game.state,
    selfHand: game.state.hands[game.state.current]
      .map((cardId) => game.cardsById.get(cardId))
      .filter((card): card is Card => card !== undefined),
    levelRank: game.levelRank ?? INITIAL_LEVEL_RANK
  });
  const view = createTableBotView(game, legalActions);
  const decision = chooseNormalVNextBotAction(view);
  if (!decision) return undefined;
  const cost = describeNormalVNextAction(decision.action, view);
  const opponentCounts = Object.entries(view.remainingCardCounts).filter(([seat]) => seat !== view.selfSeat && seat !== (view.selfSeat === "east" ? "west" : view.selfSeat === "west" ? "east" : view.selfSeat === "south" ? "north" : "south")).map(([, count]) => count);
  return { action: decision.action, reasons: decision.reasons, structureDamageCost: cost?.structureDamageCost ?? 0, controlResourceCost: cost?.controlResourceCost ?? 0, wildcardOpportunityCost: cost?.wildcardOpportunityCost ?? 0, contest: view.highestSeat === undefined ? "lead" : Math.min(...opponentCounts) <= 3 ? "block" : "conserve", alerts: diagnoseNormalVNextAction(view, decision.action) };
}

export function chooseTableStrategicDecision(game: TableGame) {
  return chooseNormalVNextBotAction(createTableBotView(game, getLegalBotActions(game)));
}

/** 人类提示只选中建议牌，评分和机器人领出/跟牌完全一致。 */
export function chooseTableHintAction(
  game: TableGame
): TurnAction | undefined {
  return chooseTableStrategicDecision(game)?.action;
}

export function chooseTableBotAction(
  game: TableGame
): TurnAction | undefined {
  return chooseTableStrategicDecision(game)?.action;
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
