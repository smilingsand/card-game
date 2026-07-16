import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Event, Rank, Seat } from "../../platform/types";
import { chooseNormalBotAction } from "./normal-bot";
import { createBotView } from "./bot-view";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import { getLegacyNormalCandidates } from "./legacy-normal-candidates";
import { getCompleteLegalCandidates } from "./rule-complete-legal-actions";
import { rankExpertCandidates } from "./strategy/candidate-generator";
import { generateHandPlans } from "./strategy/hand-plan-generator";
import { analyzeHandStructure } from "./strategy/hand-structure-analyzer";
import {
  createNormalBaselineDecision,
  createDefaultStrategyProfile,
  type StrategyDecision
} from "./strategy/decision-explanation";
import { chooseExpertBotDecision } from "./strategy/expert-decision";
import type { StrategyProfileId } from "./strategy/expert-strategy-knowledge-base";
import {
  applyAction,
  validateAction,
  type TurnAction,
  type TurnResult,
  type TurnState
} from "./turns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const INITIAL_LEVEL_RANK = "2" as const;
export interface CandidateProfileConfig {
  readonly version: string;
  readonly performanceBudget: {
    readonly handPlanTopN: { readonly default: number; readonly max: number };
  };
}

export type TableStrategyProfile = StrategyProfileId;

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

/**
 * normal profile 的冻结回归入口。P2.5-07 不将完整候选静默接入默认机器人或提示。
 */
export function getLegalBotActions(game: TableGame): readonly TurnAction[] {
  const hand = game.state.hands[game.state.current]
    .map((cardId) => game.cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  return getLegacyNormalCandidates({
    state: game.state,
    selfHand: hand,
    levelRank: game.levelRank ?? INITIAL_LEVEL_RANK
  });
}

/** A/B 层：完整规则候选再按专家结构重排；仅供后续专家链消费，尚未接入默认策略。 */
export function getExpertRankedBotCandidates(
  game: TableGame,
  profile: CandidateProfileConfig
): readonly TurnAction[] {
  const hand = game.state.hands[game.state.current]
    .map((cardId) => game.cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  const structure = analyzeHandStructure(hand, game.levelRank ?? INITIAL_LEVEL_RANK);
  const handPlans = generateHandPlans({
    structure,
    performanceBudget: profile.performanceBudget
  });
  return rankExpertCandidates({
    legalActions: getCompleteLegalCandidates({
      state: game.state,
      selfHand: hand,
      levelRank: game.levelRank ?? INITIAL_LEVEL_RANK
    }),
    structure,
    handPlans
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

export function chooseTableStrategicDecision(
  game: TableGame,
  profile: TableStrategyProfile = "normal"
): StrategyDecision | undefined {
  if (profile !== "normal") {
    const legalActions = getCompleteLegalCandidates({
      state: game.state,
      selfHand: game.state.hands[game.state.current]
        .map((cardId) => game.cardsById.get(cardId))
        .filter((card): card is Card => card !== undefined),
      levelRank: game.levelRank ?? INITIAL_LEVEL_RANK
    });
    if (legalActions.length === 0) return undefined;
    return chooseExpertBotDecision({
      view: createTableBotView(game, legalActions),
      profile: createDefaultStrategyProfile(profile)
    });
  }

  const legalActions = getLegalBotActions(game);
  const normalDecision = chooseNormalBotAction(createTableBotView(game, legalActions));
  return normalDecision
    ? createNormalBaselineDecision({
        legalActions,
        selectedAction: normalDecision.action,
        reasons: normalDecision.reasons
      })
    : undefined;
}

/** 人类提示只选中建议牌，评分和机器人领出/跟牌完全一致。 */
export function chooseTableHintAction(
  game: TableGame,
  profile: TableStrategyProfile = "normal"
): TurnAction | undefined {
  return chooseTableStrategicDecision(game, profile)?.selectedAction;
}

export function chooseTableBotAction(
  game: TableGame,
  profile: TableStrategyProfile = "normal"
): TurnAction | undefined {
  return chooseTableStrategicDecision(game, profile)?.selectedAction;
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
