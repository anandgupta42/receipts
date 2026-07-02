// R6 `compare <a> <b>`: strictly factual side-by-side comparison. I6 forbids
// "better/worse" language — the only comparative wording allowed is a plain
// cost ratio ("A cost 6.1× B"), computed from real totals, never a judgment.
import { formatRatio, formatUsd, formatInt } from "./format.js";
import { colorEnabled, makeColorizer } from "./color.js";
import type { ReceiptModel } from "./model.js";
import { renderReceiptLines, RECEIPT_WIDTH } from "./render.js";

const SIDE_BY_SIDE_MIN_TERM_WIDTH = 110;
const GUTTER = " │ ";

function labelFor(model: ReceiptModel): string {
  return model.title ?? model.sessionId;
}

/** Factual-only delta line: a cost ratio when both sides priced, a token ratio when neither is, and a plain "unpriced" note when the two are mixed (a $/token ratio wouldn't be a real number). No better/worse wording (I6). */
export function compareDeltaLine(a: ReceiptModel, b: ReceiptModel): string {
  const labelA = labelFor(a);
  const labelB = labelFor(b);

  if (a.totalUsd !== null && b.totalUsd !== null) {
    if (b.totalUsd === 0) {
      return a.totalUsd === 0
        ? `${labelA} and ${labelB} both cost $0.00`
        : `${labelB} cost $0.00; ${labelA} cost $${formatUsd(a.totalUsd)}`;
    }
    const ratio = a.totalUsd / b.totalUsd;
    return `${labelA} cost ${formatRatio(ratio)} ${labelB} ($${formatUsd(a.totalUsd)} vs $${formatUsd(b.totalUsd)})`;
  }

  const tokensA = a.unpriceable ? a.sessionTotalTokens.total : a.totalTokens.total;
  const tokensB = b.unpriceable ? b.sessionTotalTokens.total : b.totalTokens.total;
  if (a.totalUsd === null && b.totalUsd === null) {
    if (tokensB === 0) {
      return tokensA === 0
        ? `${labelA} and ${labelB} both used 0 tokens`
        : `${labelB} used 0 tokens; ${labelA} used ${formatInt(tokensA)} tok`;
    }
    const ratio = tokensA / tokensB;
    return `${labelA} used ${formatRatio(ratio)} ${labelB}'s tokens (${formatInt(tokensA)} vs ${formatInt(tokensB)} tok)`;
  }

  return `${labelA} and ${labelB} are not directly comparable: one priced, one unpriced (tokens-only)`;
}

function zipColumns(left: string[], right: string[], leftWidth: number): string[] {
  const height = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    const l = (left[i] ?? "").padEnd(leftWidth, " ");
    const r = right[i] ?? "";
    lines.push(`${l}${GUTTER}${r}`);
  }
  return lines;
}

export interface CompareOptions {
  color?: boolean;
  termWidth?: number;
  width?: number;
}

export function renderCompare(a: ReceiptModel, b: ReceiptModel, opts: CompareOptions = {}): string {
  const width = opts.width ?? RECEIPT_WIDTH;
  const color = opts.color ?? colorEnabled();
  const termWidth = opts.termWidth ?? (process.stdout.columns || 80);
  const { bold } = makeColorizer(color);

  const linesA = renderReceiptLines(a, { color, width });
  const linesB = renderReceiptLines(b, { color, width });

  const sideBySideWidth = width * 2 + GUTTER.length;
  const out: string[] = [];

  if (termWidth >= SIDE_BY_SIDE_MIN_TERM_WIDTH && sideBySideWidth <= termWidth) {
    out.push(...zipColumns(linesA, linesB, width));
  } else {
    out.push(bold(`=== ${labelFor(a)} ===`));
    out.push(...linesA);
    out.push("");
    out.push(bold(`=== ${labelFor(b)} ===`));
    out.push(...linesB);
  }

  out.push("");
  out.push(compareDeltaLine(a, b));

  return out.join("\n");
}
