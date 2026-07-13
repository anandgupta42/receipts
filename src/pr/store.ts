// SPEC-0065 R1 — pure git-plumbing ref store for `store=ref` PR receipts.
// Writes the schema-versioned `PrReceiptPayload` as a git object on
// `refs/aireceipts/<slug>` via plumbing only (`hash-object` → `mktree` →
// `commit-tree` → `update-ref`), touching no index or worktree. The wrapping
// commit is dated from the receipt's own `endedAt` (never wall-clock) with a
// fixed author/committer identity, so the same payload yields the same
// commit SHA on every machine (I1/I5). Uses its own `spawnSync` wrapper
// below — not `CommandRunner` from `./git.js` — because pinning
// `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` needs an env-injection seam
// `CommandRunner` doesn't have.
import { spawnSync } from "node:child_process";

/**
 * Fixed identity for every receipt-ref commit, pinned via ENV — `GIT_AUTHOR_*` /
 * `GIT_COMMITTER_*` override both `git config` and `-c user.*`, so setting them
 * explicitly is what actually makes the commit deterministic on a machine that
 * has its own identity env set (Codex review). Signing is disabled per-command
 * (`-c commit.gpgsign=false`) so a global `commit.gpgsign=true` can't inject a
 * nondeterministic signature into the object.
 */
const IDENT_ENV = {
  GIT_AUTHOR_NAME: "aireceipts",
  GIT_AUTHOR_EMAIL: "receipts@aireceipts.dev",
  GIT_COMMITTER_NAME: "aireceipts",
  GIT_COMMITTER_EMAIL: "receipts@aireceipts.dev",
} as const;

/**
 * Prefix of every PR-receipt ref (SPEC-0065 R1). Product-namespaced under
 * `refs/aireceipts/` — NOT the generic `refs/receipts/` — so aireceipts never
 * collides with another tool's `refs/receipts/*` producer. That collision was
 * real: a repo running a separate attestation tool on `refs/receipts/*` left
 * `pr-check` reading a foreign payload, failing its `schemaVersion` check, and
 * silently posting nothing (see `src/setup/integrations.ts`). Owning a
 * dedicated namespace lets the two coexist — each reads only its own refs.
 */
export const RECEIPT_REF_PREFIX = "refs/aireceipts/";

/** The full ref name for a slug (from `receiptRefSlug(branch)`), e.g. `refs/aireceipts/feat-x`. */
export function receiptRef(slug: string): string {
  return `${RECEIPT_REF_PREFIX}${slug}`;
}

interface GitResult {
  out: string;
  ok: boolean;
  err: string;
}

interface GitOpts {
  cwd?: string;
  input?: string;
  env?: Record<string, string>;
}

/**
 * Dedicated fixed-env git invocation (SPEC-0065 R1). Deliberately separate
 * from `CommandRunner` (`./git.js`), which has no env-injection seam — this
 * one exists specifically to pin `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` for
 * deterministic commit SHAs.
 */
function git(args: string[], opts: GitOpts = {}): GitResult {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return {
    out: (result.stdout ?? "").trim(),
    ok: result.status === 0,
    err: (result.stderr ?? "").trim(),
  };
}

export type WriteReceiptRefOutcome = { ok: true; ref: string; commit: string } | { ok: false; reason: string };

/**
 * Write `json` as `receipt.json` on `refs/aireceipts/<slug>`, wrapped in a
 * commit dated `<epochSeconds> +0000` derived from `endedAtMs` (never
 * wall-clock) under a fixed identity — so the same `(slug, branch, json,
 * endedAtMs)` always produces the same commit SHA (SPEC-0065 R1/R6).
 */
export function writeReceiptRef(slug: string, branch: string, json: string, endedAtMs: number, cwd?: string): WriteReceiptRefOutcome {
  const blob = git(["hash-object", "-w", "--stdin"], { cwd, input: json });
  if (!blob.ok) {
    return { ok: false, reason: `hash-object failed: ${blob.err}` };
  }
  const blobSha = blob.out;

  const tree = git(["mktree"], { cwd, input: `100644 blob ${blobSha}\treceipt.json\n` });
  if (!tree.ok) {
    return { ok: false, reason: `mktree failed: ${tree.err}` };
  }
  const treeSha = tree.out;

  // Explicit UTC epoch seconds — the deterministic date the whole write hinges on.
  const epochSeconds = Math.max(1, Math.floor((endedAtMs ?? 0) / 1000));
  const dateEnv = `@${epochSeconds} +0000`;
  // Pin every config input to the commit object bytes: no signature, and UTF-8 encoding
  // so a machine's `i18n.commitEncoding` can't write a differing `encoding` header (Codex
  // review). Identity + dates are pinned via env below.
  const commit = git(["-c", "commit.gpgsign=false", "-c", "i18n.commitEncoding=UTF-8", "commit-tree", treeSha, "-m", `receipt: ${branch}`], {
    cwd,
    env: {
      ...IDENT_ENV,
      GIT_AUTHOR_DATE: dateEnv,
      GIT_COMMITTER_DATE: dateEnv,
    },
  });
  if (!commit.ok) {
    return { ok: false, reason: `commit-tree failed: ${commit.err}` };
  }
  const commitSha = commit.out;

  const ref = receiptRef(slug);
  const update = git(["update-ref", ref, commitSha], { cwd });
  if (!update.ok) {
    return { ok: false, reason: `update-ref failed: ${update.err}` };
  }
  return { ok: true, ref, commit: commitSha };
}

/** Read back `receipt.json` from `refs/aireceipts/<slug>`, or `null` when the ref or blob doesn't exist. */
export function readReceiptRef(slug: string, cwd?: string): string | null {
  const result = git(["cat-file", "blob", `${receiptRef(slug)}:receipt.json`], { cwd });
  return result.ok ? result.out : null;
}

/** Best-effort push of one receipt ref to `remote` (force-updates the remote ref to match local). */
export function pushReceiptRef(slug: string, remote = "origin", cwd?: string): boolean {
  const ref = receiptRef(slug);
  const result = git(["push", remote, `+${ref}:${ref}`], { cwd });
  return result.ok;
}

/**
 * SPEC-0066 R1 — fetch one receipt ref from `remoteUrl` into the local ref namespace,
 * for the CI side. `remoteUrl` is the PR head repo's clone URL (a fork's own URL), never
 * a named remote. Returns whether the ref now exists locally. `--no-tags` keeps the fetch
 * to exactly the one receipt ref.
 */
export function fetchReceiptRef(slug: string, remoteUrl: string, cwd?: string): boolean {
  const ref = receiptRef(slug);
  const fetched = git(["fetch", "--no-tags", remoteUrl, `+${ref}:${ref}`], { cwd });
  if (!fetched.ok) {
    return false;
  }
  return git(["cat-file", "-e", `${ref}:receipt.json`], { cwd }).ok;
}

export interface ReceiptRefEntry {
  ref: string;
  slug: string;
}

/** All local receipt refs (SPEC-0065 R5 — local tooling reads these alongside file/session discovery). */
export function listReceiptRefs(cwd?: string): ReceiptRefEntry[] {
  const result = git(["for-each-ref", RECEIPT_REF_PREFIX, "--format=%(refname)"], { cwd });
  if (!result.ok || !result.out) {
    return [];
  }
  return result.out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((ref) => ({ ref, slug: ref.slice(RECEIPT_REF_PREFIX.length) }));
}
