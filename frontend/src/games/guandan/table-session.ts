import {
  EVENT_SCHEMA_VERSION,
  appendEvent,
  createEventStream,
  createSnapshot,
  replayEvents,
  type EventStream,
  type Snapshot
} from "../../platform/event-store";
import type { Event } from "../../platform/types";
import { createTableGame, submitTableAction, type TableGame } from "./table-controller";
import {
  createTributePlan,
  levelForLeader,
  levelsAfterRound,
  type MatchLevels,
  type TributePlan
} from "./match";
import {
  applyTributeExchange,
  canReturnTributeCard,
  isRequiredTributeCard,
  type TributeReturn
} from "./tribute";
import type { TurnAction, TurnResult, TurnState } from "./turns";

export const TABLE_RULES_VERSION = "guandan-v5";
export const TABLE_SAVE_SCHEMA_VERSION = 4;

export type TributePhase = "ready" | "awaiting-tribute" | "awaiting-return";

/** Serializable, public match facts that span individual tables. */
export interface MatchSessionState {
  readonly roundNumber: number;
  readonly roundSeed: number;
  readonly levels: MatchLevels;
  readonly leader: import("../../platform/types").Seat;
  readonly levelRank: MatchLevels[keyof MatchLevels];
  readonly currentFinish?: readonly import("../../platform/types").Seat[];
  readonly previousFinish?: readonly import("../../platform/types").Seat[];
  readonly tributePlan: TributePlan;
  readonly tributePhase: TributePhase;
  /** 已确认交出的贡牌；机器人会自动填入，南家由界面提交。 */
  readonly submittedTributes: readonly string[];
  /** 已确认的还贡；机器人会自动填入，南家由界面提交。 */
  readonly submittedReturns: readonly TributeReturn[];
}

type TableActionEvent = Event<{ readonly action: TurnAction }>;
type RoundStartedEvent = Event<{ readonly match: MatchSessionState }>;
type TributeProgressEvent = Event<{ readonly match: MatchSessionState }>;
type TributeResolvedEvent = Event<{
  readonly match: MatchSessionState;
  readonly hands: Readonly<Record<import("../../platform/types").Seat, readonly string[]>>;
}>;
type TableSessionEvent =
  TableActionEvent | RoundStartedEvent | TributeProgressEvent | TributeResolvedEvent;

interface TableSnapshotState {
  readonly state: TurnState;
  readonly publicEvents: readonly TableActionEvent[];
  readonly match: MatchSessionState;
}

export interface TableSession {
  readonly seed: number;
  readonly game: TableGame;
  readonly match: MatchSessionState;
  readonly stream: EventStream<TableSessionEvent>;
  readonly snapshot: Snapshot<TableSnapshotState>;
  /** 仅真人 UI 偏好，刻意不写入游戏状态、事件或快照。 */
  readonly humanDisplayOrder?: readonly string[];
}

export interface TableSave {
  readonly saveSchemaVersion: typeof TABLE_SAVE_SCHEMA_VERSION;
  readonly seed: number;
  readonly stream: EventStream<TableSessionEvent>;
  readonly snapshot: Snapshot<TableSnapshotState>;
  readonly humanDisplayOrder?: readonly string[];
}

export interface LegacyTableSave {
  readonly saveSchemaVersion: number;
  readonly seed: number;
  readonly stream: EventStream<TableActionEvent>;
  readonly snapshot: Snapshot<TableSnapshotState>;
}

export type RestorableTableSave = TableSave | LegacyTableSave;

export class TableSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableSaveError";
  }
}

function noTributePlan(): TributePlan {
  return { kind: "none", antiTribute: false, proof: [], obligations: [] };
}

function initialMatch(seed: number): MatchSessionState {
  return {
    roundNumber: 1,
    roundSeed: seed,
    levels: { northSouth: "2", eastWest: "2" },
    leader: "south",
    levelRank: "2",
    tributePlan: noTributePlan(),
    tributePhase: "ready",
    submittedTributes: [],
    submittedReturns: []
  };
}

function snapshotState(session: Pick<TableSession, "game" | "match">): TableSnapshotState {
  return {
    state: session.game.state,
    publicEvents: session.game.publicEvents as readonly TableActionEvent[],
    match: session.match
  };
}

