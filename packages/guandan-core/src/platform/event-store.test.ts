// Shared Guandan core test.
import { describe, expect, test, vi } from "vitest";
import type { Action, Event } from "./types";
import {
  appendEvent,
  createEventStream,
  createSnapshot,
  replayEvents,
  replayFromSnapshot,
} from "./event-store";
import { applyValidatedAction, type ActionReducer } from "./reducer";

interface CounterState {
  readonly seed: number;
  readonly count: number;
}

type CounterEvent = Event<{ readonly amount: number }>;
type CounterAction = Action<{ readonly amount: number }>;

const counterEventReducer = {
  initialState(seed: number): CounterState {
    return { seed, count: 0 };
  },
  applyEvent(state: CounterState, event: CounterEvent): CounterState {
    return { ...state, count: state.count + event.payload.amount };
  },
};

const counterActionReducer: ActionReducer<CounterState, CounterAction> = {
  validateAction(_state, action) {
    return action.payload.amount > 0
      ? { valid: true }
      : { valid: false, code: "amount_must_be_positive" };
  },
  applyAction(state, action) {
    return { ...state, count: state.count + action.payload.amount };
  },
};

describe("版本化 append-only 事件流", () => {
  test("seed 加事件可完整重建状态，且追加不会修改旧流", () => {
    const emptyStream = createEventStream("counter-v1");
    const firstEvent: CounterEvent = {
      sequence: 0,
      type: "action.applied",
      actorId: "player-east",
      payload: { amount: 2 },
    };
    const secondEvent: CounterEvent = {
      sequence: 1,
      type: "action.applied",
      actorId: "player-south",
      payload: { amount: 3 },
    };
    const afterFirst = appendEvent(emptyStream, firstEvent);
    const stream = appendEvent(afterFirst, secondEvent);

    expect(emptyStream.events).toEqual([]);
    expect(afterFirst.events).toEqual([firstEvent]);
    expect(stream.events).toEqual([firstEvent, secondEvent]);
    expect(replayEvents(counterEventReducer, 99, stream.events)).toEqual({
      seed: 99,
      count: 5,
    });
  });

  test("快照是事件锚点，可只回放快照后的连续事件", () => {
    const firstEvent: CounterEvent = {
      sequence: 0,
      type: "action.applied",
      payload: { amount: 2 },
    };
    const secondEvent: CounterEvent = {
      sequence: 1,
      type: "action.applied",
      payload: { amount: 3 },
    };
    const firstStream = appendEvent(
      createEventStream("counter-v1"),
      firstEvent,
    );
    const snapshot = createSnapshot(firstStream, { seed: 99, count: 2 });

    expect(snapshot.eventSequence).toBe(0);
    expect(
      replayFromSnapshot(counterEventReducer, snapshot, [secondEvent]),
    ).toEqual({
      seed: 99,
      count: 5,
    });
  });

  test("序列号或版本不连续的事件不能追加", () => {
    const stream = createEventStream("counter-v1");

    expect(() =>
      appendEvent(stream, {
        sequence: 1,
        type: "action.applied",
        payload: { amount: 1 },
      }),
    ).toThrow(RangeError);
  });

  test("追加后源事件的嵌套载荷变更不会篡改已存事件", () => {
    const sourceEvent: Event<{ details: { label: string } }> = {
      sequence: 0,
      type: "action.applied",
      payload: { details: { label: "before" } },
    };
    const stream = appendEvent(
      createEventStream<typeof sourceEvent>("counter-v1"),
      sourceEvent,
    );

    sourceEvent.payload.details.label = "after";

    expect(stream.events[0].payload.details.label).toBe("before");
    expect(Object.isFrozen(stream.events[0].payload.details)).toBe(true);
  });

  test("快照深复制并冻结状态，不保留调用方可变引用", () => {
    const sourceState = { nested: { count: 2 } };
    const snapshot = createSnapshot(
      createEventStream("counter-v1"),
      sourceState,
    );

    sourceState.nested.count = 3;

    expect(snapshot.state.nested.count).toBe(2);
    expect(Object.isFrozen(snapshot.state.nested)).toBe(true);
  });
});

describe("纯动作 reducer 基础", () => {
  test("非法动作保留同一状态引用，且不调用 applyAction", () => {
    const state = { seed: 99, count: 2 };
    const action: CounterAction = {
      type: "counter.add",
      actorId: "player-east",
      payload: { amount: 0 },
    };
    const applyAction = vi.fn(counterActionReducer.applyAction);
    const reducer = { ...counterActionReducer, applyAction };

    const result = applyValidatedAction(reducer, state, action);

    expect(result).toEqual({
      valid: false,
      state,
      error: { code: "amount_must_be_positive" },
    });
    expect(result.state).toBe(state);
    expect(applyAction).not.toHaveBeenCalled();
  });
});
