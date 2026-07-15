import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Seat } from "../../platform/types";
import { chooseBasicBotAction } from "./basic-bot";
import { chooseNormalBotAction } from "./normal-bot";
import { createBotView } from "./bot-view";
import { getLegalActions } from "./legal-actions";
import { recognizePatterns, type PatternInterpretation } from "./patterns";
import { settleRound, type Settlement } from "./settlement";
import { applyAction, validateAction, type TurnAction, type TurnState } from "./turns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const INITIAL_LEVEL = "2" as const;
const MAX_ACTIONS_PER_GAME = 1_000;
export type BotDifficulty = "basic" | "normal";
export type SimulationDifficulties = Readonly<Record<Seat, BotDifficulty>>;
const NORMAL_DIFFICULTIES: SimulationDifficulties = {
  east: "normal",
  south: "normal",
  west: "normal",
  north: "normal"
};

export type SimulationFailureCode =
  "illegal_action" | "invariant_violation" | "max_actions_exceeded" | "settlement_failure";

export interface SimulationSuccess {
  readonly ok: true;
  readonly seed: number;
  readonly actionCount: number;
  readonly finish: readonly Seat[];
  readonly settlement: Settlement;
}

export interface SimulationFailure {
  readonly ok: false;
  readonly seed: number;
  readonly actionCount: number;
  readonly code: SimulationFailureCode;
  readonly message: string;
}

export type SimulationResult = SimulationSuccess | SimulationFailure;

export interface SimulationBatchResult {
  readonly gameCount: number;
  readonly firstFailureSeed?: number;
}

function createInitialTurnState(seed: number): { state: TurnState; cards: readonly Card[] } {
  const cards = shuffleDeck(generateDeck({ deckCount: 2, includeJokers: true }), seed);
  const deal = dealFourPlayers(cards);
  return {
    cards,
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

function assertCardInvariant(
  state: TurnState,
  allCardIds: ReadonlySet<string>,
  playedCardIds: ReadonlySet<string>
): string | undefined {
  const handCardIds = SEATS.flatMap((seat) => state.hands[seat]);
  const visibleCardIds = [...handCardIds, ...playedCardIds];
  if (SEATS.some((seat) => state.hands[seat].length < 0)) return "negative hand count";
  if (new Set(visibleCardIds).size !== visibleCardIds.length) return "duplicate physical card ID";
  if (visibleCardIds.length !== allCardIds.size || visibleCardIds.some((id) => !allCardIds.has(id)))
    return "card conservation violated";
  return undefined;
}

function candidateActions(
  state: TurnState,
  singlePatternsByCardId: ReadonlyMap<string, readonly PatternInterpretation[]>
): readonly TurnAction[] {
  const hand = state.hands[state.current];
  const plays = hand.flatMap((cardId) => {
    const interpretations = singlePatternsByCardId.get(cardId);
    if (!interpretations) return [];
    return interpretations.map((interpretation) => ({
      type: "play" as const,
      actor: state.current,
      cardIds: [cardId],
      interpretation
    }));
  });
  const candidates: TurnAction[] = state.highest
    ? [...plays, { type: "pass", actor: state.current }]
    : plays;
  return getLegalActions(state, candidates);
}

function botAction(
  state: TurnState,
  cardsById: ReadonlyMap<string, Card>,
  singlePatternsByCardId: ReadonlyMap<string, readonly PatternInterpretation[]>,
  difficulties: SimulationDifficulties
): TurnAction | undefined {
  const legalActions = candidateActions(state, singlePatternsByCardId);
  const view = createBotView({
    selfSeat: state.current,
    leader: state.leader,
    highestSeat: state.highestSeat,
    levelRank: INITIAL_LEVEL,
    hand: state.hands[state.current]
      .map((cardId) => cardsById.get(cardId))
      .filter((card): card is Card => card !== undefined),
    publicEvents: [],
    remainingCardCounts: Object.fromEntries(
      SEATS.map((seat) => [seat, state.hands[seat].length])
    ) as Record<Seat, number>,
    legalActions
  });
  return difficulties[state.current] === "basic"
    ? chooseBasicBotAction(view)
    : chooseNormalBotAction(view)?.action;
}

/**
 * 使用已公开的 BotView 与统一规则入口完成一局确定性自动对局。
 * 失败结果保留 seed，调用方可用同一 seed 重放定位问题。
 */
export function runSimulation(
  seed: number,
  difficulties: SimulationDifficulties = NORMAL_DIFFICULTIES
): SimulationResult {
  const initial = createInitialTurnState(seed);
  const allCardIds = new Set(initial.cards.map((card) => card.id));
  const cardsById = new Map(initial.cards.map((card) => [card.id, card]));
  const singlePatternsByCardId = new Map<string, readonly PatternInterpretation[]>();
  for (const card of initial.cards) {
    const recognition = recognizePatterns([card], INITIAL_LEVEL);
    if (recognition.ok) singlePatternsByCardId.set(card.id, recognition.interpretations);
  }
  const playedCardIds = new Set<string>();
  let state = initial.state;
  let actionCount = 0;

  while (!state.completed && actionCount < MAX_ACTIONS_PER_GAME) {
    const invariantError = assertCardInvariant(state, allCardIds, playedCardIds);
    if (invariantError)
      return { ok: false, seed, actionCount, code: "invariant_violation", message: invariantError };

    const action = botAction(state, cardsById, singlePatternsByCardId, difficulties);
    if (!action || !validateAction(state, action).ok)
      return {
        ok: false,
        seed,
        actionCount,
        code: "illegal_action",
        message: "bot did not choose a legal action"
      };

    const result = applyAction(state, action);
    if (!result.ok)
      return { ok: false, seed, actionCount, code: "illegal_action", message: result.code };
    if (action.type === "play") action.cardIds.forEach((cardId) => playedCardIds.add(cardId));
    state = result.state;
    actionCount += 1;
  }

  const invariantError = assertCardInvariant(state, allCardIds, playedCardIds);
  if (invariantError)
    return { ok: false, seed, actionCount, code: "invariant_violation", message: invariantError };
  if (!state.completed)
    return {
      ok: false,
      seed,
      actionCount,
      code: "max_actions_exceeded",
      message: `exceeded ${MAX_ACTIONS_PER_GAME} actions`
    };

  try {
    return {
      ok: true,
      seed,
      actionCount,
      finish: state.finished,
      settlement: settleRound({ level: INITIAL_LEVEL, finish: state.finished })
    };
  } catch (error) {
    return {
      ok: false,
      seed,
      actionCount,
      code: "settlement_failure",
      message: error instanceof Error ? error.message : "unknown settlement error"
    };
  }
}

/** 按递增 seed 执行多局，首个失败 seed 可直接传给 runSimulation 重现。 */
export function runSimulationBatch(options: {
  readonly startSeed: number;
  readonly gameCount: number;
}): SimulationBatchResult {
  if (!Number.isInteger(options.startSeed) || options.startSeed < 0)
    throw new RangeError("startSeed must be a non-negative integer");
  if (!Number.isInteger(options.gameCount) || options.gameCount < 1)
    throw new RangeError("gameCount must be a positive integer");

  for (let offset = 0; offset < options.gameCount; offset += 1) {
    const seed = options.startSeed + offset;
    const result = runSimulation(seed);
    if (!result.ok) return { gameCount: options.gameCount, firstFailureSeed: result.seed };
  }
  return { gameCount: options.gameCount, firstFailureSeed: undefined };
}
