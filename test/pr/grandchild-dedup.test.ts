// SPEC-0044 B5 — grandchild subagent counted once, not twice.
//
// 3-level nesting P -> A -> B, where the MIDDLE agent A makes its own
// branch-SHA commit and is therefore independently promoted to a top-level
// contributor (SPEC-0038 R3). Before the fix, `discoverChildFiles` walks P's
// `subagents/` dir recursively and flattens EVERY descendant (including B)
// into P's rollup candidates, while A's own rollup ALSO finds B as its direct
// child — B prices twice and the PR total is inflated. After the fix, A's
// entire subtree is excluded from P's rollup (P shows zero subagent rows: A is
// its own contributor, B is A's), while A still rolls up B normally under
// itself (B appears exactly once).
//
// Uses the REAL `rollupChildren`/`discoverChildFiles` (not stubbed), so the
// fixture files on disk are actually walked and priced — this exercises the
// exact bug path end-to-end through `runPr`.
//
// NOTE on the git-log mock: `parseBranchCommitLine` (src/pr/git.ts) parses
// the real `git log --format=%H%x00%cI%x00%s` output, which is NUL-delimited
// (literal `\0` bytes between fields), NOT space-delimited. A space-delimited
// mock silently yields an empty `commitMs`, which makes every branch-candidate
// predicate return false and the whole resolution fail with NO_MATCH. Always
// join mock log lines with the `NUL` constant below.
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runPr, type PrDeps } from "../../src/pr/index.js";
import { rollupChildren } from "../../src/pr/rollup.js";
import { loadById } from "../../src/parse/load.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/pr");
const PARENT = path.join(FIX, "grandchild-parent.jsonl");
const CHILD_A = path.join(FIX, "grandchild-parent/subagents/agent-childA.jsonl");
const GRANDCHILD_B = path.join(FIX, "grandchild-parent/subagents/agent-childA/subagents/agent-grandchildB.jsonl");

const NUL = String.fromCharCode(0);
const SHA_P = "5550001" + "1".repeat(33);
const SHA_A = "6660002" + "2".repeat(33);

/** B's own priced tokens (900 in + 350 cache-write + 220 out) are distinctive
 * enough that its dollar figure ($0.01 at current pricing) is unambiguous
 * evidence of exactly-once pricing once combined with the SUBAGENTS-count
 * assertions below. */