function eventFor(sequence: number, action: TurnAction): TableActionEvent {
  return {
    sequence,
    type: "action.applied",
    actorId: action.actor,
    payload: { action }
  };
}

interface ReplayState {
  readonly game: TableGame;
  readonly match: MatchSessionState;
}

function applyEvent(state: ReplayState, event: TableSessionEvent): ReplayState {
  if (event.type === "round.started" && "match" in event.payload) {
    const match = event.payload.match;
    return {
      match,
      game: createTableGame(match.roundSeed, { levelRank: match.levelRank, leader: match.leader })
    };
  }
  if (event.type === "tribute.progressed" && "match" in event.payload)
    return { ...state, match: event.payload.match };
  if (event.type === "tribute.resolved" && "match" in event.payload && "hands" in event.payload)
    return {
      match: event.payload.match,
      game: {
        ...state.game,
        levelRank: event.payload.match.levelRank,
        state: {
          ...state.game.state,
          hands: event.payload.hands,
          leader: event.payload.match.leader,
          current: event.payload.match.leader
        }
      }
    };
  if (event.type !== "action.applied" || !("action" in event.payload))
    throw new TableSaveError(`unsupported event: ${event.type}`);
  const result = submitTableAction(state.game, event.payload.action);
  if (!result.ok) throw new TableSaveError(`stored action is invalid: ${result.code}`);
  return {
    game: { ...state.game, state: result.state, publicEvents: [...state.game.publicEvents, event] },
    match: result.state.completed
      ? { ...state.match, currentFinish: [...result.state.finished] }
      : state.match
  };
}

function assertCompatible(save: RestorableTableSave): void {
  if (save.saveSchemaVersion !== TABLE_SAVE_SCHEMA_VERSION)
    throw new TableSaveError("legacy single-round saves cannot be restored");
  if (!Number.isInteger(save.seed)) throw new TableSaveError("save seed must be an integer");
  if (
    save.stream.schemaVersion !== EVENT_SCHEMA_VERSION ||
    save.snapshot.schemaVersion !== EVENT_SCHEMA_VERSION
  ) {
    throw new TableSaveError("unsupported event schema");
  }
  if (
    save.stream.rulesVersion !== TABLE_RULES_VERSION ||
    save.snapshot.rulesVersion !== TABLE_RULES_VERSION
  ) {
    throw new TableSaveError("rules version mismatch; migration is not available");
  }
  if (save.snapshot.eventSequence !== save.stream.events.length - 1) {
    throw new TableSaveError("snapshot must cover the complete P1 event stream");
  }
}

function createSessionFromGame(
  seed: number,
  game: TableGame,
  match: MatchSessionState,
  stream: EventStream<TableSessionEvent>,
  humanDisplayOrder?: readonly string[]
): TableSession {
  const session = {
    seed,
    game,
    match,
    stream,
    snapshot: undefined as unknown as Snapshot<TableSnapshotState>,
    humanDisplayOrder
  };
  return { ...session, snapshot: createSnapshot(stream, snapshotState(session)) };
}

export function createTableSession(seed = 0): TableSession {
  const match = initialMatch(seed);
  const game = createTableGame(seed, { levelRank: match.levelRank, leader: match.leader });
  return createSessionFromGame(
    seed,
    game,
    match,
    createEventStream<TableSessionEvent>(TABLE_RULES_VERSION)
  );
}

export function applyTableSessionAction(
  session: TableSession,
  action: TurnAction
): TurnResult & { readonly session: TableSession } {
  const result = submitTableAction(session.game, action);
  if (!result.ok) return { ...result, session };
  const stream = appendEvent(session.stream, eventFor(session.stream.events.length, action));
  const game = {
    ...session.game,
    state: result.state,
    publicEvents: [...session.game.publicEvents, stream.events.at(-1)!]
  };
  return {
    ok: true,
    state: result.state,
    session: createSessionFromGame(
      session.seed,
      game,
      result.state.completed
        ? { ...session.match, currentFinish: [...result.state.finished] }
        : session.match,
      stream,
      session.humanDisplayOrder
    )
  };
}

export function setHumanDisplayOrder(
  session: TableSession,
  humanDisplayOrder: readonly string[]
): TableSession {
  return { ...session, humanDisplayOrder: [...humanDisplayOrder] };
}

