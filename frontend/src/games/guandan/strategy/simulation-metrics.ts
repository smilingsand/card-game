import type { SimulationDecisionSample } from "../simulation";
import type { ExplainedCandidate } from "./decision-explanation";

export const EXPERT_METRIC_IDS = [
  "unnecessary_natural_bomb_split",
  "low_value_wildcard_use",
  "smaller_bomb_when_natural_exists",
  "control_exhaustion_with_many_cards",
  "low_singles_increase_after_action",
  "meaningless_high_cost_contest",
  "dead_hand_risk_created",
  "meaningless_takeover_while_teammate_holds",
  "endgame_block_success"
] as const;

export type ExpertMetricId = (typeof EXPERT_METRIC_IDS)[number];
export interface MetricCounter {
  readonly numerator: number;
  readonly denominator: number;
}
export interface ExpertMetricDiagnostic {
  readonly metric: ExpertMetricId;
  readonly seed: number;
  readonly actionIndex: number;
  readonly action: SimulationDecisionSample["action"];
  readonly profile: "expert" | "experimental";
  readonly matchedRuleIds: readonly string[];
}
export interface ExpertMetricReport {
  readonly counters: Readonly<Record<ExpertMetricId, MetricCounter>>;
  readonly diagnostics: readonly ExpertMetricDiagnostic[];
}

function emptyCounters(): Record<ExpertMetricId, { numerator: number; denominator: number }> {
  return Object.fromEntries(
    EXPERT_METRIC_IDS.map((id) => [id, { numerator: 0, denominator: 0 }])
  ) as Record<ExpertMetricId, { numerator: number; denominator: number }>;
}
function sameAction(
  left: SimulationDecisionSample["action"],
  right: SimulationDecisionSample["action"]
): boolean {
  return (
    left.type === right.type &&
    left.actor === right.actor &&
    (left.type === "pass" || right.type === "pass"
      ? left.type === right.type
      : left.cardIds.join(",") === right.cardIds.join(","))
  );
}
function selected(sample: SimulationDecisionSample): ExplainedCandidate {
  const found = sample.explanation?.candidates.find((candidate) =>
    sameAction(candidate.action, sample.action)
  );
  if (!found)
    throw new Error("expert simulation sample lacks the selected expert candidate explanation");
  return found;
}
function ruleIds(candidate: ExplainedCandidate): readonly string[] {
  return candidate.matchedRules.map((rule) => rule.ruleId);
}

/**
 * Aggregates only explicit expert/experimental decision explanations. Each diagnostic retains
 * seed/action index so every numerator can be replayed without consulting normal decisions.
 */
export function collectExpertMetrics(
  samples: readonly SimulationDecisionSample[]
): ExpertMetricReport {
  const counters = emptyCounters();
  const diagnostics: ExpertMetricDiagnostic[] = [];
  for (const sample of samples) {
    if (sample.profile !== "expert" && sample.profile !== "experimental") continue;
    if (!sample.explanation)
      throw new Error("expert simulation sample must come from the expert decision chain");
    const winner = selected(sample),
      alternatives = sample.explanation.candidates;
    const s = winner.signals;
    const has = (id: ExpertMetricId, opportunity: boolean, failure: boolean) => {
      if (!opportunity) return;
      counters[id].denominator += 1;
      if (failure) {
        counters[id].numerator += 1;
        diagnostics.push({
          metric: id,
          seed: sample.seed,
          actionIndex: sample.actionIndex,
          action: sample.action,
          profile: sample.profile as "expert" | "experimental",
          matchedRuleIds: ruleIds(winner)
        });
      }
    };
    const naturalAlternative = alternatives.some(
      (candidate) => candidate.signals.preservesNaturalPattern && !candidate.hardExcluded
    );
    has("unnecessary_natural_bomb_split", naturalAlternative, Boolean(s.breaksNaturalBomb));
    has(
      "low_value_wildcard_use",
      winner.action.type === "play",
      winner.matchedRules.some((rule) => rule.ruleId.includes("wildcard")) && winner.finalScore < 0
    );
    has(
      "smaller_bomb_when_natural_exists",
      alternatives.some((candidate) => candidate.signals.hasNaturalAlternative),
      Boolean(s.hasNaturalAlternative && s.usesWildcardCompletedPattern)
    );
    has(
      "control_exhaustion_with_many_cards",
      Boolean(s.opponentHasManyCards),
      winner.control.spendsLastControlResource
    );
    has(
      "low_singles_increase_after_action",
      winner.action.type === "play",
      winner.postAction.lowSingleCount >= 2
    );
    has(
      "meaningless_high_cost_contest",
      alternatives.some((candidate) => candidate.action.type === "pass"),
      winner.action.type === "play" &&
        winner.control.opportunityCost > 0 &&
        winner.followUp.noUsefulFollowUp
    );
    has(
      "dead_hand_risk_created",
      winner.action.type === "play",
      winner.postAction.deadHandRisk > 0
    );
    has(
      "meaningless_takeover_while_teammate_holds",
      Boolean(s.teammateHolding),
      winner.action.type === "play" && !winner.signals.endgameBlock
    );
    has(
      "endgame_block_success",
      Boolean(s.endgameBlock),
      winner.action.type === "play" && Boolean(s.endgameBlock)
    );
  }
  return { counters, diagnostics };
}
