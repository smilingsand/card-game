// Shared Guandan core source.
import { runSimulation } from "./simulation";
import { monotonicNow } from "../../platform/clock";

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
  const start = monotonicNow();
  for (let i = 0; i < options.gameCount; i += 1) {
    const before = monotonicNow();
    const result = runSimulation(options.startSeed + i, {
      east: "normal",
      west: "normal",
      south: "basic",
      north: "basic",
    });
    maxDecisionMs = Math.max(maxDecisionMs, monotonicNow() - before);
    if (result.ok) {
      completedGames += 1;
      actions += result.actionCount;
      if (result.finish[0] === "east" || result.finish[0] === "west")
        normalWins += 1;
    }
  }
  return {
    gameCount: options.gameCount,
    completedGames,
    normalTeamWinRate: completedGames ? normalWins / completedGames : 0,
    averageActionCount: completedGames ? actions / completedGames : 0,
    averageDecisionMs: (monotonicNow() - start) / Math.max(1, actions),
    maxDecisionMs,
  };
}
