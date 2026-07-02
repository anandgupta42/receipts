// R5: the till-receipt text renderer. Pure formatting over the shared
// {@link ReceiptView} (see `present.ts`) — no pricing/attribution logic lives
// here (that's `src/pricing/**`, core-engine's), and no I/O. The SVG exporter
// (`svg.ts`) formats the *same* view into geometry; neither renderer derives a
// string the other doesn't. `renderReceiptLines` returns an array (not a joined
// string) so `compare.ts` can zip two receipts side-by-side at the line level.
import { colorEnabled, makeColorizer } from "./color.js";
import { center, dottedLine, wrapText } from "./format.js";
import type { ReceiptModel } from "./model.js";
import { buildReceiptView } from "./present.js";

export const RECEIPT_WIDTH = 50;

export interface RenderOptions {
  color?: boolean;
  width?: number;
}

function perforation(width: number): string {
  const unit = "- ";
  return unit.repeat(Math.ceil(width / unit.length)).slice(0, width).trimEnd();
}

/** Renders `model` as an array of lines (no trailing newline join) at a fixed width, so `compare.ts` can zip two receipts side by side. */
export function renderReceiptLines(model: ReceiptModel, opts: RenderOptions = {}): string[] {
  const width = opts.width ?? RECEIPT_WIDTH;
  const enabled = opts.color ?? colorEnabled();
  const { dim, bold } = makeColorizer(enabled);
  const view = buildReceiptView(model);

  const lines: string[] = [];
  lines.push(dim(perforation(width)));
  lines.push(center(bold(view.wordmark), width));
  for (const meta of view.metaLines) {
    lines.push(center(meta, width));
  }
  lines.push("");

  for (const row of view.toolRows) {
    lines.push(dottedLine(row.label, row.value, width));
  }

  if (view.wasteRows.length > 0) {
    lines.push("");
    for (const waste of view.wasteRows) {
      if (waste.kind === "stuck-loop") {
        lines.push(dottedLine(`⚠ ${waste.label}`, waste.value, width));
      } else {
        lines.push(dottedLine(waste.label, waste.value, width));
        lines.push(`  ${waste.detail}`);
      }
    }
  }

  lines.push(dim("-".repeat(width)));
  lines.push(bold(dottedLine(view.total.label, view.total.value, width)));
  if (view.totalNote) {
    lines.push(view.totalNote);
  }

  if (view.priceDeltaRow) {
    lines.push(dim(dottedLine(view.priceDeltaRow.label, view.priceDeltaRow.value, width)));
    if (view.priceDeltaNote) {
      lines.push(dim(`  ${view.priceDeltaNote}`));
    }
  }

  lines.push("");
  lines.push(...wrapText(view.methodologyBrief, width).map((l) => dim(l)));

  lines.push(dim(perforation(width)));
  lines.push(center("aireceipts · local · buy me a samosa 🥟", width));
  lines.push(dim(perforation(width)));

  return lines;
}

export function renderReceipt(model: ReceiptModel, opts: RenderOptions = {}): string {
  return renderReceiptLines(model, opts).join("\n");
}
