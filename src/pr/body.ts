// SPEC-0023 R4 (supersedes SPEC-0019's single-session body) — assemble the PR
// comment through the receipt block interpreter, not receipt-like string art:
// marker first (unchanged, so R5's presence check and the gh upsert still find
// it), then a fenced 50-column receipt with masthead, per-session dotted rows,
// muted provenance/subagent rows, separate priced/unpriced totals, and the
// classic samosa footer.
import type { TokenUsage } from "../parse/types.js";
import type { Block } from "../receipt/blocks.js";
import type { ModelMixEntry } from "../receipt/model.js";
import { formatInt, formatUsd } from "../receipt/format.js";
import { RECEIPT_WIDTH, renderBlockLines } from "../receipt/render.js";
import type { Role } from "./contributors.js";
import type { SliceResult } from "./slice.js";
import type { SubagentRow } from "./rollup.js";

/** The one marker that identifies aireceipts' PR comment (R2) and the R5 presence check. */
export const DOGFOOD_MARKER = "<!-- aireceipts-dogfood -->";

/** One contributing session, resolved to what the comment renders (index.ts builds these). */
export interface ContributorView {
  role: Role;
  /** Display session id (the transcript stem, not its absolute path). */
  sessionId: string;
  slice: SliceResult;
  /** The session's model mix (share by tokens) — `[]` when no turn carried a resolvable model. */
  modelMix: ModelMixEntry[];
  /** The session's own slice cost — `null` → tokens-only (I2). */
  usd: number | null;
  tokens: TokenUsage;
  subagents: SubagentRow[];
}

export interface PrBodyInput {
  contributors: ContributorView[];
  /** Candidates that were in repo + window but not credited (R1) — reported honestly (R4). */
  excludedCount: number;
}

const WORDMARK = "AIRECEIPTS";
const FOOTER_TEXT = "aireceipts · local · buy me a samosa";
const FOOTER_EMOJI = "🥟";
const NOTE_INDENT = 2;

/** The R1e(e) header line: the turn range, or the honesty label for a full-session fallback. */
export function sliceHeaderLine(slice: SliceResult): string {
  if (slice.kind === "full") {
    return slice.label ?? "entire session";
  }
  return `session slice: turns ${slice.startTurn + 1}–${slice.endTurn + 1} of ${slice.turnCount}`;
}

/** `claude-opus-4-8 100%` / `claude-opus-4-8 80% · claude-haiku-4-5 20%` — each model with its rounded token share (#39). */
function formatModelMix(modelMix: ModelMixEntry[]): string {
  if (modelMix.length === 0) {
    return "no model reported";
  }
  return modelMix.map((m) => `${m.model} ${Math.round(m.tokenShare * 100)}%`).join(" · ");
}

