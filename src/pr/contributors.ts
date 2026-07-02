// SPEC-0023 R1/R3 — widen SPEC-0019's one/many/none auto-select to the full set
// of sessions that built this branch, conservatively. A candidate (cwd inside a
// worktree root + time-overlapping the branch, per SPEC-0019's filter) is loaded
// and classified by its branch-SHA anchors: a Claude session contributes iff it
// emitted a branch commit/push SHA (own anchor); a Codex session contributes on
// that OR on making no git writes at all (a pure helper matched on cwd+time).
// Anything whose git writes are foreign-only (another branch) is excluded and
// counted for the honest "not attributed" note. Roles (R3) are descriptive, not
// rankings (I6): codex / orchestrator (spawned subagents or launched agents) /
// builder.
import type { Session, SessionSummary } from "../parse/types.js";
import { classifyBranchAnchors, computeSlice, type SliceResult } from "./slice.js";
import { cwdInsideRoots } from "./git.js";
import { isCodexExec, toolCallInvocations } from "./gitWrite.js";

export type Role = "orchestrator" | "builder" | "codex";

/** One session credited to the PR: the loaded session and its own PR-scoped slice. */
export interface RawContributor {
  summary: SessionSummary;
  session: Session;
  slice: SliceResult;
}

export interface ContributorSelection {
  contributors: RawContributor[];
  /** Plausible (this-worktree) candidates that were NOT credited — surfaced, never hidden (R4). */
  excludedCount: number;
}

export interface ContributorDeps {
  loadSession: (summary: SessionSummary) => Promise<Session | null>;
  /** The process's own worktree root — the SHA-less Codex helper rule is scoped to it (R1). `null` → helper rule off. */
  currentWorktreeRoot: string | null;
}

/** True if the session's cwd is inside the current process's worktree (not a sibling worktree). */
function inCurrentWorktree(summary: SessionSummary, currentRoot: string | null): boolean {
  return typeof summary.cwd === "string" && currentRoot !== null && cwdInsideRoots(summary.cwd, [currentRoot]);
}

/**
 * Select the contributing sessions from pre-filtered candidates (R1). Loads each
 * candidate to inspect its git-write anchors — the summary-level filter has
 * already bounded this to cwd-in-repo, time-overlapping, non-sidechain sessions.
 * A branch-SHA anchor credits any session regardless of worktree (SHA proof);
 * the SHA-less Codex helper rule is scoped to THIS worktree so unrelated
 * concurrent Codex work in sibling worktrees is not credited. Only plausible
 * (this-worktree) exclusions are counted — a sibling-worktree candidate that
 * only passed the repo-wide filter is silently ignored, not reported as noise.
 * Deterministic order: chronological by start, then session id.
 */
export async function selectContributors(
  candidates: SessionSummary[],
  branchShas: readonly string[],
  deps: ContributorDeps,
): Promise<ContributorSelection> {
  const contributors: RawContributor[] = [];
  let excludedCount = 0;

  for (const summary of candidates) {
    const here = inCurrentWorktree(summary, deps.currentWorktreeRoot);
    const session = await deps.loadSession(summary);
    if (!session) {
      // A candidate we can't load can't be proven — count it only if it's plausibly ours.
      if (here) {
        excludedCount++;
      }
      continue;
    }
    const anchors = classifyBranchAnchors(session.turns, branchShas);
    const isCodex = summary.source === "codex";
    // Own branch SHA → contributes (any source, SHA-proven). Codex that made NO
    // git writes at all AND ran in this worktree → a pure helper (cwd+time). A
    // session that committed/pushed but produced no branch SHA, or a SHA-less
    // Codex session from a sibling worktree, is not proven ours (R1).
    const include = anchors.hasOwn || (isCodex && anchors.writeCount === 0 && here);
    if (include) {
      contributors.push({ summary, session, slice: computeSlice(session.turns, branchShas) });
    } else if (here) {
      // Plausibly ours (this worktree) but unproven — surface it in the honest note.
      excludedCount++;
    }
    // else: a sibling-worktree candidate with no branch-SHA proof — another branch's work, ignored.
  }

  contributors.sort(
    (a, b) => (a.session.startedAt ?? 0) - (b.session.startedAt ?? 0) || a.summary.id.localeCompare(b.summary.id),
  );
  return { contributors, excludedCount };
}

/** True if the session spawned subagents or launched another agent (the orchestration signal, R3). */
function launchedAgents(session: Session): boolean {
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      const name = call.name?.toLowerCase();
      if (name === "task" || name === "agent") {
        return true;
      }
      if (toolCallInvocations(call).some(isCodexExec)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The descriptive role of a contributor (R3) — structure, not judgement (I6).
 * `hasChildren` is whether the rollup found on-disk subagents; combined with the
 * in-transcript agent-launch signal it distinguishes an orchestrator from a
 * plain builder.
 */
export function deriveRole(summary: SessionSummary, session: Session, hasChildren: boolean): Role {
  if (summary.source === "codex") {
    return "codex";
  }
  if (hasChildren || launchedAgents(session)) {
    return "orchestrator";
  }
  return "builder";
}
