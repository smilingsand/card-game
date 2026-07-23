import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  diagnoseNormalVNextAction,
  NORMAL_VNEXT_METRIC_IDS,
  runSimulation,
  type BotDifficulty
} from "@card-game/guandan-core";

type Profile = "normal-v1" | "normal-vNext" | "compare";
type ReplayStep = { readonly alerts: readonly string[]; readonly totalDecisionMs: number };
const raw = Object.fromEntries(
  process.argv.slice(2).map((part) => {
    const [key, value] = part.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  })
);
const fail = (message: string): never => {
  console.error(`normal-vnext-simulation: ${message}`);
  process.exit(1);
};
const parsePositive = (name: string, fallback: number) => {
  const value = Number(raw[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) fail(`--${name} must be a positive integer`);
  return value;
};
const seeds = (raw.seeds ?? "0,1").split(",").map(Number);
if (seeds.length === 0 || seeds.some((seed) => !Number.isInteger(seed) || seed < 0))
  fail("--seeds must be comma-separated non-negative integers");
const gamesPerSeed = parsePositive("games-per-seed", 1),
  maxTurns = parsePositive("max-turns", 1000);
const profile = (raw.profile ?? "normal-vNext") as Profile;
if (!["normal-v1", "normal-vNext", "compare"].includes(profile))
  fail("--profile must be normal-v1, normal-vNext, or compare");
const outputDir = resolve(raw["output-dir"] ?? "../temp/normal-vnext-simulation");
mkdirSync(outputDir, { recursive: true });
const percentile95 = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : 0;
function run(seed: number, game: number, label: Exclude<Profile, "compare">) {
  const difficulty: BotDifficulty = label === "normal-v1" ? "normal" : "normal-vNext";
  const steps: unknown[] = [],
    slow: unknown[] = [],
    counters = Object.fromEntries(NORMAL_VNEXT_METRIC_IDS.map((id) => [id, 0])) as Record<
      string,
      number
    >;
  const times: number[] = [];
  const started = performance.now();
  const result = runSimulation(seed, {
    maxActions: maxTurns,
    difficulties: { east: difficulty, south: difficulty, west: difficulty, north: difficulty },
    onDecision: (sample) => {
      const metricStarted = performance.now();
      const alerts = sample.view ? diagnoseNormalVNextAction(sample.view, sample.action) : [];
      alerts.forEach((id) => (counters[id] += 1));
      const metricDiagnosticsMs = performance.now() - metricStarted;
      times.push(sample.decisionMs);
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
        profile: label,
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
  const sortedSlow = (slow as Array<{ totalDecisionMs: number }>)
    .sort((a, b) => b.totalDecisionMs - a.totalDecisionMs)
    .slice(0, 20);
  return {
    seed,
    game,
    profile: label,
    result,
    completed: result.ok,
    turnCount: result.actionCount,
    totalRuntimeMs: performance.now() - started,
    averageDecisionMs: times.reduce((a, b) => a + b, 0) / (times.length || 1),
    p95DecisionMs: percentile95(times),
    slowestDecisionMs: Math.max(0, ...times),
    counters,
    replay: steps,
    slowestDecisions: sortedSlow
  };
}
const started = performance.now();
const labels: Exclude<Profile, "compare">[] =
  profile === "compare" ? ["normal-v1", "normal-vNext"] : [profile];
const games = labels.flatMap((label) =>
  seeds.flatMap((seed) => Array.from({ length: gamesPerSeed }, (_, game) => run(seed, game, label)))
);
const summary = (items: typeof games) => ({
  gameCount: items.length,
  completedGames: items.filter((item) => item.completed).length,
  maxTurnExceeded: items.filter(
    (item) => !item.completed && item.result.code === "max_actions_exceeded"
  ).length,
  illegalAction: items.filter((item) => !item.completed && item.result.code === "illegal_action")
    .length,
  forcedPass: items.reduce((n, item) => n + item.counters.forced_pass, 0),
  lowCostBeatMissed: items.reduce((n, item) => n + item.counters.low_cost_beat_missed, 0),
  teammateOvertake: items.reduce((n, item) => n + item.counters.teammate_overtake, 0),
  jokerOverLowSingle: items.reduce((n, item) => n + item.counters.joker_over_low_single, 0),
  tripleSplitForSingle: items.reduce((n, item) => n + item.counters.triple_split_for_single, 0),
  bombSplitForNormalPlay: items.reduce(
    (n, item) => n + item.counters.bomb_split_for_normal_play,
    0
  ),
  highPairUsedAsKicker: items.reduce((n, item) => n + item.counters.high_pair_used_as_kicker, 0),
  endgameBlockMissed: items.reduce((n, item) => n + item.counters.endgame_block_missed, 0),
  averageTurnCount: items.reduce((n, item) => n + item.turnCount, 0) / (items.length || 1),
  averageDecisionMs: items.reduce((n, item) => n + item.averageDecisionMs, 0) / (items.length || 1),
  p95DecisionMs: percentile95(
    items.flatMap((item) => (item.replay as ReplayStep[]).map((step) => step.totalDecisionMs))
  ),
  slowestDecisionMs: Math.max(0, ...items.map((item) => item.slowestDecisionMs))
});
const report = {
  profile,
  seeds,
  gamesPerSeed,
  maxTurns,
  totalRuntimeMs: performance.now() - started,
  metrics: Object.fromEntries(
    labels.map((label) => [label, summary(games.filter((game) => game.profile === label))])
  ),
  games,
  replayReference: "games[].replay",
  compare:
    profile === "compare"
      ? {
          delta: {
            averageTurnCount:
              summary(games.filter((g) => g.profile === "normal-vNext")).averageTurnCount -
              summary(games.filter((g) => g.profile === "normal-v1")).averageTurnCount
          }
        }
      : undefined
};
writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  resolve(outputDir, "report.md"),
  `# Guandan bot simulation\n\n- profile: ${profile}\n- games: ${games.length}\n- runtimeMs: ${report.totalRuntimeMs.toFixed(1)}\n\n\
${JSON.stringify(report.metrics, null, 2)}\n`
);
writeFileSync(
  resolve(outputDir, "anomaly-fixtures.json"),
  JSON.stringify(
    games.flatMap((game) => (game.replay as ReplayStep[]).filter((step) => step.alerts.length)),
    null,
    2
  )
);
console.log(resolve(outputDir, "report.json"));
