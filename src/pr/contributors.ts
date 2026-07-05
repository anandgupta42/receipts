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
import { classifyBranchAnchors, computeSlice, type BranchAnchorSummary, type SliceResult } from "./slice.js";
import { cwdInsideRoots } from "./git.js";
import { isCodexExec, toolCallInvocations } from "./gitWrite.js";
import { claimedBranchShas, eligibleSubjects, hasForeignShaWrites, sessionCommitSubjects } from "./messageAnchor.js";
import type { ConfidenceEvent } from "./confidence.js";

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
  /** `anchor` = own branch-SHA proof; `helper` = the SHA-less current-worktree Codex rule; `message` = the SPEC-0032 commit-message fallback (weaker, labeled on the row). */
  basis: "anchor" | "helper" | "message";
}

export interface ContributorSelection {
  contributors: RawContributor[];
  /** Plausible (this-worktree) candidates that were NOT credited — surfaced, never hidden (R4). */
  excludedCount: number;
  /**
   * SPEC-0044 R1 — every drop/degrade routed as a typed ConfidenceEvent. The
   * source of truth behind the receipt's incompleteness signals; `excludedCount`
   * is retained (well-tested) and mirrored as `silenced-git-write` events, while
   * A1's anchor-pool full-fallback drops surface ONLY here (never silent).
   */
  events: ConfidenceEvent[];
}

export interface ContributorDeps {
  loadSession: (summary: SessionSummary) => Promise<Session | null>;
  /** The process's own worktree root — the SHA-less Codex helper rule is scoped to it (R1). `null` → helper rule off. */
  currentWorktreeRoot: string | null;
  /** Branch commit subjects aligned with `branchShas` (SPEC-0032). Absent/empty → message fallback off. */
  branchSubjects?: readonly string[];
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
  const events: ConfidenceEvent[] = [];
  // excludedCount derives from the silenced-git-write events (kept as a field
  // for the well-tested body wiring); the events are the R1 source of truth.
  // filePath is the file-unique identity; summary.id collides across nested
  // candidates (nestedCandidates synthesizes id: agentId) — S2 finding 3.
  const excludeHere = (summary: SessionSummary): void => {
    events.push({ kind: "silenced-git-write", sessionId: summary.filePath });
  };

  // Pass 1 — load and classify EVERYTHING first, so SHA claims are computed
  // from the full candidate list before any message credit is considered:
  // a SHA-crediting session anywhere in the list claims its commit regardless
  // of order (SPEC-0032 R3a — order independence).
  interface Loaded {
    summary: SessionSummary;
    here: boolean;
    pool: CandidatePool;
    session: Session | null;
    anchors: BranchAnchorSummary | null;
  }
  const loaded: Loaded[] = [];
  for (const { summary, pool } of candidates) {
    // `here` gates the softeners (helper rule, excluded count, message
    // fallback) — always false for the anchor pool, where the SHA anchor is
    // the only key (SPEC-0024 R1).
    const here = pool === "repo" && inCurrentWorktree(summary, deps.currentWorktreeRoot);
    const session = await deps.loadSession(summary);
    loaded.push({ summary, here, pool, session, anchors: session ? classifyBranchAnchors(session.turns, branchShas) : null });
  }

  // SPEC-0032 R3 — the eligible-subject set: branch subjects on commits no
  // candidate SHA-claims, unique on the branch. Empty when subjects weren't
  // supplied (fallback off).
  const claimedShas = new Set<string>();
  for (const l of loaded) {
    if (l.session) {
      // Any write verb claims (push output too — a push-anchored commit's
      // subject must not stay eligible; S5 finding 1).
      for (const sha of claimedBranchShas(l.session, branchShas)) {
        claimedShas.add(sha);
      }
    }
  }
  const subjects = deps.branchSubjects ?? [];
  const eligible = subjects.length > 0 ? eligibleSubjects(branchShas, subjects, claimedShas) : new Set<string>();

