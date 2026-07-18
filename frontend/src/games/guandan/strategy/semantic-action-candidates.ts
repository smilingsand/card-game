import type { TurnAction } from "../turns";

type PlayAction = Extract<TurnAction, { readonly type: "play" }>;

/**
 * One rules-visible interpretation that is represented by the same physical
 * cards.  `canonicalAction` is the only action that may be submitted; aliases
 * remain auditable explanation data and are never silently discarded.
 */
export interface SemanticCandidate {
  readonly canonicalAction: TurnAction;
  readonly aliases: readonly TurnAction[];
  readonly semanticKey: string;
}

/** A physical card removal with all of its semantically distinct candidates. */
export interface CanonicalPhysicalAction {
  readonly physicalKey: string;
  readonly cardIds: readonly string[];
  readonly semanticCandidates: readonly SemanticCandidate[];
}

const sortedIds = (cardIds: readonly string[]) => [...cardIds].sort();

export function canonicalPhysicalActionKey(action: TurnAction): string {
  return action.type === "pass"
    ? `pass:${action.actor}`
    : `play:${action.actor}:${sortedIds(action.cardIds).join(",")}`;
}

/**
 * This is deliberately narrower than an interpretation serialization.  Wildcard
 * assignments are aliases only when the action that reaches the rule engine has
 * the same type, comparison key, bomb/special priority and card count.  Those
 * are precisely the fields used by turn progression and `canFollow`.
 */
export function observableSemanticKey(action: TurnAction): string {
  if (action.type === "pass") return "pass";
  const { type, comparisonKey, cardIds } = action.interpretation;
  const specialPriority =
    type === "four-jokers"
      ? 6
      : type === "normal-bomb"
        ? cardIds.length >= 6
          ? 5
          : cardIds.length === 5
            ? 3
            : 2
        : type === "straight-flush"
          ? 4
          : 1;
  return [type, cardIds.length, comparisonKey.join(","), specialPriority].join("|");
}

function canonicalAction(actions: readonly TurnAction[]): TurnAction {
  return [...actions].sort((left, right) => {
    if (left.type === "pass" || right.type === "pass") return 0;
    const wildcardCount =
      Object.keys(left.interpretation.wildcardAs).length -
      Object.keys(right.interpretation.wildcardAs).length;
    if (wildcardCount) return wildcardCount;
    return JSON.stringify(left.interpretation.wildcardAs).localeCompare(
      JSON.stringify(right.interpretation.wildcardAs)
    );
  })[0];
}

/**
 * Converts the complete rules-validated action list into physical removals plus
 * semantic candidates.  It never removes a semantically different legal play:
 * a different type, comparison key, bomb tier/card count or special priority
 * is a separate candidate.  Strict aliases share only the expensive physical
 * successor analysis.
 */
export function canonicalizeSemanticCandidates(
  legalActions: readonly TurnAction[]
): readonly CanonicalPhysicalAction[] {
  const physical = new Map<string, TurnAction[]>();
  for (const action of legalActions) {
    const key = canonicalPhysicalActionKey(action);
    physical.set(key, [...(physical.get(key) ?? []), action]);
  }
  return [...physical.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([physicalKey, actions]) => {
      const semantic = new Map<string, TurnAction[]>();
      for (const action of actions) {
        const key = observableSemanticKey(action);
        semantic.set(key, [...(semantic.get(key) ?? []), action]);
      }
      const semanticCandidates = [...semantic.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([semanticKey, interpretations]) => {
          const canonical = canonicalAction(interpretations);
          return {
            canonicalAction: canonical,
            aliases: interpretations.filter((action) => action !== canonical),
            semanticKey
          };
        });
      const play = actions.find((action): action is PlayAction => action.type === "play");
      return {
        physicalKey,
        cardIds: play ? sortedIds(play.cardIds) : [],
        semanticCandidates
      };
    });
}
