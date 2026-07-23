/** A cross-runtime monotonic clock for metrics only; it never affects game state. */
export function monotonicNow(): number {
  const runtime = globalThis as { performance?: { now?: () => number } };
  return runtime.performance?.now?.() ?? Date.now();
}
