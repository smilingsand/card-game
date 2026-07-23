import { expect, test } from "vitest";
import {
  applyTableSessionAction,
  createTableSession,
  getLegalSingleActions,
  serializeTableSession
} from "@card-game/guandan-core";

function replayFingerprint() {
  const initial = createTableSession(73);
  const opening = getLegalSingleActions(initial.game)[0];
  if (!opening) throw new Error("expected deterministic opening");
  const afterOpening = applyTableSessionAction(initial, opening);
  if (!afterOpening.ok) throw new Error("expected valid deterministic opening");
  const afterPass = applyTableSessionAction(afterOpening.session, { type: "pass", actor: "east" });
  if (!afterPass.ok) throw new Error("expected deterministic pass");
  const save = serializeTableSession(afterPass.session);
  return {
    eventCount: save.stream.events.length,
    snapshotSequence: save.snapshot.eventSequence,
    current: afterPass.session.game.state.current,
    handSizes: Object.values(afterPass.session.game.state.hands).map((hand) => hand.length)
  };
}

test("浏览器运行时以固定 seed 重放共享核心", () => {
  expect(replayFingerprint()).toEqual({
    current: "north",
    eventCount: 2,
    handSizes: [27, 22, 27, 27],
    snapshotSequence: 1
  });
});
