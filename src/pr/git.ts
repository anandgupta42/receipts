// SPEC-0019 — thin, injectable command runners for `git` and `gh`, plus the
// git-derived facts the pr command needs (worktree roots per R1b, branch SHAs +
// commit dates per R1d/R1e(a)). Every git failure degrades gracefully: callers
// treat missing data as "cannot auto-attribute" or "cannot slice", never a
// crash. Tests inject a fake runner; nothing here shells out under test.
import { spawnSync } from "node:child_process";
import * as path from "node:path";

export interface CommandResult {
  stdout: string;
  stderr: string;
  /** exit code, or null when the binary could not be spawned (e.g. not installed). */
  code: number | null;
  /** true when the binary itself is missing (ENOENT). */
  missing: boolean;
}

/** Run a command, capturing stdout/stderr. Never throws — a spawn failure is reported via `missing`. */
export type CommandRunner = (cmd: string, args: string[], opts?: { stdin?: string; cwd?: string }) => CommandResult;

/** The real runner (production). */
export const defaultRunner: CommandRunner = (cmd, args, opts) => {
  const res = spawnSync(cmd, args, {
    input: opts?.stdin,
    cwd: opts?.cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) {
    const missing = (res.error as NodeJS.ErrnoException).code === "ENOENT";
    return { stdout: "", stderr: String(res.error.message ?? res.error), code: null, missing };
  }
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status, missing: false };
};

/** Cap on branch SHAs consulted for authorship (R1e(a)). */
export const MAX_BRANCH_SHAS = 200;

/** All worktree roots of the current repo (R1b): the process worktree plus its siblings. */
export function worktreeRoots(run: CommandRunner, cwd?: string): string[] {
  const res = run("git", ["worktree", "list", "--porcelain"], { cwd });
  if (res.code !== 0) {
    return [];
  }
  const roots: string[] = [];
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      roots.push(path.resolve(line.slice("worktree ".length).trim()));
    }
  }
  return roots;
}

/**
 * The current process's own worktree root (`git rev-parse --show-toplevel`),
 * or `null` when it can't be resolved. SPEC-0023 scopes the SHA-less Codex
 * helper rule to THIS worktree — a Codex session invoked here during the branch
 * window is plausibly helping this branch; one in a sibling worktree is building
 * another branch and must not be credited (dogfood: `worktreeRoots` returns
 * every worktree of the repo, so cwd+time alone scoops up unrelated concurrent
 * Codex work).
 */
export function currentWorktreeRoot(run: CommandRunner, cwd?: string): string | null {
  const res = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (res.code !== 0 || !res.stdout.trim()) {
    return null;
  }
  return path.resolve(res.stdout.trim());
}

/** The repo's default branch ref for merge-base (origin/HEAD's target, else `main`). */
export function defaultBranchRef(run: CommandRunner, cwd?: string): string {
  const res = run("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd });
  const name = res.code === 0 ? res.stdout.trim() : "";
  if (name && name !== "origin/HEAD") {
    return name;
  }
  // SPEC-0038 (forensic P2, PR #87): agent worktrees carry a local `main`
  // pinned at worktree-creation time; comparing against it inflated the
  // branch-SHA set from 1 commit to 11+ and mis-attributed a lead session.
  // Prefer the remote-tracking ref, which is shared and current.
  const originMain = run("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd });
  return originMain.code === 0 && originMain.stdout.trim() ? "origin/main" : "main";
}

export interface BranchCommits {
  /** Full SHAs, newest-first, capped at MAX_BRANCH_SHAS (R1e(a)). */
  shas: string[];
  /** Committer instants (epoch ms) of the same commits (R1d overlap). */
  commitMs: number[];
  /** First-line subjects of the same commits, same order/cap (SPEC-0031 R2). */
  subjects: string[];
}

/** Parse one `%H%x00%cI%x00%s` log line (SPEC-0031 R2 — NUL-delimited so
 * subjects containing `|`/tabs can't corrupt fields; SPEC-0032 reuses this). */
export function parseBranchCommitLine(line: string): { sha: string; iso: string; subject: string } | null {
  const [sha, iso = "", subject = ""] = line.split("\u0000");
  if (!sha) {
    return null;
  }
  return { sha, iso, subject };
}

/**
 * The branch's commits since its merge-base with the default branch (R1d/R1e a).
 * Empty when the merge-base can't be resolved — the caller then can't slice
 * (→ labeled full session) or can't time-filter (→ no auto match), by design.
 */
export function branchCommits(run: CommandRunner, cwd?: string): BranchCommits {
  const base = defaultBranchRef(run, cwd);
  const mb = run("git", ["merge-base", base, "HEAD"], { cwd });
  if (mb.code !== 0 || !mb.stdout.trim()) {
    return { shas: [], commitMs: [], subjects: [] };
  }
  const mergeBase = mb.stdout.trim();
  const log = run("git", ["log", "--format=%H%x00%cI%x00%s", `${mergeBase}..HEAD`], { cwd });
  if (log.code !== 0) {
    return { shas: [], commitMs: [], subjects: [] };
  }
  const shas: string[] = [];
  const commitMs: number[] = [];
  const subjects: string[] = [];
  for (const line of log.stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseBranchCommitLine(line);
    if (parsed) {
      shas.push(parsed.sha);
      subjects.push(parsed.subject);
      const ms = parsed.iso ? Date.parse(parsed.iso) : NaN;
      if (!Number.isNaN(ms)) {
        commitMs.push(ms);
      }
    }
  }
  return { shas: shas.slice(0, MAX_BRANCH_SHAS), commitMs, subjects: subjects.slice(0, MAX_BRANCH_SHAS) };
}

/** True if `cwd` is at or inside any of `roots` (R1b common-dir containment). */
export function cwdInsideRoots(cwd: string, roots: string[]): boolean {
  const target = path.resolve(cwd);
  return roots.some((root) => {
    const rel = path.relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}
