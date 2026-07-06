// R6 `--handoff`: a paste-ready block built ONLY from fired waste lines — a
// terse "here's what to check" note, not a second receipt. SPEC-0059 shapes
// that body as the savings slip: a COULD HAVE SAVED headline, a hedge, and
// per-class evidence + fixed rule lines. Evidence rows reuse the receipt's own
// `wasteRowBlock` so the two surfaces never drift apart on phrasing.
//
// SPEC-0013 (handoff v2) extends this with a trailing standing-rule section:
// when a waste class recurs across enough distinct recent sessions, emit a
// fixed CLAUDE.md rule line the user pastes themselves. Templates are static
// data (I1 — never model-generated); no line judges the agent or names a
// model (I6).
import type { WasteClassAggregate } from "../aggregate/waste.js";
import { dottedLine, formatAbsoluteUtc, formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, WasteLine } from "./model.js";
import { wasteRowBlock } from "./present.js";
import { RECEIPT_WIDTH } from "./render.js";

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

/**
 * SPEC-0059 R3 — one fixed rule line per waste class, ≤ 48 chars so a slip
 * line never wraps at width 50. Strings verbatim from the spec (I1 — never
 * model-generated); context-thrash is SPEC-0017 R4's suggestion wording, the
 * other two are one-line compressions of SPEC-0013's standing-rule templates
 * (whose long forms below stay behind the recurrence gate). A class with no
 * entry renders evidence only. Guarded by the banned-phrase test (I3/I6).
 */
export const SLIP_RULE_LINES: Record<string, string> = {
  "stuck-loop": "change or stop after two identical failures",
  "trivial-spans": "route short replies to a cheaper model",
  "context-thrash": "clear or split context at task boundaries",
};

/** SPEC-0059 R2/R7 — the could-have-saved ceiling: extracted sums, never a prediction. */
export interface CouldHaveSaved {
  /** Sum of `usd` over priced waste lines; `null` when no fired line priced (I2). */
  usd: number | null;
  /** Sum of `tokens.total` over all fired waste lines — the checkable token-side count. */
  tokens: number;
  /** `round(100 · usd / totalUsd)`; `null` without both dollar sides. */
  pctOfTotal: number | null;
}

export function couldHaveSavedOf(wasteLines: WasteLine[], totalUsd: number | null): CouldHaveSaved {
  const priced = wasteLines.filter((w) => w.usd !== null);
  const usd = priced.length > 0 ? priced.reduce((sum, w) => sum + (w.usd as number), 0) : null;
  const tokens = wasteLines.reduce((sum, w) => sum + w.tokens.total, 0);
  const pctOfTotal = usd !== null && totalUsd !== null && totalUsd > 0 ? Math.round((100 * usd) / totalUsd) : null;
  return { usd, tokens, pctOfTotal };
}

/** The headline's right-aligned value: `≤ $X` when any line priced, else `≤ N tok` (I2). */
export function couldHaveSavedValue(saved: CouldHaveSaved): string {
  return saved.usd !== null ? `≤ $${formatUsd(saved.usd)}` : `≤ ${formatInt(saved.tokens)} tok`;
}

/**
 * SPEC-0059 R1–R3 — the savings slip: headline in the receipt's TOTAL idiom,
 * hedge line, blank, then evidence rows grouped by class with each group's
 * fixed rule line under its dollars. Evidence rows come from the receipt's own
 * {@link wasteRowBlock} (glyphs/labels/values shared, never re-derived — R3),
 * including its factual detail sub-lines. Group order: dollar subtotal
 * descending, token-only groups after priced ones, ties keeping first-fired
 * order; rows within a group cost-descending (nulls last, stable).
 */