function nextRoundSeed(seed: number, roundNumber: number): number {
  return (Math.imul(seed ^ roundNumber, 1_103_515_245) + 12_345) >>> 0;
}

function cardsForHands(game: TableGame) {
  const cards = (seat: import("../../platform/types").Seat) =>
    game.state.hands[seat]
      .map((id) => game.cardsById.get(id))
      .filter((card): card is import("../../platform/types").Card => card !== undefined);
  return { east: cards("east"), south: cards("south"), west: cards("west"), north: cards("north") };
}

function gameWithHands(
  game: TableGame,
  hands: Readonly<
    Record<import("../../platform/types").Seat, readonly import("../../platform/types").Card[]>
  >,
  leader = game.state.leader,
  levelRank = game.levelRank
): TableGame {
  return {
    ...game,
    levelRank,
    state: {
      ...game.state,
      leader,
      current: leader,
      hands: {
        east: hands.east.map((card) => card.id),
        south: hands.south.map((card) => card.id),
        west: hands.west.map((card) => card.id),
        north: hands.north.map((card) => card.id)
      }
    }
  };
}

function nextSeat(seat: import("../../platform/types").Seat): import("../../platform/types").Seat {
  return { east: "north", north: "west", west: "south", south: "east" }[
    seat
  ] as import("../../platform/types").Seat;
}

function leaderAfterTribute(session: TableSession): import("../../platform/types").Seat {
  const { tributePlan, previousFinish } = session.match;
  const head = previousFinish?.[0] ?? session.match.leader;
  if (tributePlan.kind === "none") return head;
  if (tributePlan.kind === "single") return tributePlan.obligations[0].from;
  const [first, second] = tributePlan.obligations;
  const firstCard = session.game.cardsById.get(first.cardId);
  const secondCard = session.game.cardsById.get(second.cardId);
  if (!firstCard || !secondCard) throw new TableSaveError("tribute card is missing");
  const comparison =
    returnValue(firstCard, session.match.levelRank) -
    returnValue(secondCard, session.match.levelRank);
  return comparison === 0 ? nextSeat(head) : comparison > 0 ? first.from : second.from;
}

function appendProgress(session: TableSession, match: MatchSessionState): TableSession {
  const stream = appendEvent(session.stream, {
    sequence: session.stream.events.length,
    type: "tribute.progressed",
    payload: { match }
  });
  return createSessionFromGame(
    session.seed,
    session.game,
    match,
    stream,
    session.humanDisplayOrder
  );
}

function returnValue(
  card: import("../../platform/types").Card,
  levelRank: MatchSessionState["levelRank"]
): number {
  if (card.rank === "big-joker") return 17;
  if (card.rank === "small-joker") return 16;
  if (card.rank === levelRank) return 15;
  return ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].indexOf(card.rank) + 2;
}

function advanceAutomatedTribute(session: TableSession): TableSession {
  let match = session.match;
  if (match.tributePhase === "ready") return session;
  const hands = cardsForHands(session.game);
  if (match.tributePhase === "awaiting-tribute") {
    const submittedTributes = [...match.submittedTributes];
    for (const obligation of match.tributePlan.obligations) {
      if (obligation.from !== "south" && !submittedTributes.includes(obligation.cardId))
        submittedTributes.push(obligation.cardId);
    }
    const allSubmitted = match.tributePlan.obligations.every((item) =>
      submittedTributes.includes(item.cardId)
    );
    match = {
      ...match,
      submittedTributes,
      tributePhase: allSubmitted ? "awaiting-return" : "awaiting-tribute"
    };
  }
  if (match.tributePhase === "awaiting-return") {
    const submittedReturns = [...match.submittedReturns];
    for (const obligation of match.tributePlan.obligations) {
      if (
        obligation.to === "south" ||
        submittedReturns.some((item) => item.from === obligation.to && item.to === obligation.from)
      )
        continue;
      const choice = [...hands[obligation.to]]
        .filter((card) => canReturnTributeCard(card, match.levelRank))
        .sort(
          (a, b) =>
            returnValue(a, match.levelRank) - returnValue(b, match.levelRank) ||
            a.id.localeCompare(b.id)
        )[0];
      if (!choice) throw new TableSaveError("recipient has no legal return card");
      submittedReturns.push({ from: obligation.to, to: obligation.from, cardId: choice.id });
    }
    const allReturned = match.tributePlan.obligations.every((obligation) =>
      submittedReturns.some((item) => item.from === obligation.to && item.to === obligation.from)
    );
    match = { ...match, submittedReturns, tributePhase: allReturned ? "ready" : "awaiting-return" };
  }
  if (match.tributePhase !== "ready") return appendProgress(session, match);
  const exchange = applyTributeExchange(
    match.levelRank,
    match.tributePlan,
    hands,
    match.submittedReturns
  );
  const leader = leaderAfterTribute({ ...session, match });
  match = { ...match, leader };
  const game = gameWithHands(session.game, exchange.hands, leader, match.levelRank);
  const stream = appendEvent(session.stream, {
    sequence: session.stream.events.length,
    type: "tribute.resolved",
    payload: { match, hands: game.state.hands }
  });
  return createSessionFromGame(session.seed, game, match, stream, session.humanDisplayOrder);
}

