// Shared Guandan core source.
import { createInitialSimulationBotView, runSimulation } from "./simulation";
import { chooseNormalVNextBotAction } from "./normal-vnext-bot";
import { monotonicNow } from "../../platform/clock";

export interface BotBenchmark {
  readonly gameCount: number;
  readonly completedGames: number;
  readonly normalTeamWinRate: number;
  readonly averageActionCount: number;
  readonly averageDecisionMs: number;
  readonly maxDecisionMs: number;
}

export interface NormalVNextDecisionBenchmark {
  readonly seeds: readonly number[];
  readonly completedDecisions: number;
  readonly totalLegalActions: number;
  readonly averageDecisionMs: number;
  readonly maxDecisionMs: number;
}

/**
 * Small, deterministic P7 performance gate. It measures the production
 * normal-vNext selector on the exact initial BotView for each fixed seed,
 * rather than coupling P7 to the long historical normal/basic 100-game run.
 */
export function benchmarkNormalVNextDecisions(
  seeds: readonly number[],
): NormalVNextDecisionBenchmark {
  let completedDecisions = 0;
  let totalLegalActions = 0;
  let totalDecisionMs = 0;
  let maxDecisionMs = 0;
  for (const seed of seeds) {
    const view = createInitialSimulationBotView(seed);
    const started = monotonicNow();
    const decision = chooseNormalVNextBotAction(view);
    const elapsed = monotonicNow() - started;
    if (!decision || !view.legalActions.includes(decision.action))
      throw new Error(`normal-vNext chose no legal action for seed ${seed}`);
    completedDecisions += 1;
    totalLegalActions += view.legalActions.length;
    totalDecisionMs += elapsed;
    maxDecisionMs = Math.max(maxDecisionMs, elapsed);
  }
  return {
    seeds: [...seeds],
    completedDecisions,
    totalLegalActions,
    averageDecisionMs: totalDecisionMs / Math.max(1, completedDecisions),
    maxDecisionMs,
  };
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
