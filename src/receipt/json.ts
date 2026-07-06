// R6 `--json`: full structured breakdown with a schema-stable key order (key
// order is an explicit requirement, not incidental — JS object literals
// preserve insertion order, so the order below IS the schema).
//
// SPEC-0011: every top-level export now carries `schemaVersion` (R1); its shape
// is validated against `receiptJsonSchema`/`compareJsonSchema` in
// `exportSchema.ts` (the single source of truth) and documented field-by-field
// in `docs/json-schema.md` (parity-tested).
import type { SessionSummary, TokenUsage } from "../parse/types.js";
import { compareDeltaLine } from "./compare.js";
import { SCHEMA_VERSION } from "./exportSchema.js";
import type { ModelMixEntry, PriceRowUsed, ReceiptModel, ToolRow, WasteLine } from "./model.js";
import type { WasteClassAggregate } from "../aggregate/waste.js";
import { SLIP_RULE_LINES, couldHaveSavedOf, type HandoffCounts } from "./handoff.js";

function tokenUsageJson(t: TokenUsage) {
  return {
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead,
    cacheCreation: t.cacheCreation,
    cacheCreation5m: t.cacheCreation5m ?? null,
    cacheCreation1h: t.cacheCreation1h ?? null,
    total: t.total,
  };
}

function modelMixJson(entries: ModelMixEntry[]) {
  return entries.map((m) => ({
    model: m.model,
    tokens: tokenUsageJson(m.tokens),
    tokenShare: m.tokenShare,
  }));
}

function toolRowJson(row: ToolRow) {
  return {
    tool: row.tool,
    usd: row.usd,
    tokens: tokenUsageJson(row.tokens),
    callCount: row.callCount,
  };
}

function wasteLineJson(waste: WasteLine) {
  if (waste.kind === "stuck-loop") {
    return {
      kind: waste.kind,
      tool: waste.tool,
      runLength: waste.runLength,
      usd: waste.usd,
      tokens: tokenUsageJson(waste.tokens),
      wallClockMs: waste.wallClockMs,
    };
  }
  if (waste.kind === "context-thrash") {
    return {
      kind: waste.kind,
      compactionCount: waste.compactionCount,
      turnSpan: waste.turnSpan,
      turnIndices: waste.turnIndices,
      tokens: tokenUsageJson(waste.tokens),
      usd: waste.usd,
    };
  }
  return {
    kind: waste.kind,
    eligibleTurnCount: waste.eligibleTurnCount,
    usd: waste.usd,
    tokens: tokenUsageJson(waste.tokens),
    cheaperModel: waste.cheaperModel,
  };
}

function priceRowUsedJson(row: PriceRowUsed) {
  return {
    vendor: row.vendor,
    model: row.model,
    input: row.input,
    output: row.output,
    input_cached: row.input_cached ?? null,
    input_cache_write_5m: row.input_cache_write_5m ?? null,
    input_cache_write_1h: row.input_cache_write_1h ?? null,
    from_date: row.from_date,
    to_date: row.to_date,
    sources: row.sources.map((s) => ({
      url: s.url,
      observed_at: s.observed_at ?? null,
      excerpt: s.excerpt ?? null,
    })),
  };
}

