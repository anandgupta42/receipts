// SPEC-0011 R2/R3: CSV export over the shared `ReceiptModel`, for FinOps /
// spreadsheet ingestion. Two granularities: `--csv=session` (one summary row
// per session) and `--csv=tool` (one row per tool line). RFC 4180 quoting
// (I5-stable, LF-terminated). I2 discipline: `$` cells are an empty string when
// unpriced (never `0`/`null`); token cells are always populated. R4: columns
// are additive-only within a schema major version — never reorder or remove.
import type { TokenUsage } from "../parse/types.js";
import { SCHEMA_VERSION } from "./exportSchema.js";
import { combinedPricedUsd, combinedTokenTotal, parentPricedUsd, type ReceiptModel } from "./model.js";
import { lowerBoundCostEstimate } from "./costEstimate.js";
import {
  combinedPricingCoverageOf,
  knownCombinedUnpricedTokens,
  knownSubagentUnpricedTokens,
  knownUnpricedTokens,
  pricingCoverageOf,
} from "./pricingCoverage.js";

/** RFC 4180 §2: quote a field iff it contains `"`, `,`, CR, or LF; escape embedded quotes by doubling. */
function csvField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvField).join(",");
}

/** A CSV `$` cell: empty string when unpriced (I2), else the raw number — byte-identical to the value `--json` emits (no `$`, no comma grouping, no rounding). */
function usdCell(usd: number | null): string {
  return usd === null ? "" : String(usd);
}

function costMetadataCells(usd: number | null): [string, string] {
  const estimate = lowerBoundCostEstimate(usd);
  return estimate === null ? ["", ""] : [estimate.kind, estimate.basis];
}

function unpricedUsageCells(tokens: TokenUsage): [string, string, string, string, string] {
  return [
    String(tokens.input),
    String(tokens.output),
    String(tokens.cacheRead),
    String(tokens.cacheCreation),
    String(tokens.total),
  ];
}

/** Session-level tokens: the adapter's session totals for unpriceable sources (Cursor's only real number), else the attributed per-turn sum — the same choice `compareDeltaLine` makes. */
function effectiveTokens(model: ReceiptModel): TokenUsage {
  return model.unpriceable ? model.sessionTotalTokens : model.totalTokens;
}

const SESSION_COLUMNS = [
  "schemaVersion",
  "sessionId",
  "agent",
  "title",
  "startedAt",
  "durationMs",
  "primaryModel",
  "totalUsd",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "totalTokens",
  "costKind",
  "costBasis",
  "totalUsdScope",
  "subagentsPricedUsd",
  "combinedPricedUsd",
  "combinedCostKind",
  "combinedCostBasis",
  "subagentsTokens",
  "combinedTotalTokens",
  "subagentCount",
  "subagentUnpricedCount",
  "subagentUnreadableCount",
  "pricingCoverage",
  "unpricedInputTokens",
  "unpricedOutputTokens",
  "unpricedCacheReadTokens",
  "unpricedCacheCreationTokens",
  "unpricedTotalTokens",
  "unpricedTokensScope",
  "subagentsCostKind",
  "subagentsCostBasis",
  "subagentsUsdScope",
  "subagentsUnpricedInputTokens",
  "subagentsUnpricedOutputTokens",
  "subagentsUnpricedCacheReadTokens",
  "subagentsUnpricedCacheCreationTokens",
  "subagentsUnpricedTotalTokens",
  "subagentsUnpricedTokensScope",
  "combinedUnpricedInputTokens",
  "combinedUnpricedOutputTokens",
  "combinedUnpricedCacheReadTokens",
  "combinedUnpricedCacheCreationTokens",
  "combinedUnpricedTotalTokens",
  "combinedUnpricedTokensScope",
  "combinedPricingCoverage",
] as const;

const TOOL_COLUMNS = [
  "schemaVersion",
  "sessionId",
  "agent",
  "tool",
  "usd",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "totalTokens",
  "callCount",
  "costKind",
  "costBasis",
  "costScope",
  "pricingCoverage",
  "pricingCoverageLimitation",
] as const;