  // SPEC-0032 R4d — claims are counted BEFORE the per-session filters (R4b/
  // R4c), so a disqualified claimant still poisons its subject: "exactly ONE
  // candidate claims that eligible subject" means one claim TOTAL, not one
  // surviving claim (S5 finding 2).
  const claimCounts = new Map<string, number>();
  const perSession = new Map<Loaded, string[]>();
  for (const l of loaded) {
    if (!l.session || !l.anchors || !l.here) {
      continue;
    }
    const isCodex = l.summary.source === "codex";
    const shaIncluded = l.anchors.hasOwn || (isCodex && l.anchors.writeCount === 0);
    if (shaIncluded) {
      continue;
    }
    const matched = sessionCommitSubjects(l.session).filter((s) => eligible.has(s));
    perSession.set(l, matched);
    for (const subject of matched) {
      claimCounts.set(subject, (claimCounts.get(subject) ?? 0) + 1);
    }
  }
  const messageCredited = new Set<Loaded>();
  for (const [l, matched] of perSession) {
    // R4c exactly one match; R4d that subject claimed exactly once overall;
    // R4b no SHA-proven writes elsewhere.
    if (matched.length === 1 && claimCounts.get(matched[0]) === 1 && l.session && !hasForeignShaWrites(l.session, branchShas)) {
      messageCredited.add(l);
    }
  }

  // Pass 2 — assemble in candidate order with the original SHA/helper rules;
  // the message fallback only ever converts an excluded-but-here session.
  for (const l of loaded) {
    const { summary, here, session, anchors } = l;
    if (!session || !anchors) {
      // A candidate we can't load can't be proven — count it only if it's plausibly ours.
      if (here) {
        excludeHere(summary);
      }
      continue;
    }
    const isCodex = summary.source === "codex";
    // Own branch SHA → contributes (any source, any pool, SHA-proven). Codex
    // that made NO git writes at all AND ran in this worktree → a pure helper
    // (cwd+time, repo pool only). A session that committed/pushed but produced
    // no branch SHA, or a SHA-less Codex session from a sibling worktree or
    // the anchor pool, is not proven ours (R1) — unless the SPEC-0032 message
    // fallback structurally credits it (weaker basis, labeled on the row).
    const include = anchors.hasOwn || (isCodex && anchors.writeCount === 0 && here);
    if (include) {
      const slice = computeSlice(session.turns, branchShas);
      // SPEC-0038 R2a — an anchor-pool session contributes ONLY with a
      // sliceable own commit anchor. Entire-session + full rollup landing
      // cross-project was PR #87's maximum-misstatement shape; a full-
      // fallback here is silently ignored, exactly SPEC-0024's miss
      // semantics (never excludedCount — the fence's "in repo + branch
      // window" copy stays true).
      if (l.pool === "anchor" && slice.kind === "full") {
        // SPEC-0044 A1 — too uncertain to credit (a full-session fallback landing
        // cross-project was PR #87's max-misstatement shape), but its absence is
        // NEVER silent: it emits a typed event so the total floors `≥` and the
        // receipt counts it (the coverage-map C.2 hole, the mirror of #87).
        events.push({ kind: "unattributable-anchor-pool", sessionId: summary.filePath });
        continue;
      }
      contributors.push({
        summary,
        session,
        slice,
        basis: anchors.hasOwn ? "anchor" : "helper",
      });
    } else if (messageCredited.has(l)) {
      contributors.push({
        summary,
        session,
        // No SHA in output → no turn range; the labeled full-session fallback
        // stays (SPEC-0032 R5 — credit, never slicing).
        slice: computeSlice(session.turns, branchShas),
        basis: "message",
      });
    } else if (here) {
      // Plausibly ours (this worktree) but unproven — surface it in the honest note.
      excludeHere(summary);
    }
    // else: a sibling-worktree or anchor-pool candidate with no branch-SHA proof — not ours, ignored.
  }

  contributors.sort(
    (a, b) => (a.session.startedAt ?? 0) - (b.session.startedAt ?? 0) || a.summary.id.localeCompare(b.summary.id),
  );
  const excludedCount = new Set(
    events.filter((e) => e.kind === "silenced-git-write").map((e) => e.sessionId),
  ).size;
  return { contributors, excludedCount, events };
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
