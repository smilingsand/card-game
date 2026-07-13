import { describe, expect, test } from "vitest";
import { getLegalSingleActions } from "./table-controller";
import {
  applyTableSessionAction,
  createTableSession,
  restoreTableSession,
  serializeTableSession,
  setHumanDisplayOrder
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

  test("显示顺序单独保存，绝不写入规则事件，且 v1 存档回退到自动排序", () => {
    const initial = createTableSession(73);
    const preferred = [...initial.game.state.hands.south].reverse();
    const arranged = setHumanDisplayOrder(initial, preferred);
    const save = serializeTableSession(arranged);

    expect(save.saveSchemaVersion).toBe(2);
    expect(save.humanDisplayOrder).toEqual(preferred);
    expect(save.stream.events).toEqual(initial.stream.events);
    expect(save.snapshot.state).toEqual(initial.snapshot.state);
    expect(restoreTableSession(save).humanDisplayOrder).toEqual(preferred);

    const v1Save = structuredClone(save);
    Reflect.set(v1Save, "saveSchemaVersion", 1);
    Reflect.deleteProperty(v1Save, "humanDisplayOrder");
    expect(restoreTableSession(v1Save).humanDisplayOrder).toBeUndefined();
  });

  test("出牌后恢复的显示顺序会剔除已出实体牌 ID", () => {
    const initial = createTableSession(73);
    const arranged = setHumanDisplayOrder(initial, [...initial.game.state.hands.south].reverse());
    const opening = getLegalSingleActions(arranged.game).find(
      (candidate) => candidate.type === "play"
    );
    if (!opening) throw new Error("expected opening play");
    const afterOpening = applyTableSessionAction(arranged, opening);
    if (!afterOpening.ok) throw new Error("expected legal opening play");
    const action = getLegalSingleActions(afterOpening.session.game).find(
      (candidate) => candidate.type === "play"
    );
    if (!action) throw new Error("expected an opening play");
    const advanced = applyTableSessionAction(afterOpening.session, action);
    if (!advanced.ok) throw new Error("expected legal action");

    expect(
      restoreTableSession(serializeTableSession(advanced.session)).humanDisplayOrder
    ).not.toContain(action.cardIds[0]);
  });

  test("当前轮三名下家均过牌后清轮，最高公开出牌随状态清空", () => {
    const initial = createTableSession(73);
    const opening = getLegalSingleActions(initial.game).find(
      (candidate) => candidate.type === "play"
    );
    if (!opening) throw new Error("expected opening play");
    const afterOpening = applyTableSessionAction(initial, opening);
    if (!afterOpening.ok) throw new Error("expected legal opening play");
    const afterSouth = applyTableSessionAction(afterOpening.session, {
      type: "pass",
      actor: "south"
    });
    if (!afterSouth.ok) throw new Error("expected south pass");
    const afterWest = applyTableSessionAction(afterSouth.session, {
      type: "pass",
      actor: "west"
    });
    if (!afterWest.ok) throw new Error("expected west pass");
    const cleared = applyTableSessionAction(afterWest.session, { type: "pass", actor: "north" });

    expect(cleared).toMatchObject({ ok: true, state: { current: "east", highest: undefined } });
  });
});
