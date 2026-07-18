export type FollowUpMandatoryReason = "finish_now" | "must_beat" | "partner_finish_setup" | null;

export interface FollowUpCandidateSelectionInput {
  readonly candidates: readonly {
    readonly key: string;
    readonly baseScore: number;
    readonly deadHandRiskProxy?: number;
    readonly mandatoryReason: FollowUpMandatoryReason;
  }[];
  readonly budget: { readonly default: number; readonly max: number };
  /** ADR-0022 ordinary candidates: primary score channel + risk-proxy channel. */
  readonly ordinaryAdmission?: { readonly baseScoreCount: number; readonly riskProxyCount: number };
}

export interface FollowUpCandidateSelectionEntry {
  readonly key: string;
  readonly status: "completed" | "not_evaluated";
  readonly reason:
    "mandatory" | "base_score_budget" | "dead_hand_risk_proxy_budget" | "mandatory_overflow";
  readonly mandatoryReason: FollowUpMandatoryReason;
}

const mandatoryPriority: Readonly<Record<Exclude<FollowUpMandatoryReason, null>, number>> = {
  finish_now: 0,
  must_beat: 1,
  partner_finish_setup: 2
};

/**
 * Selects only candidates eligible for complete FollowUp. This function is
 * pure: no time, cache state or generation order participates in the result.
 */
export function selectFollowUpCandidates(input: FollowUpCandidateSelectionInput): {
  readonly selectedKeys: readonly string[];
  readonly entries: readonly FollowUpCandidateSelectionEntry[];
  readonly mandatoryOverflow: boolean;
} {
  const mandatory = input.candidates
    .filter((candidate) => candidate.mandatoryReason !== null)
    .sort(
      (left, right) =>
        mandatoryPriority[left.mandatoryReason!] - mandatoryPriority[right.mandatoryReason!] ||
        left.key.localeCompare(right.key)
    );
  const mandatoryOverflow = mandatory.length > input.budget.max;
  const admittedMandatory = mandatory.slice(0, input.budget.max);
  const remaining = Math.max(input.budget.default - admittedMandatory.length, 0);
  const ordinaryCandidates = input.candidates
    .filter((candidate) => candidate.mandatoryReason === null)
    .sort((left, right) => right.baseScore - left.baseScore || left.key.localeCompare(right.key));
  const baseScoreCount = Math.min(input.ordinaryAdmission?.baseScoreCount ?? remaining, remaining);
  const baseScoreOrdinary = ordinaryCandidates.slice(0, baseScoreCount);
  const baseScoreKeys = new Set(baseScoreOrdinary.map((candidate) => candidate.key));
  const riskProxyOrdinary = input.ordinaryAdmission
    ? ordinaryCandidates
        .filter((candidate) => !baseScoreKeys.has(candidate.key))
        .sort(
          (left, right) =>
            (left.deadHandRiskProxy ?? Number.POSITIVE_INFINITY) -
              (right.deadHandRiskProxy ?? Number.POSITIVE_INFINITY) ||
            right.baseScore - left.baseScore ||
            left.key.localeCompare(right.key)
        )
        .slice(
          0,
          Math.min(input.ordinaryAdmission.riskProxyCount, remaining - baseScoreOrdinary.length)
        )
    : [];
  const admittedOrdinary = [...baseScoreOrdinary, ...riskProxyOrdinary];
  const admittedOrdinaryKeys = new Set(admittedOrdinary.map((candidate) => candidate.key));
  const ordinary = [
    ...admittedOrdinary,
    ...ordinaryCandidates
      .filter((candidate) => !admittedOrdinaryKeys.has(candidate.key))
      .slice(0, Math.max(0, remaining - admittedOrdinary.length))
  ];
  const selectedKeys = new Set(
    [...admittedMandatory, ...ordinary].map((candidate) => candidate.key)
  );
  const overflowKeys = new Set(mandatory.slice(input.budget.max).map((candidate) => candidate.key));
  return {
    selectedKeys: [...admittedMandatory, ...ordinary].map((candidate) => candidate.key),
    mandatoryOverflow,
    entries: input.candidates.map((candidate) => ({
      key: candidate.key,
      status: selectedKeys.has(candidate.key) ? "completed" : "not_evaluated",
      reason: selectedKeys.has(candidate.key)
        ? candidate.mandatoryReason === null
          ? riskProxyOrdinary.some((item) => item.key === candidate.key)
            ? "dead_hand_risk_proxy_budget"
            : "base_score_budget"
          : "mandatory"
        : overflowKeys.has(candidate.key)
          ? "mandatory_overflow"
          : "base_score_budget",
      mandatoryReason: candidate.mandatoryReason
    }))
  };
}
