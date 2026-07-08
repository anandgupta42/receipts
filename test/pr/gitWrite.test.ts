// SPEC-0019 R1e(b)(c) — the tokenized git-write matcher and output-only hex
// authorship. The load-bearing case: an orchestrator running
// `codex exec "…git push…"` must NEVER be read as a real push.
import { describe, expect, it } from "vitest";
import { classifyPush, gitWriteVerb, hexRuns, matchesBranchSha, toolCallGitVerb, toolCallInvocations } from "../../src/pr/gitWrite.js";
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

describe("SPEC-0073 classifyPush", () => {
  it.each([
    [["git", "push"]],
    [["git", "push", "origin"]],
    [["git", "push", "origin", "feat"]],
    [["git", "push", "origin", "HEAD:refs/heads/main"]],
    [["GIT_SSH_COMMAND=ssh -i key", "git", "push", "origin", "feat"]],
    [["git", "push", "--force-with-lease"]],
    [["git", "push", "-u", "origin", "feat"]],
  ])("attaches on branch push argv %j", (argv) => {
    expect(classifyPush(argv).attach).toBe(true);
  });

  it.each([
    [["npm", "test"]],
    [["git", "status"]],
    [["git", "push", "--dry-run"]],
    [["git", "push", "--delete", "origin", "feat"]],
    [["git", "push", "-d", "origin", "feat"]],
    [["git", "push", "--tags"]],
    [["git", "push", "--prune", "origin"]],
    [["git", "push", "--mirror"]],
    [["git", "push", "--all"]],
    [["git", "push", "upstream", "feat"]],
    [["git", "push", "origin", "refs/receipts/x"]],
    [["git", "push", "origin", "+refs/receipts/x:refs/receipts/x"]],
    [["git", "push", "origin", "HEAD"]],
    [["git", "push", "origin", "abc1234:refs/heads/tmp"]],
    [["git", "-C", "sub", "push", "origin", "feat"]],
    [["git", "--git-dir=/other/.git", "--work-tree=/other", "push", "origin", "feat"]],
    [["git", "--namespace=ns", "push", "origin", "feat"]],
  ])("does not attach on non-branch, retargeted, or ambiguous argv %j", (argv) => {
    expect(classifyPush(argv).attach).toBe(false);
  });

  it("uses the tokenized invocation view so quoted, heredoc, and compound pushes do not attach", () => {
    const attaches = (command: string) => {
      const call: ToolCall = { name: "Bash", shell: true, input: { command } };
      const invocations = toolCallInvocations(call);
      return invocations.length === 1 && classifyPush(invocations[0]).attach;
    };

    expect(attaches('echo "git push"')).toBe(false);
    expect(attaches("cat <<'EOF'\ngit push\nEOF")).toBe(false);
    expect(attaches("npm test && git push")).toBe(false);
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
