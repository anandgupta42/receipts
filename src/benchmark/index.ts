/**
 * Single public surface for `src/benchmark/**` (SPEC-0015) — mirrors
 * `src/telemetry/index.ts`'s convention. `src/cli/**` should import only
 * from here; `schemas.ts`, `payload.ts`, `prompt.ts`, `send.ts`, and
 * `response.ts` are internal implementation details.
 */
export { buildBenchmarkPayload, toBenchmarkAgentType, toModelFamily, bucketCostPerTurn } from "./payload.js";
export { confirmPrompt } from "./prompt.js";
export { BENCHMARK_UNAVAILABLE_MESSAGE, isBenchmarkServiceAvailable } from "./send.js";
export { renderBenchmarkResult } from "./response.js";
export type { BenchmarkCohortResponse } from "./response.js";
export {
  validateBenchmarkEvent,
  BENCHMARK_AGENT_TYPE_VALUES,
  MODEL_FAMILY_VALUES,
  COST_PER_TURN_BUCKET_VALUES,
  BENCHMARK_EVENT_NAMES,
} from "./schemas.js";
export type {
  BenchmarkRunEvent,
  BenchmarkEvent,
  BenchmarkRunProperties,
  BenchmarkAgentTypeValue,
  ModelFamilyValue,
  CostPerTurnBucketValue,
} from "./schemas.js";
