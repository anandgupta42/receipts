// Shared mini-summary model + the 6-line session-end render (SPEC-0006 R4).
// ONE model, two surfaces: `buildMiniSummary` reduces an already-built
// `ReceiptModel` to the compact fields both this milestone's SessionEnd
// receipt and SPEC-0007's statusline consume — neither surface recomputes
// pricing/attribution/waste, they only format what's already here. This
// renderer emits exactly 6 lines of plain text (no ANSI — the hook/statusline
// context is not guaranteed to interpret it), deterministic and golden-gated
// (I5), obeying the same $-honesty rules as the full receipt (I2).
import { formatDuration, formatInt, formatUsdFloor, formatUsdLowerBound } from "./format.js";
import { combinedPricedUsd, type ReceiptModel, type ToolRow, type WasteLine } from "./model.js";
import {
  combinedPricingCoverageOf,
  knownCombinedUnpricedTokens,
  type PricingCoverage,
} from "./pricingCoverage.js";

export interface MiniTopTool {
  tool: string;
  /** `null` when this tool resolved no price (I2) — render tokens instead. */
  usd: number | null;
  tokens: number;
  callCount: number;
}

/**
 * The compact per-session summary shared by the SessionEnd receipt (SPEC-0006)
 * and the statusline (SPEC-0007). Derived purely from `ReceiptModel`; carries
 * no rendering decisions of its own so the two surfaces can format it
 * differently (6 lines here, 1 line there) without duplicating any logic.
 */
export interface MiniSummary {
  agentLabel: string;
  /** Dominant model by token share; `null` when no turn carried a resolvable model (e.g. Cursor). */
  model: string | null;
  durationMs: number | undefined;
  /** `null` → render tokens-only, zero `$` bytes (I2). */
  totalUsd: number | null;
  /** Combined parent + readable-child price-join coverage. */
  pricingCoverage: PricingCoverage;
  /** Exact observable tokens excluded from the combined priced subtotal. */
  knownUnpricedTokens: number;
  totalTokens: number;
  /** `null` when the session recorded no tool calls. */
  topTool: MiniTopTool | null;
  /** The session's first flagged-pattern line, already ordered by the model builder; `null` → "no flagged pattern detected". */
  topWaste: WasteLine | null;
  /** Cursor's degraded mode: session totals only, no per-turn model/usage. */
  unpriceable: boolean;
  /** SPEC-0061 — discovered subagent (child) sessions folded into the totals above; `0` when none. */
  subagentCount: number;
}

function topToolOf(toolRows: ToolRow[]): MiniTopTool | null {
  const row = toolRows[0];
  if (!row) {
    return null;
  }
  return { tool: row.tool, usd: row.usd, tokens: row.tokens.total, callCount: row.callCount };
}

/** Reduce a full `ReceiptModel` to the shared mini-summary. Pure; no I/O, no recompute. SPEC-0061 R3/R4: priced child atoms stay visible even when the parent is unpriced; their floor and exact known-unpriced usage remain separate. */
export function buildMiniSummary(model: ReceiptModel): MiniSummary {
  const agg = model.subagents;
  const parentTokens = model.unpriceable ? model.sessionTotalTokens.total : model.totalTokens.total;
  return {
    agentLabel: model.agentLabel,
    model: model.modelMix[0]?.model ?? null,
    durationMs: model.durationMs,
    totalUsd: combinedPricedUsd(model),
    pricingCoverage: combinedPricingCoverageOf(model),
    knownUnpricedTokens: knownCombinedUnpricedTokens(model).total,
    totalTokens: parentTokens + (agg?.tokensTotal ?? 0),
    topTool: topToolOf(model.toolRows),
    topWaste: model.wasteLines[0] ?? null,
    unpriceable: model.unpriceable,
    subagentCount: agg?.count ?? 0,
  };
}

function callLabel(callCount: number, tool: string): string {
  const unit = tool === "(thinking/reply)" ? "turn" : "call";
  return `${formatInt(callCount)} ${unit}${callCount === 1 ? "" : "s"}`;
}

