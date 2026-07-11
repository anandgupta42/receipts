// R6 `compare <a> <b>`: strictly factual side-by-side comparison. I6 forbids
// "better/worse" language — the only comparative wording allowed is a plain
// cost ratio ("A cost 6.1× B"), computed from real totals, never a judgment.
import { formatRatio, formatUsdLowerBound, formatInt } from "./format.js";
import { colorEnabled, makeColorizer } from "./color.js";
import { combinedPricedUsd, combinedTokenTotal, type ReceiptModel } from "./model.js";
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
  // Match the TOTAL each receipt actually renders. A priced parent includes
  // readable priced children; an unpriced parent remains tokens-only even if a
  // child priced, per the receipt's one-unit display contract.
  const usdA = a.totalUsd !== null ? combinedPricedUsd(a) : null;
  const usdB = b.totalUsd !== null ? combinedPricedUsd(b) : null;

  if (usdA !== null && usdB !== null) {
    if (usdB === 0) {
      return usdA === 0
        ? `${labelA} and ${labelB} both have a ${formatUsdLowerBound(0)} standard-API floor`
        : `${labelB} has a ${formatUsdLowerBound(0)} floor; ${labelA} has a ${formatUsdLowerBound(usdA)} floor`;
    }
    const ratio = usdA / usdB;
    return `${labelA}'s standard-API floor is ${formatRatio(ratio)} ${labelB}'s (${formatUsdLowerBound(usdA)} vs ${formatUsdLowerBound(usdB)})`;
  }

  const tokensA = combinedTokenTotal(a);
  const tokensB = combinedTokenTotal(b);
  if (usdA === null && usdB === null) {
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