function sessionCells(model: ReceiptModel): string[] {
  const tokens = effectiveTokens(model);
  const parentUsd = parentPricedUsd(model);
  const costMetadata = costMetadataCells(parentUsd);
  const subagentsUsd = model.subagents?.pricedUsd ?? null;
  const combinedUsd = combinedPricedUsd(model);
  const unpricedTokens = knownUnpricedTokens(model);
  const subagentsUnpricedTokens = knownSubagentUnpricedTokens(model);
  const combinedUnpricedTokens = knownCombinedUnpricedTokens(model);
  return [
    String(SCHEMA_VERSION),
    model.sessionId,
    model.source,
    model.title ?? "",
    model.startedAtMs !== undefined ? new Date(model.startedAtMs).toISOString() : "",
    model.durationMs !== undefined ? String(model.durationMs) : "",
    model.modelMix[0]?.model ?? "",
    usdCell(parentUsd),
    String(tokens.input),
    String(tokens.output),
    String(tokens.cacheRead),
    String(tokens.cacheCreation),
    String(tokens.total),
    ...costMetadata,
    "parent-session",
    usdCell(subagentsUsd),
    usdCell(combinedUsd),
    ...costMetadataCells(combinedUsd),
    String(model.subagents?.tokensTotal ?? 0),
    String(combinedTokenTotal(model)),
    String(model.subagents?.count ?? 0),
    String(model.subagents?.unpricedCount ?? 0),
    String(model.subagents?.unreadableCount ?? 0),
    pricingCoverageOf(model),
    ...unpricedUsageCells(unpricedTokens),
    "parent-session",
    ...costMetadataCells(subagentsUsd),
    "readable-subagents",
    ...unpricedUsageCells(subagentsUnpricedTokens),
    "readable-subagents",
    ...unpricedUsageCells(combinedUnpricedTokens),
    "parent-session-plus-readable-subagents",
    combinedPricingCoverageOf(model),
  ];
}

/** `--csv=session`: header + one summary row. */
export function toSessionCsv(model: ReceiptModel): string {
  return [csvRow([...SESSION_COLUMNS]), csvRow(sessionCells(model))].join("\n");
}

/** `--csv=tool`: header + one row per tool line (token cells always populated; `$` cell empty when that tool's turns never priced). */
export function toToolCsv(model: ReceiptModel): string {
  const sessionCoverage = pricingCoverageOf(model);
  const rows = model.toolRows.map((row) => {
    const rowCoverage = row.usd === null ? "unpriced" : sessionCoverage === "full" ? "full" : "indeterminate";
    const limitation =
      rowCoverage === "indeterminate"
        ? "session pricing is partial; unpriced tokens are not separable at tool-row granularity"
        : "";
    return csvRow([
      String(SCHEMA_VERSION),
      model.sessionId,
      model.source,
      row.tool,
      usdCell(row.usd),
      String(row.tokens.input),
      String(row.tokens.output),
      String(row.tokens.cacheRead),
      String(row.tokens.cacheCreation),
      String(row.tokens.total),
      String(row.callCount),
      ...costMetadataCells(row.usd),
      "parent-session-tool",
      rowCoverage,
      limitation,
    ]);
  });
  return [csvRow([...TOOL_COLUMNS]), ...rows].join("\n");
}

/** `compare <a> <b> --csv` (R3): header + exactly two session rows, plus a `delta` column carrying the factual delta line on the first row only — never a ranking field (I6). */
export function toCompareCsv(a: ReceiptModel, b: ReceiptModel, delta: string): string {
  const header = csvRow([...SESSION_COLUMNS, "delta"]);
  const rowA = csvRow([...sessionCells(a), delta]);
  const rowB = csvRow([...sessionCells(b), ""]);
  return [header, rowA, rowB].join("\n");
}
