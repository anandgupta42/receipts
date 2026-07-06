// SPEC-0023 R4 (supersedes SPEC-0019's single-session body) — assemble the PR
// comment through the receipt block interpreter, not receipt-like string art:
// marker first (unchanged, so R5's presence check and the gh upsert still find
// it), then a fenced 50-column receipt with masthead, per-session dotted rows,
// muted provenance/subagent rows, separate priced/unpriced totals, and the
// plain closing footer (SPEC-0055: no samosa on the fenced receipt itself —
// the samosa link lives only in the details section below, via SAMOSA_LINK).
import type { TokenUsage } from "../parse/types.js";
import type { Block } from "../receipt/blocks.js";
import type { ModelMixEntry, WasteLine } from "../receipt/model.js";
import { couldHaveSavedOf, couldHaveSavedValue, prCoverageLine, savingsSlipLines } from "../receipt/handoff.js";
import { formatCentsAmount, formatInt, formatUsd, reconcileCents } from "../receipt/format.js";
import { cacheServedText, compactDuration } from "../receipt/present.js";
import { MESSAGE_BASIS_LABEL } from "./messageAnchor.js";
import { formatDuration } from "../receipt/format.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { RECEIPT_WIDTH, renderBlockLines } from "../receipt/render.js";
import type { Role } from "./contributors.js";
import type { SliceResult } from "./slice.js";
import type { SubagentRow } from "./rollup.js";
import { SAMOSA_URL } from "./publish.js";

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
  /** SPEC-0026 R3 — how selection credited this session; `helper` rows render grouped, not top-level (round 2). */
  basis?: "anchor" | "helper" | "message";
  /** Rendered-slice duration — the helper group's one per-row fact (round 2). */
  durationMs?: number;
}

import { isFloored, type ConfidenceSummary } from "./confidence.js";

export interface PrBodyInput {
  contributors: ContributorView[];
  /** Candidates that were in repo + window but not credited (R1) — reported honestly (R4). */
  excludedCount: number;
  /** Round 2: true → the hint points at the details section below; false/absent → the command hint (--no-details, unit callers). */
  detailsBelow?: boolean;
  /** SPEC-0044 — folded confidence counts (A1 anchor-pool absences etc.); absent for legacy callers. */
  confidence?: ConfidenceSummary;
}

/** SPEC-0026 R3 (round 2) — the helper explainer, now the group header's and details stat line's phrasing. */
export const HELPER_FULL_LABEL = "no commits";
/** SPEC-0026 R5 — GitHub caps issue comments at 65,536 chars; we cap under it. */
const COMMENT_SIZE_CAP = 65_000;
const OMITTED_NOTE = "full receipt omitted (comment size limit)";

const WORDMARK = "AIRECEIPTS";
const FOOTER_TEXT = "aireceipts · local · npx aireceipts-cli";
const NOTE_INDENT = 2;

/** The R1e(e) header line: the turn range, or the honesty label for a full-session fallback. */
export function sliceHeaderLine(slice: SliceResult): string {
  if (slice.kind === "full") {
    return slice.label ?? "entire session";
  }
  return `session slice: turns ${slice.startTurn + 1}–${slice.endTurn + 1} of ${slice.turnCount}`;
}

/** `claude-opus-4-8` (a share only earns ink for a real mix) / `claude-opus-4-8 80% · claude-haiku-4-5 20%` (#39, round 2). */
function formatModelMix(modelMix: ModelMixEntry[]): string {
  if (modelMix.length === 0) {
    return "no model reported";
  }
  if (modelMix.length === 1) {
    return modelMix[0].model;
  }
  // Display honesty (same rule as the cache line): a real mix never rounds a
  // partial share up to 100% or down to 0%.
  const sharePct = (share: number): string => {
    const pct = Math.round(share * 100);
    if (pct >= 100 && share < 1) {
      return ">99%";
    }
    if (pct <= 0 && share > 0) {
      return "<1%";
    }
    return `${pct}%`;
  };
  return modelMix.map((m) => `${m.model} ${sharePct(m.tokenShare)}`).join(" · ");
}

/**
 * A priced atom renders `$`; an unpriced one falls back to tokens (I2). `reconciled`
 * (B1) is this atom's cent-reconciled string — every priced row on the fence must
 * use it so displayed rows sum to the displayed total; falls back to `formatUsd`
 * only when no reconciliation map was threaded through (should not happen on any
 * real render path, kept only so a future caller can't crash on a missing entry).
 */
