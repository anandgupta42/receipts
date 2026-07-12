// SPEC-0003 / SPEC-0020: the single source of the receipt's *display strings*.
// `buildReceiptView(model, template)` emits an ordered `Block[]` (see
// `blocks.ts`); both the terminal renderer (`render.ts`) and the SVG exporter
// (`svg.ts`) interpret that same list, so neither renderer re-derives a label,
// value, or footnote of its own (AGENTS.md "no duplicated truths"). A template
// is a pure block-list builder here — adding one touches no renderer.
//
// `classic` reproduces the pre-SPEC-0020 output byte-for-byte (the block
// refactor's no-regression proof); `grocery` and `datavis` reuse the same block
// kinds with template-specific data. No template re-derives a number: every
// dollar/token figure comes from the already-priced {@link ReceiptModel}.
import {
  CONTEXT_THRASH_NOTE,
  PRICE_DELTA_NOTE,
  TRIVIAL_SPANS_LABEL,
  barcodePattern,
  normalizedBar,
  sessionToken,
} from "./blocks.js";
import type { Block, ReceiptView, TemplateName } from "./blocks.js";
import { formatAbsoluteUtc, formatDuration, formatInt, formatSharePercent, formatShortTokens, formatUsdFloor, formatUsdFloorLedger, formatUsdLowerBound, STANDARD_API_LOWER_BOUND_NOTE, usdFloorDecimals } from "./format.js";
import { combinedPricedUsd, type ModelMixEntry, type ReceiptModel, type ToolRow, type WasteLine } from "./model.js";
import type { TokenUsage } from "../parse/types.js";
import { INSTALL_FOOTER_TEXT, REPOSITORY_DISPLAY } from "./branding.js";
import { combinedPricingCoverageOf, knownCombinedUnpricedTokens } from "./pricingCoverage.js";

export type { ReceiptView } from "./blocks.js";
export { PRICE_DELTA_NOTE, TRIVIAL_SPANS_LABEL } from "./blocks.js";

/** Exact wording required by SPEC-0001 R1's Cursor scenario — never paraphrased. */
export const CURSOR_DEGRADED_NOTE = "Cursor transcripts carry no per-turn model/usage — totals only.";

export const NO_PRICE_MATCH_NOTE = "no price table matched";

const WORDMARK = "AIRECEIPTS";
const THINKING_REPLY = "(thinking/reply)";

const TITLE_MAX = 46;
const META_MAX = 50;

