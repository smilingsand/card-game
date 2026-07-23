import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESET_PLAYER_NAMES,
  canonicalizeDisplayName,
  validateDisplayName,
  validateRoomDisplayNames,
} from "./name-policy.mjs";

test("P3-01: 预设名称池完整且顺序稳定", () => {
  assert.deepEqual(PRESET_PLAYER_NAMES, [
    "曹操",
    "刘备",
    "孙权",
    "周瑜",
    "诸葛亮",
    "关羽",
    "张飞",
    "赵云",
    "貂蝉",
    "小乔",
    "甄宓",
  ]);
});

test("P3-01: 自定义显示名规范化并拒绝越界输入", () => {
  assert.equal(canonicalizeDisplayName("  Player 1  "), "Player 1");
  assert.deepEqual(validateDisplayName("赵云"), { ok: true, value: "赵云" });
  assert.deepEqual(validateDisplayName("A"), {
    ok: false,
    code: "display_name.invalid_length",
  });
  assert.deepEqual(validateDisplayName("玩家<script>"), {
    ok: false,
    code: "display_name.invalid_characters",
  });
  assert.deepEqual(validateDisplayName("玩家\u200b一号"), {
    ok: false,
    code: "display_name.invalid_characters",
  });
});

test("P3-01: 同一房间显示名在规范化后仍须唯一", () => {
  assert.deepEqual(validateRoomDisplayNames(["曹操", "刘备"]), { ok: true });
  assert.deepEqual(validateRoomDisplayNames(["Player 1", "player 1"]), {
    ok: false,
    code: "display_name.duplicate_in_room",
  });
});