async function run(): Promise<{ code: number; body: string }> {
  const parent = (await loadById("claude-code", PARENT))!;
  const out: string[] = [];
  const err: string[] = [];
  const gitOk = (_cmd: string, args: string[]) => {
    const joined = args.join(" ");
    if (joined.includes("merge-base")) {
      return { stdout: "basebase\n", stderr: "", code: 0, missing: false };
    }
    if (args[0] === "log") {
      return {
        stdout: [
          [SHA_P, "2026-07-04T11:04:00Z", "scaffold"].join(NUL),
          [SHA_A, "2026-07-04T11:02:00Z", "child feature"].join(NUL),
        ].join("\n") + "\n",
        stderr: "",
        code: 0,
        missing: false,
      };
    }
    if (joined.includes("worktree")) {
      return { stdout: "worktree /home/dev/repo\n", stderr: "", code: 0, missing: false };
    }
    if (joined.includes("origin/HEAD") || joined.includes("origin/main")) {
      return { stdout: "origin/main\n", stderr: "", code: 0, missing: false };
    }
    if (joined.includes("rev-parse --show-toplevel") || args[0] === "rev-parse") {
      return { stdout: "/home/dev/repo\n", stderr: "", code: 0, missing: false };
    }
    return { stdout: "", stderr: "", code: 0, missing: false };
  };
  const deps: PrDeps = {
    listSessions: async () => [parent as never],
    loadSession: async (summary) => loadById(summary.source, summary.id),
    runGit: gitOk as never,
    runGh: () => ({ stdout: "[]", stderr: "", code: 0, missing: false }),
    // The REAL rollup — reads the fixtures on disk, exercising the exact bug path.
    rollup: (parentFilePath, window, excluded) => rollupChildren(parentFilePath, window, {}, excluded),
    cwd: "/home/dev/repo",
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  const code = await runPr({ post: false }, deps);
  return { code, body: out.join("\n") };
}

describe("B5 — grandchild subagent counted once, not twice", () => {
  it("discovery sanity: P's recursive discovery walk finds BOTH the middle and the grandchild", async () => {
    const children = await rollupChildren(PARENT, null, {});
    const paths = children.map((c) => c.filePath);
    expect(paths).toContain(CHILD_A);
    expect(paths).toContain(GRANDCHILD_B);
  });

  it("A is promoted (own commit) and appears as its own top-level contributor", async () => {
    const { code, body } = await run();
    expect(code).toBe(0);
    expect(body).toContain("agent-childA");
  });

  it("B appears exactly once — as A's only SUBAGENTS entry, never flattened into P's own block", async () => {
    const { body } = await run();
    // Exactly one SUBAGENTS group in the whole rendered body: if B were
    // double-counted, P would ALSO grow a SUBAGENTS(1) block of its own,
    // giving two occurrences of the "SUBAGENTS" marker instead of one.
    const subagentsBlocks = body.match(/SUBAGENTS/g) ?? [];
    expect(subagentsBlocks).toHaveLength(1);
    expect(body).toContain("SUBAGENTS (1)");
    // The "counted: N sessions + M subagent(s)" footer is the receipt's own
    // audit of how many atoms it summed — must say exactly 1 subagent.
    expect(body).toContain("counted: 2 sessions + 1 subagent");
  });

  it("P's own contributor block (between P's row and A's row) has no SUBAGENTS section", async () => {
    const { body } = await run();
    const firstRow = body.indexOf("orchestrator ·");
    expect(firstRow).toBeGreaterThan(-1);
    const secondRow = body.indexOf("orchestrator ·", firstRow + 1);
    expect(secondRow).toBeGreaterThan(firstRow);
    const parentBlock = body.slice(firstRow, secondRow);
    expect(parentBlock).not.toContain("SUBAGENTS");
  });

  it("the PR total reconciles to P + A + B priced once each — no inflation from the duplicate rollup", async () => {
    const { body } = await run();
    const totalMatch = body.match(/TOTAL priced\.*\$([\d.]+)/);
    expect(totalMatch).not.toBeNull();
    const total = Number(totalMatch![1]);

    // P and A are branch-window SLICES (not full sessions), so the ground
    // truth is the two rendered contributor-row dollar figures plus B's own
    // rendered SUBAGENTS dollar figure — summed independently of the TOTAL
    // line the receipt itself prints. If B were priced under both P and A,
    // this sum would diverge from `total`.
    const contributorAmounts = [...body.matchAll(/orchestrator · claude-opus-4-8\.+\$([\d.]+)/g)].map((m) => Number(m[1]));
    expect(contributorAmounts).toHaveLength(2);
    const subagentMatch = body.match(/SUBAGENTS \(1\)\s*\n\s*\S.*?\$([\d.]+)/);
    expect(subagentMatch).not.toBeNull();
    const bAmount = Number(subagentMatch![1]);

    const expected = contributorAmounts[0] + contributorAmounts[1] + bAmount;
    expect(total).toBeCloseTo(expected, 2);
  });
});

describe("B5 regression — normal shapes are unaffected", () => {
  it("2-level P -> A (A promoted, no grandchild) is unchanged: P excludes A, A has no subagents", async () => {
    // Reuses the existing SPEC-0038 fixture pair (nested-parent / builder1) —
    // one promoted level only, exactly the shape B5's fix must NOT regress.
    const NESTED_PARENT = path.join(FIX, "nested-parent.jsonl");
    const parent = (await loadById("claude-code", NESTED_PARENT))!;
    const BRANCH_SHA = "1234abc" + "d".repeat(33);
    const out: string[] = [];
    const gitOk = (_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("merge-base")) return { stdout: "basebase\n", stderr: "", code: 0, missing: false };
      if (args[0] === "log") {
        return {
          stdout: [BRANCH_SHA, "2026-07-04T10:02:30Z", "the feature"].join(NUL) + "\n",
          stderr: "",
          code: 0,
          missing: false,
        };
      }
      if (joined.includes("worktree")) return { stdout: "worktree /home/dev/repo\n", stderr: "", code: 0, missing: false };
      if (joined.includes("origin/HEAD") || joined.includes("origin/main")) return { stdout: "origin/main\n", stderr: "", code: 0, missing: false };
      if (joined.includes("rev-parse --show-toplevel") || args[0] === "rev-parse") return { stdout: "/home/dev/repo\n", stderr: "", code: 0, missing: false };
      return { stdout: "", stderr: "", code: 0, missing: false };
    };
    const deps: PrDeps = {
      listSessions: async () => [parent as never],
      loadSession: async (summary) => loadById(summary.source, summary.id),
      runGit: gitOk as never,
      runGh: () => ({ stdout: "[]", stderr: "", code: 0, missing: false }),
      rollup: (parentFilePath, window, excluded) => rollupChildren(parentFilePath, window, {}, excluded),
      cwd: "/home/dev/repo",
      out: (s) => out.push(s),
      err: () => {},
    };
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    const body = out.join("\n");
    expect(body).toContain("builder1");
    const subagentsBlocks = body.match(/SUBAGENTS/g) ?? [];
    expect(subagentsBlocks).toHaveLength(0);
  });
});
