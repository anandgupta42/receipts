// R6 `--handoff`: a paste-ready block built ONLY from fired waste lines — a
// terse "here's what to check" note, not a second receipt. Reuses the exact
// wording rules from `render.ts` (TRIVIAL_SPANS_LABEL, etc.) so the two
// surfaces never drift apart on phrasing.
//
// SPEC-0013 (handoff v2) extends this with a trailing standing-rule section:
// when a waste class recurs across enough distinct recent sessions, emit a
// fixed CLAUDE.md rule line the user pastes themselves. Templates are static
// data (I1 — never model-generated); no line judges the agent or names a
// model (I6).
import type { WasteClassAggregate } from "../aggregate/waste.js";
import { formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, WasteLine } from "./model.js";

const TRIVIAL_SPANS_LABEL = "≈ re-priced eligible trivial spans";

/** SPEC-0013 R1: distinct-session recurrence needed before a class is eligible; `--handoff-threshold` overrides. */
export const DEFAULT_HANDOFF_THRESHOLD = 3;

/** SPEC-0013 R3 label: the section reads as a manual paste, never an auto-write (R4). */
const SUGGESTION_HEADER = "suggested CLAUDE.md rules (recurring across recent sessions — paste manually):";

/**
 * SPEC-0013 R2: static lookup, verbatim strings fixed in-spec, keyed by the
 * receipt's `WasteLine.kind`. Never model-generated (I1). A class with no entry
 * here is silently omitted from the suggestion section. The banned-phrase test
 * guards these against model-claim wording (I3/I6).
 */
const STANDING_RULE_TEMPLATES: Record<string, string> = {
  "stuck-loop":
    "When a command fails, do not re-run it unchanged more than twice — change the command, add logging, or stop and summarize the failure.",
  "trivial-spans":
    "For short acknowledgments and single-line replies, keep responses minimal — do not restate context.",
};

function handoffBullet(waste: WasteLine): string {
  if (waste.kind === "stuck-loop") {
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? `, ${formatDuration(waste.wallClockMs)} wall-clock` : "";
    return `- ${waste.tool} loop ×${waste.runLength}: ${valuePart}${clockPart}`;
  }
  if (waste.kind === "context-thrash") {
    // R7: the static clear/split-context suggestion rides with the bullet.
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    return `- context thrash ×${waste.compactionCount} compactions (${waste.turnSpan} turns): ${valuePart} — clear or split context at task boundaries`;
  }
  return `- ${TRIVIAL_SPANS_LABEL}: $${formatUsd(waste.usd)} (${waste.eligibleTurnCount} turns → ${waste.cheaperModel})`;
}

/**
 * SPEC-0013 R1/R2: the standing-rule lines for classes recurring across at
 * least `threshold` distinct sessions. Reads only `distinctSessionCount` (so a
 * class firing many times within ONE session counts once, per aggregateWaste),
 * preserves the aggregate's cost-desc order, and drops classes with no
 * template. Pure and deterministic (I1) — the disk window loading lives in the
 * CLI.
 */
export function standingRuleSuggestions(
  aggregates: WasteClassAggregate[],
  threshold: number = DEFAULT_HANDOFF_THRESHOLD,
): string[] {
  const out: string[] = [];
  for (const agg of aggregates) {
    if (agg.distinctSessionCount < threshold) {
      continue;
    }
    const template = STANDING_RULE_TEMPLATES[agg.class];
    if (template !== undefined) {
      out.push(template);
    }
  }
  return out;
}

/**
 * Exactly `"nothing to hand off"` when nothing fired and nothing is suggested —
 * caller exits 0, per spec. `suggestions` (SPEC-0013 R3) appends a trailing,
 * clearly-labeled section only when non-empty; when it is empty the output is
 * byte-identical to pre-SPEC-0013 behavior (R5).
 */
export function renderHandoff(model: ReceiptModel, suggestions: string[] = []): string {
  const hasWaste = model.wasteLines.length > 0;
  if (!hasWaste && suggestions.length === 0) {
    return "nothing to hand off";
  }
  const lines: string[] = [];
  if (hasWaste) {
    const label = model.title ?? model.sessionId;
    lines.push(`handoff: ${label}`, ...model.wasteLines.map(handoffBullet));
  }
  if (suggestions.length > 0) {
    if (hasWaste) {
      lines.push("");
    }
    lines.push(SUGGESTION_HEADER, ...suggestions.map((s) => `- ${s}`));
  }
  return lines.join("\n");
}
