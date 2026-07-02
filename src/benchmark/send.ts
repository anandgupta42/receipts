/**
 * R1 (v1 default state): no benchmark server exists yet (SPEC-0015
 * Purpose) — this is not a fallback path, it is the only path. Until a
 * separate server spec exists and names a real endpoint, this module
 * deliberately contains no `fetch` call anywhere: there is no URL to send
 * to, so there is nothing that could accidentally fire one.
 */

export const BENCHMARK_UNAVAILABLE_MESSAGE = "benchmark service not yet available";

/** Always `false` in v1. A future server spec replaces this, not extends it in place. */
export function isBenchmarkServiceAvailable(): boolean {
  return false;
}
