// Shared Guandan core source.
import type { Event } from "./types";
import { cloneValue } from "./structured-clone";

export const EVENT_SCHEMA_VERSION = 1;

export const PLATFORM_EVENT_TYPES = [
  "game.created",
  "action.applied",
  "game.completed",
] as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number];

export type Immutable<Value> = Value extends (...arguments_: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly Immutable<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: Immutable<Value[Key]> }
      : Value;

export interface EventStream<TEvent extends Event = Event> {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly rulesVersion: string;
  readonly events: readonly Immutable<TEvent>[];
}

export interface Snapshot<State> {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly rulesVersion: string;
  readonly eventSequence: number;
  readonly state: Immutable<State>;
}

export interface EventReducer<State, TEvent extends Event = Event> {
  initialState(seed: number): State;
  applyEvent(state: State, event: TEvent): State;
}

function assertRulesVersion(rulesVersion: string): void {
  if (rulesVersion.length === 0) {
    throw new RangeError("rulesVersion must not be empty");
  }
}

function assertContiguousEvents(
  events: readonly Event[],
  expectedSequence: number,
): void {
  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      throw new RangeError("event sequences must be continuous");
    }
    expectedSequence += 1;
  }
}

function deepFreeze<Value>(
  value: Value,
  seen = new WeakSet<object>(),
): Immutable<Value> {
  if (typeof value !== "object" || value === null) {
    return value as Immutable<Value>;
  }

  if (seen.has(value)) {
    return value as Immutable<Value>;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value) as Immutable<Value>;
}

function cloneAndDeepFreeze<Value>(value: Value): Immutable<Value> {
  return deepFreeze(cloneValue(value));
}

/** 创建不可变的、版本化的空事件流。 */
export function createEventStream<TEvent extends Event = Event>(
  rulesVersion: string,
): EventStream<TEvent> {
  assertRulesVersion(rulesVersion);

  return Object.freeze({
    schemaVersion: EVENT_SCHEMA_VERSION,
    rulesVersion,
    events: Object.freeze([]) as readonly Immutable<TEvent>[],
  });
}

/** 仅允许将下一个连续事件追加到新流，原流保持不变。 */
export function appendEvent<TEvent extends Event>(
  stream: EventStream<TEvent>,
  event: TEvent,
): EventStream<TEvent> {
  assertContiguousEvents([event], stream.events.length);

  return Object.freeze({
    schemaVersion: stream.schemaVersion,
    rulesVersion: stream.rulesVersion,
    events: Object.freeze([
      ...stream.events,
      cloneAndDeepFreeze(event),
    ]) as readonly Immutable<TEvent>[],
  });
}

/** 在当前事件边界创建恢复快照；空流快照的 eventSequence 为 -1。 */
export function createSnapshot<State, TEvent extends Event>(
  stream: EventStream<TEvent>,
  state: State,
): Snapshot<State> {
  return Object.freeze({
    schemaVersion: stream.schemaVersion,
    rulesVersion: stream.rulesVersion,
    eventSequence: stream.events.length - 1,
    state: cloneAndDeepFreeze(state),
  });
}

/** 从初始 seed 和完整连续事件流重建状态。 */
export function replayEvents<State, TEvent extends Event>(
  reducer: EventReducer<State, TEvent>,
  seed: number,
  events: readonly Immutable<TEvent>[],
): State {
  assertContiguousEvents(events, 0);
  return events.reduce(
    (state, event) => reducer.applyEvent(state, event as TEvent),
    reducer.initialState(seed),
  );
}

/** 从快照开始回放其后的连续事件。 */
export function replayFromSnapshot<State, TEvent extends Event>(
  reducer: Pick<EventReducer<State, TEvent>, "applyEvent">,
  snapshot: Snapshot<State>,
  events: readonly Immutable<TEvent>[],
): State {
  assertContiguousEvents(events, snapshot.eventSequence + 1);
  return events.reduce(
    (state, event) => reducer.applyEvent(state, event as TEvent),
    snapshot.state as State,
  );
}
