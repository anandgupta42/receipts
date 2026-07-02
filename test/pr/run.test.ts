// SPEC-0019 R3 — render-first, fail-visible. The full body is ALWAYS written to
// stdout before any gh call; a failed/absent gh only adds a stderr diagnostic and
// exits 1. Also covers auto-select success and the zero/many selection outcomes.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import type { CommandResult, CommandRunner } from "../../src/pr/git.js";
import { DOGFOOD_MARKER } from "../../src/pr/body.js";
import { runPr, type PrDeps } from "../../src/pr/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const ANCHORS = path.join(FIX, "claude-anchors.jsonl");
const PARENT_WITH_SUBAGENTS = path.join(FIX, "parent-with-subagents.jsonl");
const CHILD_ONE = path.join(FIX, "parent-with-subagents", "subagents", "agent-child1.jsonl");
const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });

/** git mock: one worktree at /home/dev/repo, one branch commit (our SHA) at 10:02. */
const gitOk: CommandRunner = (_cmd, args) => {
  if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
  if (args[0] === "rev-parse") return ok("origin/main\n");
  if (args[0] === "merge-base") return ok("0000000000000000000000000000000000000000\n");
  if (args[0] === "log") return ok("b1c2d3e4f5061728394a5b6c7d8e9f0011223344|2026-06-28T10:02:00.000Z\n");
  return { stdout: "", stderr: "", code: 1, missing: false };
};

const gitSubagentTime: CommandRunner = (_cmd, args) => {
  if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
  if (args[0] === "rev-parse") return ok("origin/main\n");
  if (args[0] === "merge-base") return ok("0000000000000000000000000000000000000000\n");
  if (args[0] === "log") return ok("1111111111111111111111111111111111111111|2026-06-27T12:01:00.000Z\n");
  return { stdout: "", stderr: "", code: 1, missing: false };
};

async function makeDeps(over: Partial<PrDeps> = {}): Promise<{ deps: PrDeps; events: string[]; out: string[]; err: string[] }> {
  const session = (await loadById("claude-code", ANCHORS))!;
  const events: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: PrDeps = {
    listSessions: async () => [session],
    loadSession: async (summary) => loadById(summary.source, summary.id),
    runGit: gitOk,
    runGh: () => ok("[]"),
    rollup: async () => [],
    cwd: "/home/dev/repo",
    out: (s) => {
      events.push("OUT");
      out.push(s);
    },
    err: (s) => {
      events.push("ERR");
      err.push(s);
    },
    ...over,
  };
  return { deps, events, out, err };
}

describe("R3 render-first ordering", () => {
  it("auto-selects, slices, and dry-runs the body to stdout (no gh, exit 0)", async () => {
    let ghCalled = false;
    const { deps, out } = await makeDeps({
      runGh: () => {
        ghCalled = true;
        return ok("[]");
      },
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(ghCalled).toBe(false);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(out[0]).toContain("session slice: turns 2–4 of 6");
  });

  it("explicit --session can select a subagent by stem, render, and post", async () => {
    const parent = (await loadById("claude-code", PARENT_WITH_SUBAGENTS))!;
    const ghCalls: string[] = [];
    const gh: CommandRunner = (_cmd, args) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr") return ok('{"number": 26}');
      return ok("[]");
    };
    const { deps, out, err } = await makeDeps({
      listSessions: async () => [parent],
      runGit: gitSubagentTime,
      runGh: gh,
    });
    const code = await runPr({ post: true, session: "agent-child1" }, deps);
    expect(code).toBe(0);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(out[0]).toContain("session `agent-child1`");
    expect(ghCalls.some((c) => c.includes("issues/26/comments"))).toBe(true);
    expect(err.join("\n")).toContain("posted receipt (created) to PR #26");
  });

  it("posts after rendering: body to stdout FIRST, then the gh upsert (exit 0)", async () => {
    const ghCalls: string[] = [];
    const gh: CommandRunner = (_cmd, args) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr") return ok('{"number": 7}');
      return ok("[]");
    };
    const { deps, out } = await makeDeps({ runGh: gh });
    const code = await runPr({ post: true }, deps);
    expect(code).toBe(0);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(ghCalls.some((c) => c.startsWith("pr view"))).toBe(true);
  });

  it("gh missing: prints the body FIRST, then a stderr diagnostic, exit 1", async () => {
    const { deps, events, out, err } = await makeDeps({
      runGh: () => ({ stdout: "", stderr: "", code: null, missing: true }),
    });
    const code = await runPr({ post: true }, deps);
    expect(code).toBe(1);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(events.indexOf("OUT")).toBeLessThan(events.indexOf("ERR"));
    expect(err.join("\n")).toContain("copy the receipt above");
  });

  it("not a PR: body first, stderr diagnostic, exit 1", async () => {
    const gh: CommandRunner = (_cmd, args) =>
      args[0] === "pr" ? { stdout: "", stderr: "no pr", code: 1, missing: false } : ok("[]");
    const { deps, events, out } = await makeDeps({ runGh: gh });
    const code = await runPr({ post: true }, deps);
    expect(code).toBe(1);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(events.indexOf("OUT")).toBeLessThan(events.indexOf("ERR"));
  });
});

describe("R1d selection outcomes", () => {
  it("zero matches → stderr message, exit 1, nothing rendered", async () => {
    // Worktree root does not contain the fixture session's cwd (/home/dev/repo).
    const gitElsewhere: CommandRunner = (_cmd, args) =>
      args[0] === "worktree" ? ok("worktree /other/root\n") : gitOk(_cmd, args);
    const { deps, out, err } = await makeDeps({ runGit: gitElsewhere });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--session");
  });

  it("multiple matches → lists ids and requires --session, exit 1", async () => {
    const session = (await loadById("claude-code", ANCHORS))!;
    const { deps, out, err } = await makeDeps({
      listSessions: async () => [session, { ...session, id: "dupe", filePath: "dupe.jsonl" }],
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("multiple sessions match");
  });

  it("auto-selection still skips a sidechain transcript", async () => {
    const child = (await loadById("claude-code", CHILD_ONE))!;
    const { deps, out, err } = await makeDeps({ listSessions: async () => [child], runGit: gitSubagentTime });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("no session matches");
  });

  it("bogus explicit --session id errors without rendering", async () => {
    const { deps, out, err } = await makeDeps();
    const code = await runPr({ post: false, session: "missing-child" }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain('no session matched "missing-child"');
  });
});