/** 南家需要交贡时返回所有同为最大且非红桃级牌的可选实体牌。 */
export function getSouthTributeChoices(session: TableSession): readonly string[] {
  if (session.match.tributePhase !== "awaiting-tribute") return [];
  const obligation = session.match.tributePlan.obligations.find((item) => item.from === "south");
  if (!obligation || session.match.submittedTributes.includes(obligation.cardId)) return [];
  return cardsForHands(session.game)
    .south.filter((card) =>
      isRequiredTributeCard(card.id, cardsForHands(session.game).south, session.match.levelRank)
    )
    .map((card) => card.id);
}

/** 提交南家的手动进贡，随后自动推进所有机器人的交贡和还贡。 */
export function submitSouthTribute(session: TableSession, cardId: string): TableSession {
  const obligation = session.match.tributePlan.obligations.find((item) => item.from === "south");
  if (!obligation || !getSouthTributeChoices(session).includes(cardId))
    throw new TableSaveError("invalid south tribute card");
  const tributePlan: TributePlan = {
    ...session.match.tributePlan,
    obligations: session.match.tributePlan.obligations.map((item) =>
      item === obligation ? { ...item, cardId } : item
    )
  };
  return advanceAutomatedTribute(
    appendProgress(session, {
      ...session.match,
      tributePlan,
      submittedTributes: [...session.match.submittedTributes, cardId]
    })
  );
}

/** 南家收贡后可还的牌；牌面不得大于 10。 */
export function getSouthReturnChoices(session: TableSession): readonly string[] {
  if (session.match.tributePhase !== "awaiting-return") return [];
  const obligation = session.match.tributePlan.obligations.find((item) => item.to === "south");
  if (
    !obligation ||
    session.match.submittedReturns.some(
      (item) => item.from === "south" && item.to === obligation.from
    )
  )
    return [];
  return cardsForHands(session.game)
    .south.filter((card) => canReturnTributeCard(card, session.match.levelRank))
    .map((card) => card.id);
}

/** 提交南家的手动还贡，随后自动推进其余机器人动作并交换实体牌。 */
export function submitSouthReturn(session: TableSession, cardId: string): TableSession {
  const obligation = session.match.tributePlan.obligations.find((item) => item.to === "south");
  if (!obligation || !getSouthReturnChoices(session).includes(cardId))
    throw new TableSaveError("invalid south return card");
  return advanceAutomatedTribute(
    appendProgress(session, {
      ...session.match,
      submittedReturns: [
        ...session.match.submittedReturns,
        { from: "south", to: obligation.from, cardId }
      ]
    })
  );
}

/**
 * Creates the next dealt round after a completed table. Tribute transfer is intentionally
 * not performed here; upper layers must resolve the exposed plan before allowing play.
 */
