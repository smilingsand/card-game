import { expect, test } from "vitest";
import type { ControlResourceEvaluation } from "./control-resource-evaluator";
import { createContestContext, evaluateContestAction } from "./contest-evaluator";
import type { FollowUpPlan } from "./follow-up-planner";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import type { SituationAnalysis } from "./situation-analyzer";

const situation = (
  threat: "low" | "high" | "critical",
  teammate: { isSprinting: boolean; isHolding: boolean } = { isSprinting: false, isHolding: false }
) => ({ opponentThreat: { level: threat }, teammate }) as SituationAnalysis;

const post = (overrides: Record<string, unknown> = {}) =>
  ({
    delta: { structuralIntegrity: 0, deadHandRisk: 0 },
    destroyedGroups: [],
    ...overrides
  }) as unknown as PostActionHandEvaluation;

const control = (overrides: Record<string, unknown> = {}) =>
  ({
    before: { totalUniqueCardIds: ["control"] },
    after: { totalUniqueCardIds: ["control"] },
    opportunityCost: { score: 0 },
    exception: null,
    ...overrides
  }) as unknown as ControlResourceEvaluation;

const follow = (overrides: Record<string, unknown> = {}) =>
  ({
    noUsefulFollowUp: false,
    createsRunoutPath: false,
    retainsControlPotential: false,
    ...overrides
  }) as FollowUpPlan;

test("低威胁、高结构/资源成本且无后续时，pass 正常胜过可合法压制，绝不机械 must-contest", () => {
  const context = createContestContext(situation("low"));
  const pass = evaluateContestAction({
    context,
    action: { type: "pass", actor: "east" },
    postAction: post(),
    control: control(),
    followUp: follow()
  });
  const expensivePlay = evaluateContestAction({
    context,
    action: { type: "play", actor: "east", cardIds: ["x"], interpretation: undefined as never },
    postAction: post({
      delta: { structuralIntegrity: -25, deadHandRisk: 20 },
      destroyedGroups: [{ severity: "severe" }]
    }),
    control: control({ opportunityCost: { score: 3 } }),
    followUp: follow({ noUsefulFollowUp: true })
  });

  expect(pass.shouldContest).toBe(false);
  expect(expensivePlay.shouldContest).toBe(false);
  expect(expensivePlay.contestValue).toBeLessThan(pass.contestValue);
  expect(expensivePlay.reasons).toContain("low_threat_high_cost_no_follow_up");
});

test("高威胁、队友救援与明确出完路线都是可解释例外，而非合法动作本身触发争夺", () => {
  const highThreat = evaluateContestAction({
    context: createContestContext(situation("critical")),
    action: { type: "play", actor: "east", cardIds: ["x"], interpretation: undefined as never },
    postAction: post(),
    control: control(),
    followUp: follow()
  });
  const teamRescue = evaluateContestAction({
    context: createContestContext(situation("low", { isSprinting: true, isHolding: false })),
    action: { type: "play", actor: "east", cardIds: ["x"], interpretation: undefined as never },
    postAction: post(),
    control: control({ exception: "team_support" }),
    followUp: follow()
  });
  const runout = evaluateContestAction({
    context: createContestContext(situation("low")),
    action: { type: "play", actor: "east", cardIds: ["x"], interpretation: undefined as never },
    postAction: post(),
    control: control(),
    followUp: follow({ createsRunoutPath: true, retainsControlPotential: true })
  });

  expect(highThreat.shouldContest).toBe(true);
  expect(highThreat.reasons).toContain("critical_opponent_threat");
  expect(teamRescue.shouldContest).toBe(true);
  expect(teamRescue.reasons).toContain("team_support_exception");
  expect(runout.shouldContest).toBe(true);
  expect(runout.reasons).toContain("runout_path");
});

test("context/result 均为确定性只读派生结果，且不暴露对手手牌或 seed", () => {
  const input = situation("high", { isSprinting: false, isHolding: true });
  const before = structuredClone(input);
  const context = createContestContext(input);
  const result = evaluateContestAction({
    context,
    action: { type: "pass", actor: "east" },
    postAction: post(),
    control: control(),
    followUp: follow()
  });
  expect(context).toEqual(createContestContext(input));
  expect(result).toEqual(
    evaluateContestAction({
      context,
      action: { type: "pass", actor: "east" },
      postAction: post(),
      control: control(),
      followUp: follow()
    })
  );
  expect(input).toEqual(before);
  expect("opponentHands" in context).toBe(false);
  expect("seed" in result).toBe(false);
});
