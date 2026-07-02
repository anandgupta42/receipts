// R4 (SPEC-0003): the single source of the receipt's *display strings*. Both
// the terminal renderer (`render.ts`) and the SVG exporter (`svg.ts`) build
// this same view and then only lay it out — text lines vs. SVG geometry.
// Keeping every derived string here is what makes the two renderers provably
// field-parallel (test/receipt/svg.test.ts diffs the ReceiptModel fields each
// renderer reads) and honours AGENTS.md's "no duplicated truths": neither
// renderer re-derives a label, value, or footnote of its own.
import { METHODOLOGY_BRIEF } from "../pricing/attribution.js";
import { formatAbsoluteUtc, formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, WasteLine } from "./model.js";

/** Exact wording required by SPEC-0001 R1's Cursor scenario — never paraphrased. */
export const CURSOR_DEGRADED_NOTE = "Cursor transcripts carry no per-turn model/usage — totals only.";

/** Exact wording required by SPEC-0001 R4(b) — must render with `≈`, never "a cheaper model would have handled this." */
export const TRIVIAL_SPANS_LABEL = "≈ re-priced eligible trivial spans";

export const NO_PRICE_MATCH_NOTE = "no price table matched";

/** A `label`/`value` pair for one tool row. */
export interface RowView {
  label: string;
  value: string;
}

/** One waste line, kind-tagged so a layout can pick the marker (terminal `⚠`, SVG triangle badge) and colour the value. The `label` never carries the marker glyph — that is the layout's job. */
export type WasteView =
  | { kind: "stuck-loop"; label: string; value: string }
  | { kind: "trivial-spans"; label: string; value: string; detail: string };

/** The layout-agnostic view of a receipt: only strings, no wrapping/centering/pixels (those differ per medium). */
export interface ReceiptView {
  wordmark: string;
  /** Centered meta lines under the wordmark (agent · start · duration, then the model mix if any). */
  metaLines: string[];
  toolRows: RowView[];
  wasteRows: WasteView[];
  total: RowView;
  /** Plain note rendered under TOTAL in the degraded modes (Cursor totals-only, or no price table matched). `undefined` when the session priced. */
  totalNote?: string;
  /** The price-delta footnote sentence (unwrapped). `undefined` in tokens-only mode. */
  priceDelta?: string;
  /** The methodology brief (constant), rendered as a wrapped muted footnote. */
  methodologyBrief: string;
}

const WORDMARK = "AIRECEIPTS";

function metaLines(model: ReceiptModel): string[] {
  const startLabel = model.startedAtMs !== undefined ? formatAbsoluteUtc(model.startedAtMs) : "start time unknown";
  const durationLabel = model.durationMs !== undefined ? formatDuration(model.durationMs) : "duration unknown";
  const lines = [`${model.agentLabel} · ${startLabel} · ${durationLabel}`];
  if (model.modelMix.length > 0) {
    lines.push(model.modelMix.map((m) => `${m.model} ${Math.round(m.tokenShare * 100)}%`).join(" · "));
  }
  return lines;
}

function toolRows(model: ReceiptModel): RowView[] {
  return model.toolRows.map((row) => {
    const unit = row.tool === "(thinking/reply)" ? "turn" : "call";
    const countLabel = `(${formatInt(row.callCount)} ${unit}${row.callCount === 1 ? "" : "s"})`;
    if (model.unpriceable) {
      // Cursor: per-tool tokens are always zero (no per-turn usage) — call counts are the only real number.
      return { label: row.tool, value: countLabel };
    }
    if (row.usd !== null) {
      return { label: row.tool, value: `$${formatUsd(row.usd)}  ${countLabel}` };
    }
    return { label: row.tool, value: `${formatInt(row.tokens.total)} tok  ${countLabel}` };
  });
}

function wasteRow(waste: WasteLine): WasteView {
  if (waste.kind === "stuck-loop") {
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? ` (${formatDuration(waste.wallClockMs)})` : "";
    return { kind: "stuck-loop", label: `${waste.tool} loop ×${waste.runLength}`, value: valuePart + clockPart };
  }
  return {
    kind: "trivial-spans",
    label: TRIVIAL_SPANS_LABEL,
    value: `$${formatUsd(waste.usd)}`,
    detail: `(${waste.eligibleTurnCount} turns → ${waste.cheaperModel})`,
  };
}

function totalRow(model: ReceiptModel): { total: RowView; totalNote?: string } {
  if (model.unpriceable) {
    return { total: { label: "TOTAL", value: `${formatInt(model.sessionTotalTokens.total)} tok` }, totalNote: CURSOR_DEGRADED_NOTE };
  }
  if (model.totalUsd !== null) {
    return { total: { label: "TOTAL", value: `$${formatUsd(model.totalUsd)}` } };
  }
  return { total: { label: "TOTAL", value: `${formatInt(model.totalTokens.total)} tok` }, totalNote: NO_PRICE_MATCH_NOTE };
}

function priceDeltaSentence(model: ReceiptModel): string | undefined {
  if (!model.priceDelta) {
    return undefined;
  }
  return (
    `arithmetic, not a prediction: same tokens on ${model.priceDelta.cheaperModel} would cost ` +
    `$${formatUsd(model.priceDelta.usd)} (actual: $${formatUsd(model.priceDelta.actualUsd)})`
  );
}

/** Build the shared, layout-agnostic view every renderer formats. Pure over the already-priced {@link ReceiptModel} — no pricing/attribution here. */
export function buildReceiptView(model: ReceiptModel): ReceiptView {
  const { total, totalNote } = totalRow(model);
  return {
    wordmark: WORDMARK,
    metaLines: metaLines(model),
    toolRows: toolRows(model),
    wasteRows: model.wasteLines.map(wasteRow),
    total,
    totalNote,
    priceDelta: priceDeltaSentence(model),
    methodologyBrief: METHODOLOGY_BRIEF,
  };
}
