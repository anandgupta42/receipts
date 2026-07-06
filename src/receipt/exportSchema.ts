// SPEC-0011 R1/R4: the single source of truth for the shape of every `--json`
// export surface. `docs/json-schema.md` mirrors this schema field-by-field,
// enforced by an automated parity test (the documented field names must equal
// `collectFieldNames(...)`, and the documented version must equal
// `SCHEMA_VERSION`). Any breaking shape change bumps `SCHEMA_VERSION` (R4 semver
// discipline); within a major version, JSON fields and CSV columns are
// additive-only. The exporters build their objects by hand (fixed key order =
// byte-stable output, I5) — this schema validates that output rather than
// producing it, so no render ever routes through zod.
import { z } from "zod";
import { AGENT_SOURCES } from "../parse/types.js";

/** Bumped only on a breaking `--json` shape change (R4). Mirrored in `docs/json-schema.md`. */
export const SCHEMA_VERSION = 1;

const tokenUsageSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheCreation: z.number(),
    cacheCreation5m: z.number().nullable(),
    cacheCreation1h: z.number().nullable(),
    total: z.number(),
  })
  .strict();

const modelMixEntrySchema = z
  .object({
    model: z.string(),
    tokens: tokenUsageSchema,
    tokenShare: z.number(),
  })
  .strict();

const toolRowSchema = z
  .object({
    tool: z.string(),
    usd: z.number().nullable(),
    tokens: tokenUsageSchema,
    callCount: z.number(),
  })
  .strict();

const wasteLineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stuck-loop"),
      tool: z.string(),
      runLength: z.number(),
      usd: z.number().nullable(),
      tokens: tokenUsageSchema,
      wallClockMs: z.number().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trivial-spans"),
      eligibleTurnCount: z.number(),
      usd: z.number(),
      tokens: tokenUsageSchema,
      cheaperModel: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("context-thrash"),
      compactionCount: z.number(),
      turnSpan: z.number(),
      turnIndices: z.array(z.number()),
      tokens: tokenUsageSchema,
      usd: z.number().nullable(),
    })
    .strict(),
]);

const priceDeltaSchema = z
  .object({
    cheaperModel: z.string(),
    usd: z.number(),
    actualUsd: z.number(),
  })
  .strict();

const priceSourceSchema = z
  .object({
    url: z.string(),
    observed_at: z.string().nullable(),
    excerpt: z.string().nullable(),
  })
  .strict();

const priceRowUsedSchema = z
  .object({
    vendor: z.string(),
    model: z.string(),
    input: z.number(),
    output: z.number(),
    input_cached: z.number().nullable(),
    input_cache_write_5m: z.number().nullable(),
    input_cache_write_1h: z.number().nullable(),
    from_date: z.string(),
    to_date: z.string().nullable(),
    sources: z.array(priceSourceSchema),
  })
  .strict();

/** The receipt body — every field of a single-session `--json`, minus the version envelope. Reused verbatim as `compare`'s `a`/`b`. */
const receiptBodyShape = {
  agentLabel: z.string(),
  source: z.enum(AGENT_SOURCES),
  sessionId: z.string(),
  title: z.string().nullable(),
  startedAtMs: z.number().nullable(),
  durationMs: z.number().nullable(),
  unpriceable: z.boolean(),
  modelMix: z.array(modelMixEntrySchema),
  toolRows: z.array(toolRowSchema),
  totalUsd: z.number().nullable(),
  totalTokens: tokenUsageSchema,
  sessionTotalTokens: tokenUsageSchema,
  wasteLines: z.array(wasteLineSchema),
  caveats: z.array(z.object({ kind: z.enum(["time-mtime", "time-span", "cost-lower-bound-cache-tier", "dropped-transcript-records", "partial-priced-coverage"]), text: z.string() }).strict()),
  priceDelta: priceDeltaSchema.nullable(),
  methodology: z.string(),
  priceRowsUsed: z.array(priceRowUsedSchema),
} as const;

