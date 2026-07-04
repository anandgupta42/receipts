// SPEC-0019 R1e(b)(c) — the tokenized git-write matcher and output-only hex
// authorship. The load-bearing case: an orchestrator running
// `codex exec "…git push…"` must NEVER be read as a real push.
import { describe, expect, it } from "vitest";
import { gitWriteVerb, hexRuns, matchesBranchSha, toolCallGitVerb } from "../../src/pr/gitWrite.js";
import type { ToolCall } from "../../src/parse/types.js";

describe("gitWriteVerb (tokenized argv)", () => {
  it("matches a plain git commit / push", () => {
    expect(gitWriteVerb(["git", "commit", "-m", "x"])).toBe("commit");
    expect(gitWriteVerb(["git", "push"])).toBe("push");
    expect(gitWriteVerb(["/usr/bin/git", "push", "origin", "main"])).toBe("push");
  });

  it("skips global options before the subcommand", () => {
    expect(gitWriteVerb(["git", "-C", "/repo", "commit", "-m", "x"])).toBe("commit");
    expect(gitWriteVerb(["git", "-c", "user.name=x", "--no-pager", "push"])).toBe("push");
  });

  it("does not match non-write git subcommands or non-git argv0", () => {
    expect(gitWriteVerb(["git", "status"])).toBeNull();
    expect(gitWriteVerb(["git", "log", "--oneline"])).toBeNull();
    expect(gitWriteVerb(["codex", "exec", "git push origin main"])).toBeNull();
    expect(gitWriteVerb(["echo", "git", "commit"])).toBeNull();
  });
});

describe("toolCallGitVerb (across input shapes)", () => {
  const call = (input: unknown): ToolCall => ({ name: "Bash", shell: true, input });

  it("reads Claude's {command} string and splits compound commands", () => {
    expect(toolCallGitVerb(call({ command: "git add -A && git commit -m 'msg'" }))).toBe("commit");
    expect(toolCallGitVerb(call({ command: "pnpm test && git push" }))).toBe("push");
    expect(toolCallGitVerb(call({ command: "pnpm build" }))).toBeNull();
  });

  it("reads Codex's argv and cmd shapes", () => {
    expect(toolCallGitVerb(call({ command: ["git", "commit", "-m", "x"] }))).toBe("commit");
    expect(toolCallGitVerb(call({ cmd: "git push origin main" }))).toBe("push");
  });

  it("R1e tokenized matcher: `codex exec \"…git push…\"` is NOT an anchor", () => {
    // argv: quoted instruction is ONE token; argv0 is codex, not git.
    expect(toolCallGitVerb(call({ command: ["codex", "exec", "fix it and then git push origin main"] }))).toBeNull();
    // Even as a raw string, the quoted instruction never starts a new command.
    expect(toolCallGitVerb(call({ command: 'codex exec "fix it and then git push origin main"' }))).toBeNull();
  });

  it("recurses into a shell wrapper (bash -lc \"git commit …\")", () => {
    expect(toolCallGitVerb(call({ command: ["bash", "-lc", "git add -A && git commit -m x"] }))).toBe("commit");
  });

  it("an operator inside quotes never splits a command", () => {
    expect(toolCallGitVerb(call({ command: 'git commit -m "done && shipped; really"' }))).toBe("commit");
  });
});

describe("hex authorship (output-only)", () => {
  const branchShas = ["b1c2d3e4f5061728394a5b6c7d8e9f0011223344", "c9d8e7f6a5b4c3d2e1f00918273645546372819a"];

  it("extracts ≥7-char hex runs, splitting on non-hex boundaries", () => {
    expect(hexRuns("[featB b1c2d3e] feat B")).toEqual(["b1c2d3e"]);
    expect(hexRuns("   b1c2d3e..c9d8e7f  featB -> featB")).toEqual(["b1c2d3e", "c9d8e7f"]);
    expect(hexRuns("nothing to commit, working tree clean")).toEqual([]);
  });

  it("a short SHA in output prefix-matches its full branch SHA", () => {
    expect(matchesBranchSha("b1c2d3e", branchShas)).toBe(true);
    expect(matchesBranchSha("a1a1a1a", branchShas)).toBe(false);
  });
});
