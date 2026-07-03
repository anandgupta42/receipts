// SPEC-0027 R2 — publish the artifact to `aireceipts/artifacts` via git
// plumbing ONLY: hash-object → mktree → commit-tree → push <sha>:refs/…
// The working tree, index, and current branch are never touched (kill
// criterion a); the new tree is the remote tip's tree with our one path
// upserted, so every other PR's artifact survives every publish (an old
// comment's link must never die). One retry on a lost push race, then a
// visible failure — artifact failure is additive-only damage (R3).
import type { CommandRunner } from "./git.js";

export const ARTIFACT_BRANCH = "aireceipts/artifacts";
const ARTIFACT_REF = `refs/heads/${ARTIFACT_BRANCH}`;

export type PublishOutcome = { ok: true } | { ok: false; error: string };

export interface PublishRequest {
  /** Push target — the PR's base repo, resolved once with the blob URL (R3). */
  repoUrl: string;
  fileName: string;
  content: string;
  prNumber: number;
  run: CommandRunner;
}

/** The remote tip sha of the artifact branch, `null` when the branch doesn't exist, or an error string. */
function remoteTip(run: CommandRunner, repoUrl: string): string | null | { error: string } {
  const ls = run("git", ["ls-remote", repoUrl, ARTIFACT_REF]);
  if (ls.code !== 0) {
    return { error: `ls-remote failed: ${ls.stderr.trim()}` };
  }
  const sha = ls.stdout.trim().split(/\s/)[0];
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** Tree entries of the tip commit as mktree input lines, minus our own path. */
function baseEntries(run: CommandRunner, repoUrl: string, tip: string | null, fileName: string): string[] | { error: string } {
  if (tip === null) {
    return [];
  }
  // Objects only: no tag auto-following (tags are refs — kill criterion a)
  // and no FETCH_HEAD write; the odb gains loose objects exactly like
  // hash-object does, nothing else.
  const fetch = run("git", ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", repoUrl, ARTIFACT_REF]);
  if (fetch.code !== 0) {
    return { error: `fetch of ${ARTIFACT_BRANCH} failed: ${fetch.stderr.trim()}` };
  }
  const tree = run("git", ["ls-tree", tip]);
  if (tree.code !== 0) {
    return { error: `ls-tree failed: ${tree.stderr.trim()}` };
  }
  return tree.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => line.split("\t")[1] !== fileName);
}

/** Build the commit for one publish attempt against the given remote tip. */
function buildCommit(req: PublishRequest, tip: string | null): string | { error: string } {
  const blob = req.run("git", ["hash-object", "-w", "--stdin"], { stdin: req.content });
  if (blob.code !== 0) {
    return { error: `hash-object failed: ${blob.stderr.trim()}` };
  }
  const blobSha = blob.stdout.trim();

  const entries = baseEntries(req.run, req.repoUrl, tip, req.fileName);
  if (!Array.isArray(entries)) {
    return entries;
  }
  const lines = [...entries, `100644 blob ${blobSha}\t${req.fileName}`].sort((a, b) =>
    (a.split("\t")[1] ?? "").localeCompare(b.split("\t")[1] ?? ""),
  );
  const mktree = req.run("git", ["mktree"], { stdin: `${lines.join("\n")}\n` });
  if (mktree.code !== 0) {
    return { error: `mktree failed: ${mktree.stderr.trim()}` };
  }
  const treeSha = mktree.stdout.trim();

  const message = `chore: receipt artifact for PR #${req.prNumber}`;
  const args = ["commit-tree", treeSha, ...(tip === null ? [] : ["-p", tip]), "-m", message];
  const commit = req.run("git", args);
  if (commit.code !== 0) {
    return { error: `commit-tree failed: ${commit.stderr.trim()}` };
  }
  return commit.stdout.trim();
}

/**
 * Publish `fileName` to the artifact branch of `repoUrl`. Exactly one retry
 * when the push loses a race (the tip moved between ls-remote and push);
 * every other failure is returned verbatim for the caller's stderr.
 */
export function publishArtifact(req: PublishRequest): PublishOutcome {
  let tip = remoteTip(req.run, req.repoUrl);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tip !== null && typeof tip === "object") {
      return { ok: false, error: tip.error };
    }
    const commitSha = buildCommit(req, tip);
    if (typeof commitSha === "object") {
      return { ok: false, error: commitSha.error };
    }
    const push = req.run("git", ["push", req.repoUrl, `${commitSha}:${ARTIFACT_REF}`]);
    if (push.code === 0) {
      return { ok: true };
    }
    const raced = /non-fast-forward|fetch first|rejected/i.test(`${push.stderr}`);
    if (!raced || attempt === 1) {
      return { ok: false, error: `push to ${ARTIFACT_BRANCH} failed: ${push.stderr.trim()}` };
    }
    tip = remoteTip(req.run, req.repoUrl);
  }
  return { ok: false, error: `push to ${ARTIFACT_BRANCH} failed after retry` };
}