export function savingsSlipLines(wasteLines: WasteLine[], totalUsd: number | null): string[] {
  const saved = couldHaveSavedOf(wasteLines, totalUsd);
  const lines: string[] = [dottedLine("COULD HAVE SAVED", couldHaveSavedValue(saved), RECEIPT_WIDTH)];
  // R2 hedge: `≈` when an estimate-tier class contributes (a sum containing an
  // estimate is itself estimate-tier — I3); the `$` sum is only a ceiling over
  // ALL waste when nothing was token-only, so the mixed case must say less.
  const approx = wasteLines.some((w) => w.kind !== "stuck-loop") ? "≈ " : "";
  const mixed = saved.usd !== null && wasteLines.some((w) => w.usd === null);
  const core = mixed ? "priced waste only, not a prediction" : "arithmetic, not a prediction";
  lines.push(
    saved.pctOfTotal !== null && totalUsd !== null
      ? `  ${approx}${saved.pctOfTotal}% of $${formatUsd(totalUsd)} · ${core}`
      : `  ${approx}${core}`,
  );
  lines.push("");
  const order: string[] = [];
  const groups = new Map<string, WasteLine[]>();
  for (const waste of wasteLines) {
    const group = groups.get(waste.kind);
    if (group === undefined) {
      groups.set(waste.kind, [waste]);
      order.push(waste.kind);
    } else {
      group.push(waste);
    }
  }
  const subtotal = (kind: string): number => (groups.get(kind) as WasteLine[]).reduce((sum, w) => sum + (w.usd ?? 0), 0);
  const hasPriced = (kind: string): number => ((groups.get(kind) as WasteLine[]).some((w) => w.usd !== null) ? 1 : 0);
  const keys = [...order].sort(
    (a, b) => hasPriced(b) - hasPriced(a) || subtotal(b) - subtotal(a) || order.indexOf(a) - order.indexOf(b),
  );
  for (const kind of keys) {
    const rows = [...(groups.get(kind) as WasteLine[])].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
    for (const waste of rows) {
      const block = wasteRowBlock(waste);
      lines.push(dottedLine(block.badge ? `⚠ ${block.label}` : block.label, block.value, RECEIPT_WIDTH));
      if (block.detail !== undefined) {
        lines.push(`  ${block.detail}`);
      }
    }
    const rule = SLIP_RULE_LINES[kind];
    if (rule !== undefined) {
      lines.push(`  → ${rule}`);
    }
  }
  return lines;
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
 * SPEC-0042 R1/R2 — the session counts the resume-packet header and coverage
 * line quote. Computed by the CLI from the loaded `Session` (turn/tool-call/
 * compaction counts live there, not on `ReceiptModel`); the render stays pure.
 */
export interface HandoffCounts {
  turns: number;
  toolCalls: number;
  compactions: number;
}

/**
 * SPEC-0042 R1 — the state-header lines, rendered only when waste renders and
 * counts were supplied. Every line quotes an existing model field or count —
 * extraction, never narration (I1). A missing field omits its line, never a
 * placeholder. Wording is golden-pinned.
 */
function stateHeaderLines(model: ReceiptModel, counts: HandoffCounts): string[] {
  // R1 omission contract: unknown start/duration are OMITTED from the line —
  // never a placeholder (deliberately NOT the receipt masthead's
  // `start time unknown` treatment, and no width compaction).
  const agentParts = [model.agentLabel];
  if (model.startedAtMs !== undefined) {
    agentParts.push(formatAbsoluteUtc(model.startedAtMs));
  }
  if (model.durationMs !== undefined) {
    agentParts.push(formatDuration(model.durationMs));
  }
  const lines: string[] = [agentParts.join(" · ")];
  if (model.modelMix.length > 0) {
    lines.push(model.modelMix.map((m) => `${m.model} ${Math.round(m.tokenShare * 100)}%`).join(" · "));
  }
  const totalPart = model.totalUsd !== null ? `total $${formatUsd(model.totalUsd)}` : `total ${formatInt(model.sessionTotalTokens.total)} tok`;
  lines.push(`${totalPart} · ${formatInt(counts.turns)} turns · ${formatInt(counts.toolCalls)} tool calls`);
  if (counts.compactions > 0) {
    lines.push(`compactions: ${formatInt(counts.compactions)}`);
  }
  return lines;
}

/** Pluralize a count with its noun (`1 waste line`, `2 waste lines`) — matches the receipt's row-label singular/plural discipline. */
function countNoun(n: number, singular: string): string {
  return `${formatInt(n)} ${singular}${n === 1 ? "" : "s"}`;
}

/** SPEC-0042 R2 — the packet states what it covers, checkably (fixed format, counts only). */
function coverageLine(model: ReceiptModel, counts: HandoffCounts): string {
  return `covers: ${countNoun(counts.turns, "turn")} · ${countNoun(counts.toolCalls, "tool call")} · ${countNoun(counts.compactions, "compaction")} · ${countNoun(model.wasteLines.length, "waste line")}`;
}

/** SPEC-0059 R5 — the PR slip's covers line: session count first, then facts summed across the counted sessions. */
export function prCoverageLine(sessionCount: number, turnCount: number, wasteLineCount: number): string {
  return `covers: ${countNoun(sessionCount, "session")} · ${countNoun(turnCount, "turn")} · ${countNoun(wasteLineCount, "waste line")}`;
}

/**
 * Exactly `"nothing to hand off"` when nothing fired and nothing is suggested —
 * caller exits 0, per spec. `suggestions` (SPEC-0013 R3) appends a trailing,
 * clearly-labeled section only when non-empty; when it is empty the output is
 * byte-identical to pre-SPEC-0013 behavior (R5).
 *
 * SPEC-0042 R1/R2/R6: when `counts` is supplied AND at least one waste line
 * renders, the block opens with the state header and closes with the coverage
 * line. Suggestions-only output (zero waste) stays byte-identical to
 * SPEC-0013 — the packet is a briefing about this session's problems, not a
 * second receipt.
 *
 * SPEC-0059 R1/R4: the waste body is the savings slip, separated from the
 * header lines above it by the receipt's 50-dash pre-TOTAL seam. Rendered
 * standalone (the PR fence), the slip opens with its headline — no seam.
 */
export function renderHandoff(model: ReceiptModel, suggestions: string[] = [], counts?: HandoffCounts): string {
  const hasWaste = model.wasteLines.length > 0;
  if (!hasWaste && suggestions.length === 0) {
    return "nothing to hand off";
  }
  const packet = counts !== undefined && hasWaste;
  const lines: string[] = [];
  if (hasWaste) {
    const label = model.title ?? model.sessionId;
    lines.push(`handoff: ${label}`);
    if (packet && counts !== undefined) {
      lines.push(...stateHeaderLines(model, counts));
    }
    lines.push("-".repeat(RECEIPT_WIDTH));
    lines.push(...savingsSlipLines(model.wasteLines, model.totalUsd));
  }
  if (suggestions.length > 0) {
    if (hasWaste) {
      lines.push("");
    }
    lines.push(SUGGESTION_HEADER, ...suggestions.map((s) => `- ${s}`));
  }
  if (packet && counts !== undefined) {
    lines.push("", coverageLine(model, counts));
  }
  return lines.join("\n");
}
