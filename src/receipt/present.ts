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
import { METHODOLOGY_BRIEF } from "../pricing/attribution.js";
import {
  CONTEXT_THRASH_NOTE,
  PRICE_DELTA_NOTE,
  TRIVIAL_SPANS_LABEL,
  barcodePattern,
  normalizedBar,
  sessionToken,
} from "./blocks.js";
import type { Block, ReceiptView, TemplateName } from "./blocks.js";
import { formatAbsoluteUtc, formatDuration, formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, ToolRow, WasteLine } from "./model.js";

export type { ReceiptView } from "./blocks.js";
export { PRICE_DELTA_NOTE, TRIVIAL_SPANS_LABEL } from "./blocks.js";

/** Exact wording required by SPEC-0001 R1's Cursor scenario — never paraphrased. */
export const CURSOR_DEGRADED_NOTE = "Cursor transcripts carry no per-turn model/usage — totals only.";

export const NO_PRICE_MATCH_NOTE = "no price table matched";

const WORDMARK = "AIRECEIPTS";
const FOOTER_TEXT = "aireceipts · local · buy me a samosa";
const FOOTER_EMOJI = "🥟";
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

/** Share of prompt-side tokens served from cache — the single most explanatory cost fact a session has. `undefined` when there is no per-turn usage (Cursor) or no prompt tokens at all. */
function cacheLine(model: ReceiptModel): string | undefined {
  if (model.unpriceable) {
    return undefined;
  }
  const t = model.totalTokens;
  const promptSide = t.input + t.cacheRead + t.cacheCreation;
  if (promptSide <= 0 || t.cacheRead <= 0) {
    return undefined;
  }
  const ratio = t.cacheRead / promptSide;
  // Display honesty: never round a partial ratio up to the impossible-sounding
  // "100%" — a real session always has SOME uncached prompt. True 100% (synthetic
  // fixtures) may say it; 99.5%+ says ">99%".
  const pct = ratio >= 1 ? "100" : Math.round(ratio * 100) >= 100 ? ">99" : String(Math.round(ratio * 100));
  return `cache served ${pct}% of input tokens`;
}

function charCount(s: string): number {
  return [...s].length;
}

function withoutSeconds(utc: string): string {
  return utc.replace(/:\d{2} UTC$/u, " UTC");
}

