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

/**
 * SPEC-0024 R1 — which pool admitted a candidate decides its credit rules:
 * `repo` (cwd in a repo worktree, non-sidechain — SPEC-0023's set) keeps the
 * SHA-less Codex helper rule and the honest excluded count; `anchor` (any
 * other time-overlapping session, any cwd) is credited on an own branch-SHA
 * anchor ONLY, and its misses are silently ignored — another repo's work is
 * not "plausibly ours" noise.
 */
export type CandidatePool = "repo" | "anchor";

export interface PoolCandidate {
  summary: SessionSummary;
  pool: CandidatePool;
}

/** One session credited to the PR: the loaded session, its own PR-scoped slice, and how it was credited (SPEC-0026 R3). */
export interface RawContributor {
  summary: SessionSummary;
  session: Session;
  slice: SliceResult;
  /** `anchor` = own branch-SHA proof; `helper` = the SHA-less current-worktree Codex rule. */
  basis: "anchor" | "helper";
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
 * Select the contributing sessions from pre-filtered, pool-tagged candidates
 * (R1; SPEC-0024 widens). Loads each candidate to inspect its git-write
 * anchors. A branch-SHA anchor credits any session regardless of pool or
 * worktree (SHA proof); the SHA-less Codex helper rule and the honest excluded
 * count apply to the repo pool only — an anchor-pool candidate (cross-repo cwd
 * or none) is credited on its own anchor or silently ignored. Deterministic
 * order: chronological by start, then session id.
 */
export async function selectContributors(
  candidates: PoolCandidate[],
  branchShas: readonly string[],
  deps: ContributorDeps,
): Promise<ContributorSelection> {
  const contributors: RawContributor[] = [];
  let excludedCount = 0;

  for (const { summary, pool } of candidates) {
    // `here` gates both softeners (helper rule, excluded count) — always false
    // for the anchor pool, where the SHA anchor is the only key (SPEC-0024 R1).
    const here = pool === "repo" && inCurrentWorktree(summary, deps.currentWorktreeRoot);
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
    // Own branch SHA → contributes (any source, any pool, SHA-proven). Codex
    // that made NO git writes at all AND ran in this worktree → a pure helper
    // (cwd+time, repo pool only). A session that committed/pushed but produced
    // no branch SHA, or a SHA-less Codex session from a sibling worktree or
    // the anchor pool, is not proven ours (R1).
    const include = anchors.hasOwn || (isCodex && anchors.writeCount === 0 && here);
    if (include) {
      contributors.push({
        summary,
        session,
        slice: computeSlice(session.turns, branchShas),
        basis: anchors.hasOwn ? "anchor" : "helper",
      });
    } else if (here) {
      // Plausibly ours (this worktree) but unproven — surface it in the honest note.
      excludedCount++;
    }
    // else: a sibling-worktree or anchor-pool candidate with no branch-SHA proof — not ours, ignored.
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
