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
  reconciledModelCents,
  sessionToken,
} from "./blocks.js";
import type { Block, ReceiptView, TemplateName } from "./blocks.js";
import { formatAbsoluteUtc, formatCentsAmount, formatDuration, formatInt, formatShortTokens, formatUsd, reconcileCents } from "./format.js";
import type { ModelMixEntry, ReceiptModel, ToolRow, WasteLine } from "./model.js";
import type { TokenUsage } from "../parse/types.js";

export type { ReceiptView } from "./blocks.js";
export { PRICE_DELTA_NOTE, TRIVIAL_SPANS_LABEL } from "./blocks.js";

/** Exact wording required by SPEC-0001 R1's Cursor scenario — never paraphrased. */
export const CURSOR_DEGRADED_NOTE = "Cursor transcripts carry no per-turn model/usage — totals only.";

export const NO_PRICE_MATCH_NOTE = "no price table matched";

const WORDMARK = "AIRECEIPTS";
const FOOTER_TEXT = "aireceipts · local · npx aireceipts-cli";
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
function honestPct(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct <= 0 && ratio > 0) {
    return "<1";
  }
  if (pct >= 100 && ratio < 1) {
    return ">99";
  }
  return String(pct);
}

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
    lines.push(model.modelMix.map((m) => `${m.model} ${Math.round(m.tokenShare * 100)}%`).join(" · "));
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
    ? `pre-edit: ${pe.preEditPct}% of cost (${range})`
    : `pre-edit: ${pe.preEditTokenPct}% of tokens (${range})`;
}

/** The count suffix a classic row shows (`(3 calls)` / `(2 turns)` / `(1 call)`). */
function countLabel(row: ToolRow): string {
  const unit = row.tool === THINKING_REPLY ? "turn" : "call";
  return `(${formatInt(row.callCount)} ${unit}${row.callCount === 1 ? "" : "s"})`;
}

/** B1/SPEC-0061 — the cent-reconciliation result: every priced tool row's display string plus, when the subagent aggregate is priced on a priced receipt, its own reconciled amount from the SAME cents universe — so the rows a receipt draws still sum byte-exactly to TOTAL. */
interface ReconciledAmounts {
  /** Keyed by object reference (`buildDatavis` filters `toolRows` into subsets, so a position-based lookup would misalign). */
  rows: Map<ToolRow, string>;
  /** The `SUBAGENTS (N)` row's `$` text; `undefined` when the aggregate renders tokens (I2) or the session has no children. */
  subagents?: string;
}

function reconciledRowText(model: ReceiptModel): ReconciledAmounts {
  const priced = model.toolRows.filter((r) => r.usd !== null);
  const values = priced.map((r) => r.usd as number);
  const agg = model.subagents;
  const aggPriced = agg !== undefined && agg.pricedUsd !== null && model.totalUsd !== null;
  if (aggPriced) {
    values.push(agg.pricedUsd as number);
  }
  const cents = reconcileCents(values);
  const rows = new Map<ToolRow, string>();
  priced.forEach((row, i) => rows.set(row, formatCentsAmount(cents[i])));
  return { rows, ...(aggPriced ? { subagents: formatCentsAmount(cents[priced.length]) } : {}) };
}

/** SPEC-0061 R1 — the one `SUBAGENTS (N)` spend row: `$` only when the aggregate joined the reconciled universe; tokens otherwise (I2). `undefined` when the session has no children, keeping every existing render byte-identical (I5). */
function subagentRowParts(model: ReceiptModel, reconciled: ReconciledAmounts): { label: string; amount: string } | undefined {
  const agg = model.subagents;
  if (!agg) {
    return undefined;
  }
  const label = `SUBAGENTS (${formatInt(agg.count)})`;
  const amount = reconciled.subagents !== undefined ? `$${reconciled.subagents}` : `${formatInt(agg.tokensTotal)} tok`;
  return { label, amount };
}

