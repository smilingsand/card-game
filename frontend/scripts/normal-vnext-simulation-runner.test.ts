import { expect, test } from "vitest";
import { runNormalVNextSimulation } from "./normal-vnext-simulation-runner";

test("runner 顺序消费固定 seed 并写出可复核报告", () => {
  const seen: number[] = [],
    written = new Map<string, string>();
  const report = runNormalVNextSimulation(
    {
      profile: "normal-vNext",
      seeds: [0, 7],
      gamesPerSeed: 1,
      maxTurns: 100,
      outputDir: "p7-test"
    },
    {
      now: (() => {
        let value = 0;
        return () => ++value;
      })(),
      runSimulation: ((
        seed: number,
        options: {
          onDecision?: (sample: { decisionMs: number; view?: undefined; action: unknown }) => void;
        }
      ) => {
        seen.push(seed);
        options.onDecision?.({ decisionMs: 2, action: {} });
        return { ok: true, seed, actionCount: 1, finish: ["east"], settlement: {} };
      }) as never,
      makeDirectory: (() => undefined) as never,
      writeFile: ((path: string, content: string) => written.set(path, content)) as never
    }
  );
  expect(seen).toEqual([0, 7]);
  expect(report.metrics["normal-vNext"]).toMatchObject({
    gameCount: 2,
    completedGames: 2,
    averageDecisionMs: 2
  });
  expect([...written.keys()]).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/report\.json$/),
      expect.stringMatching(/report\.md$/),
      expect.stringMatching(/anomaly-fixtures\.json$/)
    ])
  );
});

test("runner 遇到失败局时拒绝生成成功基线", () => {
  expect(() =>
    runNormalVNextSimulation(
      { profile: "normal-vNext", seeds: [0], gamesPerSeed: 1, maxTurns: 100, outputDir: "p7-test" },
      {
        runSimulation: (() => ({
          ok: false,
          seed: 0,
          actionCount: 1,
          code: "illegal_action",
          message: "fixture"
        })) as never,
        makeDirectory: (() => undefined) as never,
        writeFile: (() => undefined) as never
      }
    )
  ).toThrow("contains failed games");
});
