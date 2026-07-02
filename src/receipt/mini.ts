// Shared mini-summary model + the 6-line session-end render (SPEC-0006 R4).
// ONE model, two surfaces: `buildMiniSummary` reduces an already-built
// `ReceiptModel` to the compact fields both this milestone's SessionEnd
// receipt and SPEC-0007's statusline consume — neither surface recomputes
// pricing/attribution/waste, they only format what's already here. This
// renderer emits exactly 6 lines of plain text (no ANSI — the hook/statusline
// context is not guaranteed to interpret it), deterministic and golden-gated
// (I5), obeying the same $-honesty rules as the full receipt (I2).
import { formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, ToolRow, WasteLine } from "./model.js";

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
  totalTokens: number;
  /** `null` when the session recorded no tool calls. */
  topTool: MiniTopTool | null;
  /** The session's first waste line, already ordered by the model builder; `null` → "no waste detected". */
  topWaste: WasteLine | null;
  /** Cursor's degraded mode: session totals only, no per-turn model/usage. */
  unpriceable: boolean;
}

function topToolOf(toolRows: ToolRow[]): MiniTopTool | null {
  const row = toolRows[0];
  if (!row) {
    return null;
  }
  return { tool: row.tool, usd: row.usd, tokens: row.tokens.total, callCount: row.callCount };
}

/** Reduce a full `ReceiptModel` to the shared mini-summary. Pure; no I/O, no recompute. */
export function buildMiniSummary(model: ReceiptModel): MiniSummary {
  return {
    agentLabel: model.agentLabel,
    model: model.modelMix[0]?.model ?? null,
    durationMs: model.durationMs,
    totalUsd: model.totalUsd,
    totalTokens: model.unpriceable ? model.sessionTotalTokens.total : model.totalTokens.total,
    topTool: topToolOf(model.toolRows),
    topWaste: model.wasteLines[0] ?? null,
    unpriceable: model.unpriceable,
  };
}

function callLabel(callCount: number, tool: string): string {
  const unit = tool === "(thinking/reply)" ? "turn" : "call";
  return `${formatInt(callCount)} ${unit}${callCount === 1 ? "" : "s"}`;
}

function totalLine(s: MiniSummary): string {
  if (!s.unpriceable && s.totalUsd !== null) {
    return `total  $${formatUsd(s.totalUsd)}`;
  }
  return `total  ${formatInt(s.totalTokens)} tok`;
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
  const value = t.usd !== null ? `$${formatUsd(t.usd)}` : `${formatInt(t.tokens)} tok`;
  return `top    ${t.tool} · ${value} (${callLabel(t.callCount, t.tool)})`;
}

function wasteValue(waste: WasteLine): string {
  if (waste.kind === "stuck-loop") {
    return waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
  }
  return `$${formatUsd(waste.usd)}`;
}

function wasteLine(s: MiniSummary): string {
  const waste = s.topWaste;
  if (!waste) {
    return "no waste detected";
  }
  if (waste.kind === "stuck-loop") {
    return `⚠ ${waste.tool} loop ×${waste.runLength} · ${wasteValue(waste)}`;
  }
  return `⚠ ${formatInt(waste.eligibleTurnCount)} trivial spans → ${waste.cheaperModel} · ${wasteValue(waste)}`;
}

/**
 * Render `model` as the 6-line session-end receipt (SPEC-0006 R4). Exactly six
 * lines, in order: brand header, agent · model · duration, total, top tool,
 * waste line (or "no waste detected"), footer pointing at the full receipt.
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
