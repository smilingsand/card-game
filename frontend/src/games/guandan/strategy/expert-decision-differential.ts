import type { TurnAction } from "../turns";
import type { StrategyDecision } from "./decision-explanation";
import {
  baselineExpertDecisionForDifferential,
  chooseExpertBotDecision,
  clearExpertDecisionCache,
  type ChooseExpertBotDecisionInput
} from "./expert-decision";

/**
 * This module is intentionally test/benchmark-only.  In particular, its
 * baseline never narrows `view.legalActions`: both sides receive the exact
 * same complete BotView, profile snapshot and performance budget.
 */

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function actionKey(action: TurnAction): string {
  return stableJson(action);
}

/** The public, deterministic result contract used by the differential tests. */
export interface DecisionFingerprint {
  readonly profile: StrategyDecision["explanation"]["profile"];
  readonly legalActionKeys: readonly string[];
  readonly candidateOrder: readonly string[];
  /** Includes base/full score components, rule hits, eligibility and explanation fields. */
  readonly candidates: readonly unknown[];
  readonly selectedAction: string;
  readonly finalReason: readonly string[];
}

export function createExpertDecisionFingerprint(
  input: ChooseExpertBotDecisionInput,
  decision: StrategyDecision
): DecisionFingerprint {
  return {
    profile: decision.explanation.profile,
    // Preserve A-layer order as supplied by the rules engine: it is part of
    // the stable tie-break contract, so sorting here would conceal a defect.
    legalActionKeys: input.view.legalActions.map(actionKey),
    candidateOrder: decision.explanation.candidates.map((candidate) => actionKey(candidate.action)),
    candidates: decision.explanation.candidates,
    selectedAction: actionKey(decision.selectedAction),
    finalReason: decision.explanation.finalReason
  };
}

export interface ExpertDecisionDifferentialTrace {
  readonly decision: StrategyDecision;
  readonly fingerprint: DecisionFingerprint;
  readonly elapsedMilliseconds: number;
  readonly mode: "baseline-test-only" | "optimized-production";
}

/**
 * Full, unprojected reference execution.  It is deliberately excluded from
 * production exports/entry points and exists only to make a replay fail closed
 * when an exact reuse optimization changes the externally visible decision.
 */
export function baselineExpertDecision(
  input: ChooseExpertBotDecisionInput
): ExpertDecisionDifferentialTrace {
  clearExpertDecisionCache();
  const started = performance.now();
  const decision = baselineExpertDecisionForDifferential(input);
  return {
    decision,
    fingerprint: createExpertDecisionFingerprint(input, decision),
    elapsedMilliseconds: performance.now() - started,
    mode: "baseline-test-only"
  };
}

/** Same full input and budget, with production's exact reuse implementation enabled. */
export function optimizedExpertDecision(
  input: ChooseExpertBotDecisionInput
): ExpertDecisionDifferentialTrace {
  clearExpertDecisionCache();
  const started = performance.now();
  const decision = chooseExpertBotDecision(input);
  return {
    decision,
    fingerprint: createExpertDecisionFingerprint(input, decision),
    elapsedMilliseconds: performance.now() - started,
    mode: "optimized-production"
  };
}

/** Fails closed for legal-set, order, score, rule-hit, explanation or selection changes. */
export function assertExpertDecisionEquivalent(input: ChooseExpertBotDecisionInput): {
  readonly baseline: ExpertDecisionDifferentialTrace;
  readonly optimized: ExpertDecisionDifferentialTrace;
} {
  const baseline = baselineExpertDecision(input);
  const optimized = optimizedExpertDecision(input);
  const left = stableJson(baseline.fingerprint);
  const right = stableJson(optimized.fingerprint);
  if (left !== right)
    throw new Error(
      "expert differential failure: complete DecisionFingerprint differs between the " +
        "test-only baseline and optimized production evaluator"
    );
  return { baseline, optimized };
}
