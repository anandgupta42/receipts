// SPEC-0027 R2 — the plumbing publisher: orphan creation, sibling
// preservation, overwrite-in-place, the no-porcelain guarantee (kill
// criterion a), the exact command sequence, and the single race retry.
import { describe, expect, it } from "vitest";
import type { CommandResult } from "../../src/pr/git.js";
import { ARTIFACT_BRANCH, publishArtifact } from "../../src/pr/publish.js";

const REPO = "https://github.com/o/r.git";
const TIP = "a".repeat(40);
const TIP2 = "b".repeat(40);
const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });
const fail = (stderr: string): CommandResult => ({ stdout: "", stderr, code: 1, missing: false });

interface Call {
  cmd: string;
  args: string[];
  stdin?: string;
}

/** A recording git mock; `tree` is the remote tip's ls-tree output ("" = branch absent). */
function gitMock(opts: { tree: string | null; pushResults?: CommandResult[]; tips?: (string | null)[] }) {
  const calls: Call[] = [];
  const pushResults = opts.pushResults ?? [ok("")];
  const tips = opts.tips ?? [opts.tree === null ? null : TIP];
  let pushes = 0;
  let lsRemotes = 0;
  const run = (cmd: string, args: string[], o?: { stdin?: string }): CommandResult => {
    calls.push({ cmd, args, stdin: o?.stdin });
    switch (args[0]) {
      case "ls-remote": {
        const tip = tips[Math.min(lsRemotes++, tips.length - 1)];
        return ok(tip === null ? "" : `${tip}\t${args[2]}\n`);
      }
      case "fetch":
        return ok("");
      case "ls-tree":
        return ok(opts.tree ?? "");
      case "hash-object":
        return ok("f".repeat(40));
      case "mktree":
        return ok("e".repeat(40));
      case "commit-tree":
        return ok("d".repeat(40));
      case "push":
        return pushResults[Math.min(pushes++, pushResults.length - 1)];
      default:
        return fail(`unexpected git ${args[0]}`);
    }
  };
  return { run, calls };
}

const publish = (run: (cmd: string, args: string[], o?: { stdin?: string }) => CommandResult) =>
  publishArtifact({ repoUrl: REPO, fileName: "pr-42.html", content: "<!doctype html>", prNumber: 42, run });

describe("SPEC-0027 R2 publishArtifact", () => {
  it("creates the orphan branch when absent: no parent, tree holds only our file", () => {
    const { run, calls } = gitMock({ tree: null });
    expect(publish(run)).toEqual({ ok: true });
    const mktree = calls.find((c) => c.args[0] === "mktree")!;
    expect(mktree.stdin).toBe(`100644 blob ${"f".repeat(40)}\tpr-42.html\n`);
    const commit = calls.find((c) => c.args[0] === "commit-tree")!;
    expect(commit.args).not.toContain("-p");
    // Branch absent → nothing to fetch or list.
    expect(calls.some((c) => c.args[0] === "fetch" || c.args[0] === "ls-tree")).toBe(false);
  });

  it("preserves sibling artifacts: the new tree is tip tree + our path (old comments' links survive)", () => {
    const { run, calls } = gitMock({ tree: `100644 blob ${"1".repeat(40)}\tpr-58.html\n` });
    expect(publish(run)).toEqual({ ok: true });
    const mktree = calls.find((c) => c.args[0] === "mktree")!;
    expect(mktree.stdin).toContain("\tpr-58.html");
    expect(mktree.stdin).toContain("\tpr-42.html");
    const commit = calls.find((c) => c.args[0] === "commit-tree")!;
    expect(commit.args).toContain("-p");
    expect(commit.args).toContain(TIP);
  });

  it("overwrites its own path in place — no duplicate entry on re-publish", () => {
    const { run, calls } = gitMock({ tree: `100644 blob ${"1".repeat(40)}\tpr-42.html\n` });
    expect(publish(run)).toEqual({ ok: true });
    const mktree = calls.find((c) => c.args[0] === "mktree")!;
    expect(mktree.stdin!.match(/\tpr-42\.html/g)).toHaveLength(1);
    expect(mktree.stdin).toContain("f".repeat(40));
  });

  it("issues plumbing only, in order — never porcelain (kill criterion a)", () => {
    const { run, calls } = gitMock({ tree: `100644 blob ${"1".repeat(40)}\tpr-58.html\n` });
    expect(publish(run)).toEqual({ ok: true });
    const verbs = calls.map((c) => c.args[0]);
    expect(verbs).toEqual(["ls-remote", "hash-object", "fetch", "ls-tree", "mktree", "commit-tree", "push"]);
    const allowed = new Set(["ls-remote", "fetch", "ls-tree", "hash-object", "mktree", "commit-tree", "push"]);
    expect(verbs.every((v) => allowed.has(v))).toBe(true);
    const push = calls[calls.length - 1];
    expect(push.args).toEqual(["push", REPO, `${"d".repeat(40)}:refs/heads/${ARTIFACT_BRANCH}`]);
    // The fetch may write loose objects ONLY: no tag auto-following (tags are
    // refs), no FETCH_HEAD (kill criterion a).
    const fetch = calls.find((c) => c.args[0] === "fetch")!;
    expect(fetch.args).toContain("--no-tags");
    expect(fetch.args).toContain("--no-write-fetch-head");
  });

  it("retries exactly once on a lost push race, against the refreshed tip", () => {
    const { run, calls } = gitMock({
      tree: "",
      pushResults: [fail("! [rejected] non-fast-forward"), ok("")],
      tips: [TIP, TIP2],
    });
    expect(publish(run)).toEqual({ ok: true });
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(2);
    const commits = calls.filter((c) => c.args[0] === "commit-tree");
    expect(commits[1].args).toContain(TIP2);
  });

  it("fails visibly when the race is lost twice", () => {
    const { run, calls } = gitMock({ tree: "", pushResults: [fail("non-fast-forward"), fail("non-fast-forward")] });
    const outcome = publish(run);
    expect(outcome.ok).toBe(false);
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(2);
  });

  it("returns a non-race push failure verbatim (no rights) with no retry", () => {
    const { run, calls } = gitMock({ tree: null, pushResults: [fail("remote: Permission denied")] });
    const outcome = publish(run);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toContain("Permission denied");
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(1);
  });
});
