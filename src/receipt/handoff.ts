// R6 `--handoff`: a paste-ready block built ONLY from detector-flagged pattern lines — a
// terse "here's what to check" note, not a second receipt. SPEC-0059 shapes
// that body as the savings slip. Cost arithmetic is now universally a
// Standard-API-equivalent lower bound, but detector membership is heuristic:
// the headline reports the cost inside a flagged pattern, never guaranteed
// waste or savings.
// per-class evidence + fixed rule lines. Evidence rows reuse the receipt's own
// `wasteRowBlock` so the two surfaces never drift apart on phrasing.
//
// SPEC-0013 (handoff v2) extends this with a trailing standing-rule section:
// when a waste class recurs across enough distinct recent sessions, emit a
// fixed CLAUDE.md rule line the user pastes themselves. Templates are static
// data (I1 — never model-generated); no line judges the agent or names a
// model (I6).
import type { WasteClassAggregate } from "../aggregate/waste.js";
import { dottedLine, formatAbsoluteUtc, formatDuration, formatInt, formatSharePercent, formatUsdFloor, formatUsdLowerBound, wrapText } from "./format.js";
import { combinedPricedUsd, combinedTokenTotal, type ReceiptModel, type WasteLine } from "./model.js";
import { wasteRowBlock } from "./present.js";
import { RECEIPT_WIDTH } from "./render.js";
import { HEURISTIC_PATTERN_PRICING_INTERPRETATION } from "./costEstimate.js";
import { combinedPricingCoverageOf, knownCombinedUnpricedTokens } from "./pricingCoverage.js";
import { REVIEW_REGISTRY } from "./reviewRegistry.js";

/** SPEC-0013 R1: distinct-session recurrence needed before a class is eligible; `--handoff-threshold` overrides. */
export const DEFAULT_HANDOFF_THRESHOLD = 3;

/** SPEC-0013 R3 label: the section reads as a manual paste, never an auto-write (R4). */
const SUGGESTION_HEADER = "suggested project instructions (recurring across recent sessions — paste manually):";

/**
 * SPEC-0013 R2: static lookup, verbatim strings fixed in-spec, keyed by the
 * receipt's `WasteLine.kind`. Never model-generated (I1). A class with no entry
 * here is silently omitted from the suggestion section. The banned-phrase test
 * guards these against model-claim wording (I3/I6).
 */
/** Legacy detector kinds mapped to the registry's one canonical recommendation. */
export const SLIP_RULE_LINES: Record<string, string> = {
  "stuck-loop": REVIEW_REGISTRY.patterns["repeated-identical-attempt"].recommendation,
  "trivial-spans": REVIEW_REGISTRY.patterns["short-tool-free-turn-cost"].recommendation,
  "context-thrash": REVIEW_REGISTRY.patterns["context-refill-cluster"].recommendation,
};

const FLAGGED_PATTERN_COST_KINDS = new Set(["stuck-loop", "context-thrash"]);

/** SPEC-0059 R2/R7 — overlap-safe flagged-pattern arithmetic, never a savings claim. */
export interface CouldHaveSaved {
  /** Explicit meaning for this legacy-named object: detector pricing, not proven savings. */
  interpretation: typeof HEURISTIC_PATTERN_PRICING_INTERPRETATION;
  /** Legacy field: largest flagged-class cost subtotal. It does not establish avoidability. */
  usd: number | null;
  /** Largest one-class token subtotal. It does not establish avoidability. */
  tokens: number;
  /** Retained for schema compatibility; null because a ratio of two lower bounds has no valid direction. */
  pctOfTotal: number | null;
}

