// R5: the till-receipt text renderer — a pure interpreter over the shared
// `Block[]` (see `present.ts` / `blocks.ts`). It branches only on a block's kind
// and its own data (columns? badge? muted?), never on which template built it,
// so `classic` renders byte-identically to the pre-SPEC-0020 output while
// `grocery`/`datavis` fall out of the same interpreter for free. No
// pricing/attribution logic lives here (that's `src/pricing/**`), and no I/O.
// `renderReceiptLines` returns an array so `compare.ts` can zip two receipts
// side-by-side at the line level.
import type { Block, TemplateName } from "./blocks.js";
import { groceryLine } from "./blocks.js";
import { colorEnabled, makeColorizer } from "./color.js";
import { center, dottedLine, wrapText } from "./format.js";
import type { ReceiptModel } from "./model.js";
import { buildReceiptView } from "./present.js";

export const RECEIPT_WIDTH = 50;

export interface RenderOptions {
  color?: boolean;
  width?: number;
  /** SPEC-0020: which template to render (default `classic`). */
  template?: TemplateName;
}

export interface RenderBlockOptions {
  color?: boolean;
  width?: number;
}

function perforation(width: number): string {
  const unit = "- ";
  return unit.repeat(Math.ceil(width / unit.length)).slice(0, width).trimEnd();
}

type Colorize = (s: string) => string;

/** Interpret one block into terminal lines, appending to `lines`. */
function renderBlock(block: Block, lines: string[], width: number, dim: Colorize, bold: Colorize): void {
  switch (block.kind) {
    case "masthead":
      lines.push(center(bold(block.text), width));
      return;
    case "meta":
      for (const line of block.lines) {
        lines.push(center(line, width));
      }
      return;
    case "columnHeader":
      lines.push(groceryLine(block.item, block.qty, block.amt));
      return;
    case "row": {
      if (block.spaceBefore) {
        lines.push("");
      }
      const line = block.columns
        ? groceryLine(block.label, block.columns.qty, block.columns.amt)
        : dottedLine(block.label, block.value, width);
      lines.push(block.muted ? dim(line) : line);
      return;
    }
    case "wasteRow": {
      if (block.spaceBefore) {
        lines.push("");
      }
      lines.push(dottedLine(block.badge ? `⚠ ${block.label}` : block.label, block.value, width));
      if (block.detail !== undefined) {
        lines.push(`  ${block.detail}`);
      }
      return;
    }
    case "rule":
      lines.push(dim("-".repeat(width)));
      return;
    case "total": {
      const line = block.columns
        ? groceryLine(block.label, block.columns.qty, block.columns.amt)
        : dottedLine(block.label, block.value, width);
      lines.push(bold(line));
      return;
    }
    case "note": {
      if (block.spaceBefore) {
        lines.push("");
      }
      const indented = `${" ".repeat(block.indent ?? 0)}${block.text}`;
      const laid = block.align === "center" ? center(block.text, width) : indented;
      lines.push(block.muted ? dim(laid) : laid);
      return;
    }
    case "footnote":
      if (block.spaceBefore) {
        lines.push("");
      }
      lines.push(...wrapText(block.text, width).map((l) => dim(l)));
      return;
    case "barcode":
      lines.push(center(block.pattern, width));
      return;
    case "footer":
      lines.push(dim(perforation(width)));
      // Text-only: no emoji stands in for the samosa here — graphical
      // renderers honor `samosaMark` by drawing the real glyph instead.
      lines.push(center(block.text, width));
      return;
  }
}

/** Renders an already-built block list through the same terminal interpreter used by receipt templates. */
export function renderBlockLines(blocks: Block[], opts: RenderBlockOptions = {}): string[] {
  const width = opts.width ?? RECEIPT_WIDTH;
  const enabled = opts.color ?? colorEnabled();
  const { dim, bold } = makeColorizer(enabled);

  const lines: string[] = [dim(perforation(width))];
  for (const block of blocks) {
    renderBlock(block, lines, width, dim, bold);
  }
  lines.push(dim(perforation(width)));
  return lines;
}

/** Renders `model` as an array of lines (no trailing newline join) at a fixed width, so `compare.ts` can zip two receipts side by side. */
export function renderReceiptLines(model: ReceiptModel, opts: RenderOptions = {}): string[] {
  const { blocks } = buildReceiptView(model, opts.template ?? "classic");
  return renderBlockLines(blocks, opts);
}

export function renderReceipt(model: ReceiptModel, opts: RenderOptions = {}): string {
  return renderReceiptLines(model, opts).join("\n");
}
