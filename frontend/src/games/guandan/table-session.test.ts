import { describe, expect, test } from "vitest";
import { getLegalSingleActions } from "./table-controller";
import {
  applyTableSessionAction,
  createTableSession,
  prepareNextTableSession,
  getSouthReturnChoices,
  getSouthTributeChoices,
  restoreTableSession,
  serializeTableSession,
  setHumanDisplayOrder,
  submitSouthReturn,
  submitSouthTribute
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
    Reflect.set(save.stream, "rulesVersion", "guandan-v1");

    expect(() => restoreTableSession(save)).toThrow("rules version mismatch");
  });

  test("显示顺序单独保存，绝不写入规则事件", () => {
    const initial = createTableSession(73);
    const preferred = [...initial.game.state.hands.south].reverse();
    const arranged = setHumanDisplayOrder(initial, preferred);
    const save = serializeTableSession(arranged);

    expect(save.saveSchemaVersion).toBe(4);
    expect(save.humanDisplayOrder).toEqual(preferred);
    expect(save.stream.events).toEqual(initial.stream.events);
    expect(save.snapshot.state).toEqual(initial.snapshot.state);
    expect(restoreTableSession(save).humanDisplayOrder).toEqual(preferred);
  });

  test("旧单局存档被明确拒绝，不会被按连续赛局规则恢复", () => {
    const legacySave = structuredClone(serializeTableSession(createTableSession(73)));
    Reflect.set(legacySave, "saveSchemaVersion", 2);

    expect(() => restoreTableSession(legacySave)).toThrow("legacy single-round saves");
  });

  test("一局结束后会保存双方等级、完成顺序、下一局先手和待进贡计划，并可恢复", () => {
    const initial = createTableSession(73);
    const completed = {
      ...initial,
      game: {
        ...initial.game,
        state: {
          ...initial.game.state,
          completed: true as const,
          finished: ["south", "north", "east", "west"] as const
        }
      },
      match: { ...initial.match, currentFinish: ["south", "north", "east", "west"] as const }
    };

    const next = prepareNextTableSession(completed);
    const restored = restoreTableSession(serializeTableSession(next));

    expect(next.match).toMatchObject({
      roundNumber: 2,
      levels: { northSouth: "5", eastWest: "2" },
      previousFinish: ["south", "north", "east", "west"],
      leader: "south",
      levelRank: "5"
    });
    expect(next.game.levelRank).toBe("5");
    expect(restored.match).toEqual(next.match);
    expect(restored.game.state).toEqual(next.game.state);
  });

  test("北家头游而东家进贡时，下一局由东家先出并使用东/西方等级", () => {
    const initial = createTableSession(74);
    const completed = {
      ...initial,
      game: {
        ...initial.game,
        state: {
          ...initial.game.state,
          completed: true as const,
          finished: ["north", "west", "south", "east"] as const
        }
      },
      match: {
        ...initial.match,
        levels: { northSouth: "6" as const, eastWest: "2" as const },
        currentFinish: ["north", "west", "south", "east"] as const
      }
    };

    const next = prepareNextTableSession(completed);

    expect(next.match).toMatchObject({
      levels: { northSouth: "8", eastWest: "2" },
      leader: "east",
      levelRank: "8",
      tributePhase: "ready"
    });
    expect(next.game.state.leader).toBe("east");
    expect(next.game.levelRank).toBe("8");
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
    const afterEast = applyTableSessionAction(afterOpening.session, {
      type: "pass",
      actor: "east"
    });
    if (!afterEast.ok) throw new Error("expected east pass");
    const afterNorth = applyTableSessionAction(afterEast.session, {
      type: "pass",
      actor: "north"
    });
    if (!afterNorth.ok) throw new Error("expected north pass");
    const cleared = applyTableSessionAction(afterNorth.session, { type: "pass", actor: "west" });

    expect(cleared).toMatchObject({ ok: true, state: { current: "south", highest: undefined } });
  });

  test("南家进贡手动提交，机器人自动还贡并在交换后保留可恢复的下一局", () => {
    const initial = createTableSession(91);
    const completed = {
      ...initial,
      game: {
        ...initial.game,
        state: {
          ...initial.game.state,
          completed: true as const,
          finished: ["east", "north", "west", "south"] as const
        }
      },
      match: { ...initial.match, currentFinish: ["east", "north", "west", "south"] as const }
    };
    const awaitingTribute = prepareNextTableSession(completed);
    const tribute = getSouthTributeChoices(awaitingTribute);

    expect(awaitingTribute.match.tributePhase).toBe("awaiting-tribute");
    expect(tribute).not.toHaveLength(0);

    const exchanged = submitSouthTribute(awaitingTribute, tribute[0]);
    expect(exchanged.match.tributePhase).toBe("ready");
    expect(getSouthReturnChoices(exchanged)).toEqual([]);
    expect(exchanged.game.state.hands.south).toHaveLength(27);
    expect(restoreTableSession(serializeTableSession(exchanged)).game.state.hands).toEqual(
      exchanged.game.state.hands
    );
  });

  test("南家收贡时必须手动还不大于十的牌，另一位机器人会自动完成双下还贡", () => {
    const awaitingReturn = Array.from({ length: 32 }, (_, seed) => {
      const initial = createTableSession(seed);
      const completed = {
        ...initial,
        game: {
          ...initial.game,
          state: {
            ...initial.game.state,
            completed: true as const,
            finished: ["south", "north", "east", "west"] as const
          }
        },
        match: { ...initial.match, currentFinish: ["south", "north", "east", "west"] as const }
      };
      return prepareNextTableSession(completed);
    }).find((session) => session.match.tributePhase === "awaiting-return");
    if (!awaitingReturn) throw new Error("expected a non-anti-tribute dealt round");
    const choices = getSouthReturnChoices(awaitingReturn);

    expect(awaitingReturn.match.tributePhase).toBe("awaiting-return");
    expect(choices).not.toHaveLength(0);
    const exchanged = submitSouthReturn(awaitingReturn, choices[0]);
    expect(exchanged.match.tributePhase).toBe("ready");
    expect(exchanged.match.submittedReturns).toHaveLength(2);
    expect(exchanged.game.state.hands.south).toHaveLength(27);
  });
});
