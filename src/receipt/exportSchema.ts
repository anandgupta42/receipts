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
import {
  HEURISTIC_PATTERN_PRICING_INTERPRETATION,
  SAME_TOKENS_REPRICING_INTERPRETATION,
  STANDARD_API_LIST_PRICE_EQUIVALENT,
} from "./costEstimate.js";
import { SCHEMA_VERSION } from "./schemaVersion.js";
import { REVIEW_PATTERNS, type ReviewPatternId } from "./reviewRegistry.js";

// Re-exported so existing importers keep one canonical path; the constant itself
// lives in the zod-free `schemaVersion.ts` (see the rationale there).
export { SCHEMA_VERSION } from "./schemaVersion.js";

/** Additive machine-readable semantics for every currently computed dollar. */
export const costEstimateSchema = z
  .object({
    kind: z.literal("lower-bound"),
    basis: z.literal(STANDARD_API_LIST_PRICE_EQUIVALENT),
    minUsd: z.number().nonnegative(),
  })
  .strict();

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

const pricingCoverageSchema = z.enum(["full", "partial", "unpriced"]);

const subagentAggregateSchema = z
  .object({
    count: z.number().int().nonnegative(),
    pricedUsd: z.number().nullable(),
    pricedCostEstimate: costEstimateSchema.nullable(),
    tokensTotal: z.number().int().nonnegative(),
    unpricedTokens: tokenUsageSchema,
    unpricedTokensScope: z.literal("readable-subagents"),
    unpricedCount: z.number().int().nonnegative(),
    unreadableCount: z.number().int().nonnegative(),
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
    costEstimate: costEstimateSchema.nullable(),
    tokens: tokenUsageSchema,
    callCount: z.number(),
  })
  .strict();

const stuckLoopWasteShape = {
  kind: z.literal("stuck-loop"),
  costInterpretation: z.literal(HEURISTIC_PATTERN_PRICING_INTERPRETATION),
  tool: z.string(),
  runLength: z.number(),
  usd: z.number().nullable(),
  costEstimate: costEstimateSchema.nullable(),
  tokens: tokenUsageSchema,
  wallClockMs: z.number().nullable(),
} as const;
const trivialSpansWasteShape = {
  kind: z.literal("trivial-spans"),
  costInterpretation: z.literal(HEURISTIC_PATTERN_PRICING_INTERPRETATION),
  eligibleTurnCount: z.number(),
  usd: z.number(),
  costEstimate: costEstimateSchema,
  tokens: tokenUsageSchema,
  cheaperModel: z.string(),
} as const;
const contextThrashWasteShape = {
  kind: z.literal("context-thrash"),
  costInterpretation: z.literal(HEURISTIC_PATTERN_PRICING_INTERPRETATION),
  compactionCount: z.number(),
  turnSpan: z.number(),
  turnIndices: z.array(z.number()),
  tokens: tokenUsageSchema,
  usd: z.number().nullable(),
  costEstimate: costEstimateSchema.nullable(),
} as const;

const wasteLineSchema = z.discriminatedUnion("kind", [
  z.object(stuckLoopWasteShape).strict(),
  z.object(trivialSpansWasteShape).strict(),
  z.object(contextThrashWasteShape).strict(),
]);

/** SPEC-0059 R7 — the handoff export's waste lines additionally carry the class's fixed rule string (`null` for a class without one). */
const slipRuleField = { rule: z.string().nullable() } as const;
const handoffWasteLineSchema = z.discriminatedUnion("kind", [
  z.object({ ...stuckLoopWasteShape, ...slipRuleField }).strict(),
  z.object({ ...trivialSpansWasteShape, ...slipRuleField }).strict(),
  z.object({ ...contextThrashWasteShape, ...slipRuleField }).strict(),
]);

const priceDeltaSchema = z
  .object({
    cheaperModel: z.string(),
    interpretation: z.literal(SAME_TOKENS_REPRICING_INTERPRETATION),
    usd: z.number(),
    costEstimate: costEstimateSchema,
    actualUsd: z.number(),
    actualCostEstimate: costEstimateSchema,
    baselineUsd: z.number(),
    baselineCostEstimate: costEstimateSchema,
  })
  .strict();

const priceSourceSchema = z
  .object({
    url: z.string(),
    observed_at: z.string().nullable(),
    excerpt: z.string().nullable(),
  })
  .strict();

const contextPriceTierSchema = z
  .object({
    above_input_tokens: z.number().int().nonnegative(),
    input: z.number(),
    output: z.number(),
    input_cached: z.number().nullable(),
    input_cache_write: z.number().nullable(),
    input_cache_write_5m: z.number().nullable(),
    input_cache_write_1h: z.number().nullable(),
  })
  .strict();

