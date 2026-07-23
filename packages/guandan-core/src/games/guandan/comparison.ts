// Shared Guandan core source.
import type { PatternInterpretation } from "./patterns";

export type Comparison =
  | { readonly ok: true; readonly result: "greater" | "equal" | "less" }
  | { readonly ok: false; readonly code: "incomparable" };
function tier(pattern: PatternInterpretation): number {
  if (pattern.type === "four-jokers") return 6;
  if (pattern.type === "normal-bomb")
    return pattern.cardIds.length >= 6
      ? 5
      : pattern.cardIds.length === 5
        ? 3
        : 2;
  if (pattern.type === "straight-flush") return 4;
  return 1;
}
function keys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
export function compareInterpretations(
  candidate: PatternInterpretation,
  current: PatternInterpretation,
): Comparison {
  const candidateTier = tier(candidate),
    currentTier = tier(current);
  if (candidateTier !== 1 || currentTier !== 1)
    return {
      ok: true,
      result:
        candidateTier === currentTier
          ? keys(candidate.comparisonKey, current.comparisonKey) > 0
            ? "greater"
            : keys(candidate.comparisonKey, current.comparisonKey) < 0
              ? "less"
              : "equal"
          : candidateTier > currentTier
            ? "greater"
            : "less",
    };
  if (
    candidate.type !== current.type ||
    candidate.cardIds.length !== current.cardIds.length
  )
    return { ok: false, code: "incomparable" };
  const result = keys(candidate.comparisonKey, current.comparisonKey);
  return {
    ok: true,
    result: result > 0 ? "greater" : result < 0 ? "less" : "equal",
  };
}
export function canFollow(
  candidate: PatternInterpretation,
  current: PatternInterpretation,
): boolean {
  const result = compareInterpretations(candidate, current);
  return result.ok && result.result === "greater";
}