export function prepareNextTableSession(session: TableSession): TableSession {
  const finish = session.match.currentFinish ?? session.game.state.finished;
  if (!session.game.state.completed || finish.length !== 4)
    throw new TableSaveError("cannot prepare next round before the current round completes");
  const leader = finish[0];
  const levels = levelsAfterRound(session.match.levels, finish);
  const roundNumber = session.match.roundNumber + 1;
  const roundSeed = nextRoundSeed(session.seed, roundNumber);
  // 级牌取上一局胜方（头游方）升级后的等级，与进贡确定的先手分离。
  const levelRank = levelForLeader(levels, finish[0]);
  const game = createTableGame(roundSeed, { leader, levelRank });
  const tributePlan = createTributePlan(levelRank, finish, cardsForHands(game));
  const match: MatchSessionState = {
    roundNumber,
    roundSeed,
    levels,
    leader,
    levelRank,
    previousFinish: [...finish],
    tributePlan,
    tributePhase: tributePlan.kind === "none" ? "ready" : "awaiting-tribute",
    submittedTributes: [],
    submittedReturns: []
  };
  const roundEvent: RoundStartedEvent = {
    sequence: session.stream.events.length,
    type: "round.started",
    payload: { match }
  };
  const prepared = createSessionFromGame(
    session.seed,
    game,
    match,
    appendEvent(session.stream, roundEvent),
    undefined
  );
  return tributePlan.kind === "none" ? prepared : advanceAutomatedTribute(prepared);
}

/**
 * Re-deals the current round without changing the result of the prior round.
 * The new hand must produce a new tribute plan, and may therefore produce a new leader.
 */
export function restartCurrentTableSession(session: TableSession, roundSeed: number): TableSession {
  const leader = session.match.previousFinish?.[0] ?? "south";
  const game = createTableGame(roundSeed, { leader, levelRank: session.match.levelRank });
  const tributePlan = session.match.previousFinish
    ? createTributePlan(session.match.levelRank, session.match.previousFinish, cardsForHands(game))
    : noTributePlan();
  const match: MatchSessionState = {
    ...session.match,
    roundSeed,
    leader,
    currentFinish: undefined,
    tributePlan,
    tributePhase: tributePlan.kind === "none" ? "ready" : "awaiting-tribute",
    submittedTributes: [],
    submittedReturns: []
  };
  const roundEvent: RoundStartedEvent = {
    sequence: session.stream.events.length,
    type: "round.started",
    payload: { match }
  };
  const restarted = createSessionFromGame(
    session.seed,
    game,
    match,
    appendEvent(session.stream, roundEvent),
    undefined
  );
  return tributePlan.kind === "none" ? restarted : advanceAutomatedTribute(restarted);
}

export function serializeTableSession(session: TableSession): TableSave {
  return {
    saveSchemaVersion: TABLE_SAVE_SCHEMA_VERSION,
    seed: session.seed,
    stream: session.stream,
    snapshot: session.snapshot,
    humanDisplayOrder: session.humanDisplayOrder
  };
}

function restoredDisplayOrder(
  save: TableSave,
  hand: readonly string[]
): readonly string[] | undefined {
  const value = save.humanDisplayOrder;
  if (!Array.isArray(value) || !value.every((cardId) => typeof cardId === "string"))
    return undefined;
  const handIds = new Set(hand);
  const normalized = value.filter(
    (cardId, index) => handIds.has(cardId) && value.indexOf(cardId) === index
  );
  return normalized.length === 0 ? undefined : normalized;
}

export function restoreTableSession(save: RestorableTableSave): TableSession {
  assertCompatible(save);
  const initialMatchState = initialMatch(save.seed);
  const initial: ReplayState = {
    match: initialMatchState,
    game: createTableGame(save.seed, {
      levelRank: initialMatchState.levelRank,
      leader: initialMatchState.leader
    })
  };
  let replayed: ReplayState;
  try {
    replayed = replayEvents(
      {
        initialState: () => initial,
        applyEvent
      },
      save.seed,
      save.stream.events
    );
  } catch (error) {
    throw new TableSaveError(
      `cannot replay saved event stream: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  if (
    JSON.stringify(replayed.game.state) !== JSON.stringify(save.snapshot.state.state) ||
    JSON.stringify(replayed.game.publicEvents) !==
      JSON.stringify(save.snapshot.state.publicEvents) ||
    JSON.stringify(replayed.match) !== JSON.stringify(save.snapshot.state.match)
  ) {
    throw new TableSaveError("snapshot does not match replayed event stream");
  }
  return {
    seed: save.seed,
    game: replayed.game,
    match: replayed.match,
    stream: save.stream,
    snapshot: save.snapshot,
    humanDisplayOrder: restoredDisplayOrder(save as TableSave, replayed.game.state.hands.south)
  };
}
