// SPEC-0019 R2 — gh upsert: resolve PR, list comments, PATCH the marked comment
// by id (or POST create). `gh pr comment --edit-last` must NEVER be invoked.
import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../../src/pr/git.js";
import { DOGFOOD_MARKER } from "../../src/pr/body.js";
import { repoVisibility, upsertPrComment } from "../../src/pr/comment.js";

interface Call {
  cmd: string;
  args: string[];
  stdin?: string;
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });

/** A gh mock that dispatches on args; records every call for assertions. */
function mockGh(commentsJson: string): { run: CommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: CommandRunner = (cmd, args, opts) => {
    calls.push({ cmd, args, stdin: opts?.stdin });
    if (args[0] === "pr" && args[1] === "view") {
      return ok('{"number": 42, "url": "https://github.com/o/r/pull/42"}');
    }
    if (args[0] === "api" && args.includes("--paginate")) {
      return ok(commentsJson);
    }
    if (args[0] === "api") {
      return ok('{"id": 555}'); // PATCH or POST response
    }
    return { stdout: "", stderr: "unexpected", code: 1, missing: false };
  };
  return { run, calls };
}

const body = `${DOGFOOD_MARKER}\n🧾 receipt`;

describe("upsertPrComment", () => {
  it("PATCHes the existing marked comment by id (never appends, never --edit-last)", () => {
    const existing = JSON.stringify([
      { id: 111, body: "unrelated" },
      { id: 999, body: `${DOGFOOD_MARKER}\nold receipt` },
    ]);
    const { run, calls } = mockGh(existing);
    const result = upsertPrComment(body, run);

    expect(result).toEqual({ ok: true, action: "updated", prNumber: 42, ownerRepo: "o/r", commentId: 999 });
    const write = calls.find((c) => c.args.includes("-X"));
    expect(write!.args).toContain("PATCH");
    // S6: endpoints address the PR's BASE repo explicitly, never {owner}/{repo} placeholders.
    expect(write!.args.join(" ")).toContain("repos/o/r/issues/comments/999");
    expect(write!.stdin).toBe(JSON.stringify({ body }));
    // The wrong-comment-risk path is never taken.
    expect(calls.some((c) => c.args.includes("--edit-last"))).toBe(false);
    expect(calls.some((c) => c.args.includes("POST"))).toBe(false);
  });

  it("POSTs a new comment when no marked comment exists", () => {
    const { run, calls } = mockGh(JSON.stringify([{ id: 111, body: "hello" }]));
    const result = upsertPrComment(body, run);
    expect(result).toEqual({ ok: true, action: "created", prNumber: 42, ownerRepo: "o/r" });
    const write = calls.find((c) => c.args.includes("-X"))!;
    expect(write.args).toContain("POST");
    expect(write.args.join(" ")).toContain("repos/o/r/issues/42/comments");
  });

  it("a second post after more commits still edits in place (no spam)", () => {
    // Simulate the state after the first create: the comment now exists.
    const { run, calls } = mockGh(JSON.stringify([{ id: 999, body: `${DOGFOOD_MARKER}\nprev` }]));
    const result = upsertPrComment(body, run);
    expect(result).toMatchObject({ action: "updated", commentId: 999 });
    expect(calls.filter((c) => c.args.includes("-X"))).toHaveLength(1);
  });

  it("reports gh missing distinctly", () => {
    const run: CommandRunner = () => ({ stdout: "", stderr: "", code: null, missing: true });
    const result = upsertPrComment(body, run);
    expect(result).toEqual(expect.objectContaining({ ok: false, missing: true }));
  });

  it("reports not-a-PR", () => {
    const run: CommandRunner = (_cmd, args) =>
      args[0] === "pr" ? { stdout: "", stderr: "no pull requests found", code: 1, missing: false } : ok("[]");
    const result = upsertPrComment(body, run);
    expect(result).toMatchObject({ ok: false });
    expect((result as { missing?: boolean }).missing).toBeUndefined();
  });
});

describe("repoVisibility — SPEC-0035 R5 visibility guard (PR #87 review + its Codex round)", () => {
  it("'private' on a positive answer, via exactly one repos/<ownerRepo> call", () => {
    const calls: Call[] = [];
    const run: CommandRunner = (cmd, args) => {
      calls.push({ cmd, args });
      return ok("true\n");
    };
    expect(repoVisibility("o/r", run)).toBe("private");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["api", "repos/o/r", "--jq", ".private"]);
  });

  it("'public' only on a positive false answer", () => {
    expect(repoVisibility("o/r", () => ok("false\n"))).toBe("public");
  });

  it("'unknown' when the check errors or answers garbage — the caller skips neutrally", () => {
    expect(repoVisibility("o/r", () => ({ stdout: "", stderr: "boom", code: 1, missing: false }))).toBe("unknown");
    expect(repoVisibility("o/r", () => ({ stdout: "", stderr: "", code: null, missing: true }))).toBe("unknown");
    expect(repoVisibility("o/r", () => ok("null\n"))).toBe("unknown");
  });
});
