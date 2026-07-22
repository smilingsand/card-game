import { runSimulation } from "./simulation";

export interface BotBenchmark {
  readonly gameCount: number;
  readonly completedGames: number;
  readonly normalTeamWinRate: number;
  readonly averageActionCount: number;
  readonly averageDecisionMs: number;
  readonly maxDecisionMs: number;
}
export function benchmarkBots(options: {
  readonly startSeed: number;
  readonly gameCount: number;
}): BotBenchmark {
  let completedGames = 0,
    normalWins = 0,
    actions = 0,
    maxDecisionMs = 0;
  const start = performance.now();
  for (let i = 0; i < options.gameCount; i += 1) {
    const before = performance.now();
    const result = runSimulation(options.startSeed + i, {
      east: "normal",
      west: "normal",
      south: "basic",
      north: "basic"
    });
    maxDecisionMs = Math.max(maxDecisionMs, performance.now() - before);
    if (result.ok) {
      completedGames += 1;
      actions += result.actionCount;
      if (result.finish[0] === "east" || result.finish[0] === "west") normalWins += 1;
    }
  }
  return {
    gameCount: options.gameCount,
    completedGames,
    normalTeamWinRate: completedGames ? normalWins / completedGames : 0,
    averageActionCount: completedGames ? actions / completedGames : 0,
    averageDecisionMs: (performance.now() - start) / Math.max(1, actions),
    maxDecisionMs
  };
}
