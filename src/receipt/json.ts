// R6 `--json`: full structured breakdown with a schema-stable key order (key
// order is an explicit requirement, not incidental — JS object literals
// preserve insertion order, so the order below IS the schema).
import type { SessionSummary, TokenUsage } from "../parse/types.js";
import type { ModelMixEntry, PriceRowUsed, ReceiptModel, ToolRow, WasteLine } from "./model.js";

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

/** Full structured breakdown for `--json` — fixed key order, includes the price rows actually consulted (I3: every number traceable). */
export function toJsonModel(model: ReceiptModel) {
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
    priceDelta: model.priceDelta
      ? {
          cheaperModel: model.priceDelta.cheaperModel,
          usd: model.priceDelta.usd,
          actualUsd: model.priceDelta.actualUsd,
        }
      : null,
    methodology: model.methodology,
    priceRowsUsed: model.priceRowsUsed.map(priceRowUsedJson),
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