const priceRowUsedSchema = z
  .object({
    vendor: z.string(),
    model: z.string(),
    input: z.number(),
    output: z.number(),
    input_cached: z.number().nullable(),
    input_cache_write: z.number().nullable(),
    input_cache_write_5m: z.number().nullable(),
    input_cache_write_1h: z.number().nullable(),
    context_tiers: z.array(contextPriceTierSchema),
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
  totalCostEstimate: costEstimateSchema.nullable(),
  totalUsdScope: z.literal("parent-session"),
  combinedPricedUsd: z.number().nullable(),
  combinedPricedCostEstimate: costEstimateSchema.nullable(),
  combinedScope: z.literal("parent-session-plus-readable-subagents"),
  combinedTotalTokens: z.number().nonnegative(),
  totalTokens: tokenUsageSchema,
  sessionTotalTokens: tokenUsageSchema,
  pricingCoverage: pricingCoverageSchema,
  unpricedTokens: tokenUsageSchema,
  unpricedTokensScope: z.literal("parent-session"),
  combinedUnpricedTokens: tokenUsageSchema,
  combinedUnpricedTokensScope: z.literal("parent-session-plus-readable-subagents"),
  combinedPricingCoverage: pricingCoverageSchema,
  wasteLines: z.array(wasteLineSchema),
  caveats: z.array(z.object({ kind: z.enum(["time-mtime", "time-span", "cost-lower-bound-cache-tier", "unobserved-cache-write-tokens", "unattributed-aggregate-usage", "dropped-transcript-records", "partial-priced-coverage", "subagents-unreadable", "subagents-unpriced", "subagents-priced-tokens-only", "subagents-dropped-records", "subagent-rollup-unavailable"]), text: z.string() }).strict()),
  priceDelta: priceDeltaSchema.nullable(),
  methodology: z.string(),
  priceRowsUsed: z.array(priceRowUsedSchema),
  /** SPEC-0067 — cost-shape facts. Standalone facts (not waste), never in savings math. */
  costShape: z
    .object({
      preEdit: z
        .object({
          preEditUsd: z.number().nullable(),
          preEditCostEstimate: costEstimateSchema.nullable(),
          postEditUsd: z.number().nullable(),
          postEditCostEstimate: costEstimateSchema.nullable(),
          preEditPct: z.number().nullable(),
          preEditTokenPct: z.number(),
          firstEditTurn: z.number().nullable(),
          confidence: z.literal("high"),
        })
        .strict(),
      topTurns: z.object({ sharePct: z.number(), indices: z.array(z.number().int()), confidence: z.literal("high") }).strict().nullable(),
      lateTurn: z.object({ lateRatio: z.number(), confidence: z.literal("low") }).strict().nullable(),
    })
    .strict(),
  /** SPEC-0068 — same-file re-reads diagnostic (standalone, never in savings math); null when none. */
  sameFileReReads: z
    .object({
      count: z.number().int().nonnegative(),
      turnIndices: z.array(z.number().int()),
      tokens: tokenUsageSchema,
      usd: z.number().nullable(),
      costEstimate: costEstimateSchema.nullable(),
      confidence: z.literal("low"),
    })
    .strict()
    .nullable(),
  /** SPEC-0061 R5 — subagent rollup aggregate; present only when the session has children. Counts and sums only — never child ids, titles, or paths. */
  subagents: subagentAggregateSchema.optional(),
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
        scope: z.literal("parent-session"),
      })
      .strict(),
    pricingCoverage: pricingCoverageSchema,
    unpricedTokens: tokenUsageSchema,
    unpricedTokensScope: z.literal("parent-session"),
    combinedUnpricedTokens: tokenUsageSchema,
    combinedUnpricedTokensScope: z.literal("parent-session-plus-readable-subagents"),
    combinedPricingCoverage: pricingCoverageSchema,
    totalUsd: z.number().nullable(),
    totalCostEstimate: costEstimateSchema.nullable(),
    totalUsdScope: z.literal("parent-session"),
    combinedPricedUsd: z.number().nullable(),
    combinedPricedCostEstimate: costEstimateSchema.nullable(),
    combinedTotalTokens: z.number().nonnegative(),
    combinedScope: z.literal("parent-session-plus-readable-subagents"),
    subagents: subagentAggregateSchema.nullable(),
    wasteLines: z.array(handoffWasteLineSchema),
    wasteLinesScope: z.literal("parent-session"),
    /** SPEC-0059 R7 — extracted could-have-saved ceiling; additive to the SPEC-0042-pinned list, no version bump (line 14's contract). */
    couldHaveSaved: z
      .object({
        interpretation: z.literal(HEURISTIC_PATTERN_PRICING_INTERPRETATION),
        scope: z.literal("parent-session"),
        usd: z.number().nullable(),
        costEstimate: costEstimateSchema.nullable(),
        tokens: z.number(),
        pctOfTotal: z.number().nullable(),
      })
      .strict(),
    suggestions: z.array(z.string()),
    threshold: z.number(),
    coverage: z
      .object({
        scope: z.literal("parent-session"),
        turns: z.number(),
        toolCalls: z.number(),
        compactions: z.number(),
        wasteLines: z.number(),
      })
      .strict(),
    aggregates: z.array(z.object({ class: z.string(), distinctSessionCount: z.number() }).strict()),
  })
  .strict();