function totalLine(s: MiniSummary): string {
  // SPEC-0061 R4 — say when the total covers more than the parent transcript.
  const suffix = s.subagentCount > 0 ? ` (incl. ${formatInt(s.subagentCount)} subagent${s.subagentCount === 1 ? "" : "s"})` : "";
  if (s.totalUsd !== null && s.pricingCoverage === "partial") {
    const gap = s.knownUnpricedTokens > 0
      ? `${formatInt(s.knownUnpricedTokens)} tok known unpriced · coverage partial`
      : "coverage partial";
    return `total  known priced ${formatUsdLowerBound(s.totalUsd)} · ${gap}${suffix}`;
  }
  if (s.totalUsd !== null) {
    return `total  ${formatUsdLowerBound(s.totalUsd)}${suffix}`;
  }
  return `total  ${formatInt(s.totalTokens)} tok${suffix}`;
}

function topToolLine(s: MiniSummary): string {
  const t = s.topTool;
  if (!t) {
    return "top    (no tool calls)";
  }
  if (s.unpriceable) {
    // Cursor: per-tool tokens are unavailable — call counts are the only real number.
    return `top    ${t.tool} · ${callLabel(t.callCount, t.tool)}`;
  }
  const value = t.usd !== null ? formatUsdLowerBound(t.usd) : `${formatInt(t.tokens)} tok`;
  return `top    ${t.tool} · ${value} (${callLabel(t.callCount, t.tool)})`;
}

function wasteValue(waste: WasteLine): string {
  if (waste.kind === "trivial-spans") {
    return `≈ $${formatUsdFloor(waste.usd)}`;
  }
  // stuck-loop and context-thrash both carry a nullable usd → tokens when unpriced (I2).
  return waste.usd !== null ? `≈ $${formatUsdFloor(waste.usd)}` : `≈ ${formatInt(waste.tokens.total)} tok`;
}

function wasteLine(s: MiniSummary): string {
  const waste = s.topWaste;
  if (!waste) {
    return "no flagged pattern detected";
  }
  if (waste.kind === "stuck-loop") {
    return `⚠ ${waste.tool} loop ×${waste.runLength} · ${wasteValue(waste)}`;
  }
  if (waste.kind === "context-thrash") {
    return `⚠ context thrash ×${waste.compactionCount} compactions · ${wasteValue(waste)}`;
  }
  return `⚠ ${formatInt(waste.eligibleTurnCount)} trivial spans → ${waste.cheaperModel} · ${wasteValue(waste)}`;
}

/**
 * Render `model` as the 6-line session-end receipt (SPEC-0006 R4). Exactly six
 * lines, in order: brand header, agent · model · duration, total, top tool,
 * flagged-pattern line (or "no flagged pattern detected"), footer pointing at the full receipt.
 */
export function renderMiniReceipt(model: ReceiptModel): string {
  return renderMiniSummary(buildMiniSummary(model));
}

/** Render a pre-built `MiniSummary` as the 6-line receipt — the surface SPEC-0006 owns. */
export function renderMiniSummary(s: MiniSummary): string {
  const modelLabel = s.model ?? "model unknown";
  const durationLabel = s.durationMs !== undefined ? formatDuration(s.durationMs) : "duration unknown";
  const lines = [
    "aireceipts · session receipt",
    `${s.agentLabel} · ${modelLabel} · ${durationLabel}`,
    totalLine(s),
    topToolLine(s),
    wasteLine(s),
    "run  aireceipts  for the full receipt",
  ];
  return lines.join("\n");
}

// --- SPEC-0007: one-line statusline rendering over the same shared summary ---

/**
 * Terse, factual detector-pattern flag for the one-line statusline (I6: never a
 * good/bad framing, just what fired). Deliberately shorter than the 6-line
 * receipt's `wasteLine` — no `$`/token value, since the total is already on
 * the same line. SPEC-0062 moved the one-line renderer itself to the segments
 * engine (`src/cli/statuslineSegments.ts`), which composes this flag; the
 * `waste` segment's copy is still pinned here so both surfaces share one
 * truth.
 */
export function statuslineWasteFlag(waste: WasteLine): string {
  if (waste.kind === "stuck-loop") {
    return `⚠ ${waste.tool} loop ×${waste.runLength}`;
  }
  if (waste.kind === "context-thrash") {
    return `⚠ context thrash ×${waste.compactionCount}`;
  }
  return `⚠ ${formatInt(waste.eligibleTurnCount)} trivial spans`;
}
