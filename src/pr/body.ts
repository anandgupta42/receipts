// SPEC-0019 R1e(e)/R1c/R2 — assemble the PR comment body: the dogfood marker
// (outside the fence, so R5's check and the gh upsert can find it), a 🧾 header
// naming the session, then the fenced receipt (slice header + core receipt +
// a SUBAGENTS rollup with a combined total when children exist). The marker
// MUST be the very first line — the upsert matches comments by `startsWith`.
import type { TokenUsage } from "../parse/types.js";
import { formatInt, formatUsd } from "../receipt/format.js";
import type { SliceResult } from "./slice.js";
import type { SubagentRow } from "./rollup.js";

/** The one marker that identifies aireceipts' PR comment (R2) and the R5 presence check. */
export const DOGFOOD_MARKER = "<!-- aireceipts-dogfood -->";

export interface PrBodyInput {
  /** Display session id (the transcript stem, not its absolute path). */
  sessionId: string;
  slice: SliceResult;
  /** `renderReceipt(model, { color: false })` over the sliced (or full) session. */
  receiptText: string;
  /** The rendered session's own total (parent slice), before subagents. */
  parentUsd: number | null;
  parentTokens: TokenUsage;
  subagents: SubagentRow[];
}

/** The R1e(e) header line: the turn range, or the honesty label for a full-session fallback. */
export function sliceHeaderLine(slice: SliceResult): string {
  if (slice.kind === "full") {
    return slice.label ?? "entire session";
  }
  return `session slice: turns ${slice.startTurn + 1}–${slice.endTurn + 1} of ${slice.turnCount}`;
}

function subagentRowLine(row: SubagentRow): string {
  const who = row.model ? `${row.name} · ${row.model}` : row.name;
  if (row.unreadable) {
    return `  ${who} — (unreadable)`;
  }
  const cost = row.usd !== null ? `$${formatUsd(row.usd)}` : `${formatInt(row.tokens.total)} tokens`;
  return `  ${who} — ${cost}`;
}

/** SUBAGENTS section + combined total, honest when a child is tokens-only or unreadable (I2). */
function subagentSection(input: PrBodyInput): string[] {
  const { subagents } = input;
  const lines = [`SUBAGENTS · ${subagents.length} session${subagents.length === 1 ? "" : "s"}`];
  for (const row of subagents) {
    lines.push(subagentRowLine(row));
  }

  const included = subagents.filter((r) => !r.unreadable);
  const notPriced = subagents.filter((r) => r.unreadable || r.usd === null).length;
  if (input.parentUsd !== null) {
    const childUsd = included.reduce((sum, r) => sum + (r.usd ?? 0), 0);
    const total = `$${formatUsd(input.parentUsd + childUsd)}`;
    const caveat = notPriced > 0 ? ` (+ ${notPriced} subagent${notPriced === 1 ? "" : "s"} not priced)` : "";
    lines.push("", `TOTAL (session slice + subagents) — ${total}${caveat}`);
  } else {
    const childTokens = included.reduce((sum, r) => sum + r.tokens.total, 0);
    lines.push("", `TOTAL (session slice + subagents) — ${formatInt(input.parentTokens.total + childTokens)} tokens`);
  }
  return lines;
}

/** The complete comment body (R2): marker line, 🧾 header, then the fenced receipt. */
export function renderPrBody(input: PrBodyInput): string {
  const fenced: string[] = [sliceHeaderLine(input.slice), "", input.receiptText.replace(/\n+$/, "")];
  if (input.subagents.length > 0) {
    fenced.push("", ...subagentSection(input));
  }
  return [
    DOGFOOD_MARKER,
    `🧾 **aireceipts** — session \`${input.sessionId}\``,
    "",
    "```",
    fenced.join("\n"),
    "```",
    "",
  ].join("\n");
}
