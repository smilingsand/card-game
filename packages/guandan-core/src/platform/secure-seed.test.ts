import { describe, expect, test } from "vitest";
import { generateDeck, shuffleDeck } from "./deck";
import { createSecureSeedRandom, parseSecureSeed } from "./secure-seed";
import {
  applyTableSessionAction,
  createTableSession,
  restoreTableSession,
  serializeTableSession,
} from "../games/guandan/table-session";

const SEED = parseSecureSeed(
  "0123456789abcdef00112233445566778899aabbccddeefffedcba9876543210",
);

describe("P3-04 secure seed", () => {
  test("固定 32-byte seed 跨运行可重放且末尾 word 会影响结果", () => {
    const deck = generateDeck({ deckCount: 2, includeJokers: true });
    const first = shuffleDeck(deck, SEED).map((card) => card.id);
    const second = shuffleDeck(deck, SEED).map((card) => card.id);
    const changedLastWord = shuffleDeck(
      deck,
      parseSecureSeed(
        "0123456789abcdef00112233445566778899aabbccddeefffedcba9876543211",
      ),
    ).map((card) => card.id);
    expect(first).toEqual(second);
    expect(first).not.toEqual(changedLastWord);
  });

  test("不调用 Math.random，且旧 number seed 固定回放保持不变", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random must not be used");
    };
    try {
      expect(createSecureSeedRandom(SEED)()).toBeGreaterThanOrEqual(0);
      expect(createTableSession(SEED).game.state.hands.south).toHaveLength(27);
      expect(createTableSession(73).game.state.hands.south.slice(0, 3)).toEqual(
        createTableSession(73).game.state.hands.south.slice(0, 3),
      );
    } finally {
      Math.random = original;
    }
  });

  test("拒绝非 32-byte 小写 hexadecimal 与零 seed", () => {
    expect(() => parseSecureSeed("00")).toThrow("32 lowercase");
    expect(() => parseSecureSeed("0".repeat(64))).toThrow("must not be zero");
    expect(() => parseSecureSeed("A".repeat(64))).toThrow("32 lowercase");
  });

  test("同一 secure seed 与事件流可完整重放", () => {
    const initial = createTableSession(SEED);
    const action = {
      type: "play" as const,
      actor: "south" as const,
      cardIds: [initial.game.state.hands.south[0]!],
    };
    const first = applyTableSessionAction(initial, action);
    const second = applyTableSessionAction(createTableSession(SEED), action);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok)
      throw new Error("fixture action must be valid");
    expect(first.session).toEqual(second.session);
    expect(restoreTableSession(serializeTableSession(first.session))).toEqual(
      first.session,
    );
  });
});
