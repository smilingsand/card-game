import { expect, test } from "vitest";
import { selectFollowUpCandidates } from "./follow-up-candidate-selection";

test("mandatory 候选先于普通预算进入 FollowUp，且按固定优先级和 key 截断", () => {
  const selected = selectFollowUpCandidates({
    candidates: [
      { key: "z", baseScore: 100, mandatoryReason: null },
      { key: "finish-b", baseScore: 1, mandatoryReason: "finish_now" },
      { key: "beat-c", baseScore: 1, mandatoryReason: "must_beat" },
      { key: "partner-a", baseScore: 1, mandatoryReason: "partner_finish_setup" },
      { key: "finish-a", baseScore: 1, mandatoryReason: "finish_now" }
    ],
    budget: { default: 2, max: 4 }
  });

  expect(selected.selectedKeys).toEqual(["finish-a", "finish-b", "beat-c", "partner-a"]);
  expect(selected.mandatoryOverflow).toBe(false);
  expect(selected.entries.find((entry) => entry.key === "z")).toMatchObject({
    status: "not_evaluated",
    reason: "base_score_budget"
  });
});

test("mandatory 超过 max 时记录 overflow，且不得以普通预算截断", () => {
  const selected = selectFollowUpCandidates({
    candidates: [
      { key: "f2", baseScore: 1, mandatoryReason: "finish_now" },
      { key: "f1", baseScore: 1, mandatoryReason: "finish_now" },
      { key: "b1", baseScore: 1, mandatoryReason: "must_beat" },
      { key: "p1", baseScore: 1, mandatoryReason: "partner_finish_setup" },
      { key: "p2", baseScore: 1, mandatoryReason: "partner_finish_setup" }
    ],
    budget: { default: 1, max: 3 }
  });

  expect(selected.selectedKeys).toEqual(["f1", "f2", "b1"]);
  expect(selected.mandatoryOverflow).toBe(true);
  expect(selected.entries.find((entry) => entry.key === "p1")).toMatchObject({
    status: "not_evaluated",
    reason: "mandatory_overflow"
  });
});

test("普通候选只按 baseScore 降序和稳定 key 补足预算", () => {
  const selected = selectFollowUpCandidates({
    candidates: [
      { key: "b", baseScore: 5, mandatoryReason: null },
      { key: "a", baseScore: 5, mandatoryReason: null },
      { key: "c", baseScore: 4, mandatoryReason: null }
    ],
    budget: { default: 2, max: 64 }
  });
  expect(selected.selectedKeys).toEqual(["a", "b"]);
  expect(selected.entries.find((entry) => entry.key === "c")).toMatchObject({
    status: "not_evaluated",
    reason: "base_score_budget"
  });
});

test("ADR-0022 ordinary 18+6: base score 通道后从剩余候选按低死手代理入围", () => {
  const selected = selectFollowUpCandidates({
    candidates: Array.from({ length: 30 }, (_, index) => ({
      key: `c${String(index).padStart(2, "0")}`,
      baseScore: 100 - index,
      deadHandRiskProxy: index < 18 ? 100 : 30 - index,
      mandatoryReason: null
    })),
    budget: { default: 24, max: 32 },
    ordinaryAdmission: { baseScoreCount: 18, riskProxyCount: 6 }
  });
  expect(selected.selectedKeys).toEqual([
    ...Array.from({ length: 18 }, (_, index) => `c${String(index).padStart(2, "0")}`),
    "c29",
    "c28",
    "c27",
    "c26",
    "c25",
    "c24"
  ]);
  expect(selected.entries.find((entry) => entry.key === "c29")).toMatchObject({
    status: "completed",
    reason: "dead_hand_risk_proxy_budget"
  });
});
