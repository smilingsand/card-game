import { runSimulation } from "./games/guandan/simulation";
import { clearCompleteLegalActionsCaches } from "./games/guandan/rule-complete-legal-actions";
import { createDefaultStrategyProfile } from "./games/guandan/strategy/decision-explanation";
import {
  chooseExpertBotDecision,
  clearExpertDecisionCache,
  EXPERT_DECISION_BUDGET
} from "./games/guandan/strategy/expert-decision";
import { clearExpertHandAnalysisCache } from "./games/guandan/strategy/hand-analysis-cache";
import { selectSeedZeroFixedBotViewSamples } from "./games/guandan/strategy/fixed-botview-quality";

type ReplayView = Parameters<typeof chooseExpertBotDecision>[0]["view"];

interface BrowserMeasurement {
  readonly actionIndex: number;
  readonly elapsedMilliseconds: number;
  readonly longTaskMilliseconds: number;
  readonly selectedActionType: string;
  readonly candidateCount: number;
}

interface BrowserReport {
  readonly contract: "ADR-0023-browser";
  readonly fixedActionIndexes: readonly number[];
  readonly samples: readonly BrowserMeasurement[];
  readonly memory?: { readonly usedJSHeapSize: number; readonly totalJSHeapSize: number };
}

function clearExactCaches(): void {
  clearExpertDecisionCache();
  clearExpertHandAnalysisCache();
  clearCompleteLegalActionsCaches();
}

function captureFixedViews(): readonly {
  readonly actionIndex: number;
  readonly view: ReplayView;
}[] {
  const replay: {
    readonly seed: number;
    readonly actionIndex: number;
    readonly view: ReplayView;
  }[] = [];
  const result = runSimulation(0, {
    difficulties: { east: "expert", west: "expert", south: "normal", north: "normal" },
    onBotView: (sample) => replay.push(sample)
  });
  if (!result.ok) throw new Error(`seed=0 replay failed: ${result.code}`);
  return selectSeedZeroFixedBotViewSamples(replay).map(({ actionIndex, view }) => ({
    actionIndex,
    view
  }));
}

async function run(): Promise<BrowserReport> {
  // Opening/top-20 (0), middle/top-20 (44), and endgame/mandatory (114), all ADR-0020 frozen.
  const representativeIndexes = new Set([0, 44, 114]);
  const fixed = captureFixedViews().filter(({ actionIndex }) =>
    representativeIndexes.has(actionIndex)
  );
  if (fixed.length !== representativeIndexes.size)
    throw new Error(
      `representative BotView capture incomplete: ${fixed.map((item) => item.actionIndex).join(",")}`
    );

  clearExactCaches();
  const longTasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  observer.observe({ entryTypes: ["longtask"] });
  const profile = createDefaultStrategyProfile("expert");
  const samples: BrowserMeasurement[] = [];
  for (const { actionIndex, view } of fixed) {
    const beforeLongTaskCount = longTasks.length;
    const started = performance.now();
    const decision = chooseExpertBotDecision({
      view,
      profile,
      performanceBudget: EXPERT_DECISION_BUDGET
    });
    const elapsedMilliseconds = performance.now() - started;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const observed = longTasks
      .slice(beforeLongTaskCount)
      .reduce((sum, entry) => sum + entry.duration, 0);
    samples.push({
      actionIndex,
      elapsedMilliseconds,
      longTaskMilliseconds: observed,
      selectedActionType: decision.selectedAction.type,
      candidateCount: decision.explanation.candidates.length
    });
  }
  observer.disconnect();
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  ).memory;
  return {
    contract: "ADR-0023-browser",
    fixedActionIndexes: [...representativeIndexes],
    samples,
    memory: memory && {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize
    }
  };
}

declare global {
  interface Window {
    __p25BrowserPerformance?: { readonly run: () => Promise<BrowserReport> };
  }
}

window.__p25BrowserPerformance = { run };
