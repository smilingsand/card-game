import { dealFourPlayers, generateDeck, shuffleDeck } from "../../platform/deck";
import type { Card, Event, Seat } from "../../platform/types";
import { chooseBasicBotAction } from "./basic-bot";
import { chooseNormalBotAction } from "./normal-bot";
import {
  chooseExpertBotDecision,
  getExpertDecisionCacheStatistics,
  type ExpertDecisionBudget
} from "./strategy/expert-decision";
import { createDecisionFingerprint } from "./strategy/decision-cache";
import { getExpertHandAnalysisCacheStatistics } from "./strategy/hand-analysis-cache";
import {
  createDefaultStrategyProfile,
  type DecisionExplanation
} from "./strategy/decision-explanation";
import { createBotView, type BotView } from "./bot-view";
import { getCompleteLegalCandidates } from "./rule-complete-legal-actions";
import { settleRound, type Settlement } from "./settlement";
import { applyAction, validateAction, type TurnAction, type TurnState } from "./turns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const INITIAL_LEVEL = "2" as const;
const MAX_ACTIONS_PER_GAME = 1_000;
/** `expert`/`experimental` are explicit production profiles; neither may fall back to normal. */
export type BotDifficulty = "basic" | "normal" | "expert" | "experimental";
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

export interface SimulationDecisionSample {
  readonly seed: number;
  readonly actionIndex: number;
  readonly action: TurnAction;
  readonly publicEventSequence: number;
  readonly decisionMs: number;
  readonly legalActionCount: number;
  readonly profile: BotDifficulty;
  /** Present only for the real expert decision chain, never synthesized from normal. */
  readonly explanation?: DecisionExplanation;
  /** Post-decision observation only; it is never read by the expert decision chain. */
  readonly expertPerformance?: {
    readonly botViewReplayFingerprint: string;
    readonly rawLegalInterpretationCount: number;
    readonly canonicalPhysicalActionCount: number;
    readonly semanticCandidateCount: number;
    readonly postActionExecutionCount: number;
    readonly followUpExecutionCount: number;
    readonly moduleElapsedMilliseconds: Readonly<Record<string, number>>;
    readonly memory?: {
      readonly rss?: number;
      readonly heapUsed?: number;
      readonly heapTotal?: number;
    };
    readonly decisionCache: ReturnType<typeof getExpertDecisionCacheStatistics>;
    readonly handAnalysisCache: ReturnType<typeof getExpertHandAnalysisCacheStatistics>;
  };
}

export interface RunSimulationOptions {
  readonly difficulties?: SimulationDifficulties;
  /**
   * Diagnostic/replay-only expert budget override. It is intentionally
   * explicit so historical BotView samples can be reproduced without making
   * the current production expert profile select a legacy budget.
   */
  readonly expertPerformanceBudget?: ExpertDecisionBudget;
  /**
   * Diagnostic-only pre-decision projection. It is invoked with exactly the
   * BotView consumed by the selected bot, before that bot is evaluated. The
   * callback result is ignored and can never affect game state or selection.
   */
  readonly onBotView?: (sample: {
    readonly seed: number;
    readonly actionIndex: number;
    readonly profile: BotDifficulty;
    readonly view: BotView;
  }) => void;
  /** Diagnostics only. It receives public information and the selected legal action. */
  readonly onDecision?: (sample: SimulationDecisionSample) => void;
}

function isSimulationOptions(
  options: SimulationDifficulties | RunSimulationOptions
): options is RunSimulationOptions {
  return (
    "difficulties" in options ||
    "onBotView" in options ||
    "onDecision" in options ||
    "expertPerformanceBudget" in options
  );
}

/** Diagnostic identifier only. seed/actionIndex replays the actual BotView; this compact hash avoids
 * retaining the complete legal-action payload in every benchmark sample. */
function replayFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `p25-botview-v1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

/**
 * Reproducible first-decision projection for diagnostics/differential tests.
 * It exposes only the same BotView consumed by an actual simulation bot.
 */
export function createInitialSimulationBotView(seed: number): BotView {
  const initial = createInitialTurnState(seed);
  const cardsById = new Map(initial.cards.map((card) => [card.id, card]));
  const selfSeat = initial.state.current;
  const hand = initial.state.hands[selfSeat]
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  return createBotView({
    selfSeat,
    leader: initial.state.leader,
    highestSeat: initial.state.highestSeat,
    levelRank: INITIAL_LEVEL,
    hand,
    publicEvents: [],
    remainingCardCounts: Object.fromEntries(
      SEATS.map((seat) => [seat, initial.state.hands[seat].length])
    ) as Record<Seat, number>,
    legalActions: getCompleteLegalCandidates({
      state: initial.state,
      selfHand: hand,
      levelRank: INITIAL_LEVEL
    })
  });
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

function botAction(
  state: TurnState,
  cardsById: ReadonlyMap<string, Card>,
  publicEvents: readonly Event[],
  difficulties: SimulationDifficulties,
  expertPerformanceBudget?: ExpertDecisionBudget
): {
  readonly action: TurnAction | undefined;
  readonly legalActionCount: number;
  readonly profile: BotDifficulty;
  readonly view: BotView;
  readonly explanation?: DecisionExplanation;
  readonly expertPerformance?: SimulationDecisionSample["expertPerformance"];
} {
  const hand = state.hands[state.current]
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => card !== undefined);
  const legalActions = getCompleteLegalCandidates({
    state,
    selfHand: hand,
    levelRank: INITIAL_LEVEL
  });
  const view = createBotView({
    selfSeat: state.current,
    leader: state.leader,
    highestSeat: state.highestSeat,
    levelRank: INITIAL_LEVEL,
    hand,
    publicEvents,
    remainingCardCounts: Object.fromEntries(
      SEATS.map((seat) => [seat, state.hands[seat].length])
    ) as Record<Seat, number>,
    legalActions
  });
  const profile = difficulties[state.current];
  if (profile === "basic")
    return {
      action: chooseBasicBotAction(view),
      legalActionCount: legalActions.length,
      profile,
      view
    };
  if (profile === "normal")
    return {
      action: chooseNormalBotAction(view)?.action,
      legalActionCount: legalActions.length,
      profile,
      view
    };
  const decision = chooseExpertBotDecision({
    view,
    profile: createDefaultStrategyProfile(profile),
    performanceBudget: expertPerformanceBudget
  });
  return {
    action: decision.selectedAction,
    legalActionCount: legalActions.length,
    profile,
    view,
    explanation: decision.explanation,
    expertPerformance: {
      botViewReplayFingerprint: replayFingerprint(
        createDecisionFingerprint({
          view,
          legalActionSummary: JSON.stringify(view.legalActions),
          profile: decision.explanation.profile
        })
      ),
      rawLegalInterpretationCount:
        decision.debug?.rawLegalInterpretationCount ?? legalActions.length,
      canonicalPhysicalActionCount:
        decision.debug?.canonicalPhysicalActionCount ?? legalActions.length,
      semanticCandidateCount: decision.debug?.semanticCandidateCount ?? legalActions.length,
      postActionExecutionCount: decision.debug?.postActionExecutionCount ?? 0,
      followUpExecutionCount: decision.debug?.followUpExecutionCount ?? 0,
      moduleElapsedMilliseconds: decision.debug?.moduleElapsedMilliseconds ?? {},
      memory: (() => {
        const usage = globalThis.process?.memoryUsage?.();
        return usage
          ? { rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal }
          : undefined;
      })(),
      decisionCache: getExpertDecisionCacheStatistics(),
      handAnalysisCache: getExpertHandAnalysisCacheStatistics()
    }
  };
}

function publicEvent(sequence: number, action: TurnAction): Event<{ readonly action: TurnAction }> {
  return { sequence, type: "guandan.turn_action", actorId: action.actor, payload: { action } };
}

/**
 * 使用已公开的 BotView 与统一规则入口完成一局确定性自动对局。
 * 失败结果保留 seed，调用方可用同一 seed 重放定位问题。
 */
export function runSimulation(
  seed: number,
  options: SimulationDifficulties | RunSimulationOptions = NORMAL_DIFFICULTIES
): SimulationResult {
  const normalized: RunSimulationOptions = isSimulationOptions(options)
    ? options
    : { difficulties: options };
  const difficulties = normalized.difficulties ?? NORMAL_DIFFICULTIES;
  const initial = createInitialTurnState(seed);
  const allCardIds = new Set(initial.cards.map((card) => card.id));
  const cardsById = new Map(initial.cards.map((card) => [card.id, card]));
  const playedCardIds = new Set<string>();
  const publicEvents: Event<{ readonly action: TurnAction }>[] = [];
  let state = initial.state;
  let actionCount = 0;

  while (!state.completed && actionCount < MAX_ACTIONS_PER_GAME) {
    const invariantError = assertCardInvariant(state, allCardIds, playedCardIds);
    if (invariantError)
      return { ok: false, seed, actionCount, code: "invariant_violation", message: invariantError };

    const beforeDecision = performance.now();
    // `botAction` builds this projection once. The observer receives that exact
    // input after the decision returns; it never receives a reconstructed or
    // post-apply view and its return value is ignored.
    const selected = botAction(
      state,
      cardsById,
      publicEvents,
      difficulties,
      normalized.expertPerformanceBudget
    );
    normalized.onBotView?.({
      seed,
      actionIndex: actionCount,
      profile: selected.profile,
      view: selected.view
    });
    const decisionMs = performance.now() - beforeDecision;
    const action = selected.action;
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
    normalized.onDecision?.({
      seed,
      actionIndex: actionCount,
      action,
      publicEventSequence: publicEvents.at(-1)?.sequence ?? 0,
      decisionMs,
      legalActionCount: selected.legalActionCount,
      profile: selected.profile,
      explanation: selected.explanation,
      expertPerformance: selected.expertPerformance
    });
    publicEvents.push(publicEvent(publicEvents.length + 1, action));
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