function compactDuration(duration: string): string {
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

/** The count suffix a classic row shows (`(3 calls)` / `(2 turns)` / `(1 call)`). */
function countLabel(row: ToolRow): string {
  const unit = row.tool === THINKING_REPLY ? "turn" : "call";
  return `(${formatInt(row.callCount)} ${unit}${row.callCount === 1 ? "" : "s"})`;
}

/** The bare amount for one tool row: `$X.XX`, `N tok`, or `""` in Cursor's degraded (per-tool tokens always zero) mode. */
function rowAmount(row: ToolRow, model: ReceiptModel): string {
  if (model.unpriceable) {
    return "";
  }
  return row.usd !== null ? `$${formatUsd(row.usd)}` : `${formatInt(row.tokens.total)} tok`;
}

/** The classic `.`-leader value: amount + count (or count alone in Cursor mode). */
function classicRowValue(row: ToolRow, model: ReceiptModel): string {
  const amt = rowAmount(row, model);
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
  if (model.totalUsd !== null) {
    return { value: `$${formatUsd(model.totalUsd)}` };
  }
  return { value: `${formatInt(model.totalTokens.total)} tok`, note: NO_PRICE_MATCH_NOTE };
}

/** The `same tokens on <model>` price-delta value, or `undefined` when the session did not price. */
function priceDeltaParts(model: ReceiptModel): { label: string; value: string } | undefined {
  if (!model.priceDelta) {
    return undefined;
  }
  return { label: `same tokens on ${model.priceDelta.cheaperModel}`, value: `$${formatUsd(model.priceDelta.usd)}` };
}

/** A classic waste block: stuck-loop carries the ⚠ badge, trivial-spans carries the `≈` label and a detail sub-line. */
function classicWasteBlock(waste: WasteLine): Extract<Block, { kind: "wasteRow" }> {
  if (waste.kind === "stuck-loop") {
    const valuePart = waste.usd !== null ? `$${formatUsd(waste.usd)}` : `${formatInt(waste.tokens.total)} tok`;
    const clockPart = waste.wallClockMs !== null ? ` (${formatDuration(waste.wallClockMs)})` : "";
    return { kind: "wasteRow", label: `${waste.tool} loop ×${waste.runLength}`, value: valuePart + clockPart, badge: true };
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

// --- Shared tail: rule → total → price-delta → methodology footnote ----------

/** The rule/total/price-delta/footnote sequence every template ends its body with (honesty invariants live here — I3). */
function tailBlocks(model: ReceiptModel, footer: Block): Block[] {
  const blocks: Block[] = [];
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
  blocks.push({ kind: "footnote", text: METHODOLOGY_BRIEF, spaceBefore: true });
  blocks.push(footer);
  return blocks;
}

// --- classic (default; byte-identical to pre-SPEC-0020) ----------------------

function buildClassic(model: ReceiptModel): Block[] {
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
  ];
  model.toolRows.forEach((row, i) => {
    blocks.push({ kind: "row", label: row.tool, value: classicRowValue(row, model), spaceBefore: i === 0 });
  });
  model.wasteLines.forEach((waste, i) => {
    const block = classicWasteBlock(waste);
    blocks.push(i === 0 ? { ...block, spaceBefore: true } : block);
  });
  blocks.push(...tailBlocks(model, { kind: "footer", text: FOOTER_TEXT, emoji: FOOTER_EMOJI }));
  return blocks;
}

// --- grocery (the shareable meme; Receiptify column mechanics) ---------------

function buildGrocery(model: ReceiptModel): Block[] {
  const dominantModel = model.modelMix[0]?.model ?? "unknown";
  const token = sessionToken(model.sessionId);
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: metaLines(model) },
    { kind: "note", text: `TXN #${token}`, spaceBefore: true },
    { kind: "columnHeader", item: "ITEM", qty: "QTY", amt: "AMT" },
  ];
  for (const row of model.toolRows) {
    const amt = rowAmount(row, model);
    blocks.push({ kind: "row", label: row.tool, value: amt, columns: { qty: formatInt(row.callCount), amt } });
  }
  if (model.wasteLines.length > 0) {
    blocks.push({ kind: "note", text: "--- RETURN/REFUND ---", align: "center", spaceBefore: true });
    model.wasteLines.forEach((waste) => {
      // grocery frames waste as a refund line (no ⚠ badge); the ≈ label + numbers carry through unchanged.
      blocks.push({ ...classicWasteBlock(waste), badge: false });
    });
  }
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
  blocks.push({ kind: "footnote", text: METHODOLOGY_BRIEF, spaceBefore: true });
  blocks.push({ kind: "footer", text: `THANK YOU FOR VIBING WITH ${model.agentLabel}` });
  blocks.push({ kind: "barcode", pattern: barcodePattern(token) });
  return blocks;
}

// --- datavis (Susie Lu's heirs; bars yes, bubbles no) ------------------------

const DATAVIS_LEGEND = "[##########] = priciest line; others in proportion";

function datavisRowBlock(row: ToolRow, model: ReceiptModel, max: number): Block {
  const amt = rowAmount(row, model);
  const bar = normalizedBar(rowMetric(row, model), max);
  const value = amt === "" ? bar : `${amt} ${bar}`;
  return { kind: "row", label: row.tool, value };
}

function buildDatavis(model: ReceiptModel): Block[] {
  const max = model.toolRows.reduce((m, row) => Math.max(m, rowMetric(row, model)), 0);
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
      blocks.push(datavisRowBlock(row, model, max));
    }
  }
  if (toolCalls.length > 0) {
    blocks.push({ kind: "note", text: "--- TOOL CALLS ---", spaceBefore: true });
    for (const row of toolCalls) {
      blocks.push(datavisRowBlock(row, model, max));
    }
  }
  model.wasteLines.forEach((waste, i) => {
    const block = classicWasteBlock(waste);
    blocks.push(i === 0 ? { ...block, spaceBefore: true } : block);
  });
  blocks.push(...tailBlocks(model, { kind: "footer", text: FOOTER_TEXT, emoji: FOOTER_EMOJI }));
  return blocks;
}

const BUILDERS: Record<TemplateName, (model: ReceiptModel) => Block[]> = {
  classic: buildClassic,
  grocery: buildGrocery,
  datavis: buildDatavis,
};

/** Build the shared, layout-agnostic block list a renderer formats. Pure over the already-priced {@link ReceiptModel} — no pricing/attribution here. */
export function buildReceiptView(model: ReceiptModel, template: TemplateName = "classic"): ReceiptView {
  return { template, blocks: BUILDERS[template](model) };
}
