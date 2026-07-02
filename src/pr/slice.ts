// SPEC-0019 R1e(d)(e)(f) — PR-scoped turn slicing over one session. Pure: given
// the session's turns and the branch's commit SHAs, decide the turn range whose
// receipt is THIS PR's cost. Time windows (R1d) only FILTER candidate sessions;
// they never slice. When attribution is ambiguous (no own commit anchor, or a
// rebase/amend leaves only a push anchor), we render the labeled full session
// rather than a confident wrong cut (I3 applied to attribution).
import type { Turn } from "../parse/types.js";
import { hexRuns, matchesBranchSha, toolCallGitVerb, type GitVerb } from "./gitWrite.js";

/** The label shown when a slice can't be computed — full-session cost is never presented as PR cost unlabeled. */
export const FULL_FALLBACK_LABEL = "entire session (slice unavailable)";

export interface SliceResult {
  /** "slice" → render buildReceiptModel over [startTurn, endTurn]; "full" → whole session, labeled. */
  kind: "slice" | "full";
  /** 0-based inclusive turn indices. For "full", the whole session (0 … turnCount-1). */
  startTurn: number;
  endTurn: number;
  /** Original turn count N, for the `turns A–B of N` header. */
  turnCount: number;
  /** Present only for "full" — the honesty label. */
  label?: string;
}

interface GitAnchor {
  turnIndex: number;
  verb: GitVerb;
  /** true iff a hex run in the OUTPUT prefix-matches a branch SHA (authorship, R1e(c)). */
  own: boolean;
}

/**
 * Every git-write span whose OUTPUT carries at least one ≥7-hex run. A span
 * with no hex run in its output is neither own nor foreign (unusable for
 * slicing) and is dropped here. `own` distinguishes ours (R1e c) from foreign
 * (R1e d — a sibling PR's commit in a multi-PR session).
 */
function classifyAnchors(turns: Turn[], branchShas: readonly string[]): GitAnchor[] {
  const anchors: GitAnchor[] = [];
  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      const verb = toolCallGitVerb(call);
      if (!verb) {
        continue;
      }
      const runs = hexRuns(String(call.output ?? ""));
      if (runs.length === 0) {
        continue;
      }
      anchors.push({ turnIndex: turn.index, verb, own: runs.some((r) => matchesBranchSha(r, branchShas)) });
    }
  }
  return anchors;
}

/**
 * Compute the PR-scoped turn range. See R1e(d)-(f):
 * - no own anchor → labeled full session.
 * - own anchors present but none from a `git commit` (only `git push`) →
 *   labeled full session (stale-anchor / rebase safety).
 * - otherwise slice = (last foreign anchor before our first own anchor)+1
 *   through our last own anchor; no foreign before → from the session start.
 */
export function computeSlice(turns: Turn[], branchShas: readonly string[]): SliceResult {
  const turnCount = turns.length;
  const full = (): SliceResult => ({
    kind: "full",
    startTurn: 0,
    endTurn: Math.max(0, turnCount - 1),
    turnCount,
    label: FULL_FALLBACK_LABEL,
  });

  const anchors = classifyAnchors(turns, branchShas);
  const own = anchors.filter((a) => a.own);
  if (own.length === 0) {
    return full();
  }
  // R1e(f): a push-only own anchor with no own commit anchor is ambiguous (a
  // rebase/amend re-SHA'd the branch) — fall back rather than slice away real work.
  if (!own.some((a) => a.verb === "commit")) {
    return full();
  }

  const firstOwnTurn = Math.min(...own.map((a) => a.turnIndex));
  const lastOwnTurn = Math.max(...own.map((a) => a.turnIndex));
  const foreignBefore = anchors
    .filter((a) => !a.own && a.turnIndex < firstOwnTurn)
    .reduce<number | undefined>((max, a) => (max === undefined ? a.turnIndex : Math.max(max, a.turnIndex)), undefined);

  return {
    kind: "slice",
    startTurn: foreignBefore !== undefined ? foreignBefore + 1 : 0,
    endTurn: lastOwnTurn,
    turnCount,
  };
}
