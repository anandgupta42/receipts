// SPEC-0024 R2 — promote orphan SHA-anchored listed sidechains to top-level
// contributors. An agent-team teammate is a flagged sidechain (`isSidechain`
// in the top-level list) that neither `isBranchCandidate` nor `rollupChildren`
// ever sees — its cost is counted nowhere even when its slice SHA-provably
// authored the branch (issue #51). Promotion is dedup-safe: a candidate whose
// `filePath` is already covered (a contributor itself, or any contributor's
// rolled-up `SubagentRow`) is skipped, so no token is ever counted twice (I3).
import type { Session, SessionSummary } from "../parse/types.js";
import type { RawContributor } from "./contributors.js";
import type { ConfidenceEvent } from "./confidence.js";
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
): Promise<{ promoted: RawContributor[]; events: ConfidenceEvent[] }> {
  const promoted: RawContributor[] = [];
  const events: ConfidenceEvent[] = [];
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
    // SPEC-0038 R2b — promotion requires a sliceable commit anchor: `hasOwn`
    // via push-only output no longer promotes (rebase-safety parity with
    // computeSlice's own rule); a full-fallback sidechain is a silent miss.
    const slice = computeSlice(session.turns, branchShas);
    if (slice.kind === "full") {
      // SPEC-0044 A1 parity: a branch-touching sidechain that can't be sliced is
      // counted-absent, never a silent drop (filePath is the file-unique key).
      events.push({ kind: "unattributable-anchor-pool", sessionId: summary.filePath });
      continue;
    }
    promoted.push({ summary, session, slice, basis: "anchor" });
  }
  return { promoted, events };
}