/** The bare amount for one tool row: `$X.XX`, `N tok`, or `""` in Cursor's degraded (per-tool tokens always zero) mode. */
function rowAmount(row: ToolRow, model: ReceiptModel, reconciled: ReconciledAmounts): string {
  if (model.unpriceable) {
    return "";
  }
  return row.usd !== null ? `$${reconciled.rows.get(row) ?? formatUsd(row.usd)}` : `${formatInt(row.tokens.total)} tok`;
}

/** The classic `.`-leader value: amount + count (or count alone in Cursor mode). */
function classicRowValue(row: ToolRow, model: ReceiptModel, reconciled: ReconciledAmounts): string {
  const amt = rowAmount(row, model, reconciled);
  return amt === "" ? countLabel(row) : `${amt}  ${countLabel(row)}`;
}

/**
 * The metric a datavis bar normalizes on. One unit per receipt, never mixed: a
 * priced receipt scales every bar on dollars (an unpriced row in an otherwise
 * priced session gets an empty bar — its tokens are not comparable to dollars),
 * and a fully-unpriced receipt scales on token totals. This is what stops a
 * large token count from rendering a full bar next to a real dollar row.
 */
function rowMetric(row: ToolRow, model: ReceiptModel): number {
  if (model.totalUsd !== null) {
    return row.usd ?? 0;
  }
  return model.unpriceable ? 0 : row.tokens.total;
}

interface TotalParts {
  value: string;
  note?: string;
}

function totalParts(model: ReceiptModel): TotalParts {
  if (model.unpriceable) {
    return { value: `${formatInt(model.sessionTotalTokens.total)} tok`, note: CURSOR_DEGRADED_NOTE };
  }
  // SPEC-0061 R1 — TOTAL covers parent + subagent aggregate: priced children join
  // the `$` sum; on an unpriced receipt children join the token count. Unpriced
  // children under a priced total stay out of the `$` (their floor caveat says so).
  const agg = model.subagents;
  if (model.totalUsd !== null) {
    return { value: `$${formatUsd(model.totalUsd + (agg?.pricedUsd ?? 0))}` };
  }
  return { value: `${formatInt(model.totalTokens.total + (agg?.tokensTotal ?? 0))} tok`, note: NO_PRICE_MATCH_NOTE };
}

/**
 * The `same tokens on <model>` price-delta value, or `undefined` when the
 * session did not price. SPEC-0054 R1: when the delta is real savings
 * (`actualUsd > 0` and `usd < actualUsd`), the value gains a `(N% less)`
 * suffix — arithmetic on the already-traced `usd`/`actualUsd` pair, not a new
 * dollar figure, so the honesty battery's allowlist needs no change.
 */