/** One-line session title: newlines collapsed, truncated with an ellipsis. The receipt must say WHAT the work was, not just what it cost. */
function titleLine(model: ReceiptModel): string | undefined {
  if (model.title === undefined || model.title.trim() === "") {
    return undefined;
  }
  const flat = model.title.replace(/\s+/g, " ").trim();
  // A markup-shaped title (agent-injected XML, system tags) is machine noise, not a
  // work description — render nothing rather than garbage on the masthead.
  if (flat.startsWith("<")) {
    return undefined;
  }
  const cut = flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…` : flat;
  return `“${cut}”`;
}

/**
 * Share of prompt-side tokens served from cache, over any `TokenUsage` — one
 * formatter for the receipt masthead AND the PR comment's aggregate line
 * (SPEC-0026 R2; a duplicated implementation is a review-rejected defect).
 * `undefined` when there are no prompt tokens or no cache reads.
 */
export function cacheServedPct(t: TokenUsage): string | undefined {
  const promptSide = t.input + t.cacheRead + t.cacheCreation;
  if (promptSide <= 0 || t.cacheRead <= 0) {
    return undefined;
  }
  const ratio = t.cacheRead / promptSide;
  // Display honesty: never round a partial ratio up to the impossible-sounding
  // "100%" — a real session always has SOME uncached prompt. True 100% (synthetic
  // fixtures) may say it; 99.5%+ says ">99%".
  return ratio >= 1 ? "100" : Math.round(ratio * 100) >= 100 ? ">99" : String(Math.round(ratio * 100));
}

/**
 * Round a 0..1 share to an integer percent without ever claiming the
 * impossible-sounding "0%"/"100%" for a genuinely partial share — the same
 * display-honesty rule as {@link cacheServedPct} and `src/pr/body.ts`'s
 * `sharePct`. Shared by R1's price-delta suffix and R4's BY MODEL row.
 */
export function cacheServedText(t: TokenUsage): string | undefined {
  const pct = cacheServedPct(t);
  return pct === undefined ? undefined : `cache served ${pct}% of input tokens`;
}

/** Share of prompt-side tokens served from cache — the single most explanatory cost fact a session has. `undefined` when there is no per-turn usage (Cursor) or no prompt tokens at all. */
function cacheLine(model: ReceiptModel): string | undefined {
  if (model.unpriceable) {
    return undefined;
  }
  return cacheServedText(model.totalTokens);
}

function charCount(s: string): number {
  return [...s].length;
}

function withoutSeconds(utc: string): string {
  return utc.replace(/:\d{2} UTC$/u, " UTC");
}

/** `15h 53m 20s` → `15h 53m` — a stat line doesn't need seconds. */
export function compactDuration(duration: string): string {
  return duration.replace(/ \d{2}s$/u, "");
}

function agentTimeLine(model: ReceiptModel): string {
  const startLabel = model.startedAtMs !== undefined ? formatAbsoluteUtc(model.startedAtMs) : "start time unknown";
  const durationLabel = model.durationMs !== undefined ? formatDuration(model.durationMs) : "duration unknown";
  const full = `${model.agentLabel} · ${startLabel} · ${durationLabel}`;
  if (charCount(full) <= META_MAX) {
    return full;
  }

  const compactStart = model.startedAtMs !== undefined ? withoutSeconds(startLabel) : "unknown start";
  const compact = `${model.agentLabel} · ${compactStart} · ${compactDuration(durationLabel)}`;
  if (charCount(compact) <= META_MAX) {
    return compact;
  }

  return `${model.agentLabel} · ${compactStart}`;
}

function metaLines(model: ReceiptModel): string[] {
  const lines: string[] = [];
  const title = titleLine(model);
  if (title !== undefined) {
    lines.push(title);
  }
  lines.push(agentTimeLine(model));
  if (model.modelMix.length > 0) {
    lines.push(model.modelMix.map((m) => `${m.model} ${formatSharePercent(m.tokenShare)}`).join(" · "));
  }
  const cache = cacheLine(model);
  if (cache !== undefined) {
    lines.push(cache);
  }
  return lines;
}

/**
 * SPEC-0067 — the default-receipt pre-edit line (HIGH confidence). Uses the `$`
 * split when every usage turn priced; otherwise the always-present token split
 * (I2 — never a `$` ratio over a partial denominator). Omitted when the session
 * has no usage turns to split. Neutral wording only (I6): "pre-edit", never a
 * "tax"/"overhead"/"wasted" or any cross-session ranking.
 */
function preEditLine(model: ReceiptModel): string | undefined {
  const pe = model.costShape.preEdit;
  if (pe.totalTurnCount === 0) {
    return undefined;
  }
  if (pe.firstEditTurn === null) {
    return "pre-edit: no named edit tool observed";
  }
  const range = `${formatInt(pe.preEditTurnCount)}/${formatInt(pe.totalTurnCount)} turns`;
  return pe.preEditPct !== null
    ? `pre-edit: ${pe.preEditPct}% of priced floor (${range})`
    : `pre-edit: ${pe.preEditTokenPct}% of tokens (${range})`;
}

/** The count suffix a classic row shows (`(3 calls)` / `(2 turns)` / `(1 call)`). */
function countLabel(row: ToolRow): string {
  const unit = row.tool === THINKING_REPLY ? "turn" : "call";
  return `(${formatInt(row.callCount)} ${unit}${row.callCount === 1 ? "" : "s"})`;
}

/** One additive downward-rounded row ledger; no displayed floor can exceed its raw value. */
interface FloorAmounts {
  /** Keyed by object reference (`buildDatavis` filters `toolRows` into subsets, so a position-based lookup would misalign). */
  rows: Map<ToolRow, string>;
  /** The `SUBAGENTS (N)` row's `$` text; `undefined` when the aggregate renders tokens (I2) or the session has no children. */
  subagents?: string;
  /** Sum of the displayed row floors; therefore both additive and no greater than the raw combined subtotal. */
  total?: string;
}

function receiptFloorPrecision(model: ReceiptModel) {
  const combinedTotal = combinedPricedUsd(model);
  return usdFloorDecimals([
    ...model.toolRows.map((row) => row.usd),
    ...model.modelMix.map((entry) => entry.usd),
    model.subagents?.pricedUsd,
    combinedTotal,
  ]);
}

function floorRowText(model: ReceiptModel): FloorAmounts {
  const priced = model.toolRows.filter((r) => r.usd !== null);
  const agg = model.subagents;
  const aggPriced = agg !== undefined && agg.pricedUsd !== null;
  const precision = receiptFloorPrecision(model);
  const values = [
    ...priced.map((row) => row.usd as number),
    ...(aggPriced ? [agg.pricedUsd as number] : []),
  ];
  const combined = combinedPricedUsd(model);
  const ledger = formatUsdFloorLedger(values, precision, combined ?? undefined);
  const rows = new Map<ToolRow, string>();
  priced.forEach((row, index) => rows.set(row, ledger.amounts[index]));
  const subagents = aggPriced ? ledger.amounts[priced.length] : undefined;
  const total = combined === null
    ? undefined
    : values.length > 0
      ? ledger.total
      : formatUsdFloor(combined, precision);
  return { rows, ...(subagents !== undefined ? { subagents } : {}), ...(total !== undefined ? { total } : {}) };
}

/** SPEC-0061 R1 — the one `SUBAGENTS (N)` spend row: a readable priced child keeps its visible `$` floor even when the parent is unpriced; otherwise the row renders tokens (I2). */
function subagentRowParts(model: ReceiptModel, reconciled: FloorAmounts): { label: string; amount: string } | undefined {
  const agg = model.subagents;
  if (!agg) {
    return undefined;
  }
  const label = `SUBAGENTS (${formatInt(agg.count)})`;
  const amount = reconciled.subagents !== undefined ? `≥ $${reconciled.subagents}` : `${formatInt(agg.tokensTotal)} tok`;
  return { label, amount };
}

/** The bare amount for one tool row: `$X.XX`, `N tok`, or `""` in Cursor's degraded (per-tool tokens always zero) mode. */
function rowAmount(row: ToolRow, model: ReceiptModel, reconciled: FloorAmounts): string {
  if (model.unpriceable) {
    return "";
  }
  return row.usd !== null ? `≥ $${reconciled.rows.get(row) ?? formatUsdFloor(row.usd)}` : `${formatInt(row.tokens.total)} tok`;
}

/** The classic `.`-leader value: amount + count (or count alone in Cursor mode). */
function classicRowValue(row: ToolRow, model: ReceiptModel, reconciled: FloorAmounts): string {
  const amt = rowAmount(row, model, reconciled);
  return amt === "" ? countLabel(row) : `${amt}  ${countLabel(row)}`;
}

/**
 * The metric a datavis bar normalizes on. A parent-priced receipt scales rows
 * on dollars (an unpriced row gets an empty bar); a parent-unpriced receipt,
 * including one with a separately priced child, scales bars on token totals.
 * The child amount still carries `≥`, so bar length never mixes dollars and
 * tokens while the observable floor remains visible.
 */
function rowMetric(row: ToolRow, model: ReceiptModel): number {
  if (model.totalUsd !== null) {
    return row.usd ?? 0;
  }
  return model.unpriceable ? 0 : row.tokens.total;
}

interface TotalParts {
  label: string;
  value: string;
  knownUnpriced?: { label: string; value: string };
  note?: string;
  coverageNote?: string;
}

function totalParts(model: ReceiptModel): TotalParts {
  // SPEC-0061's mixed-coverage amendment: a priced child remains visible even
  // when the parent has no matching price row. Dollars and unpriced tokens are
  // separate facts; neither is allowed to masquerade as an invoice total.
  const agg = model.subagents;
  const combinedUsd = combinedPricedUsd(model);
  if (combinedUsd !== null) {
    const displayTotal = floorRowText(model).total ?? formatUsdFloor(combinedUsd, receiptFloorPrecision(model));
    if (combinedPricingCoverageOf(model) === "partial") {
      const knownUnpriced = knownCombinedUnpricedTokens(model);
      return {
        label: "KNOWN PRICED SUBTOTAL",
        value: `≥ $${displayTotal}`,
        ...(knownUnpriced.total > 0
          ? {
              knownUnpriced: {
                label: "KNOWN UNPRICED TOKENS",
                value: `${formatInt(knownUnpriced.total)} tok`,
              },
            }
          : {}),
        note: STANDARD_API_LOWER_BOUND_NOTE,
        coverageNote: "partial pricing coverage; invoice total unknown",
      };
    }
    return { label: "TOTAL", value: `≥ $${displayTotal}`, note: STANDARD_API_LOWER_BOUND_NOTE };
  }
  if (model.unpriceable) {
    return {
      label: "TOTAL",
      value: `${formatInt(model.sessionTotalTokens.total + (agg?.tokensTotal ?? 0))} tok`,
      note: CURSOR_DEGRADED_NOTE,
    };
  }
  return {
    label: "TOTAL",
    value: `${formatInt(model.totalTokens.total + (agg?.tokensTotal ?? 0))} tok`,
    note: NO_PRICE_MATCH_NOTE,
  };
}

/**
 * The `same tokens on <model>` price-delta value, or `undefined` when the
 * session did not price. SPEC-0054 R1: when the observable-floor delta is
 * positive (`actualUsd > 0` and `usd < actualUsd`), a separate percentage note keeps
 * the full model id visible inside the 50-column receipt. The percentage is
 * arithmetic on the already-traced observable floors, not a new dollar.
 */
function priceDeltaParts(model: ReceiptModel): { label: string; value: string; percentageNote?: string } | undefined {
  if (!model.priceDelta) {
    return undefined;
  }
  // SPEC-0061 — the delta re-prices the PARENT session's tokens only; under a
  // TOTAL that includes priced children, the line (and its `% less`) would read
  // against the wrong base. Suppress rather than mislead (I3); `--json` still
  // carries the labeled usd/actualUsd pair.
  if (model.subagents !== undefined && model.subagents.pricedUsd !== null) {
    return undefined;
  }
  const { cheaperModel, usd } = model.priceDelta;
  const baselineUsd = model.priceDelta.baselineUsd ?? model.priceDelta.actualUsd;
  const percentageNote = baselineUsd > 0 && usd < baselineUsd
    ? `(${formatSharePercent((baselineUsd - usd) / baselineUsd)} lower observable floor)`
    : undefined;
  return { label: `same tokens on ${cheaperModel}`, value: formatUsdLowerBound(usd), percentageNote };
}

/** SPEC-0054 R2 — the stuck-loop turn location, 1-based (`turnIndices` is 0-based): `at turn N` for a single turn, `at turns A-B` for a span. */
function stuckLoopDetail(turnIndices: number[]): string | undefined {
  if (turnIndices.length === 0) {
    return undefined;
  }
  const min = Math.min(...turnIndices) + 1;
  const max = Math.max(...turnIndices) + 1;
  return min === max ? `at turn ${min}` : `at turns ${min}-${max}`;
}

/**
 * A classic waste block: stuck-loop carries the ⚠ badge, trivial-spans carries
 * the `≈` label and a detail sub-line. Exported for SPEC-0059 R3 — the savings
 * slip renders its evidence lines from these exact blocks, so glyphs, labels,
 * and values are never duplicated as strings across the two surfaces.
 */
export function wasteRowBlock(waste: WasteLine): Extract<Block, { kind: "wasteRow" }> {
  if (waste.kind === "stuck-loop") {
    const valuePart = waste.usd !== null ? formatUsdLowerBound(waste.usd) : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? ` (${formatDuration(waste.wallClockMs)})` : "";
    const detail = stuckLoopDetail(waste.turnIndices);
    return {
      kind: "wasteRow",
      label: `${waste.tool} loop ×${waste.runLength}`,
      value: valuePart + clockPart,
      badge: true,
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  if (waste.kind === "context-thrash") {
    // R7 compact form keeps the full count and lower-bound amount inside 50 columns.
    // Value is $ when priced, tokens otherwise (I2 — a tokens-only line when any
    // contributing turn is unpriced or the session never priced).
    const value = waste.usd !== null ? formatUsdLowerBound(waste.usd) : `${formatInt(waste.tokens.total)} tok`;
    return {
      kind: "wasteRow",
      label: `≈ context thrash: ${waste.compactionCount} compactions (${waste.turnSpan}t)`,
      value,
      detail: CONTEXT_THRASH_NOTE,
      badge: false,
    };
  }
  return {
    kind: "wasteRow",
    label: TRIVIAL_SPANS_LABEL,
    value: `≈ $${formatUsdFloor(waste.usd)}`,
    detail: `(${waste.eligibleTurnCount} tiny turns, priced at ${waste.cheaperModel})`,
    badge: false,
  };
}

// --- DETAILS section (R4, opt-in, classic-only) ------------------------------

/** The token composition DETAILS reads from: real per-turn totals normally, session totals for Cursor's degraded mode (its per-turn usage is always absent). */
function detailsTokens(model: ReceiptModel): TokenUsage {
  return model.unpriceable ? model.sessionTotalTokens : model.totalTokens;
}

/**
 * BY MODEL rows independently round down so every `≥` remains true. An
 * unpriced entry renders its token share instead of a fabricated dollar (I2).
 */
function byModelRows(model: ReceiptModel): Block[] {
  const priced = model.modelMix.filter((m) => m.usd !== null);
  const precision = receiptFloorPrecision(model);
  const ledger = formatUsdFloorLedger(priced.map((m) => m.usd as number), precision);
  const centText = new Map<ModelMixEntry, string>();
  priced.forEach((m, index) => centText.set(m, ledger.amounts[index]));
  return model.modelMix.map((m): Block => {
    const pct = formatSharePercent(m.tokenShare);
    const value = m.usd !== null ? `${pct} · ≥ $${centText.get(m)}` : `${pct} · ${formatShortTokens(m.tokens.total)} tok`;
    return { kind: "row", label: m.model, value };
  });
}

/**
 * SPEC-0054 R4 — the opt-in `DETAILS` section (`--details`), classic-only.
 * Built entirely from `note`/`row` blocks (no new `Block` kind). Every line is
 * omitted when its underlying data is absent — never a fabricated 0 (I2).
 * Exported so tests can assert its output directly.
 */
export function detailsBlocks(model: ReceiptModel): Block[] {
  const blocks: Block[] = [{ kind: "note", text: "DETAILS", spaceBefore: true }];
  const tokens = detailsTokens(model);

  if (tokens.input + tokens.output > 0) {
    blocks.push({ kind: "row", label: "tokens in / out", value: `${formatShortTokens(tokens.input)} / ${formatShortTokens(tokens.output)}` });
  }
  if (tokens.cacheRead + tokens.cacheCreation > 0) {
    blocks.push({ kind: "row", label: "cache read / write", value: `${formatShortTokens(tokens.cacheRead)} / ${formatShortTokens(tokens.cacheCreation)}` });
    // TTL sub-line carries only the tiers the transcript actually reported —
    // an absent tier is unknown, never a fabricated 0 (I2's tier-unknown-vs-zero
    // distinction, parse/types.ts).
    const tiers: string[] = [];
    if (tokens.cacheCreation5m !== undefined) {
      tiers.push(`5m ${formatShortTokens(tokens.cacheCreation5m)}`);
    }
    if (tokens.cacheCreation1h !== undefined) {
      tiers.push(`1h ${formatShortTokens(tokens.cacheCreation1h)}`);
    }
    if (tiers.length > 0) {
      blocks.push({ kind: "note", text: `writes: ${tiers.join(" · ")}`, indent: 2, muted: true });
    }
  }
  blocks.push({ kind: "row", label: "turns / tool calls", value: `${formatInt(model.turnCount)} / ${formatInt(model.toolCallCount)}` });
  if (model.peakTurn) {
    blocks.push({ kind: "row", label: "peak turn", value: `${formatShortTokens(model.peakTurn.tokens)} tok (turn ${model.peakTurn.turnNumber})` });
  }
  // SPEC-0067 — expensive-turn concentration (HIGH) and late-turn cost ratio
  // (LOW confidence; a neutral ratio, never a "context growth" cause). Details-only.
  if (model.costShape.topTurns) {
    const ts = model.costShape.topTurns;
    blocks.push({ kind: "row", label: "top 3 turns", value: `${ts.sharePct}% (turns ${ts.indices.join(",")})` });
  }
  if (model.costShape.lateTurn) {
    blocks.push({ kind: "row", label: "late-turn", value: `${model.costShape.lateTurn.lateRatio}× late/early (low conf)` });
    // R-conf/R4b — disclose WHY confidence is low: the ratio mixes output,
    // cache-write, and model switches, so it is not a context-growth measure (Codex #4).
    blocks.push({ kind: "note", text: "(ratio only — mixes output/cache/model)", indent: 2, muted: true });
  }
  // SPEC-0068 — same-file re-reads: a LOW-confidence neutral diagnostic (never a
  // "wasted"/savings claim; it is not a WasteLine and never enters savings math).
  if (model.sameFileReReads) {
    const r = model.sameFileReReads;
    blocks.push({ kind: "row", label: "same-file re-reads", value: `${formatInt(r.count)} · ${formatShortTokens(r.tokens.total)} tok` });
    blocks.push({ kind: "note", text: "(no recorded edit/shell/compaction between)", indent: 2, muted: true });
    blocks.push({ kind: "note", text: "(low conf — may be legitimate re-grounding)", indent: 2, muted: true });
  }
  if (model.cacheReadAtInputRateUsd !== null) {
    blocks.push({ kind: "row", label: "same reads at uncached input rate", value: formatUsdLowerBound(model.cacheReadAtInputRateUsd) });
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  if (model.totalUsd !== null && model.modelMix.length > 1) {
    blocks.push({ kind: "note", text: model.subagents ? "BY PARENT MODEL" : "BY MODEL" });
    blocks.push(...byModelRows(model));
  }
  return blocks;
}

// --- Shared tail: rule → total → price-delta → footer -----------------------

/** SPEC-0028 R3 — muted time-integrity caveat notes; empty for consistent sessions so existing renders stay byte-identical (I5). */
function caveatBlocks(model: ReceiptModel): Block[] {
  return model.caveats.map((c, i): Block => ({ kind: "note", text: c.text, muted: true, spaceBefore: i === 0 }));
}

/**
 * The rule/total/price-delta/footer/provenance sequence every template ends its body with
 * (honesty invariants live here — I3; SPEC-0055: the card carries no
 * methodology footnote — the full methodology is one flag away,
 * `aireceipts --methodology`, and ships in `--json`). `extra` (SPEC-0054 R4's
 * DETAILS blocks, classic-only) inserts between the price-delta block and the
 * footer.
 */
function tailBlocks(model: ReceiptModel, footer: Block, extra?: Block[]): Block[] {
  const blocks: Block[] = [];
  blocks.push(...caveatBlocks(model));
  const total = totalParts(model);
  blocks.push({ kind: "rule" });
  blocks.push({ kind: "total", label: total.label, value: total.value });
  if (total.knownUnpriced !== undefined) {
    blocks.push({ kind: "total", label: total.knownUnpriced.label, value: total.knownUnpriced.value });
  }
  if (total.note !== undefined) {
    blocks.push({ kind: "note", text: total.note });
  }
  if (total.coverageNote !== undefined) {
    blocks.push({ kind: "note", text: total.coverageNote });
  }
  const delta = priceDeltaParts(model);
  if (delta) {
    blocks.push({ kind: "row", label: delta.label, value: delta.value, muted: true });
    if (delta.percentageNote) {
      blocks.push({ kind: "note", text: delta.percentageNote, indent: 2, muted: true });
    }
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  if (extra) {
    blocks.push(...extra);
  }
  blocks.push(footer, { kind: "note", text: REPOSITORY_DISPLAY, align: "center", muted: true });
  return blocks;
}

// --- classic (default; byte-identical to pre-SPEC-0020) ----------------------

function buildClassic(model: ReceiptModel, view?: { details?: boolean }): Block[] {
  const reconciled = floorRowText(model);
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
  ];
  const preEdit = preEditLine(model);
  if (preEdit !== undefined) {
    blocks.push({ kind: "note", text: preEdit, spaceBefore: true });
    // R1/R5 (I3) — disclose the split is around the first NAMED edit tool, so
    // shell/vendor mutations are not implied to be captured (Codex #3).
    blocks.push({ kind: "note", text: "(share before the first named edit tool)", indent: 2, muted: true });
  }
  model.toolRows.forEach((row, i) => {
    blocks.push({ kind: "row", label: row.tool, value: classicRowValue(row, model, reconciled), spaceBefore: i === 0 });
  });
  const subagents = subagentRowParts(model, reconciled);
  if (subagents) {
    // SPEC-0061 R1 — the last spend row: after tool rows, before waste rows.
    blocks.push({ kind: "row", label: subagents.label, value: subagents.amount, spaceBefore: model.toolRows.length === 0 });
  }
  model.wasteLines.forEach((waste, i) => {
    const block = wasteRowBlock(waste);
    blocks.push(i === 0 ? { ...block, spaceBefore: true } : block);
  });
  const extra = view?.details ? detailsBlocks(model) : undefined;
  blocks.push(...tailBlocks(model, { kind: "footer", text: INSTALL_FOOTER_TEXT }, extra));
  return blocks;
}

// --- grocery (the shareable meme; Receiptify column mechanics) ---------------

function buildGrocery(model: ReceiptModel): Block[] {
  const reconciled = floorRowText(model);
  const dominantModel = model.modelMix[0]?.model ?? "unknown";
  const token = sessionToken(model.sessionId);
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
    { kind: "note", text: `TXN #${token}`, spaceBefore: true },
    { kind: "columnHeader", item: "ITEM", qty: "QTY", amt: "AMT" },
  ];
  for (const row of model.toolRows) {
    const amt = rowAmount(row, model, reconciled);
    blocks.push({ kind: "row", label: row.tool, value: amt, columns: { qty: formatInt(row.callCount), amt } });
  }
  const subagents = subagentRowParts(model, reconciled);
  if (subagents) {
    // SPEC-0061 R1 — qty carries the child count; amt the aggregate.
    blocks.push({ kind: "row", label: "SUBAGENTS", value: subagents.amount, columns: { qty: formatInt(model.subagents?.count ?? 0), amt: subagents.amount } });
  }
  if (model.wasteLines.length > 0) {
    blocks.push({ kind: "note", text: "--- RETURN/REFUND ---", align: "center", spaceBefore: true });
    model.wasteLines.forEach((waste) => {
      // grocery frames waste as a refund line (no ⚠ badge); the ≈ label + numbers carry through unchanged.
      blocks.push({ ...wasteRowBlock(waste), badge: false });
    });
  }
  blocks.push(...caveatBlocks(model));
  const total = totalParts(model);
  blocks.push({ kind: "rule" });
  blocks.push({ kind: "total", label: total.label, value: total.value, columns: { qty: "", amt: total.value } });
  if (total.knownUnpriced !== undefined) {
    blocks.push({
      kind: "total",
      label: total.knownUnpriced.label,
      value: total.knownUnpriced.value,
      columns: { qty: "", amt: total.knownUnpriced.value },
    });
  }
  if (total.note !== undefined) {
    blocks.push({ kind: "note", text: total.note });
  }
  if (total.coverageNote !== undefined) {
    blocks.push({ kind: "note", text: total.coverageNote });
  }
  const delta = priceDeltaParts(model);
  if (delta) {
    blocks.push({ kind: "row", label: delta.label, value: delta.value, muted: true });
    if (delta.percentageNote) {
      blocks.push({ kind: "note", text: delta.percentageNote, indent: 2, muted: true });
    }
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  blocks.push({ kind: "note", text: `CARDHOLDER: ${dominantModel}`, spaceBefore: true });
  blocks.push({ kind: "footer", text: `THANK YOU FOR VIBING WITH ${model.agentLabel}` });
  blocks.push({ kind: "barcode", pattern: barcodePattern(token) });
  blocks.push({ kind: "footer", text: INSTALL_FOOTER_TEXT, stamp: false });
  blocks.push({ kind: "note", text: REPOSITORY_DISPLAY, align: "center", muted: true });
  return blocks;
}

