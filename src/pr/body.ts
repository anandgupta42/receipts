// SPEC-0023 R4 (supersedes SPEC-0019's single-session body) — assemble the PR
// comment: the dogfood marker (unchanged, so R5's presence check and the gh
// upsert still find it), a 🧾 header naming the session COUNT (issue #39 fix 1),
// then one fenced block of per-session rows and ONE combined total. Each row is
// role · model-mix · cost, with the slice line demoted to a muted provenance line
// under it (issue #39 fix 2). The combined total keeps priced dollars and
// tokens-only counts separate — never blended (I2/I3, SPEC-0008's pattern) — and
// a final line honestly reports any candidate sessions that were excluded.
import type { TokenUsage } from "../parse/types.js";
import type { ModelMixEntry } from "../receipt/model.js";
import { formatInt, formatUsd } from "../receipt/format.js";
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

function subagentRowLine(row: SubagentRow): string {
  const who = row.model ? `${row.name} · ${row.model}` : row.name;
  if (row.unreadable) {
    return `    ${who} — (unreadable)`;
  }
  return `    ${who} — ${costText(row.usd, row.tokens)}`;
}

/** One contributor: the role/model/cost headline, a muted provenance line, then any subagent sub-rows. */
function contributorBlock(view: ContributorView): string[] {
  const lines = [`${view.role} · ${formatModelMix(view.modelMix)} · ${costText(view.usd, view.tokens)}`];
  lines.push(`  ${view.sessionId} · ${sliceHeaderLine(view.slice)}`);
  if (view.subagents.length > 0) {
    lines.push(`  subagents (${view.subagents.length}):`);
    for (const row of view.subagents) {
      lines.push(subagentRowLine(row));
    }
  }
  return lines;
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

/** The single combined total (R4). Priced dollars and tokens-only counts stay separate — never one blended number (I2/I3). */
function combinedTotalLine(input: PrBodyInput): string {
  const { atoms, childCount } = collectAtoms(input.contributors);
  const priced = atoms.filter((a) => a.usd !== null);
  const pricedSubtotal = priced.reduce((sum, a) => sum + (a.usd ?? 0), 0);
  const tokensOnly = atoms.filter((a) => a.usd === null && !a.unreadable);
  const tokenSubtotal = tokensOnly.reduce((sum, a) => sum + a.tokens.total, 0);
  const notPriced = atoms.filter((a) => a.unreadable).length;

  let magnitude: string;
  if (priced.length > 0 && tokensOnly.length > 0) {
    magnitude = `$${formatUsd(pricedSubtotal)} priced + ${formatInt(tokenSubtotal)} tokens (${tokensOnly.length} tokens-only)`;
  } else if (priced.length > 0) {
    magnitude = `$${formatUsd(pricedSubtotal)}`;
  } else {
    magnitude = `${formatInt(tokenSubtotal)} tokens`;
  }
  const caveat = notPriced > 0 ? ` (+ ${notPriced} not priced)` : "";

  const sessionCount = input.contributors.length;
  const scope =
    childCount > 0
      ? `${sessionCount} session${sessionCount === 1 ? "" : "s"} + ${childCount} subagent${childCount === 1 ? "" : "s"}`
      : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  return `COMBINED — ${magnitude}  ·  ${scope}${caveat}`;
}

/** The complete comment body (R4): marker line, 🧾 header with the session count, fenced rows + combined total. */
export function renderPrBody(input: PrBodyInput): string {
  const n = input.contributors.length;
  const fenced: string[] = [];
  input.contributors.forEach((view, i) => {
    if (i > 0) {
      fenced.push("");
    }
    fenced.push(...contributorBlock(view));
  });
  fenced.push("", "─".repeat(10), combinedTotalLine(input));
  if (input.excludedCount > 0) {
    fenced.push(
      `${input.excludedCount} candidate session${input.excludedCount === 1 ? "" : "s"} not attributed (in repo + branch window, no branch commit)`,
    );
  }

  return [
    DOGFOOD_MARKER,
    `🧾 **aireceipts** — ${n} session${n === 1 ? "" : "s"} behind this PR`,
    "",
    "```",
    fenced.join("\n"),
    "```",
    "",
  ].join("\n");
}
