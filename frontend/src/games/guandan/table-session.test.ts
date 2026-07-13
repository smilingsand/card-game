import { describe, expect, test } from "vitest";
import { getLegalSingleActions } from "./table-controller";
import {
  applyTableSessionAction,
  createTableSession,
  restoreTableSession,
  serializeTableSession
} from "./table-session";

describe("牌桌事件存档", () => {
  test("中断后的事件流和快照可恢复相同牌桌及机器人公开记忆", () => {
    const initial = createTableSession(73);
    const action = getLegalSingleActions(initial.game).find(
      (candidate) => candidate.type === "play"
    );
    expect(action).toBeDefined();
    if (!action) throw new Error("expected an opening play");

    const advanced = applyTableSessionAction(initial, action);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) throw new Error("expected legal action");

    const restored = restoreTableSession(serializeTableSession(advanced.session));

    expect(restored.game.state).toEqual(advanced.session.game.state);
    expect(restored.game.publicEvents).toEqual(advanced.session.game.publicEvents);
    expect(restored.stream.events).toEqual(advanced.session.stream.events);
  });

  test("旧 rulesVersion 被明确拒绝，不能静默按当前规则恢复", () => {
    const save = structuredClone(serializeTableSession(createTableSession(73)));
    Reflect.set(save.stream, "rulesVersion", "guandan-v0");

    expect(() => restoreTableSession(save)).toThrow("rules version mismatch");
  });
});
