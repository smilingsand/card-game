import type { Card, Rank } from "../../../platform/types";
import { DecisionCache, type CacheStatistics } from "./decision-cache";
import { analyzeHandStructure, type HandStructureAnalysis } from "./hand-structure-analyzer";
import {
  generateHandPlans,
  type GenerateHandPlansInput,
  type HandPlan
} from "./hand-plan-generator";

type LevelRank = Exclude<Rank, "small-joker" | "big-joker">;

// Synchronous diagnostic switch only. It makes the differential oracle
// recompute pure hand analyses instead of observing any process-local reuse.
let bypassExpertHandAnalysisCache = false;

/** The cache key deliberately includes card identity, not merely rank/suit. */
export function createHandAnalysisFingerprint(input: {
  readonly hand: readonly Card[];
  readonly levelRank: LevelRank;
  readonly rulesVersion: string;
}): string {
  return JSON.stringify({
    rulesVersion: input.rulesVersion,
    levelRank: input.levelRank,
    hand: [...input.hand]
      .map((card) => [card.id, card.deckIndex, card.rank, card.suit])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  });
}

function planKey(input: GenerateHandPlansInput, rulesVersion: string): string {
  return JSON.stringify({
    rulesVersion,
    structure: input.structure.fingerprint,
    role: input.role ?? "neutral",
    performanceBudget: input.performanceBudget
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/**
 * Exact, process-local LRU reuse for pure hand analysis. Rules/profile versions and the
 * complete plan budget are part of the keys, so a hit is observationally indistinguishable
 * from recomputation. Values are deeply frozen before publication.
 */
export class HandAnalysisCache {
  private readonly structures: DecisionCache<HandStructureAnalysis>;
  private readonly plans: DecisionCache<readonly HandPlan[]>;

  public constructor(private readonly capacity = 8_192) {
    this.structures = new DecisionCache(capacity);
    this.plans = new DecisionCache(capacity);
  }

  public structure(input: {
    readonly hand: readonly Card[];
    readonly levelRank: LevelRank;
    readonly rulesVersion: string;
  }): HandStructureAnalysis {
    if (bypassExpertHandAnalysisCache) return analyzeHandStructure(input.hand, input.levelRank);
    const key = createHandAnalysisFingerprint(input);
    const hit = this.structures.get(key);
    if (hit) return hit;
    const value = deepFreeze(analyzeHandStructure(input.hand, input.levelRank));
    this.structures.set(key, value);
    return value;
  }

  public handPlans(
    input: GenerateHandPlansInput & { readonly rulesVersion: string }
  ): readonly HandPlan[] {
    if (bypassExpertHandAnalysisCache) return generateHandPlans(input);
    const key = planKey(input, input.rulesVersion);
    const hit = this.plans.get(key);
    if (hit) return hit;
    const value = deepFreeze(generateHandPlans(input));
    this.plans.set(key, value);
    return value;
  }

  public clear(): void {
    this.structures.clear();
    this.plans.clear();
  }

  public statistics(): {
    readonly capacity: number;
    readonly structure: CacheStatistics;
    readonly handPlan: CacheStatistics;
  } {
    return {
      capacity: this.capacity,
      structure: this.structures.statistics(),
      handPlan: this.plans.statistics()
    };
  }
}

/** Shared by expert decisions, post-action analysis and batch simulation in this process. */
export let expertHandAnalysisCache = new HandAnalysisCache();

/**
 * Benchmark-only cache-capacity switch. It replaces only exact, bounded LRU
 * storage; no key, value or decision semantics change. Call before a run.
 */
export function configureExpertHandAnalysisCacheForDiagnostics(capacity: number): void {
  expertHandAnalysisCache = new HandAnalysisCache(capacity);
}

export function getExpertHandAnalysisCacheStatistics() {
  return expertHandAnalysisCache.statistics();
}

export function clearExpertHandAnalysisCache(): void {
  expertHandAnalysisCache.clear();
}

/** Test-only synchronous scope used by the unoptimized differential oracle. */
export function withoutExpertHandAnalysisCache<T>(work: () => T): T {
  const previous = bypassExpertHandAnalysisCache;
  bypassExpertHandAnalysisCache = true;
  try {
    return work();
  } finally {
    bypassExpertHandAnalysisCache = previous;
  }
}
