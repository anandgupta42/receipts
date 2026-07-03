// SPEC-0024 R2 — promote orphan SHA-anchored listed sidechains to top-level
// contributors. An agent-team teammate is a flagged sidechain (`isSidechain`
// in the top-level list) that neither `isBranchCandidate` nor `rollupChildren`
// ever sees — its cost is counted nowhere even when its slice SHA-provably
// authored the branch (issue #51). Promotion is dedup-safe: a candidate whose
// `filePath` is already covered (a contributor itself, or any contributor's
// rolled-up `SubagentRow`) is skipped, so no token is ever counted twice (I3).
import type { Session, SessionSummary } from "../parse/types.js";
import type { RawContributor } from "./contributors.js";
import { classifyBranchAnchors, computeSlice } from "./slice.js";

/**
 * Load each time-overlapping listed sidechain and promote it iff it carries an
 * own branch-SHA anchor and is not already counted elsewhere. Anchor-only:
 * there is no cwd+time credit for sidechains, and misses are silently ignored
 * (another parent's work is not "plausibly ours" noise). Deterministic order:
 * chronological by start, then session id.
 */
export async function promoteOrphanSidechains(
  sidechains: SessionSummary[],
  branchShas: readonly string[],
  coveredFilePaths: ReadonlySet<string>,
  loadSession: (summary: SessionSummary) => Promise<Session | null>,
): Promise<RawContributor[]> {
  const promoted: RawContributor[] = [];
  const ordered = [...sidechains].sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id),
  );
  for (const summary of ordered) {
    if (coveredFilePaths.has(summary.filePath)) {
      continue;
    }
    const session = await loadSession(summary);
    if (!session) {
      continue;
    }
    if (!classifyBranchAnchors(session.turns, branchShas).hasOwn) {
      continue;
    }
    promoted.push({ summary, session, slice: computeSlice(session.turns, branchShas) });
  }
  return promoted;
}
