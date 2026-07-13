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
import type { TurnAction, TurnResult, TurnState } from "./turns";

export const TABLE_RULES_VERSION = "guandan-v1";
export const TABLE_SAVE_SCHEMA_VERSION = 1;

type TableActionEvent = Event<{ readonly action: TurnAction }>;

interface TableSnapshotState {
  readonly state: TurnState;
  readonly publicEvents: readonly TableActionEvent[];
}

export interface TableSession {
  readonly seed: number;
  readonly game: TableGame;
  readonly stream: EventStream<TableActionEvent>;
  readonly snapshot: Snapshot<TableSnapshotState>;
}

export interface TableSave {
  readonly saveSchemaVersion: typeof TABLE_SAVE_SCHEMA_VERSION;
  readonly seed: number;
  readonly stream: EventStream<TableActionEvent>;
  readonly snapshot: Snapshot<TableSnapshotState>;
}

export class TableSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableSaveError";
  }
}

function snapshotState(game: TableGame): TableSnapshotState {
  return { state: game.state, publicEvents: game.publicEvents as readonly TableActionEvent[] };
}

function eventFor(sequence: number, action: TurnAction): TableActionEvent {
  return {
    sequence,
    type: "action.applied",
    actorId: action.actor,
    payload: { action }
  };
}

function applyEvent(game: TableGame, event: TableActionEvent): TableGame {
  if (event.type !== "action.applied") throw new TableSaveError(`unsupported event: ${event.type}`);
  const result = submitTableAction(game, event.payload.action);
  if (!result.ok) throw new TableSaveError(`stored action is invalid: ${result.code}`);
  return { ...game, state: result.state, publicEvents: [...game.publicEvents, event] };
}

function assertCompatible(save: TableSave): void {
  if (save.saveSchemaVersion !== TABLE_SAVE_SCHEMA_VERSION) {
    throw new TableSaveError(`unsupported save schema: ${String(save.saveSchemaVersion)}`);
  }
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
  stream: EventStream<TableActionEvent>
): TableSession {
  return { seed, game, stream, snapshot: createSnapshot(stream, snapshotState(game)) };
}

export function createTableSession(seed = 0): TableSession {
  const game = createTableGame(seed);
  return createSessionFromGame(
    seed,
    game,
    createEventStream<TableActionEvent>(TABLE_RULES_VERSION)
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
    session: createSessionFromGame(session.seed, game, stream)
  };
}

export function serializeTableSession(session: TableSession): TableSave {
  return {
    saveSchemaVersion: TABLE_SAVE_SCHEMA_VERSION,
    seed: session.seed,
    stream: session.stream,
    snapshot: session.snapshot
  };
}

export function restoreTableSession(save: TableSave): TableSession {
  assertCompatible(save);
  const initial = createTableGame(save.seed);
  let replayed: TableGame;
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
    JSON.stringify(replayed.state) !== JSON.stringify(save.snapshot.state.state) ||
    JSON.stringify(replayed.publicEvents) !== JSON.stringify(save.snapshot.state.publicEvents)
  ) {
    throw new TableSaveError("snapshot does not match replayed event stream");
  }
  return { seed: save.seed, game: replayed, stream: save.stream, snapshot: save.snapshot };
}
