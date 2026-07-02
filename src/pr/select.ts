// SPEC-0019 R1b/R1d — pick the session that built this branch. A candidate must
// live in one of the repo's worktrees (R1b) AND overlap the branch's commit
// window in time (R1d). Zero candidates → caller errors; multiple → caller lists
// them and requires --session (never guess). Slicing (R1e) happens only after a
// single session is chosen; time is a filter here, never the slicer.
import type { SessionSummary } from "../parse/types.js";
import { cwdInsideRoots } from "./git.js";

/** ±15 min slack around the session window (R1d). */
export const OVERLAP_SLACK_MS = 15 * 60 * 1000;

export type Selection =
  | { kind: "one"; summary: SessionSummary }
  | { kind: "many"; matches: SessionSummary[] }
  | { kind: "none" };

/** A commit instant falls inside the session window padded by ±15 min (R1d). */
function overlaps(startedAt: number, endedAt: number, commitMs: readonly number[]): boolean {
  const lo = startedAt - OVERLAP_SLACK_MS;
  const hi = endedAt + OVERLAP_SLACK_MS;
  return commitMs.some((c) => c >= lo && c <= hi);
}

/**
 * Auto-select among `sessions` those whose `cwd` is inside a repo worktree root
 * and whose time window overlaps a branch commit. Sessions missing `cwd` or
 * either timestamp are never auto-attributed (R1a/R1d). Subagent transcripts
 * are excluded (they roll up into their parent, R1c).
 */
export function selectCandidates(
  sessions: SessionSummary[],
  roots: string[],
  commitMs: readonly number[],
): Selection {
  const matches = sessions.filter(
    (s) =>
      !s.isSidechain &&
      typeof s.cwd === "string" &&
      cwdInsideRoots(s.cwd, roots) &&
      s.startedAt !== undefined &&
      s.endedAt !== undefined &&
      overlaps(s.startedAt, s.endedAt, commitMs),
  );
  if (matches.length === 0) {
    return { kind: "none" };
  }
  if (matches.length === 1) {
    return { kind: "one", summary: matches[0] };
  }
  return { kind: "many", matches };
}
