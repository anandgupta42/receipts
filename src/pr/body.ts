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
import { cacheServedText, compactDuration } from "../receipt/present.js";
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
  basis?: "anchor" | "helper";
  /** Rendered-slice duration — the helper group's one per-row fact (round 2). */
  durationMs?: number;
}

export interface PrBodyInput {
  contributors: ContributorView[];
  /** Candidates that were in repo + window but not credited (R1) — reported honestly (R4). */
  excludedCount: number;
  /** Round 2: true → the hint points at the details section below; false/absent → the command hint (--no-details, unit callers). */
  detailsBelow?: boolean;
}

/** SPEC-0026 R3 (round 2) — the helper explainer, now the group header's and details stat line's phrasing. */
export const HELPER_FULL_LABEL = "no commits";
/** SPEC-0026 R5 — GitHub caps issue comments at 65,536 chars; we cap under it. */
const COMMENT_SIZE_CAP = 65_000;
const OMITTED_NOTE = "full receipt omitted (comment size limit)";

const WORDMARK = "AIRECEIPTS";
const FOOTER_TEXT = "aireceipts · local · buy me a samosa";
const FOOTER_EMOJI = "🔺";
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

/** A priced atom renders `$`; an unpriced one falls back to tokens (I2). */
function costText(usd: number | null, tokens: TokenUsage): string {
  return usd !== null ? `$${formatUsd(usd)}` : `${formatInt(tokens.total)} tokens`;
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

/** Round 2: the fence carries provenance ONLY when it changes a number's meaning — a real slice. Ids and full-session explainers live in the details section. */
function provenanceBlocks(view: ContributorView): Block[] {
  if (view.slice.kind !== "slice") {
    return [];
  }
  return [mutedNote(capText(sliceHeaderLine(view.slice), RECEIPT_WIDTH - NOTE_INDENT))];
}

function subagentLabel(row: SubagentRow): string {
  return row.model ? `${row.name} · ${row.model}` : row.name;
}

function subagentValue(row: SubagentRow): string {
  return row.unreadable ? "(unreadable)" : costText(row.usd, row.tokens);
}

/** One contributor: role/model dotted row (role only when rows need telling apart — SPEC-0026 R1), muted provenance line, then any SUBAGENTS sub-rows. */
function contributorBlocks(view: ContributorView, spaceBefore: boolean, showRole: boolean): Block[] {
  const blocks: Block[] = [
    {
      kind: "row",
      label: showRole ? `${view.role} · ${formatModelMix(view.modelMix)}` : formatModelMix(view.modelMix),
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
  // SPEC-0026 R4 (round 2) — the route to the full per-tool story, always the
  // last note: point at the details section when one follows, else the command.
  blocks.push(
    mutedNote(input.detailsBelow === true ? "full receipts + session ids: section below" : "details: npx aireceipts --session <id>"),
  );
  return blocks;
}

/** Round 2: one muted row per helper — model + duration + cost; the group header explains them once. */
function helperGroupBlocks(helpers: ContributorView[], spaceBefore: boolean): Block[] {
  if (helpers.length === 0) {
    return [];
  }
  const blocks: Block[] = [
    { kind: "note", text: `CODEX HELPERS (${helpers.length}) — ${HELPER_FULL_LABEL}`, indent: NOTE_INDENT, muted: true, spaceBefore },
  ];
  for (const h of helpers) {
    const dur = h.durationMs !== undefined ? compactDuration(formatDuration(h.durationMs)) : undefined;
    const label = dur !== undefined ? `${formatModelMix(h.modelMix)} · ${dur}` : formatModelMix(h.modelMix);
    blocks.push({ kind: "row", label: `  ${label}`, value: costText(h.usd, h.tokens), muted: true });
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
  authors.forEach((view, i) => {
    blocks.push(...contributorBlocks(view, i === 0, showRole));
  });
  blocks.push(...helperGroupBlocks(helpers, authors.length === 0));
  blocks.push(...totalBlocks(input));
  blocks.push({ kind: "footer", text: FOOTER_TEXT, emoji: FOOTER_EMOJI });
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

export interface PrBodyExtras {
  /** SPEC-0027 R3 — present only after a confirmed artifact push. */
  artifactLink?: { fileName: string; url: string };
  /** SPEC-0026 R5 — per-session full receipts, row order; omitted under `--no-details`. */
  details?: DetailReceipt[];
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

/**
 * The complete comment body: marker line, fenced receipt blocks, the R5
 * details section, then the SPEC-0027 artifact link (present only after a
 * confirmed push) — printed and posted bodies are always identical.
 */
export function renderPrBody(input: PrBodyInput, extras: PrBodyExtras = {}): string {
  const linkLine = extras.artifactLink
    ? `full receipt: [${extras.artifactLink.fileName}](${extras.artifactLink.url})`
    : undefined;
  // Decide the section first against the section-hint fence (the longer of the
  // two hints, so the budget can only be conservative); the fence's hint then
  // states what the FINAL body actually contains — a dropped section must
  // never leave a "section below" pointing at nothing.
  let section: string | null = null;
  if (extras.details !== undefined && extras.details.length > 0) {
    const budgetFence = renderPrReceiptText({ ...input, detailsBelow: true });
    const used =
      [...[DOGFOOD_MARKER, FENCE, budgetFence, FENCE].join("\n")].length +
      (linkLine === undefined ? 0 : [...linkLine].length + 1) +
      3;
    section = detailsSection(extras.details, COMMENT_SIZE_CAP - used);
  }
  const fence = renderPrReceiptText({ ...input, detailsBelow: section !== null });
  const lines = [DOGFOOD_MARKER, "```", fence, "```"];
  if (section !== null) {
    // GFM: an HTML block swallows everything until a BLANK line — without
    // one, the link after </details> renders as raw text, not a link.
    lines.push(section, "");
  }
  if (linkLine !== undefined) {
    lines.push(linkLine);
  }
  lines.push("");
  return lines.join("\n");
}