export const receiptBodySchema = z.object(receiptBodyShape).strict();

/** `aireceipts <selector> --json` — a versioned single-session receipt. */
export const receiptJsonSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    ...receiptBodyShape,
    /** SPEC-0009: advisory budget lines — present only when ~/.aireceipts/budget.json is configured. */
    budget: z.array(z.string()).optional(),
  })
  .strict();

/**
 * SPEC-0042 R3 — `aireceipts --handoff <selector> --json`, the machine-readable
 * resume packet. Top-level field names are pinned in the spec; the
 * implementation may not add or rename fields without amending that list.
 * `aggregates` carries exactly the classes `aggregateWaste` returned for the
 * recurrence window (fired classes only, no padding) so a below-threshold
 * recurring class is inspectable instead of silently absent. R4 privacy: the
 * banned attribution-only fields (`cwd`, `gitBranch`, `isSidechain`,
 * `parentSessionId`, `agentId`, `parentFilePath`) are structurally
 * unrepresentable — `.strict()` rejects them.
 */
export const handoffJsonSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: z.enum(AGENT_SOURCES),
    sessionId: z.string(),
    title: z.string().nullable(),
    startedAtMs: z.number().nullable(),
    durationMs: z.number().nullable(),
    totals: z
      .object({
        tokens: tokenUsageSchema,
        turnCount: z.number(),
        toolCallCount: z.number(),
      })
      .strict(),
    wasteLines: z.array(wasteLineSchema),
    suggestions: z.array(z.string()),
    threshold: z.number(),
    coverage: z
      .object({
        turns: z.number(),
        toolCalls: z.number(),
        compactions: z.number(),
        wasteLines: z.number(),
      })
      .strict(),
    aggregates: z.array(z.object({ class: z.string(), distinctSessionCount: z.number() }).strict()),
  })
  .strict();

/** `aireceipts compare <a> <b> --json` — two receipt bodies plus a factual delta line (R3; no ranking field, I6). */
export const compareJsonSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    a: receiptBodySchema,
    b: receiptBodySchema,
    delta: z.string(),
  })
  .strict();

/**
 * Minimal structural view over a zod node's introspection surface — enough to
 * walk the schema tree without depending on zod's internal class identities
 * (which don't survive bundling). Present-or-absent by node kind: `def.type`
 * is the discriminator, `shape`/`element`/`options`/`unwrap` the descent edges.
 */
interface ZodIntrospect {
  def?: { type?: string };
  shape?: Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  unwrap?: () => z.ZodTypeAny;
}

function introspect(schema: z.ZodTypeAny): ZodIntrospect {
  return schema as unknown as ZodIntrospect;
}

/**
 * Every field name reachable in a schema, unioned across object keys, array
 * elements, and discriminated-union options (optional/nullable wrappers are
 * transparent). This is the exact set `docs/json-schema.md` must document,
 * so adding/removing/renaming a field here fails the parity test until the
 * doc is updated (R4).
 */
export function collectFieldNames(schema: z.ZodTypeAny, into: Set<string> = new Set()): Set<string> {
  const node = introspect(schema);
  const type = node.def?.type;
  if ((type === "optional" || type === "nullable") && node.unwrap) {
    return collectFieldNames(node.unwrap(), into);
  }
  if (type === "object" && node.shape) {
    for (const [key, child] of Object.entries(node.shape)) {
      into.add(key);
      collectFieldNames(child, into);
    }
    return into;
  }
  if (type === "array" && node.element) {
    return collectFieldNames(node.element, into);
  }
  if (type === "union" && node.options) {
    for (const option of node.options) {
      collectFieldNames(option, into);
    }
    return into;
  }
  return into;
}

/** The complete documented-field set across every JSON export surface — what the doc parity test asserts against. */
export function allExportFieldNames(): Set<string> {
  const names = collectFieldNames(receiptJsonSchema);
  collectFieldNames(compareJsonSchema, names);
  return collectFieldNames(handoffJsonSchema, names);
}
