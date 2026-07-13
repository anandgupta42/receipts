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
import { combinedPricedUsd, combinedTokenTotal, parentPricedUsd, type ModelMixEntry, type PriceRowUsed, type ReceiptModel, type ToolRow, type WasteLine } from "./model.js";
import type { WasteClassAggregate } from "../aggregate/waste.js";
import { SLIP_RULE_LINES, couldHaveSavedOf, type HandoffCounts } from "./handoff.js";
import {
  HEURISTIC_PATTERN_PRICING_INTERPRETATION,
  lowerBoundCostEstimate,
  SAME_TOKENS_REPRICING_INTERPRETATION,
} from "./costEstimate.js";
import {
  combinedPricingCoverageOf,
  knownCombinedUnpricedTokens,
  knownUnpricedTokens,
  pricingCoverageOf,
} from "./pricingCoverage.js";

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
    costEstimate: lowerBoundCostEstimate(row.usd),
    tokens: tokenUsageJson(row.tokens),
    callCount: row.callCount,
  };
}

function wasteLineJson(waste: WasteLine) {
  if (waste.kind === "stuck-loop") {
    return {
      kind: waste.kind,
      costInterpretation: HEURISTIC_PATTERN_PRICING_INTERPRETATION,
      tool: waste.tool,
      runLength: waste.runLength,
      usd: waste.usd,
      costEstimate: lowerBoundCostEstimate(waste.usd),
      tokens: tokenUsageJson(waste.tokens),
      wallClockMs: waste.wallClockMs,
    };
  }
  if (waste.kind === "context-thrash") {
    return {
      kind: waste.kind,
      costInterpretation: HEURISTIC_PATTERN_PRICING_INTERPRETATION,
      compactionCount: waste.compactionCount,
      turnSpan: waste.turnSpan,
      turnIndices: waste.turnIndices,
      tokens: tokenUsageJson(waste.tokens),
      usd: waste.usd,
      costEstimate: lowerBoundCostEstimate(waste.usd),
    };
  }
  return {
    kind: waste.kind,
    costInterpretation: HEURISTIC_PATTERN_PRICING_INTERPRETATION,
    eligibleTurnCount: waste.eligibleTurnCount,
    usd: waste.usd,
    costEstimate: lowerBoundCostEstimate(waste.usd),
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
    input_cache_write: row.input_cache_write ?? null,
    input_cache_write_5m: row.input_cache_write_5m ?? null,
    input_cache_write_1h: row.input_cache_write_1h ?? null,
    context_tiers: (row.context_tiers ?? []).map((tier) => ({
      above_input_tokens: tier.above_input_tokens,
      input: tier.input,
      output: tier.output,
      input_cached: tier.input_cached ?? null,
      input_cache_write: tier.input_cache_write ?? null,
      input_cache_write_5m: tier.input_cache_write_5m ?? null,
      input_cache_write_1h: tier.input_cache_write_1h ?? null,
    })),
    from_date: row.from_date,
    to_date: row.to_date,
    sources: row.sources.map((s) => ({
      url: s.url,
      observed_at: s.observed_at ?? null,
      excerpt: s.excerpt ?? null,
    })),
  };
}

function subagentAggregateJson(model: ReceiptModel) {
  if (!model.subagents) {
    return null;
  }
  return {
    count: model.subagents.count,
    pricedUsd: model.subagents.pricedUsd,
    pricedCostEstimate: lowerBoundCostEstimate(model.subagents.pricedUsd),
    tokensTotal: model.subagents.tokensTotal,
    unpricedTokens: tokenUsageJson(model.subagents.unpricedTokens),
    unpricedTokensScope: "readable-subagents" as const,
    unpricedCount: model.subagents.unpricedCount,
    unreadableCount: model.subagents.unreadableCount,
  };
}

