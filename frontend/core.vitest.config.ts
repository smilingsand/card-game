import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "../packages/guandan-core/src/platform/deck.test.ts",
      "../packages/guandan-core/src/platform/event-store.test.ts",
      "../packages/guandan-core/src/platform/runtime-globals.test.ts",
      "../packages/guandan-core/src/platform/secure-seed.test.ts",
      "../packages/guandan-core/src/platform/types.test.ts",
      "../packages/guandan-core/src/games/guandan/basic-bot.test.ts",
      "../packages/guandan-core/src/games/guandan/bot-benchmark.test.ts",
      "../packages/guandan-core/src/games/guandan/bot-timing.test.ts",
      "../packages/guandan-core/src/games/guandan/bot-view.test.ts",
      "../packages/guandan-core/src/games/guandan/comparison.test.ts",
      "../packages/guandan-core/src/games/guandan/display-order.test.ts",
      "../packages/guandan-core/src/games/guandan/match.test.ts",
      "../packages/guandan-core/src/games/guandan/normal-bot.test.ts",
      "../packages/guandan-core/src/games/guandan/normal-vnext-bot.test.ts",
      "../packages/guandan-core/src/games/guandan/normal-vnext-metrics.test.ts",
      "../packages/guandan-core/src/games/guandan/patterns.test.ts",
      "../packages/guandan-core/src/games/guandan/rule-cases.test.ts",
      "../packages/guandan-core/src/games/guandan/settlement.test.ts",
      "../packages/guandan-core/src/games/guandan/simulation.test.ts",
      "../packages/guandan-core/src/games/guandan/strategy-analysis.test.ts",
      "../packages/guandan-core/src/games/guandan/table-controller.test.ts",
      "../packages/guandan-core/src/games/guandan/table-session.test.ts",
      "../packages/guandan-core/src/games/guandan/tribute.test.ts",
      "../packages/guandan-core/src/games/guandan/turns.test.ts"
    ],
    exclude: ["**/bot-benchmark.10k.test.ts"]
  }
});
