import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  diagnoseNormalVNextAction,
  NORMAL_VNEXT_METRIC_IDS,
  runSimulation,
  type BotDifficulty
} from "@card-game/guandan-core";

export type SimulationProfile = "normal-v1" | "normal-vNext" | "compare";
type MetricId = (typeof NORMAL_VNEXT_METRIC_IDS)[number];
type ReplayStep = { readonly alerts: readonly string[]; readonly totalDecisionMs: number };

export interface NormalVNextSimulationOptions {
  readonly profile: SimulationProfile;
  readonly seeds: readonly number[];
  readonly gamesPerSeed: number;
  readonly maxTurns: number;
  readonly outputDir: string;
}

export interface SimulationRuntime {
  readonly now: () => number;
  readonly runSimulation: typeof runSimulation;
  readonly diagnose: typeof diagnoseNormalVNextAction;
  readonly makeDirectory: typeof mkdirSync;
  readonly writeFile: typeof writeFileSync;
}

const defaultRuntime: SimulationRuntime = {
  now: () => performance.now(),
  runSimulation,
  diagnose: diagnoseNormalVNextAction,
  makeDirectory: mkdirSync,
  writeFile: writeFileSync
};

const percentile95 = (values: readonly number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : 0;

const difficulty = (profile: Exclude<SimulationProfile, "compare">): BotDifficulty =>
  profile === "normal-v1" ? "normal" : "normal-vNext";

/** Runs the existing fixed-seed diagnostic simulation without CLI concerns. */
export function runNormalVNextSimulation(
  options: NormalVNextSimulationOptions,
  overrides: Partial<SimulationRuntime> = {}
) {
  const runtime = { ...defaultRuntime, ...overrides };
  const started = runtime.now();
  const profiles: readonly Exclude<SimulationProfile, "compare">[] =
    options.profile === "compare" ? ["normal-v1", "normal-vNext"] : [options.profile];
  const games = profiles.flatMap((profile) =>
    options.seeds.flatMap((seed) =>
      Array.from({ length: options.gamesPerSeed }, (_, game) => {
        const steps: unknown[] = [];
        const slow: unknown[] = [];
        const counters = Object.fromEntries(NORMAL_VNEXT_METRIC_IDS.map((id) => [id, 0])) as Record<
          MetricId,
          number
        >;
        const decisionTimes: number[] = [];
        const gameStarted = runtime.now();
        const result = runtime.runSimulation(seed, {
          maxActions: options.maxTurns,
          difficulties: {
            east: difficulty(profile),
            south: difficulty(profile),
            west: difficulty(profile),
            north: difficulty(profile)
          },
          onDecision: (sample) => {
            const metricStarted = runtime.now();
            const alerts = sample.view ? runtime.diagnose(sample.view, sample.action) : [];
            alerts.forEach((id) => (counters[id] += 1));
            const metricDiagnosticsMs = runtime.now() - metricStarted;
            decisionTimes.push(sample.decisionMs);
            const replayView = sample.view && {
              selfSeat: sample.view.selfSeat,
              leader: sample.view.leader,
              highestSeat: sample.view.highestSeat,
              levelRank: sample.view.levelRank,
              selfHand: sample.view.selfHand,
              remainingCardCounts: sample.view.remainingCardCounts,
              publicEventCount: sample.view.publicEvents.length
            };
            const step = {
              seed,
              game,
              turn: sample.actionIndex,
              actor: sample.action.actor,
              profile,
              view: replayView,
              legalActions: sample.view?.legalActions,
              selectedAction: sample.action,
              reasons: sample.reasons ?? [],
              validation: "runSimulation validateAction passed",
              alerts,
              legalActionsGenerationMs: sample.legalActionsGenerationMs ?? 0,
              botDecisionMs: sample.botDecisionMs ?? sample.decisionMs,
              metricDiagnosticsMs,
              totalDecisionMs: sample.decisionMs
            };
            steps.push(step);
            slow.push({ ...step, candidateCount: sample.legalActionCount });
          }
        });
        const slowestDecisions = (slow as Array<{ totalDecisionMs: number }>)
          .sort((a, b) => b.totalDecisionMs - a.totalDecisionMs)
          .slice(0, 20);
        return {
          seed,
          game,
          profile,
          result,
          completed: result.ok,
          turnCount: result.actionCount,
          totalRuntimeMs: runtime.now() - gameStarted,
          averageDecisionMs:
            decisionTimes.reduce((total, value) => total + value, 0) / (decisionTimes.length || 1),
          p95DecisionMs: percentile95(decisionTimes),
          slowestDecisionMs: Math.max(0, ...decisionTimes),
          counters,
          replay: steps,
          slowestDecisions
        };
      })
    )
  );
  const summarize = (items: typeof games) => ({
    gameCount: items.length,
    completedGames: items.filter((item) => item.completed).length,
    maxTurnExceeded: items.filter(
      (item) => !item.completed && item.result.code === "max_actions_exceeded"
    ).length,
    illegalAction: items.filter((item) => !item.completed && item.result.code === "illegal_action")
      .length,
    forcedPass: items.reduce((total, item) => total + item.counters.forced_pass, 0),
    lowCostBeatMissed: items.reduce((total, item) => total + item.counters.low_cost_beat_missed, 0),
    teammateOvertake: items.reduce((total, item) => total + item.counters.teammate_overtake, 0),
    jokerOverLowSingle: items.reduce(
      (total, item) => total + item.counters.joker_over_low_single,
      0
    ),
    tripleSplitForSingle: items.reduce(
      (total, item) => total + item.counters.triple_split_for_single,
      0
    ),
    bombSplitForNormalPlay: items.reduce(
      (total, item) => total + item.counters.bomb_split_for_normal_play,
      0
    ),
    highPairUsedAsKicker: items.reduce(
      (total, item) => total + item.counters.high_pair_used_as_kicker,
      0
    ),
    endgameBlockMissed: items.reduce(
      (total, item) => total + item.counters.endgame_block_missed,
      0
    ),
    averageTurnCount:
      items.reduce((total, item) => total + item.turnCount, 0) / (items.length || 1),
    averageDecisionMs:
      items.reduce((total, item) => total + item.averageDecisionMs, 0) / (items.length || 1),
    p95DecisionMs: percentile95(
      items.flatMap((item) => (item.replay as ReplayStep[]).map((step) => step.totalDecisionMs))
    ),
    slowestDecisionMs: Math.max(0, ...items.map((item) => item.slowestDecisionMs))
  });
  const report = {
    profile: options.profile,
    seeds: [...options.seeds],
    gamesPerSeed: options.gamesPerSeed,
    maxTurns: options.maxTurns,
    totalRuntimeMs: runtime.now() - started,
    metrics: Object.fromEntries(
      profiles.map((profile) => [
        profile,
        summarize(games.filter((game) => game.profile === profile))
      ])
    ),
    games,
    replayReference: "games[].replay",
    compare:
      options.profile === "compare"
        ? {
            delta: {
              averageTurnCount:
                summarize(games.filter((game) => game.profile === "normal-vNext"))
                  .averageTurnCount -
                summarize(games.filter((game) => game.profile === "normal-v1")).averageTurnCount
            }
          }
        : undefined
  };
  const outputDir = resolve(options.outputDir);
  runtime.makeDirectory(outputDir, { recursive: true });
  runtime.writeFile(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  runtime.writeFile(
    resolve(outputDir, "report.md"),
    `# Guandan bot simulation\n\n- profile: ${options.profile}\n- games: ${games.length}\n- runtimeMs: ${report.totalRuntimeMs.toFixed(1)}\n\n${JSON.stringify(report.metrics, null, 2)}\n`,
    "utf8"
  );
  runtime.writeFile(
    resolve(outputDir, "anomaly-fixtures.json"),
    JSON.stringify(
      games.flatMap((game) => (game.replay as ReplayStep[]).filter((step) => step.alerts.length)),
      null,
      2
    ),
    "utf8"
  );
  if (games.some((game) => !game.completed))
    throw new Error("normal-vNext simulation contains failed games");
  return report;
}
