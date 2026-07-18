import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSimulation } from "../simulation";
import { createDecisionFingerprint } from "./decision-cache";
import { createDefaultStrategyProfile } from "./decision-explanation";
import {
  createExperimentalFullBenchmarkBudget,
  EXPERT_DECISION_BUDGET,
  chooseExpertBotDecision
} from "./expert-decision";
import {
  ADR_0020_FIXED_ACTION_INDEXES,
  ADR_0020_MANDATORY_ACTION_INDEXES,
  createFixedBotViewQualityReport,
  SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES,
  selectSeedZeroFixedBotViewSamples,
  type FixedBotViewQualityCase
} from "./fixed-botview-quality";

const ADR_0020_EXPERT_12_BUDGET = {
  handPlanTopN: { default: 4, max: 4 },
  postActionReplanCount: { default: 1, max: 1 },
  postActionCandidateCount: { default: 12, max: 24 },
  followUpCandidateCount: { default: 12, max: 24 }
} as const;

function fixedBotViewFingerprint(
  view: Parameters<typeof chooseExpertBotDecision>[0]["view"]
): string {
  return createDecisionFingerprint({
    view,
    legalActionSummary: JSON.stringify(view.legalActions),
    profile: {
      id: "expert",
      version: "p2.5a-depth-12-v1",
      rulesVersion: "guandan-v1",
      weightsVersion: "p2.5a-weights-v1"
    }
  });
}

function compactFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `p25-fixed-v1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

test("ADR-0020 选择器保留 seed=0 Top-20，并以稳定规则补足公开局面覆盖", () => {
  const samples = SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES.map((actionIndex) => ({
    seed: 0,
    actionIndex,
    view: {
      selfSeat: "east" as const,
      leader: "east" as const,
      levelRank: "2" as const,
      selfHand: [],
      publicEvents: [],
      remainingCardCounts: { east: 27, south: 27, west: 27, north: 27 },
      legalActions: []
    }
  }));
  const selected = selectSeedZeroFixedBotViewSamples([
    ...samples,
    ...ADR_0020_FIXED_ACTION_INDEXES.filter(
      (actionIndex) => !samples.some((sample) => sample.actionIndex === actionIndex)
    ).map((actionIndex) => ({ ...samples[0], actionIndex }))
  ]);
  expect(ADR_0020_FIXED_ACTION_INDEXES).toHaveLength(34);
  expect(selected.map((sample) => sample.actionIndex)).toEqual(
    expect.arrayContaining([...SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES])
  );
  expect(selected.some((sample) => sample.coverage.includes("opening"))).toBe(true);
  expect(selected.some((sample) => sample.coverage.includes("middle"))).toBe(true);
  expect(selected.some((sample) => sample.coverage.includes("endgame"))).toBe(true);
});

test.runIf(process.env.P25_CAPTURE_FIXED_BOTVIEWS === "1")(
  "ADR-0020 历史 expert-12 路径重放产生冻结的 34 个 BotView 指纹",
  () => {
    const botViews: {
      seed: number;
      actionIndex: number;
      view: Parameters<typeof chooseExpertBotDecision>[0]["view"];
    }[] = [];
    expect(
      runSimulation(0, {
        difficulties: { east: "expert", west: "expert", south: "normal", north: "normal" },
        expertPerformanceBudget: ADR_0020_EXPERT_12_BUDGET,
        onBotView: (sample) => botViews.push(sample)
      }).ok
    ).toBe(true);
    const selected = selectSeedZeroFixedBotViewSamples(botViews);
    expect(selected.map((sample) => sample.actionIndex)).toEqual([
      ...ADR_0020_FIXED_ACTION_INDEXES
    ]);
    console.info(
      JSON.stringify(
        selected.map((sample) => [
          sample.actionIndex,
          compactFingerprint(fixedBotViewFingerprint(sample.view))
        ])
      )
    );
  },
  0
);

test.runIf(process.env.P25_FIXED_BOTVIEW_QUALITY === "1")(
  "ADR-0020/0021：seed=0 实际 BotView 的 expert-24 与 experimental-full 逐决策全字段质量对照",
  () => {
    const botViews: {
      seed: number;
      actionIndex: number;
      view: Parameters<typeof chooseExpertBotDecision>[0]["view"];
    }[] = [];
    const simulation = runSimulation(0, {
      difficulties: { east: "expert", west: "expert", south: "normal", north: "normal" },
      expertPerformanceBudget: ADR_0020_EXPERT_12_BUDGET,
      onBotView: (sample) => botViews.push(sample)
    });
    expect(simulation.ok).toBe(true);

    const selected = selectSeedZeroFixedBotViewSamples(botViews);
    expect(selected).toHaveLength(34);
    expect(selected.map((sample) => sample.actionIndex)).toEqual([
      ...ADR_0020_FIXED_ACTION_INDEXES
    ]);
    expect(selected.map((sample) => sample.actionIndex)).toEqual(
      expect.arrayContaining([...SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES])
    );
    expect(ADR_0020_MANDATORY_ACTION_INDEXES.length).toBeGreaterThan(0);

    const profile = createDefaultStrategyProfile("expert");
    const cases: FixedBotViewQualityCase[] = selected.map((sample) => {
      const expert = chooseExpertBotDecision({
        view: sample.view,
        profile,
        performanceBudget: EXPERT_DECISION_BUDGET
      });
      const experimentalFull = chooseExpertBotDecision({
        view: sample.view,
        profile,
        performanceBudget: createExperimentalFullBenchmarkBudget(sample.view.legalActions.length)
      });
      return {
        id: `seed-0-action-${sample.actionIndex}`,
        seed: 0,
        actionIndex: sample.actionIndex,
        expert,
        experimentalFull,
        coverage: [
          ...sample.coverage,
          ...(ADR_0020_MANDATORY_ACTION_INDEXES.includes(
            sample.actionIndex as (typeof ADR_0020_MANDATORY_ACTION_INDEXES)[number]
          )
            ? (["mandatory"] as const)
            : [])
        ],
        botViewFingerprint: fixedBotViewFingerprint(sample.view)
      };
    });
    const report = createFixedBotViewQualityReport(cases);
    // Keep the worker RPC payload bounded: full BotView fingerprints make the
    // historical quality evidence several megabytes and can hide a completed
    // assertion behind Vitest's heartbeat error.
    const differingActionIndexes = report.depth.differences.map((item) => item.actionIndex);
    const compactReport = {
      contract: "ADR-0022",
      sample: "ADR-0020 frozen seed=0 fixed BotViews",
      totalCaseCount: report.totalCaseCount,
      actionDifferenceCount: report.actionDifferenceCount,
      actionDifferenceRate: report.actionDifferenceRate,
      metrics: report.depth.metrics,
      differingActionIndexes,
      endgameOrPartnerRegressionActionIndexes: differingActionIndexes.filter(
        (actionIndex) =>
          actionIndex >= 103 || report.coverage.partner_cooperation.includes(actionIndex)
      ),
      coverage: report.coverage
    };
    console.info(JSON.stringify(compactReport));
    writeFileSync(
      resolve(
        process.cwd(),
        "../proj-info/handoffs/P2.5-16-ADR-0022-fixed-botview-quality-result.json"
      ),
      `${JSON.stringify(compactReport, null, 2)}\n`,
      "utf8"
    );
    for (const coverage of [
      "opening",
      "middle",
      "endgame",
      "top_20_slow",
      "bomb",
      "wildcard",
      "partner_cooperation",
      "opponent_near_finish",
      "mandatory"
    ] as const)
      expect(report.coverage[coverage].length, `missing ${coverage} coverage`).toBeGreaterThan(0);
    expect(report.totalCaseCount).toBeGreaterThanOrEqual(
      SEED_ZERO_TOP_20_SLOW_ACTION_INDEXES.length
    );
    expect(
      report.cases.every(
        (item) => item.expertCandidateCount === item.experimentalFullCandidateCount
      )
    ).toBe(true);
    expect(report.actionDifferenceRate).toBeLessThanOrEqual(0.1);
    expect(report.depth.metrics.dead_hand_risk_created.delta).toBeLessThanOrEqual(1);
    // A zero-difference result also proves no tail blocking or partnership
    // cooperation action regression in their explicitly tagged samples.
    expect(compactReport.endgameOrPartnerRegressionActionIndexes.length).toBe(0);
  },
  0
);
