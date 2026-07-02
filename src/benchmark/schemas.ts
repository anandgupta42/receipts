import { z } from "zod";

/**
 * Allowlist schema for SPEC-0015's opt-in benchmark event (R2).
 *
 * This is a NEW, separate schema from `src/telemetry/schemas.ts` — the
 * benchmark event is not a fourth diagnostics event (SPEC-0002 Non-goals);
 * it is its own value exchange under a different invariant (I1/I4 network
 * exception), gated by its own per-call `[y/N]` prompt rather than the
 * always-on diagnostics kill switches. Every field is enum-only — there is
 * no free-text field anywhere in this module. `.strict()` rejects any
 * payload carrying an extra key, so a caller can never smuggle an unlisted
 * field (a path, a prompt, a dollar amount, a raw model string, an install
 * ID) past the schema by attaching it under a new name. Banned forever, and
 * structurally unrepresentable here: transcript content, prompts, file
 * paths, repo names, hostnames, usernames, session IDs, raw dollar amounts,
 * raw model strings, install IDs / caller tokens (R2, R6).
 */

export const BENCHMARK_AGENT_TYPE_VALUES = ["claude-code", "codex", "cursor", "opencode", "unknown"] as const;
export type BenchmarkAgentTypeValue = (typeof BENCHMARK_AGENT_TYPE_VALUES)[number];

/** Derived from `vendorForSource` (src/pricing/resolve.ts) — never a raw model ID string. */
export const MODEL_FAMILY_VALUES = ["anthropic", "openai", "unknown"] as const;
export type ModelFamilyValue = (typeof MODEL_FAMILY_VALUES)[number];

/** Coarse, fixed buckets — never the raw dollar total, which SPEC-0015 R2 explicitly bans. */
export const COST_PER_TURN_BUCKET_VALUES = ["unpriced", "<$0.01", "$0.01-$0.05", "$0.05-$0.25", "$0.25-$1", ">$1"] as const;
export type CostPerTurnBucketValue = (typeof COST_PER_TURN_BUCKET_VALUES)[number];

export const benchmarkRunPropertiesSchema = z
  .object({
    agentType: z.enum(BENCHMARK_AGENT_TYPE_VALUES),
    modelFamily: z.enum(MODEL_FAMILY_VALUES),
    costPerTurnBucket: z.enum(COST_PER_TURN_BUCKET_VALUES),
    hasStuckLoopWaste: z.boolean(),
    hasTrivialSpanWaste: z.boolean(),
  })
  .strict();
export type BenchmarkRunProperties = z.infer<typeof benchmarkRunPropertiesSchema>;

/** Exactly one event exists in v1 (R2) — this array is the single source of truth other modules and tests assert against. */
export const BENCHMARK_EVENT_NAMES = ["benchmark_run"] as const;
export type BenchmarkEventName = (typeof BENCHMARK_EVENT_NAMES)[number];

export interface BenchmarkRunEvent {
  name: "benchmark_run";
  properties: BenchmarkRunProperties;
}
export type BenchmarkEvent = BenchmarkRunEvent;

/** `event.name` → its properties schema, exhaustive over `BENCHMARK_EVENT_NAMES`. */
export const BENCHMARK_PROPERTIES_SCHEMA_BY_EVENT_NAME = {
  benchmark_run: benchmarkRunPropertiesSchema,
} as const satisfies Record<BenchmarkEventName, z.ZodTypeAny>;

/** Validates a full envelope (name + properties) against its schema. Never throws — returns `false` on any mismatch, including an unrecognized `name`. */
export function validateBenchmarkEvent(event: BenchmarkEvent): boolean {
  const schema = BENCHMARK_PROPERTIES_SCHEMA_BY_EVENT_NAME[event.name] as z.ZodTypeAny | undefined;
  if (!schema) {
    return false;
  }
  return schema.safeParse(event.properties).success;
}
