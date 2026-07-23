export const PRESET_PLAYER_NAMES = Object.freeze([
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

const DISPLAY_NAME_PATTERN =
  /^[\p{L}\p{N}](?:[\p{L}\p{N} ]{0,14}[\p{L}\p{N}])?$/u;

export function canonicalizeDisplayName(input) {
  return input.normalize("NFKC").trim().replaceAll(/ +/g, " ");
}

export function validateDisplayName(input) {
  if (typeof input !== "string") {
    return { ok: false, code: "display_name.invalid_type" };
  }

  const value = canonicalizeDisplayName(input);
  const length = [...value].length;
  if (length < 2 || length > 16) {
    return { ok: false, code: "display_name.invalid_length" };
  }
  if (!DISPLAY_NAME_PATTERN.test(value)) {
    return { ok: false, code: "display_name.invalid_characters" };
  }
  return { ok: true, value };
}

export function validateRoomDisplayNames(names) {
  const seen = new Set();
  for (const name of names) {
    const result = validateDisplayName(name);
    if (!result.ok) return result;

    const comparisonKey = result.value.toLocaleLowerCase("und");
    if (seen.has(comparisonKey)) {
      return { ok: false, code: "display_name.duplicate_in_room" };
    }
    seen.add(comparisonKey);
  }
  return { ok: true };
}
