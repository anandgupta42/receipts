// SPEC-0072 R1 — recover amended/rebased git-commit output SHAs by matching a
// locally resolvable orphan commit's stable patch-id to exactly one branch
// commit. This is intentionally under-crediting: duplicated diffs, empty
// commits, merge commits, missing objects, and git failures produce no match.
import type { Session } from "../parse/types.js";
import type { CommandRunner } from "./git.js";
import { matchesBranchSha, toolCallGitVerb, writeOutputShas } from "./gitWrite.js";

export interface OrphanCommitCandidate {
  /** File-unique session key, used only by callers to route a recovered SHA back to a session. */
  sessionId: string;
  /** A git-commit output SHA/prefix that does not prefix-match any branch SHA. */
  sha: string;
}

export interface AnchorRecoveryInput {
  branchShas: readonly string[];
  candidates: readonly OrphanCommitCandidate[];
  runGit: CommandRunner;
  cwd?: string;
}

/** Commit-output SHAs that are not direct branch anchors and may still be locally recoverable. */
export function orphanCommitOutputShas(session: Session, branchShas: readonly string[]): string[] {
  const out: string[] = [];
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      if (toolCallGitVerb(call) !== "commit") {
        continue;
      }
      for (const sha of writeOutputShas("commit", String(call.output ?? ""))) {
        if (!matchesBranchSha(sha, branchShas) && !out.includes(sha)) {
          out.push(sha);
        }
      }
    }
  }
  return out;
}

function commitExists(runGit: CommandRunner, sha: string, cwd?: string): boolean {
  return runGit("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd }).code === 0;
}

function stablePatchId(runGit: CommandRunner, sha: string, cwd?: string): string | null {
  if (!commitExists(runGit, sha, cwd)) {
    return null;
  }
  const diff = runGit("git", ["diff-tree", "-p", "--no-color", sha], { cwd });
  if (diff.code !== 0 || diff.stdout.trim() === "") {
    return null;
  }
  const patch = runGit("git", ["patch-id", "--stable"], { cwd, stdin: diff.stdout });
  if (patch.code !== 0) {
    return null;
  }
  const [id] = patch.stdout.trim().split(/\s+/);
  return /^[0-9a-f]{40}$/.test(id) ? id : null;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Return recovered orphan -> branch SHA promotions. A promotion exists only
 * when the orphan patch-id maps to one branch commit and that patch-id is not
 * duplicated by any other branch commit or orphan candidate.
 */
export function recoverBranchAnchors(input: AnchorRecoveryInput): Map<string, string> {
  const branchByPatch = new Map<string, string[]>();
  const branchCounts = new Map<string, number>();
  for (const sha of input.branchShas) {
    const patchId = stablePatchId(input.runGit, sha, input.cwd);
    if (patchId === null) {
      continue;
    }
    const shas = branchByPatch.get(patchId) ?? [];
    shas.push(sha);
    branchByPatch.set(patchId, shas);
    bump(branchCounts, patchId);
  }

  const orphanPatches: Array<{ sha: string; patchId: string }> = [];
  const orphanCounts = new Map<string, number>();
  for (const candidate of input.candidates) {
    const patchId = stablePatchId(input.runGit, candidate.sha, input.cwd);
    if (patchId === null) {
      continue;
    }
    orphanPatches.push({ sha: candidate.sha, patchId });
    bump(orphanCounts, patchId);
  }

  const recovered = new Map<string, string>();
  for (const orphan of orphanPatches) {
    const branchMatches = branchByPatch.get(orphan.patchId) ?? [];
    if (branchMatches.length !== 1) {
      continue;
    }
    if ((branchCounts.get(orphan.patchId) ?? 0) !== 1 || (orphanCounts.get(orphan.patchId) ?? 0) !== 1) {
      continue;
    }
    recovered.set(orphan.sha, branchMatches[0]);
  }
  return recovered;
}
