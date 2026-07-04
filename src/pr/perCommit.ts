// SPEC-0031 — per-commit cost attribution: a LEDGER CONVENTION, not causality.
// Within a sliced session, each turn is booked to the branch commit whose
// anchor turn comes next; segments partition the slice completely (computeSlice
// ends at the last own anchor, so there is no "after" remainder). Segments are
// priced by the exact machinery the slice itself uses — sliceSessionForReceipt
// + buildReceiptModel over a sub-range — never a new pricing path (I2).
import type { Session } from "../parse/types.js";
import { buildReceiptModel, sliceSessionForReceipt, type ReceiptModel } from "../receipt/model.js";
import { formatUsd } from "../receipt/format.js";
import type { BranchCommits } from "./git.js";
import type { AnchorEvent, SliceResult } from "./slice.js";

/** The convention, named on every surface that shows a table (I3). */
export const PER_COMMIT_METHODOLOGY =
  "turns preceding each commit anchor, booked to that commit — a ledger convention, not causality";

/** The labeled bucket for sessions that cannot be commit-attributed (I3). */
export const NOT_ATTRIBUTABLE_LABEL = "not commit-attributable";

/** Display cap for commit subjects (SPEC-0031 R2). */
export const SUBJECT_DISPLAY_CAP = 72;

export interface PerCommitSegment {
  /** Full branch SHA owning this segment (chronologically earliest on its boundary turn). */
  sha: string;
  subject: string;
  /** Original-turn-space inclusive range within the slice. */
  startTurn: number;
  endTurn: number;
  /** Other commits whose anchors landed on the same boundary turn (`+N more in this turn`). */
  extraShas: string[];
}

export interface PerCommitRow {
  shortSha: string;
  subject: string;
  turnCount: number;
  /** null when the segment priced nothing — tokens shown instead, zero `$` bytes (I2). */
  usd: number | null;
  totalTokens: number;
  extraCount: number;
}

/**
 * Partition a sliced session's turn range at commit-anchor boundaries.
 * Returns [] for anything but a real slice (full fallbacks and helpers are
 * `not commit-attributable` — the slicer itself refused per-turn precision
 * there, so per-commit tables must too). Trailing turns between the last
 * commit anchor and the slice end (a closing `git push` span) fold into the
 * last segment — the partition is always complete.
 */
export function segmentSlice(slice: SliceResult, events: AnchorEvent[], commits: BranchCommits): PerCommitSegment[] {
  if (slice.kind !== "slice") {
    return [];
  }
  const claimed = new Set<string>();
  const segments: PerCommitSegment[] = [];
  let cursor = slice.startTurn;
  for (const ev of events) {
    if (ev.turnIndex < slice.startTurn || ev.turnIndex > slice.endTurn) {
      continue;
    }
    const fresh = ev.shas.filter((sha) => !claimed.has(sha));
    if (fresh.length === 0) {
      continue; // a re-printed SHA (e.g. `git log` in a later turn) is not a boundary
    }
    for (const sha of fresh) {
      claimed.add(sha);
    }
    // Chronologically earliest = highest index in the newest-first commit list.
    const byChrono = [...fresh].sort((a, b) => commits.shas.indexOf(b) - commits.shas.indexOf(a));
    const owner = byChrono[0];
    segments.push({
      sha: owner,
      subject: subjectOf(owner, commits),
      startTurn: cursor,
      endTurn: ev.turnIndex,
      extraShas: byChrono.slice(1),
    });
    cursor = ev.turnIndex + 1;
  }
  if (segments.length > 0 && cursor <= slice.endTurn) {
    segments[segments.length - 1].endTurn = slice.endTurn; // fold the trailing push span
  }
  return segments;
}

function subjectOf(sha: string, commits: BranchCommits): string {
  const i = commits.shas.indexOf(sha);
  const raw = i >= 0 ? (commits.subjects[i] ?? "") : "";
  const points = [...raw];
  return points.length > SUBJECT_DISPLAY_CAP ? points.slice(0, SUBJECT_DISPLAY_CAP - 1).join("") + "…" : raw;
}

/** Price each segment through the existing model builder (no new pricing paths). */
export async function buildPerCommitRows(session: Session, segments: PerCommitSegment[]): Promise<PerCommitRow[]> {
  const rows: PerCommitRow[] = [];
  for (const seg of segments) {
    const model: ReceiptModel = await buildReceiptModel(sliceSessionForReceipt(session, seg));
    const t = model.totalTokens;
    rows.push({
      shortSha: seg.sha.slice(0, 7),
      subject: seg.subject,
      turnCount: seg.endTurn - seg.startTurn + 1,
      usd: model.totalUsd,
      totalTokens: t.input + t.output + t.cacheRead + t.cacheCreation,
      extraCount: seg.extraShas.length,
    });
  }
  return rows;
}

/** Fixed-format table lines for the artifact page (rendered inside a <pre>). */
export function renderPerCommitLines(rows: PerCommitRow[]): string[] {
  const lines = rows.map((r) => {
    const cost = r.usd !== null ? `$${formatUsd(r.usd)}` : `${r.totalTokens} tokens`;
    const extra = r.extraCount > 0 ? `  (+${r.extraCount} more in this turn)` : "";
    const turns = `${r.turnCount} ${r.turnCount === 1 ? "turn" : "turns"}`;
    return `${r.shortSha}  ${r.subject}  ·  ${turns}  ·  ${cost}${extra}`;
  });
  lines.push(`(${PER_COMMIT_METHODOLOGY})`);
  return lines;
}