// --- datavis (Susie Lu's heirs; bars yes, bubbles no) ------------------------

const DATAVIS_PRICE_LEGEND = "[##########] = priciest line; others in proportion";
const DATAVIS_TOKEN_LEGEND = "[##########] = most tokens; others in proportion";

function datavisRowBlock(row: ToolRow, model: ReceiptModel, max: number, reconciled: FloorAmounts): Block {
  const amt = rowAmount(row, model, reconciled);
  const bar = normalizedBar(rowMetric(row, model), max);
  const value = amt === "" ? bar : `${amt} ${bar}`;
  return { kind: "row", label: row.tool, value };
}

/** SPEC-0061 — the datavis metric for the subagent aggregate. A mixed parent/child receipt uses token-length bars while keeping the child's priced amount as separate text. */
function subagentMetric(model: ReceiptModel): number {
  const agg = model.subagents;
  if (!agg) {
    return 0;
  }
  if (model.totalUsd !== null) {
    return agg.pricedUsd ?? 0;
  }
  return model.unpriceable ? 0 : agg.tokensTotal;
}

function buildDatavis(model: ReceiptModel): Block[] {
  const reconciled = floorRowText(model);
  const max = model.toolRows.reduce((m, row) => Math.max(m, rowMetric(row, model)), subagentMetric(model));
  const modelOutput = model.toolRows.filter((r) => r.tool === THINKING_REPLY);
  const toolCalls = model.toolRows.filter((r) => r.tool !== THINKING_REPLY);

  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
    {
      kind: "note",
      text: model.totalUsd === null && model.subagents?.pricedUsd !== null && model.subagents?.pricedUsd !== undefined
        ? DATAVIS_TOKEN_LEGEND
        : DATAVIS_PRICE_LEGEND,
      spaceBefore: true,
    },
  ];
  if (modelOutput.length > 0) {
    blocks.push({ kind: "note", text: "--- MODEL OUTPUT ---", spaceBefore: true });
    for (const row of modelOutput) {
      blocks.push(datavisRowBlock(row, model, max, reconciled));
    }
  }
  if (toolCalls.length > 0) {
    blocks.push({ kind: "note", text: "--- TOOL CALLS ---", spaceBefore: true });
    for (const row of toolCalls) {
      blocks.push(datavisRowBlock(row, model, max, reconciled));
    }
  }
  const subagents = subagentRowParts(model, reconciled);
  if (subagents) {
    const bar = normalizedBar(subagentMetric(model), max);
    blocks.push({ kind: "note", text: "--- SUBAGENTS ---", spaceBefore: true });
    blocks.push({ kind: "row", label: subagents.label, value: `${subagents.amount} ${bar}` });
  }
  model.wasteLines.forEach((waste, i) => {
    const block = wasteRowBlock(waste);
    blocks.push(i === 0 ? { ...block, spaceBefore: true } : block);
  });
  blocks.push(...tailBlocks(model, { kind: "footer", text: INSTALL_FOOTER_TEXT }));
  return blocks;
}

const BUILDERS: Record<TemplateName, (model: ReceiptModel, view?: { details?: boolean }) => Block[]> = {
  classic: buildClassic,
  grocery: buildGrocery,
  datavis: buildDatavis,
};

/**
 * Build the shared, layout-agnostic block list a renderer formats. Pure over
 * the already-priced {@link ReceiptModel} — no pricing/attribution here.
 * `view.details` (SPEC-0054 R4/R6) is honored by `classic` only; `grocery`
 * and `datavis` ignore it — the CLI guards the combination.
 */
export function buildReceiptView(model: ReceiptModel, template: TemplateName = "classic", view?: { details?: boolean }): ReceiptView {
  return { template, blocks: BUILDERS[template](model, view) };
}
