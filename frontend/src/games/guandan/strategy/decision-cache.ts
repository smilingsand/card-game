import type { BotView } from "../bot-view";

/** A versioned public projection key.  It intentionally has no deal seed or opponent cards. */
export interface DecisionFingerprintInput {
  readonly view: Pick<
    BotView,
    | "selfSeat"
    | "selfHand"
    | "levelRank"
    | "publicEvents"
    | "remainingCardCounts"
    | "leader"
    | "highestSeat"
  >;
  readonly currentWinningPlaySummary?: string;
  /** The rule-engine-complete legal action set is part of the decision input. */
  readonly legalActionSummary?: string;
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly rulesVersion: string;
    readonly weightsVersion: string;
  };
}

export function createDecisionFingerprint(input: DecisionFingerprintInput): string {
  const eventSequence = input.view.publicEvents.at(-1)?.sequence ?? 0;
  return JSON.stringify({
    selfSeat: input.view.selfSeat,
    hand: input.view.selfHand.map((card) => card.id).sort(),
    levelRank: input.view.levelRank,
    publicEventSequence: eventSequence,
    remainingCardCounts: Object.entries(input.view.remainingCardCounts).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
    leader: input.view.leader,
    highestSeat: input.view.highestSeat ?? null,
    currentWinningPlaySummary: input.currentWinningPlaySummary ?? null,
    legalActionSummary: input.legalActionSummary ?? null,
    // Situation analysis consumes the cumulative public history. Sequence alone is not a
    // sufficient semantic key when a caller supplies a different public projection.
    publicHistory: input.view.publicEvents,
    profile: input.profile
  });
}

export interface CacheStatistics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly invalidations: number;
  readonly size: number;
}

/** Capacity-bounded LRU cache. Values are never approximated or shared across fingerprints. */
export class DecisionCache<T> {
  private readonly entries = new Map<string, T>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;

  public constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError("capacity must be a positive integer");
  }

  public get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value as string);
      this.evictions += 1;
    }
  }

  /** Explicit invalidation is observable; fingerprint changes naturally result in misses. */
  public invalidate(key: string): void {
    if (this.entries.delete(key)) this.invalidations += 1;
  }

  public clear(): void {
    if (this.entries.size > 0) this.invalidations += this.entries.size;
    this.entries.clear();
  }

  public statistics(): CacheStatistics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      size: this.entries.size
    };
  }
}

export interface BoundedWorkItem<T> {
  readonly id: string;
  readonly quality: number;
  readonly upperBound: number;
  readonly value: T;
}
export interface DeterministicEarlyStopResult<T> {
  readonly evaluated: readonly T[];
  readonly reason?: "bound_proven";
  readonly bestLowerBound?: number;
  readonly remainingUpperBound?: number;
}

/**
 * Work is ordered by stable quality/id. It never looks at a clock: work stops only after a
 * strict mathematical bound proves all remaining work cannot win.
 */
export function evaluateWithBoundedEarlyStop<T>(input: {
  readonly items: readonly BoundedWorkItem<T>[];
  readonly evaluate: (value: T) => { readonly value: T; readonly lowerBound: number };
}): DeterministicEarlyStopResult<T> {
  const ordered = [...input.items].sort(
    (a, b) => b.quality - a.quality || a.id.localeCompare(b.id)
  );
  const evaluated: T[] = [];
  let best = -Infinity;
  for (let index = 0; index < ordered.length; index += 1) {
    const result = input.evaluate(ordered[index].value);
    evaluated.push(result.value);
    best = Math.max(best, result.lowerBound);
    const remainingUpperBound = ordered
      .slice(index + 1)
      .reduce((maximum, item) => Math.max(maximum, item.upperBound), -Infinity);
    if (best > remainingUpperBound)
      return { evaluated, reason: "bound_proven", bestLowerBound: best, remainingUpperBound };
  }
  return { evaluated };
}