/** The receipt body — every field of a single-session receipt, minus the `schemaVersion` envelope. Reused verbatim as `compare`'s `a`/`b` so both surfaces share one shape (single-source-of-truth). */
function receiptBody(model: ReceiptModel) {
  return {
    agentLabel: model.agentLabel,
    source: model.source,
    sessionId: model.sessionId,
    title: model.title ?? null,
    startedAtMs: model.startedAtMs ?? null,
    durationMs: model.durationMs ?? null,
    unpriceable: model.unpriceable,
    modelMix: modelMixJson(model.modelMix),
    toolRows: model.toolRows.map(toolRowJson),
    totalUsd: model.totalUsd,
    totalTokens: tokenUsageJson(model.totalTokens),
    sessionTotalTokens: tokenUsageJson(model.sessionTotalTokens),
    wasteLines: model.wasteLines.map(wasteLineJson),
    caveats: model.caveats.map((c) => ({ kind: c.kind, text: c.text })),
    priceDelta: model.priceDelta
      ? {
          cheaperModel: model.priceDelta.cheaperModel,
          usd: model.priceDelta.usd,
          actualUsd: model.priceDelta.actualUsd,
        }
      : null,
    methodology: model.methodology,
    priceRowsUsed: model.priceRowsUsed.map(priceRowUsedJson),
    // SPEC-0061 R5 — aggregate only (counts + sums); child ids/titles/paths never export.
    ...(model.subagents ? { subagents: { ...model.subagents } } : {}),
  };
}

/** Full structured breakdown for `--json` — `schemaVersion` first, then the fixed-order receipt body (I3: every number traceable). Validated against `receiptJsonSchema`. */
export function toJsonModel(model: ReceiptModel) {
  return { schemaVersion: SCHEMA_VERSION, ...receiptBody(model) };
}

/** `compare <a> <b> --json` (R3): the two receipt bodies plus a factual delta line — never a better/worse ranking field (I6). Validated against `compareJsonSchema`. */
export function toCompareJsonModel(a: ReceiptModel, b: ReceiptModel) {
  return {
    schemaVersion: SCHEMA_VERSION,
    a: receiptBody(a),
    b: receiptBody(b),
    delta: compareDeltaLine(a, b),
  };
}

/** `--list --json` row — summary-only, no pricing (that requires a full `loadSession` + `buildReceiptModel`). */
export function summaryToJson(summary: SessionSummary) {
  return {
    id: summary.id,
    source: summary.source,
    title: summary.title ?? null,
    model: summary.model ?? null,
    startedAt: summary.startedAt ?? null,
    endedAt: summary.endedAt ?? null,
    totals: {
      tokens: tokenUsageJson(summary.totals.tokens),
      durationMs: summary.totals.durationMs ?? null,
      turnCount: summary.totals.turnCount,
      toolCallCount: summary.totals.toolCallCount,
    },
    filePath: summary.filePath,
    unpriceable: summary.unpriceable ?? false,
  };
}

/**
 * SPEC-0042 R3 — the machine-readable resume packet. Fixed key order = the
 * schema (I5); validated against `handoffJsonSchema`. Always emits the full
 * structure (empty arrays included) — machine consumers need shape, not
 * sentinels (R6). `aggregates` is exactly what `aggregateWaste` returned for
 * the recurrence window, below-threshold classes included. SPEC-0059 R7
 * extends the SPEC-0042-pinned field list with `couldHaveSaved` and a
 * per-waste-line `rule` (additive — no version bump).
 */
export function toHandoffJson(
  model: ReceiptModel,
  suggestions: string[],
  threshold: number,
  counts: HandoffCounts,
  aggregates: WasteClassAggregate[],
) {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: model.source,
    sessionId: model.sessionId,
    title: model.title ?? null,
    startedAtMs: model.startedAtMs ?? null,
    durationMs: model.durationMs ?? null,
    totals: {
      tokens: tokenUsageJson(model.sessionTotalTokens),
      turnCount: counts.turns,
      toolCallCount: counts.toolCalls,
    },
    wasteLines: model.wasteLines.map((w) => ({ ...wasteLineJson(w), rule: SLIP_RULE_LINES[w.kind] ?? null })),
    couldHaveSaved: couldHaveSavedOf(model.wasteLines, model.totalUsd),
    suggestions,
    threshold,
    coverage: {
      turns: counts.turns,
      toolCalls: counts.toolCalls,
      compactions: counts.compactions,
      wasteLines: model.wasteLines.length,
    },
    aggregates: aggregates.map((a) => ({ class: a.class, distinctSessionCount: a.distinctSessionCount })),
  };
}
