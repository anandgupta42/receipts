// R6 `--handoff`: a paste-ready block built ONLY from fired waste lines — a
// terse "here's what to check" note, not a second receipt. Reuses the exact
// wording rules from `render.ts` (TRIVIAL_SPANS_LABEL, etc.) so the two
// surfaces never drift apart on phrasing.
import { formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, WasteLine } from "./model.js";

const TRIVIAL_SPANS_LABEL = "≈ re-priced eligible trivial spans";

function handoffBullet(waste: WasteLine): string {
  if (waste.kind === "stuck-loop") {
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? `, ${formatDuration(waste.wallClockMs)} wall-clock` : "";
    return `- ${waste.tool} loop ×${waste.runLength}: ${valuePart}${clockPart}`;
  }
  return `- ${TRIVIAL_SPANS_LABEL}: $${formatUsd(waste.usd)} (${waste.eligibleTurnCount} turns → ${waste.cheaperModel})`;
}

/** Exactly `"nothing to hand off"` when no waste line fired — caller exits 0, per spec. */
export function renderHandoff(model: ReceiptModel): string {
  if (model.wasteLines.length === 0) {
    return "nothing to hand off";
  }
  const label = model.title ?? model.sessionId;
  const lines = [`handoff: ${label}`, ...model.wasteLines.map(handoffBullet)];
  return lines.join("\n");
}