export function couldHaveSavedOf(wasteLines: WasteLine[], totalUsd: number | null): CouldHaveSaved {
  void totalUsd; // Compatibility parameter; ratios of lower bounds are intentionally not computed.
  const byKind = new Map<string, { usd: number; hasPriced: boolean; tokens: number }>();
  for (const waste of wasteLines) {
    const subtotal = byKind.get(waste.kind) ?? { usd: 0, hasPriced: false, tokens: 0 };
    if (waste.usd !== null && FLAGGED_PATTERN_COST_KINDS.has(waste.kind)) {
      subtotal.usd += waste.usd;
      subtotal.hasPriced = true;
    }
    subtotal.tokens += waste.tokens.total;
    byKind.set(waste.kind, subtotal);
  }
  const flaggedSubtotals = [...byKind.entries()]
    .filter(([kind, subtotal]) => FLAGGED_PATTERN_COST_KINDS.has(kind) && subtotal.hasPriced)
    .map(([, subtotal]) => subtotal.usd);
  const usd = flaggedSubtotals.length > 0 ? Math.max(...flaggedSubtotals) : null;
  const tokens = Math.max(0, ...[...byKind.values()].map((subtotal) => subtotal.tokens));
  return { interpretation: HEURISTIC_PATTERN_PRICING_INTERPRETATION, usd, tokens, pctOfTotal: null };
}

/** The headline's explicitly heuristic pattern subtotal. */
export function couldHaveSavedValue(saved: CouldHaveSaved): string {
  return saved.usd !== null ? `≈ $${formatUsdFloor(saved.usd)}` : `≈ ${formatInt(saved.tokens)} tok`;
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
  const lines: string[] = [dottedLine("FLAGGED PATTERN COST", couldHaveSavedValue(saved), RECEIPT_WIDTH)];
  lines.push("  heuristic pattern subtotal · not proven savings");
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
      const wrapped = wrapText(rule, RECEIPT_WIDTH - 4);
      lines.push(...wrapped.map((line, index) => `${index === 0 ? "  → " : "    "}${line}`));
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
    const template = SLIP_RULE_LINES[agg.class];
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
    lines.push(model.modelMix.map((m) => `${m.model} ${formatSharePercent(m.tokenShare)}`).join(" · "));
  }
  const combinedUsd = combinedPricedUsd(model);
  const pricingCoverage = combinedPricingCoverageOf(model);
  const totalPart = combinedUsd !== null && pricingCoverage === "partial"
    ? `known priced subtotal ${formatUsdLowerBound(combinedUsd)} · known unpriced ${formatInt(knownCombinedUnpricedTokens(model).total)} tok`
    : combinedUsd !== null
      ? `total ${formatUsdLowerBound(combinedUsd)}`
      : `total ${formatInt(combinedTokenTotal(model))} tok`;
  const childCount = model.subagents?.count ?? 0;
  lines.push(
    childCount > 0
      ? `${totalPart} · ${formatInt(counts.turns)} parent turns · ${formatInt(counts.toolCalls)} parent tool calls · ${formatInt(childCount)} subagents`
      : `${totalPart} · ${formatInt(counts.turns)} turns · ${formatInt(counts.toolCalls)} tool calls`,
  );
  if (counts.compactions > 0) {
    lines.push(`compactions: ${formatInt(counts.compactions)}`);
  }
  return lines;
}

/** Pluralize a count with its noun — matches the receipt's row-label singular/plural discipline. */
function countNoun(n: number, singular: string): string {
  return `${formatInt(n)} ${singular}${n === 1 ? "" : "s"}`;
}

/** SPEC-0042 R2 — the packet states what it covers, checkably (fixed format, counts only). */
function coverageLine(model: ReceiptModel, counts: HandoffCounts): string {
  const base = model.subagents !== undefined
    ? `covers: ${countNoun(counts.turns, "parent turn")} · ${countNoun(counts.toolCalls, "parent tool call")} · ${countNoun(model.subagents.count, "subagent")} · ${countNoun(counts.compactions, "parent compaction")} · ${countNoun(model.wasteLines.length, "parent flagged-pattern line")}`
    : `covers: ${countNoun(counts.turns, "turn")} · ${countNoun(counts.toolCalls, "tool call")} · ${countNoun(counts.compactions, "compaction")} · ${countNoun(model.wasteLines.length, "flagged-pattern line")}`;
  return combinedPricingCoverageOf(model) === "partial" ? `${base} · pricing coverage partial` : base;
}

/** SPEC-0059 R5 — the PR slip's covers line: session count first, then facts summed across the counted sessions. */
export function prCoverageLine(sessionCount: number, turnCount: number, wasteLineCount: number): string {
  return `covers: ${countNoun(sessionCount, "session")} · ${countNoun(turnCount, "turn")} · ${countNoun(wasteLineCount, "flagged-pattern line")}`;
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