/** A priced atom renders `$`; an unpriced one falls back to tokens (I2). */
function costText(usd: number | null, tokens: TokenUsage): string {
  return usd !== null ? `$${formatUsd(usd)}` : `${formatInt(tokens.total)} tokens`;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function codepointLength(s: string): number {
  return [...s].length;
}

function capText(s: string, width: number): string {
  const chars = [...s];
  if (chars.length <= width) {
    return s;
  }
  return `${chars.slice(0, Math.max(1, width - 1)).join("").trimEnd()}…`;
}

function mutedNote(text: string, indent = NOTE_INDENT): Block {
  return { kind: "note", text, indent, muted: true };
}

function provenanceBlocks(view: ContributorView): Block[] {
  const slice = sliceHeaderLine(view.slice);
  const joined = `${view.sessionId} · ${slice}`;
  const capacity = RECEIPT_WIDTH - NOTE_INDENT;
  if (codepointLength(joined) <= capacity) {
    return [mutedNote(joined)];
  }
  const prefix = "session: ";
  return [
    mutedNote(`${prefix}${capText(view.sessionId, capacity - prefix.length)}`),
    mutedNote(capText(slice, capacity)),
  ];
}

function subagentLabel(row: SubagentRow): string {
  return row.model ? `${row.name} · ${row.model}` : row.name;
}

function subagentValue(row: SubagentRow): string {
  return row.unreadable ? "(unreadable)" : costText(row.usd, row.tokens);
}

/** One contributor: role/model dotted row, muted provenance line, then any SUBAGENTS sub-rows. */
function contributorBlocks(view: ContributorView, spaceBefore: boolean): Block[] {
  const blocks: Block[] = [
    {
      kind: "row",
      label: `${view.role} · ${formatModelMix(view.modelMix)}`,
      value: costText(view.usd, view.tokens),
      spaceBefore,
    },
    ...provenanceBlocks(view),
  ];
  if (view.subagents.length > 0) {
    blocks.push(mutedNote(`SUBAGENTS (${view.subagents.length})`));
    for (const row of view.subagents) {
      blocks.push({ kind: "row", label: `  ${subagentLabel(row)}`, value: subagentValue(row), muted: true });
    }
  }
  return blocks;
}

interface Atom {
  usd: number | null;
  tokens: TokenUsage;
  unreadable: boolean;
}

function collectAtoms(contributors: ContributorView[]): { atoms: Atom[]; childCount: number } {
  const atoms: Atom[] = [];
  let childCount = 0;
  for (const c of contributors) {
    atoms.push({ usd: c.usd, tokens: c.tokens, unreadable: false });
    for (const s of c.subagents) {
      atoms.push({ usd: s.usd, tokens: s.tokens, unreadable: s.unreadable });
      childCount++;
    }
  }
  return { atoms, childCount };
}

interface Totals {
  pricedSubtotal: number;
  pricedCount: number;
  tokenSubtotal: number;
  tokensOnlyCount: number;
  unreadableCount: number;
  childCount: number;
}

function totalsFor(contributors: ContributorView[]): Totals {
  const { atoms, childCount } = collectAtoms(contributors);
  const priced = atoms.filter((a) => a.usd !== null);
  const tokensOnly = atoms.filter((a) => a.usd === null && !a.unreadable);
  return {
    pricedSubtotal: priced.reduce((sum, a) => sum + (a.usd ?? 0), 0),
    pricedCount: priced.length,
    tokenSubtotal: tokensOnly.reduce((sum, a) => sum + a.tokens.total, 0),
    tokensOnlyCount: tokensOnly.length,
    unreadableCount: atoms.filter((a) => a.unreadable).length,
    childCount,
  };
}

function countLine(sessionCount: number, totals: Totals): string {
  const parts = [plural(sessionCount, "session")];
  if (totals.childCount > 0) {
    parts.push(plural(totals.childCount, "subagent"));
  }
  return `counted: ${parts.join(" + ")}`;
}

/**
 * Separate total rows (R4). Priced dollars and tokens-only counts are never
 * blended into one line (I2/I3). SPEC-0028 R1: when the receipt KNOWS it is
 * incomplete — excluded candidates or unreadable subagents — every total is
 * an explicit floor (`≥`); a known-partial number must say so in the number,
 * never only in a note below it.
 */
function totalBlocks(input: PrBodyInput): Block[] {
  const totals = totalsFor(input.contributors);
  const floor = input.excludedCount > 0 || totals.unreadableCount > 0 ? "≥ " : "";
  const blocks: Block[] = [{ kind: "rule" }];
  if (totals.pricedCount > 0) {
    blocks.push({ kind: "total", label: "TOTAL priced", value: `${floor}$${formatUsd(totals.pricedSubtotal)}` });
  }
  if (totals.tokensOnlyCount > 0) {
    blocks.push({ kind: "total", label: "TOTAL unpriced", value: `${floor}${formatInt(totals.tokenSubtotal)} tokens` });
  }
  if (totals.pricedCount === 0 && totals.tokensOnlyCount === 0) {
    blocks.push({ kind: "total", label: "TOTAL unpriced", value: `${floor}0 tokens` });
  }
  blocks.push(mutedNote(countLine(input.contributors.length, totals)));
  if (totals.unreadableCount > 0) {
    blocks.push(mutedNote(`${plural(totals.unreadableCount, "unreadable subagent")} not priced`));
  }
  if (input.excludedCount > 0) {
    blocks.push({
      kind: "note",
      text: `${plural(input.excludedCount, "candidate session")} not attributed`,
      muted: true,
      spaceBefore: true,
    });
    blocks.push({ kind: "note", text: "(in repo + branch window, no branch commit)", muted: true });
  }
  return blocks;
}

function prBlocks(input: PrBodyInput): Block[] {
  const n = input.contributors.length;
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: [`${plural(n, "session")} behind this PR`] },
  ];
  input.contributors.forEach((view, i) => {
    blocks.push(...contributorBlocks(view, i === 0));
  });
  blocks.push(...totalBlocks(input));
  blocks.push({ kind: "footer", text: FOOTER_TEXT, emoji: FOOTER_EMOJI });
  return blocks;
}

/** The complete comment body (R4): marker line plus fenced receipt blocks. */
export function renderPrBody(input: PrBodyInput): string {
  const receipt = renderBlockLines(prBlocks(input), { color: false, width: RECEIPT_WIDTH }).join("\n");
  return [
    DOGFOOD_MARKER,
    "```",
    receipt,
    "```",
    "",
  ].join("\n");
}