/** The receipt body — every field of a single-session receipt, minus the `schemaVersion` envelope. Reused verbatim as `compare`'s `a`/`b` so both surfaces share one shape (single-source-of-truth). */
function receiptBody(model: ReceiptModel) {
  const parentUsd = parentPricedUsd(model);
  const combinedUsd = combinedPricedUsd(model);
  const parentUnpricedTokens = knownUnpricedTokens(model);
  const combinedUnpricedTokens = knownCombinedUnpricedTokens(model);
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
    totalUsd: parentUsd,
    totalCostEstimate: lowerBoundCostEstimate(parentUsd),
    totalUsdScope: "parent-session" as const,
    combinedPricedUsd: combinedUsd,
    combinedPricedCostEstimate: lowerBoundCostEstimate(combinedUsd),
    combinedScope: "parent-session-plus-readable-subagents" as const,
    combinedTotalTokens: combinedTokenTotal(model),
    totalTokens: tokenUsageJson(model.totalTokens),
    sessionTotalTokens: tokenUsageJson(model.sessionTotalTokens),
    pricingCoverage: pricingCoverageOf(model),
    unpricedTokens: tokenUsageJson(parentUnpricedTokens),
    unpricedTokensScope: "parent-session" as const,
    combinedUnpricedTokens: tokenUsageJson(combinedUnpricedTokens),
    combinedUnpricedTokensScope: "parent-session-plus-readable-subagents" as const,
    combinedPricingCoverage: combinedPricingCoverageOf(model),
    wasteLines: model.wasteLines.map(wasteLineJson),
    caveats: model.caveats.map((c) => ({ kind: c.kind, text: c.text })),
    priceDelta: model.priceDelta
      ? {
          cheaperModel: model.priceDelta.cheaperModel,
          interpretation: SAME_TOKENS_REPRICING_INTERPRETATION,
          usd: model.priceDelta.usd,
          costEstimate: lowerBoundCostEstimate(model.priceDelta.usd),
          actualUsd: model.priceDelta.actualUsd,
          actualCostEstimate: lowerBoundCostEstimate(model.priceDelta.actualUsd),
          baselineUsd: model.priceDelta.baselineUsd ?? model.priceDelta.actualUsd,
          baselineCostEstimate: lowerBoundCostEstimate(model.priceDelta.baselineUsd ?? model.priceDelta.actualUsd),
        }
      : null,
    methodology: model.methodology,
    priceRowsUsed: model.priceRowsUsed.map(priceRowUsedJson),
    // SPEC-0067 — cost-shape facts (standalone; never in savings math). The R5
    // JSON contract lists exactly these preEdit fields; preEditTurnCount /
    // totalTurnCount stay internal to the model (they drive the text range only).
    costShape: {
      preEdit: {
        preEditUsd: model.costShape.preEdit.preEditUsd,
        preEditCostEstimate: lowerBoundCostEstimate(model.costShape.preEdit.preEditUsd),
        postEditUsd: model.costShape.preEdit.postEditUsd,
        postEditCostEstimate: lowerBoundCostEstimate(model.costShape.preEdit.postEditUsd),
        preEditPct: model.costShape.preEdit.preEditPct,
        preEditTokenPct: model.costShape.preEdit.preEditTokenPct,
        firstEditTurn: model.costShape.preEdit.firstEditTurn,
        confidence: model.costShape.preEdit.confidence,
      },
      topTurns: model.costShape.topTurns,
      lateTurn: model.costShape.lateTurn,
    },
    // SPEC-0068 — same-file re-reads diagnostic (standalone; NEVER a waste[] row or savings claim).
    sameFileReReads: model.sameFileReReads
      ? {
          count: model.sameFileReReads.count,
          turnIndices: model.sameFileReReads.turnIndices,
          tokens: tokenUsageJson(model.sameFileReReads.tokens),
          usd: model.sameFileReReads.usd,
          costEstimate: lowerBoundCostEstimate(model.sameFileReReads.usd),
          confidence: model.sameFileReReads.confidence,
        }
      : null,
    // SPEC-0061 R5 — aggregate only (counts + sums); child ids/titles/paths never export.
    ...(model.subagents ? { subagents: subagentAggregateJson(model) } : {}),
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
  const couldHaveSaved = couldHaveSavedOf(model.wasteLines, model.totalUsd);
  const parentUsd = parentPricedUsd(model);
  const combinedUsd = combinedPricedUsd(model);
  const parentUnpricedTokens = knownUnpricedTokens(model);
  const combinedUnpricedTokens = knownCombinedUnpricedTokens(model);
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
      scope: "parent-session" as const,
    },
    pricingCoverage: pricingCoverageOf(model),
    unpricedTokens: tokenUsageJson(parentUnpricedTokens),
    unpricedTokensScope: "parent-session" as const,
    combinedUnpricedTokens: tokenUsageJson(combinedUnpricedTokens),
    combinedUnpricedTokensScope: "parent-session-plus-readable-subagents" as const,
    combinedPricingCoverage: combinedPricingCoverageOf(model),
    totalUsd: parentUsd,
    totalCostEstimate: lowerBoundCostEstimate(parentUsd),
    totalUsdScope: "parent-session" as const,
    combinedPricedUsd: combinedUsd,
    combinedPricedCostEstimate: lowerBoundCostEstimate(combinedUsd),
    combinedTotalTokens: combinedTokenTotal(model),
    combinedScope: "parent-session-plus-readable-subagents" as const,
    subagents: subagentAggregateJson(model),
    wasteLines: model.wasteLines.map((w) => ({ ...wasteLineJson(w), rule: SLIP_RULE_LINES[w.kind] ?? null })),
    wasteLinesScope: "parent-session" as const,
    couldHaveSaved: {
      interpretation: couldHaveSaved.interpretation,
      scope: "parent-session" as const,
      usd: couldHaveSaved.usd,
      costEstimate: lowerBoundCostEstimate(couldHaveSaved.usd),
      tokens: couldHaveSaved.tokens,
      pctOfTotal: couldHaveSaved.pctOfTotal,
    },
    suggestions,
    threshold,
    coverage: {
      scope: "parent-session" as const,
      turns: counts.turns,
      toolCalls: counts.toolCalls,
      compactions: counts.compactions,
      wasteLines: model.wasteLines.length,
    },
    aggregates: aggregates.map((a) => ({ class: a.class, distinctSessionCount: a.distinctSessionCount })),
  };
}