function costText(usd: number | null, tokens: TokenUsage, reconciled?: string): string {
  return usd !== null ? `$${reconciled ?? formatUsd(usd)}` : `${formatInt(tokens.total)} tokens`;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
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

/** Round 2: the fence carries provenance ONLY when it changes a number's meaning — a real slice, or the weaker
 * SPEC-0032 message basis (a reader must see that this row's credit is not SHA-proven, with or without --details). */
function provenanceBlocks(view: ContributorView): Block[] {
  if (view.basis === "message") {
    return [mutedNote(MESSAGE_BASIS_LABEL)];
  }
  if (view.slice.kind !== "slice") {
    return [];
  }
  return [mutedNote(capText(sliceHeaderLine(view.slice), RECEIPT_WIDTH - NOTE_INDENT))];
}

function subagentLabel(row: SubagentRow): string {
  return row.model ? `${row.name} · ${row.model}` : row.name;
}

function subagentValue(row: SubagentRow, reconciled?: string): string {
  return row.unreadable ? "(unreadable)" : costText(row.usd, row.tokens, reconciled);
}

/** One contributor: role/model dotted row (role only when rows need telling apart — SPEC-0026 R1), muted provenance line, then any SUBAGENTS sub-rows. */
function contributorBlocks(view: ContributorView, spaceBefore: boolean, showRole: boolean, reconciled: ReconciledAtoms): Block[] {
  const blocks: Block[] = [
    {
      kind: "row",
      label: showRole ? `${view.role} · ${formatModelMix(view.modelMix)}` : formatModelMix(view.modelMix),
      value: costText(view.usd, view.tokens, reconciled.get(view)),
      spaceBefore,
    },
    ...provenanceBlocks(view),
  ];
  if (view.subagents.length > 0) {
    blocks.push(mutedNote(`SUBAGENTS (${view.subagents.length})`));
    for (const row of view.subagents) {
      blocks.push({ kind: "row", label: `  ${subagentLabel(row)}`, value: subagentValue(row, reconciled.get(row)), muted: true });
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

/** B1 — every priced contributor/subagent's cent-reconciled display string, keyed by object reference (a `Map`, not a position — helper rows and subagent loops iterate their own subsets). */
type ReconciledAtoms = Map<ContributorView | SubagentRow, string>;

/**
 * SPEC-0044/B1 — reconcile every priced atom (contributor + subagent, any
 * basis — the same universe {@link totalsFor} sums into "TOTAL priced") so the
 * rows this comment actually RENDERS sum exactly to that total. Rows and the
 * total used to round independently; this computes the split once, up front,
 * over largest-remainder cents (see `reconcileCents`).
 */
function reconciledAtomText(contributors: ContributorView[]): ReconciledAtoms {
  const keys: (ContributorView | SubagentRow)[] = [];
  const amounts: number[] = [];
  for (const c of contributors) {
    if (c.usd !== null) {
      keys.push(c);
      amounts.push(c.usd);
    }
    for (const s of c.subagents) {
      if (s.usd !== null) {
        keys.push(s);
        amounts.push(s.usd);
      }
    }
  }
  const cents = reconcileCents(amounts);
  const map: ReconciledAtoms = new Map();
  keys.forEach((k, i) => map.set(k, formatCentsAmount(cents[i])));
  return map;
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
  // SPEC-0044 R1/S2-finding-5 — floor on ANY incompleteness/lower-bound event
  // (not just excludedCount): every ConfidenceEvent kind that can under-state
  // the total drives the `≥`. excludedCount/unreadable kept for legacy callers
  // that don't pass a confidence summary.
  const floor = input.excludedCount > 0 || totals.unreadableCount > 0 || (input.confidence !== undefined && isFloored(input.confidence)) ? "≥ " : "";
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
  // SPEC-0026 R2 — one aggregate cache line over exactly the atoms the totals
  // count, through the receipt masthead's own formatter (one implementation).
  const summed = collectAtoms(input.contributors).atoms.reduce((acc, a) => addUsage(acc, a.tokens), emptyUsage());
  const cache = cacheServedText(summed);
  if (cache !== undefined) {
    blocks.push(mutedNote(cache));
  }
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
  // SPEC-0044 A1 — anchor-pool sessions that touched the branch but couldn't be
  // sliced precisely: counted-absence, DISTINCT from the excluded note above
  // (the coverage-map C.2 hole — never a silent drop).
  const unattributable = input.confidence?.unattributableAnchorPool ?? 0;
  if (unattributable > 0) {
    blocks.push({
      kind: "note",
      text: `${plural(unattributable, "session")} touched this branch but couldn't be attributed precisely`,
      muted: true,
      spaceBefore: true,
    });
    blocks.push({ kind: "note", text: "(see docs/trust.md)", muted: true });
  }
  // SPEC-0044 A3 — a session whose cache-write cost took the unsplit-tier
  // fallback (assumed 5m rate): its `$` share is a lower bound, not exact.
  const cacheTierLowerBound = input.confidence?.costLowerBoundCacheTier ?? 0;
  if (cacheTierLowerBound > 0) {
    blocks.push({
      kind: "note",
      text: `${plural(cacheTierLowerBound, "session")} had a cache-write cost that is a lower bound`,
      muted: true,
      spaceBefore: true,
    });
    blocks.push({ kind: "note", text: "(see docs/cost-model.md)", muted: true });
  }
  // SPEC-0044 B4 — in-window candidates we couldn't READ (load/parse failed),
  // outside this worktree so the excluded note above never saw them. Counted,
  // never silent: "couldn't read" ≠ "not ours".
  const unreadable = input.confidence?.unreadableSession ?? 0;
  if (unreadable > 0) {
    blocks.push({
      kind: "note",
      text: `${plural(unreadable, "session")} touched this branch but couldn't be read`,
      muted: true,
      spaceBefore: true,
    });
    blocks.push({ kind: "note", text: "(see docs/trust.md)", muted: true });
  }
  // SPEC-0044 B3 — a credited session whose transcript had records skipped at
  // parse time: its `$` is a lower bound (dropped records carried real usage).
  const droppedRecords = input.confidence?.droppedTranscriptRecords ?? 0;
  if (droppedRecords > 0) {
    blocks.push({
      kind: "note",
      text: `${plural(droppedRecords, "session")} had unreadable transcript records skipped`,
      muted: true,
      spaceBefore: true,
    });
    blocks.push({ kind: "note", text: "(total is a lower bound — see docs/trust.md)", muted: true });
  }
  // SPEC-0026 R4 (round 2) — the route to the full per-tool story, always the
  // last note: point at the details section when one follows, else the command.
  blocks.push(
    mutedNote(input.detailsBelow === true ? "full receipts + session ids: section below" : "details: npx aireceipts-cli --session <id>"),
  );
  return blocks;
}

/** Round 2: one muted row per helper — model + duration + cost; the group header explains them once. */
function helperGroupBlocks(helpers: ContributorView[], spaceBefore: boolean, reconciled: ReconciledAtoms): Block[] {
  if (helpers.length === 0) {
    return [];
  }
  const blocks: Block[] = [
    { kind: "note", text: `CODEX HELPERS (${helpers.length}) — ${HELPER_FULL_LABEL}`, indent: NOTE_INDENT, muted: true, spaceBefore },
  ];
  for (const h of helpers) {
    const dur = h.durationMs !== undefined ? compactDuration(formatDuration(h.durationMs)) : undefined;
    const label = dur !== undefined ? `${formatModelMix(h.modelMix)} · ${dur}` : formatModelMix(h.modelMix);
    blocks.push({ kind: "row", label: `  ${label}`, value: costText(h.usd, h.tokens, reconciled.get(h)), muted: true });
    // SPEC-0044/B1: a helper's subagents are counted in the TOTAL (collectAtoms)
    // and cent-reconciled (reconciledAtomText), so they must also be DRAWN as
    // rows — otherwise the displayed rows would not sum to the total. Codex
    // helpers carry none in practice; this keeps the invariant true regardless.
    for (const row of h.subagents) {
      blocks.push({ kind: "row", label: `    ${subagentLabel(row)}`, value: subagentValue(row, reconciled.get(row)), muted: true });
    }
  }
  return blocks;
}

function prBlocks(input: PrBodyInput): Block[] {
  const n = input.contributors.length;
  const blocks: Block[] = [
    { kind: "masthead", text: WORDMARK },
    { kind: "meta", lines: [`${plural(n, "session")} behind this PR`] },
  ];
  // Round 2 grammar: top-level rows are sessions that committed; helpers group
  // below them under one explanatory header (never nested under a specific
  // session — grouping states only what the credit rule proved).
  const authors = input.contributors.filter((v) => v.basis !== "helper");
  const helpers = input.contributors.filter((v) => v.basis === "helper");
  const showRole = authors.length > 1;
  const reconciled = reconciledAtomText(input.contributors);
  authors.forEach((view, i) => {
    blocks.push(...contributorBlocks(view, i === 0, showRole, reconciled));
  });
  blocks.push(...helperGroupBlocks(helpers, authors.length === 0, reconciled));
  blocks.push(...totalBlocks(input));
  blocks.push({ kind: "footer", text: FOOTER_TEXT });
  return blocks;
}

/** The bare concise receipt text (no marker, no fence) — shared by the comment body and the SPEC-0027 HTML artifact. */
export function renderPrReceiptText(input: PrBodyInput): string {
  return renderBlockLines(prBlocks(input), { color: false, width: RECEIPT_WIDTH }).join("\n");
}

/** One pre-rendered per-session full receipt for the R5 details section. */
export interface DetailReceipt {
  /** Heading over the receipt: `#### <role> · \`<shortId>\`` (markdown; artifact uses its own plain labels). */
  label: string;
  /** Session-table row cells: [role, id, scope, turns, time, tokens, cached] (round 3 — the ledger table). */
  row: string[];
  /** `renderReceipt(model, { color: false })` output for the contributor's sliced model. */
  text: string;
}

/** SPEC-0059 R5 — the raw facts the handoff section aggregates (index.ts builds these from the sliced models). */
export interface HandoffSectionData {
  /** Every fired waste line across the counted sessions' sliced models, fence order. */
  wasteLines: WasteLine[];
  /** Counted sessions behind the PR (the covers line's first fact). */
  sessionCount: number;
  /** Summed counted turns across those sessions. */
  turnCount: number;
}

export interface PrBodyExtras {
  /** SPEC-0027 R3 — present only after a confirmed artifact push. */
  artifactLink?: { fileName: string; url: string };
  /** SPEC-0026 R5 — per-session full receipts, row order; omitted under `--no-details`. */
  details?: DetailReceipt[];
  /** SPEC-0059 R5 — handoff slip facts; omitted under `--no-details` (index.ts gates it). */
  handoff?: HandoffSectionData;
}

const FENCE = "```";

/** SPEC-0034 R3 — the one place in the comment that renders a link; the fenced receipt stays link-free by nature. */
const SAMOSA_LINK = `[buy me a samosa](${SAMOSA_URL})`;

/**
 * The `<details>` section, size-capped: the largest prefix of receipts that
 * fits is kept, trailing ones degrade to one-line omission notes; `null` when
 * even all-omitted cannot fit (the caller drops the section). Computed with
 * prefix sums — one pass, no quadratic reassembly. The section always ends
 * with the samosa link (SPEC-0034 R3); its fixed length is folded into the
 * frame so the budget accounting still holds.
 */
function detailsSection(details: DetailReceipt[], budget: number): string | null {
  const kept = details.map((d) => `${d.label}\n\n${FENCE}\n${d.text}\n${FENCE}`);
  const omitted = details.map((d) => `${d.label} — ${OMITTED_NOTE}`);
  // Round 3: a ledger table up top — uniform, scannable — then each receipt
  // under its own small heading. The table is always kept (cheap bytes).
  const table = [
    "| session | id | scope | turns | time | tokens in / out | cached |",
    "|---|---|---|---|---|---|---|",
    ...details.map((d) => `| ${d.row.join(" | ")} |`),
  ].join("\n");
  const header = `<details><summary>full receipts (${plural(details.length, "session")})</summary>\n\n${table}`;
  // header + blank lines + joins + the closing samosa link and its own blank-line pair
  const frame =
    [...header].length + [...`\n\n${"\n"}\n${SAMOSA_LINK}\n\n</details>`].length + details.length;
  const size = (s: string): number => [...s].length + 1; // +1 for its join newline

  const allOmitted = frame + omitted.reduce((sum, s) => sum + size(s), 0);
  if (allOmitted > budget) {
    return null;
  }
  // Largest keep-prefix that fits: swap omitted→kept from the front while the total holds.
  let total = allOmitted;
  let keep = 0;
  while (keep < details.length && total - size(omitted[keep]) + size(kept[keep]) <= budget) {
    total = total - size(omitted[keep]) + size(kept[keep]);
    keep++;
  }
  const parts = details.map((_, i) => (i < keep ? kept[i] : omitted[i]));
  return [header, "", ...parts, "", SAMOSA_LINK, "", "</details>"].join("\n");
}

/** SPEC-0059 R5 — the slip strings shared by the comment section and the artifact page (R6): one builder, no drift. */
export interface HandoffSlipView {
  /** The collapsed row's text — dollars visible before any click. */
  summary: string;
  /** The fenced slip body: headline, hedge, evidence + rule lines, covers. */
  text: string;
}

/**
 * SPEC-0059 R5 — the aggregated slip over every counted session's fired waste
 * lines, or `null` when none fired (a clean PR's comment stays byte-identical).
 * The percent (summary and hedge) is withheld when the PR total renders with
 * the `≥` floor marker — a percent of a floor overstates (I3) — by denying the
 * slip its denominator; the `≤ $` ceiling itself is still an extracted sum.
 */
export function buildHandoffSlip(data: HandoffSectionData, input: PrBodyInput): HandoffSlipView | null {
  if (data.wasteLines.length === 0) {
    return null;
  }
  const totals = totalsFor(input.contributors);
  const floored =
    input.excludedCount > 0 || totals.unreadableCount > 0 || (input.confidence !== undefined && isFloored(input.confidence));
  const denominator = floored || totals.pricedCount === 0 ? null : totals.pricedSubtotal;
  const saved = couldHaveSavedOf(data.wasteLines, denominator);
  const pct = saved.pctOfTotal !== null ? ` (${saved.pctOfTotal}%)` : "";
  const summary = `handoff — could have saved ${couldHaveSavedValue(saved)}${pct}`;
  const text = [
    ...savingsSlipLines(data.wasteLines, denominator),
    "",
    prCoverageLine(data.sessionCount, data.turnCount, data.wasteLines.length),
  ].join("\n");
  return { summary, text };
}

/** The R5 handoff `<details>` block — all-or-nothing against `budget`: advice is never truncated mid-slip. */
function handoffSection(slip: HandoffSlipView, budget: number): string | null {
  const section = [`<details><summary>${slip.summary}</summary>`, "", FENCE, slip.text, FENCE, "", "</details>"].join("\n");
  return [...section].length + 1 <= budget ? section : null;
}

/**
 * The complete comment body: marker line, fenced receipt blocks, the R5
 * details section, the SPEC-0059 handoff section (waste-carrying PRs only),
 * then the SPEC-0027 artifact link (present only after a confirmed push) —
 * printed and posted bodies are always identical. The detailed form also
 * reports whether the handoff section made the body (the R8 telemetry
 * boolean) — assembly state, never a substring scan of the body.
 */
export function renderPrBodyDetailed(
  input: PrBodyInput,
  extras: PrBodyExtras = {},
): { body: string; handoffSectionIncluded: boolean } {
  const linkLine = extras.artifactLink
    ? `full receipt: [${extras.artifactLink.fileName}](${extras.artifactLink.url})`
    : undefined;
  // Decide the section first against the section-hint fence (the longer of the
  // two hints, so the budget can only be conservative); the fence's hint then
  // states what the FINAL body actually contains — a dropped section must
  // never leave a "section below" pointing at nothing.
  let section: string | null = null;
  let handoff: string | null = null;
  if (extras.details !== undefined && extras.details.length > 0) {
    const budgetFence = renderPrReceiptText({ ...input, detailsBelow: true });
    const used =
      [...[DOGFOOD_MARKER, FENCE, budgetFence, FENCE].join("\n")].length +
      (linkLine === undefined ? 0 : [...linkLine].length + 1) +
      3;
    section = detailsSection(extras.details, COMMENT_SIZE_CAP - used);
    // SPEC-0059 R5 — a sibling of the full-receipts section, decided against
    // what that section actually consumed (+2: its trailing blank-line join).
    if (section !== null && extras.handoff !== undefined) {
      const slip = buildHandoffSlip(extras.handoff, input);
      if (slip !== null) {
        handoff = handoffSection(slip, COMMENT_SIZE_CAP - used - [...section].length - 2);
      }
    }
  }
  const fence = renderPrReceiptText({ ...input, detailsBelow: section !== null });
  const lines = [DOGFOOD_MARKER, "```", fence, "```"];
  if (section !== null) {
    // GFM: an HTML block swallows everything until a BLANK line — without
    // one, the link after </details> renders as raw text, not a link.
    lines.push(section, "");
  }
  if (handoff !== null) {
    lines.push(handoff, "");
  }
  if (linkLine !== undefined) {
    lines.push(linkLine);
  }
  lines.push("");
  return { body: lines.join("\n"), handoffSectionIncluded: handoff !== null };
}

export function renderPrBody(input: PrBodyInput, extras: PrBodyExtras = {}): string {
  return renderPrBodyDetailed(input, extras).body;
}