const reviewPatternIds = REVIEW_PATTERNS.map(({ id }) => id) as [ReviewPatternId, ...ReviewPatternId[]];
const reviewPatternIdSchema = z.enum(reviewPatternIds);
const reviewFactNameSchema = z.enum([
  "attempts",
  "compactions",
  "consecutive-errors",
  "failed-checks",
  "qualifying-turns",
  "repeated-reads",
  "retries-after-first-error",
  "source-writes",
  "triggering-attempts",
  "window-turns",
]);

const reviewEvidenceSchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    actionCount: z.number().int().nonnegative(),
    turnIndices: z.array(z.number().int().nonnegative()).max(20),
    totalTurnCount: z.number().int().nonnegative(),
    tools: z.array(z.string().max(64)).max(8),
    totalToolCount: z.number().int().nonnegative(),
    facts: z.array(
      z
        .object({
          name: reviewFactNameSchema,
          value: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

const reviewImpactSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("observed-attributed"),
      tokens: tokenUsageSchema,
      usd: z.number().nonnegative().nullable(),
      durationMs: z.number().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      role: z.literal("observed-window"),
      tokens: tokenUsageSchema,
      usd: z.number().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      role: z.literal("same-token-reprice"),
      tokens: tokenUsageSchema,
      observedUsd: z.number().nonnegative(),
      repricedUsd: z.number().nonnegative(),
    })
    .strict(),
]);

const reviewFindingSchema = z
  .object({
    ruleVersion: z.number().int().positive(),
    category: z.enum(["issue", "cost-opportunity", "observation"]),
    title: z.string(),
    whatHappened: z.string(),
    whyItMatters: z.string(),
    recommendation: z.string(),
    evidenceStrength: z.string(),
    claimLimit: z.string(),
    evidence: reviewEvidenceSchema,
    impact: reviewImpactSchema.optional(),
    recurrence: z
      .object({
        distinctSessionCount: z.number().int().positive(),
        windowDays: z.number().int().positive(),
        recommendation: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

const reviewFindingShape = Object.fromEntries(
  reviewPatternIds.map((id) => [id, reviewFindingSchema.optional()]),
) as Record<ReviewPatternId, z.ZodOptional<typeof reviewFindingSchema>>;

/** SPEC-0083 R12 — privacy-safe, pattern-keyed session review JSON. */
export const reviewJsonSchema = z
  .object({
    schemaVersion: z.literal(1),
    review: z
      .object({
        registryVersion: z.literal(1),
        source: z.enum(AGENT_SOURCES),
        findings: z.object(reviewFindingShape).strict(),
        coverage: z
          .object({
            evaluated: z
              .object({
                count: z.number().int().nonnegative(),
                patternIds: z.array(reviewPatternIdSchema),
              })
              .strict(),
            unavailable: z
              .object({
                count: z.number().int().nonnegative(),
                patternIds: z.array(reviewPatternIdSchema),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
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
 * SPEC-0056 R8 — `aireceipts backfill --json`, the bulk-sweep summary. Counts are
 * honest per SPEC-0045: `loadFailureCount` covers degraded summaries and failed
 * loads (never silently dropped), and `sessions` carries one row per matched
 * session with the file name written (or `null` when nothing was written for it).
 */
export const backfillJsonSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    discoveredCount: z.number(),
    matchedCount: z.number(),
    loadFailureCount: z.number(),
    writtenCount: z.number(),
    wroteFiles: z.boolean(),
    sessions: z.array(
      z
        .object({
          source: z.enum(AGENT_SOURCES),
          sessionId: z.string(),
          title: z.string().nullable(),
          startedAtMs: z.number().nullable(),
          fileName: z.string().nullable(),
          loadFailed: z.boolean(),
        })
        .strict(),
    ),
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
  collectFieldNames(backfillJsonSchema, names);
  return collectFieldNames(reviewJsonSchema, names);
}