function priceDeltaParts(model: ReceiptModel): { label: string; value: string } | undefined {
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
  const { cheaperModel, usd, actualUsd } = model.priceDelta;
  const suffix = actualUsd > 0 && usd < actualUsd ? ` (${honestPct((actualUsd - usd) / actualUsd)}% less)` : "";
  return { label: `same tokens on ${cheaperModel}`, value: `$${formatUsd(usd)}${suffix}` };
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
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
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
    // R7: `≈ context thrash: N compactions in M turns` + a methodology sub-line.
    // Value is $ when priced, tokens otherwise (I2 — a tokens-only line when any
    // contributing turn is unpriced or the session never priced).
    const value = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    return {
      kind: "wasteRow",
      label: `≈ context thrash: ${waste.compactionCount} compactions in ${waste.turnSpan} turns`,
      value,
      detail: CONTEXT_THRASH_NOTE,
      badge: false,
    };
  }
  return {
    kind: "wasteRow",
    label: TRIVIAL_SPANS_LABEL,
    value: `$${formatUsd(waste.usd)}`,
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
 * BY MODEL rows, cent-reconciled across priced entries only (same
 * `reconcileCents` universe {@link reconciledRowText} uses for tool rows) so
 * the displayed rows sum to the displayed TOTAL; an unpriced entry (a
 * Cursor-style per-model gap) renders its token share instead of a fabricated
 * `$` (I2).
 */
function byModelRows(model: ReceiptModel): Block[] {
  const priced = model.modelMix.filter((m) => m.usd !== null);
  const cents = reconciledModelCents(model);
  const centText = new Map<ModelMixEntry, string>();
  priced.forEach((m, i) => centText.set(m, formatCentsAmount(cents[i])));
  return model.modelMix.map((m): Block => {
    const pct = honestPct(m.tokenShare);
    const value = m.usd !== null ? `${pct}% · $${centText.get(m)}` : `${pct}% · ${formatShortTokens(m.tokens.total)} tok`;
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
  if (model.cacheReadAtInputRateUsd !== null) {
    blocks.push({ kind: "row", label: "same reads at uncached input rate", value: `$${formatUsd(model.cacheReadAtInputRateUsd)}` });
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  if (model.totalUsd !== null && model.modelMix.length > 1) {
    blocks.push({ kind: "note", text: "BY MODEL" });
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
 * The rule/total/price-delta/footer sequence every template ends its body with
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
  blocks.push({ kind: "total", label: "TOTAL", value: total.value });
  if (total.note !== undefined) {
    blocks.push({ kind: "note", text: total.note });
  }
  const delta = priceDeltaParts(model);
  if (delta) {
    blocks.push({ kind: "row", label: delta.label, value: delta.value, muted: true });
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  if (extra) {
    blocks.push(...extra);
  }
  blocks.push(footer);
  return blocks;
}

// --- classic (default; byte-identical to pre-SPEC-0020) ----------------------

function buildClassic(model: ReceiptModel, view?: { details?: boolean }): Block[] {
  const reconciled = reconciledRowText(model);
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
  blocks.push(...tailBlocks(model, { kind: "footer", text: FOOTER_TEXT }, extra));
  return blocks;
}

// --- grocery (the shareable meme; Receiptify column mechanics) ---------------

function buildGrocery(model: ReceiptModel): Block[] {
  const reconciled = reconciledRowText(model);
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
  blocks.push({ kind: "total", label: "TOTAL", value: total.value, columns: { qty: "", amt: total.value } });
  if (total.note !== undefined) {
    blocks.push({ kind: "note", text: total.note });
  }
  const delta = priceDeltaParts(model);
  if (delta) {
    blocks.push({ kind: "row", label: delta.label, value: delta.value, muted: true });
    blocks.push({ kind: "note", text: PRICE_DELTA_NOTE, indent: 2, muted: true });
  }
  blocks.push({ kind: "note", text: `CARDHOLDER: ${dominantModel}`, spaceBefore: true });
  blocks.push({ kind: "footer", text: `THANK YOU FOR VIBING WITH ${model.agentLabel}` });
  blocks.push({ kind: "barcode", pattern: barcodePattern(token) });
  return blocks;
}

// --- datavis (Susie Lu's heirs; bars yes, bubbles no) ------------------------

const DATAVIS_LEGEND = "[##########] = priciest line; others in proportion";

function datavisRowBlock(row: ToolRow, model: ReceiptModel, max: number, reconciled: ReconciledAmounts): Block {
  const amt = rowAmount(row, model, reconciled);
  const bar = normalizedBar(rowMetric(row, model), max);
  const value = amt === "" ? bar : `${amt} ${bar}`;
  return { kind: "row", label: row.tool, value };
}

/** SPEC-0061 — the datavis metric for the subagent aggregate, on the same one-unit-per-receipt rule as {@link rowMetric}. */
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
  const reconciled = reconciledRowText(model);
  const max = model.toolRows.reduce((m, row) => Math.max(m, rowMetric(row, model)), subagentMetric(model));
  const modelOutput = model.toolRows.filter((r) => r.tool === THINKING_REPLY);
  const toolCalls = model.toolRows.filter((r) => r.tool !== THINKING_REPLY);

  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
    { kind: "note", text: DATAVIS_LEGEND, spaceBefore: true },
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
  blocks.push(...tailBlocks(model, { kind: "footer", text: FOOTER_TEXT }));
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
