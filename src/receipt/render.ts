// R5: the till-receipt text renderer. Pure formatting over an already-built
// `ReceiptModel` — no pricing/attribution logic lives here (that's
// `src/pricing/**`, core-engine's), and no I/O. `renderReceiptLines` returns
// an array (not a joined string) so `compare.ts` can zip two receipts
// side-by-side at the line level.
import { METHODOLOGY_BRIEF } from "../pricing/attribution.js";
import { colorEnabled, makeColorizer } from "./color.js";
import {
  center,
  dottedLine,
  formatAbsoluteUtc,
  formatDuration,
  formatInt,
  formatUsd,
  wrapText,
} from "./format.js";
import type { ReceiptModel, WasteLine } from "./model.js";

export const RECEIPT_WIDTH = 50;

/** Exact wording required by SPEC-0001 R1's Cursor scenario — never paraphrased. */
const CURSOR_DEGRADED_NOTE = "Cursor transcripts carry no per-turn model/usage — totals only.";

/** Exact wording required by SPEC-0001 R4(b) — must render with `≈`, never "a cheaper model would have handled this." */
const TRIVIAL_SPANS_LABEL = "≈ re-priced eligible trivial spans";

const NO_PRICE_MATCH_NOTE = "no price table matched";

export interface RenderOptions {
  color?: boolean;
  width?: number;
}

function perforation(width: number): string {
  const unit = "- ";
  return unit.repeat(Math.ceil(width / unit.length)).slice(0, width).trimEnd();
}

function masthead(model: ReceiptModel, width: number, bold: (s: string) => string): string[] {
  const lines = [center(bold("AIRECEIPTS"), width)];
  const startLabel = model.startedAtMs !== undefined ? formatAbsoluteUtc(model.startedAtMs) : "start time unknown";
  const durationLabel = model.durationMs !== undefined ? formatDuration(model.durationMs) : "duration unknown";
  lines.push(center(`${model.agentLabel} · ${startLabel} · ${durationLabel}`, width));
  if (model.modelMix.length > 0) {
    const mixLabel = model.modelMix
      .map((m) => `${m.model} ${Math.round(m.tokenShare * 100)}%`)
      .join(" · ");
    lines.push(center(mixLabel, width));
  }
  return lines;
}

function toolRowLines(model: ReceiptModel, width: number): string[] {
  const lines: string[] = [];
  for (const row of model.toolRows) {
    const unit = row.tool === "(thinking/reply)" ? "turn" : "call";
    const countLabel = `(${formatInt(row.callCount)} ${unit}${row.callCount === 1 ? "" : "s"})`;
    if (model.unpriceable) {
      // Cursor: per-tool tokens are always zero (no per-turn usage) — call counts are the only real number.
      lines.push(dottedLine(row.tool, countLabel, width));
      continue;
    }
    if (row.usd !== null) {
      lines.push(dottedLine(row.tool, `$${formatUsd(row.usd)}  ${countLabel}`, width));
    } else {
      lines.push(dottedLine(row.tool, `${formatInt(row.tokens.total)} tok  ${countLabel}`, width));
    }
  }
  return lines;
}

function wasteLineLines(waste: WasteLine, width: number): string[] {
  if (waste.kind === "stuck-loop") {
    const label = `⚠ ${waste.tool} loop ×${waste.runLength}`;
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? ` (${formatDuration(waste.wallClockMs)})` : "";
    return [dottedLine(label, valuePart + clockPart, width)];
  }
  // trivial-spans — label is long, so the call-out/cost render on the label
  // line and the "N turns → model" detail goes on an indented sub-line.
  const lines = [dottedLine(TRIVIAL_SPANS_LABEL, `$${formatUsd(waste.usd)}`, width)];
  lines.push(`  (${waste.eligibleTurnCount} turns → ${waste.cheaperModel})`);
  return lines;
}

/** Renders `model` as an array of lines (no trailing newline join) at a fixed width, so `compare.ts` can zip two receipts side by side. */
export function renderReceiptLines(model: ReceiptModel, opts: RenderOptions = {}): string[] {
  const width = opts.width ?? RECEIPT_WIDTH;
  const enabled = opts.color ?? colorEnabled();
  const { dim, bold } = makeColorizer(enabled);

  const lines: string[] = [];
  lines.push(dim(perforation(width)));
  lines.push(...masthead(model, width, bold));
  lines.push("");
  lines.push(...toolRowLines(model, width));

  if (model.wasteLines.length > 0) {
    lines.push("");
    for (const waste of model.wasteLines) {
      lines.push(...wasteLineLines(waste, width));
    }
  }

  lines.push(dim("-".repeat(width)));

  if (model.unpriceable) {
    lines.push(bold(dottedLine("TOTAL", `${formatInt(model.sessionTotalTokens.total)} tok`, width)));
    lines.push(CURSOR_DEGRADED_NOTE);
  } else if (model.totalUsd !== null) {
    lines.push(bold(dottedLine("TOTAL", `$${formatUsd(model.totalUsd)}`, width)));
  } else {
    lines.push(bold(dottedLine("TOTAL", `${formatInt(model.totalTokens.total)} tok`, width)));
    lines.push(NO_PRICE_MATCH_NOTE);
  }

  if (model.priceDelta) {
    lines.push("");
    const footnote =
      `arithmetic, not a prediction: same tokens on ${model.priceDelta.cheaperModel} would cost ` +
      `$${formatUsd(model.priceDelta.usd)} (actual: $${formatUsd(model.priceDelta.actualUsd)})`;
    lines.push(...wrapText(footnote, width).map((l) => dim(l)));
  }

  lines.push("");
  lines.push(...wrapText(METHODOLOGY_BRIEF, width).map((l) => dim(l)));

  lines.push(dim(perforation(width)));
  lines.push(center("aireceipts · local · buy me a samosa 🥟", width));
  lines.push(dim(perforation(width)));

  return lines;
}

export function renderReceipt(model: ReceiptModel, opts: RenderOptions = {}): string {
  return renderReceiptLines(model, opts).join("\n");
}
