// SPEC-0038 — attribution fidelity: anchors are authorship, receipts never
// double-count. R1 (shell gate + write-output line grammars), R2 (fallback
// bounding in both pools), R3 (nested discovery + rollup dedup), R5 (the #87
// regression, end-to-end through runPr with the real fixture files).
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ToolCall, Turn } from "../../src/parse/types.js";
import { toolCallGitVerb, writeOutputShas } from "../../src/pr/gitWrite.js";
import { classifyBranchAnchors, computeSlice } from "../../src/pr/slice.js";
import { selectContributors, type PoolCandidate } from "../../src/pr/contributors.js";
import { promoteOrphanSidechains } from "../../src/pr/promote.js";
import { nestedCandidates } from "../../src/pr/nested.js";
import { defaultBranchRef } from "../../src/pr/git.js";
import { runPr, type PrDeps } from "../../src/pr/index.js";
import { loadById } from "../../src/parse/load.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/pr");
const PARENT = path.join(FIX, "nested-parent.jsonl");
const CHILD = path.join(FIX, "nested-parent/subagents/agent-builder1.jsonl");

const BRANCH_SHA = "1234abc" + "d".repeat(33);
const FOREIGN_SHA = "feedbee" + "f".repeat(33);
const OTHER_SHA = "9876fed" + "c".repeat(33);

const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
const turn = (index: number, toolCalls: ToolCall[]): Turn => ({ index, timestamp: 1000 + index, model: "claude-opus-4-8", usage, toolCalls });
const PUSH = "git pu" + "sh";

describe("R1a — only adapter-flagged shells mint git verbs", () => {
  it("an unflagged tool carrying a command field and SHAs in output yields no verb, no anchor", () => {
    const call: ToolCall = { name: "mcp__deploy__run", input: { command: "git commit -m x" }, output: `[main ${BRANCH_SHA.slice(0, 7)}] x`, status: "ok" };
    expect(toolCallGitVerb(call)).toBeNull();
    const summary = classifyBranchAnchors([turn(0, [call])], [BRANCH_SHA]);
    expect(summary).toEqual({ hasOwn: false, writeCount: 0 });
  });

  it("an Agent/Task result echoing a commit line never anchors (the #87 echo class)", () => {
    const call: ToolCall = { name: "Agent", input: { prompt: "build" }, output: `shipped as [feat ${BRANCH_SHA.slice(0, 7)}] msg`, status: "ok" };
    expect(toolCallGitVerb(call)).toBeNull();
    expect(classifyBranchAnchors([turn(0, [call])], [BRANCH_SHA]).hasOwn).toBe(false);
  });

  it("a flagged Bash git write anchors exactly as before", () => {
    const call: ToolCall = { name: "Bash", shell: true, input: { command: "git commit -m x" }, output: `[feat ${BRANCH_SHA.slice(0, 7)}] x`, status: "ok" };
    expect(toolCallGitVerb(call)).toBe("commit");
    expect(classifyBranchAnchors([turn(0, [call])], [BRANCH_SHA]).hasOwn).toBe(true);
  });
});

describe("R1b — write-output line grammars", () => {
  it("compound contamination: a commit-and-log blob anchors only the [ref sha] line", () => {
    const output = [
      `[feat ${BRANCH_SHA.slice(0, 7)}] real commit`,
      `${OTHER_SHA.slice(0, 7)} some other commit in the log`,
      `${FOREIGN_SHA.slice(0, 7)} yet another`,
    ].join("\n");
    const shas = writeOutputShas("commit", output);
    expect(shas).toEqual([BRANCH_SHA.slice(0, 7)]);
  });

  it("push grammar: update-line pairs anchor; prose SHAs in the same blob are inert", () => {
    const output = [
      `   ${OTHER_SHA.slice(0, 8)}..${BRANCH_SHA.slice(0, 8)}  feat -> feat`,
      `note: see ${FOREIGN_SHA.slice(0, 12)} for context`,
    ].join("\n");
    const shas = writeOutputShas("push", output);
    expect(shas).toContain(BRANCH_SHA.slice(0, 8));
    expect(shas).not.toContain(FOREIGN_SHA.slice(0, 12));
  });

  it("root-commit bracket shape parses", () => {
    expect(writeOutputShas("commit", `[main (root-commit) ${BRANCH_SHA.slice(0, 7)}] init`)).toEqual([BRANCH_SHA.slice(0, 7)]);
  });

  it("forced-push triple-dot shape parses", () => {
    expect(writeOutputShas("push", ` + ${OTHER_SHA.slice(0, 7)}...${BRANCH_SHA.slice(0, 7)} feat -> feat (forced update)`)).toContain(BRANCH_SHA.slice(0, 7));
  });
});

describe("R1a codex surfaces (S5 finding 9)", () => {
  it("codex exec_command running a real git commit anchors (recorded deviation: exec_command IS codex's shell in current fixtures)", () => {
    const call: ToolCall = { name: "exec_command", shell: true, input: { command: "git commit -m x" }, output: `[feat ${BRANCH_SHA.slice(0, 7)}] x`, status: "ok" };
    expect(toolCallGitVerb(call)).toBe("commit");
  });

  it("codex exec_command launching `codex exec \"…git text…\"` still yields no verb (launch detection path unchanged)", () => {
    const call: ToolCall = { name: "exec_command", shell: true, input: { command: 'codex exec "then git commit everything"' }, output: "launched", status: "ok" };
    expect(toolCallGitVerb(call)).toBeNull();
  });
});

describe("R2 — fallback bounding", () => {
  const session = (id: string, turns: Turn[], cwd: string) => ({
    summary: { id, source: "claude-code" as const, filePath: `/tmp/${id}.jsonl`, cwd, totals: { tokens: usage, turnCount: turns.length, toolCallCount: 1 } },
    session: { id, source: "claude-code" as const, filePath: `/tmp/${id}.jsonl`, cwd, startedAt: 1, endedAt: 2, turns, totals: { tokens: usage, turnCount: turns.length, toolCallCount: 1 }, title: id, model: "m" },
  });

  it("R2a / SPEC-0044 A1: an anchor-pool full-fallback session is COUNTED-ABSENT, not silently dropped", async () => {
    // push-anchored but no commit anchor → computeSlice returns "full" → anchor pool won't credit it,
    // but SPEC-0044 A1 forbids the old SILENT drop: it must leave a typed trace so the total floors.
    const pushTurn = turn(0, [{ name: "Bash", shell: true, input: { command: PUSH }, output: `   0000000..${BRANCH_SHA.slice(0, 8)}  feat -> feat`, status: "ok" }]);
    const s = session("cross-repo-lead", [pushTurn], "/elsewhere/other-repo");
    expect(computeSlice(s.session.turns, [BRANCH_SHA]).kind).toBe("full");
    const candidates: PoolCandidate[] = [{ summary: s.summary as never, pool: "anchor" }];
    const sel = await selectContributors(candidates, [BRANCH_SHA], {
      loadSession: async () => s.session as never,
      currentWorktreeRoot: "/home/dev/repo",
    });
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(0); // distinct from `excluded` (repo+window, no commit) — SPEC-0024 fence copy stays true
    // The fix: no longer silent — a typed unattributable-anchor-pool event is emitted (the coverage-map C.2 hole).
    expect(sel.events).toContainEqual({ kind: "unattributable-anchor-pool", sessionId: "/tmp/cross-repo-lead.jsonl" });
  });

  it("R2a: an anchor-pool session with a sliceable commit anchor still contributes", async () => {
    const commitTurn = turn(0, [{ name: "Bash", shell: true, input: { command: "git commit -m x" }, output: `[feat ${BRANCH_SHA.slice(0, 7)}] x`, status: "ok" }]);
    const s = session("cross-repo-committer", [commitTurn], "/elsewhere/other-repo");
    const sel = await selectContributors([{ summary: s.summary as never, pool: "anchor" }], [BRANCH_SHA], {
      loadSession: async () => s.session as never,
      currentWorktreeRoot: "/home/dev/repo",
    });
    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].slice.kind).toBe("slice");
  });

  it("R2a: a repo-pool session keeps today's labeled full fallback", async () => {
    const pushTurn = turn(0, [{ name: "Bash", shell: true, input: { command: PUSH }, output: `   0000000..${BRANCH_SHA.slice(0, 8)}  feat -> feat`, status: "ok" }]);
    const s = session("local-pusher", [pushTurn], "/home/dev/repo");
    const sel = await selectContributors([{ summary: s.summary as never, pool: "repo" }], [BRANCH_SHA], {
      loadSession: async () => s.session as never,
      currentWorktreeRoot: "/home/dev/repo",
    });
    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].slice.kind).toBe("full");
  });

  it("R2b: a push-only sidechain is no longer promoted", async () => {
    const pushTurn = turn(0, [{ name: "Bash", shell: true, input: { command: PUSH }, output: `   0000000..${BRANCH_SHA.slice(0, 8)}  feat -> feat`, status: "ok" }]);
    const s = session("teammate", [pushTurn], "/elsewhere");
    const { promoted: promoted } = await promoteOrphanSidechains([s.summary as never], [BRANCH_SHA], new Set(), async () => s.session as never);
    expect(promoted).toHaveLength(0);
  });

  it("R2b: a commit-anchored sidechain still promotes, sliced", async () => {
    const commitTurn = turn(0, [{ name: "Bash", shell: true, input: { command: "git commit -m x" }, output: `[feat ${BRANCH_SHA.slice(0, 7)}] x`, status: "ok" }]);
    const s = session("teammate2", [commitTurn], "/elsewhere");
    const { promoted: promoted } = await promoteOrphanSidechains([s.summary as never], [BRANCH_SHA], new Set(), async () => s.session as never);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].slice.kind).toBe("slice");
  });
});

describe("R3 — nested discovery", () => {
  it("discovers the nested builder under a window-overlapping claude parent, id = agent stem", async () => {
    const parent = (await loadById("claude-code", PARENT))!;
    const commitMs = [Date.parse("2026-07-04T10:02:30Z")];
    const nested = await nestedCandidates([parent as never], commitMs);
    expect(nested).toHaveLength(1);
    expect(nested[0].summary.id).toBe("builder1");
    expect(nested[0].summary.filePath).toBe(CHILD);
    expect(nested[0].summary.cwd).toBe("/home/dev/repo");
  });

  it("skips non-claude parents and non-overlapping windows", async () => {
    const parent = (await loadById("claude-code", PARENT))!;
    const farFuture = [Date.parse("2027-01-01T00:00:00Z")];
    expect(await nestedCandidates([parent as never], farFuture)).toHaveLength(0);
    expect(await nestedCandidates([{ ...(parent as object), source: "codex" } as never], [Date.parse("2026-07-04T10:02:30Z")])).toHaveLength(0);
  });
});

describe("stale-base hardening (forensic P2)", () => {
  it("prefers origin/main when origin/HEAD is unset (agent worktrees pin a stale local main)", () => {
    const run = (cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("origin/HEAD")) {
        return { stdout: "", stderr: "", code: 1, missing: false };
      }
      if (joined.includes("origin/main")) {
        return { stdout: "5b46b67d\n", stderr: "", code: 0, missing: false };
      }
      return { stdout: "", stderr: "", code: 1, missing: false };
    };
    expect(defaultBranchRef(run as never)).toBe("origin/main");
  });

  it("falls back to main only when origin/main is absent too", () => {
    const run = () => ({ stdout: "", stderr: "", code: 1, missing: false });
    expect(defaultBranchRef(run as never)).toBe("main");
  });
});

describe("R5 — the #87 regression, end-to-end", () => {
  async function run87(): Promise<{ code: number; body: string; err: string[] }> {
    const parent = (await loadById("claude-code", PARENT))!;
    const out: string[] = [];
    const err: string[] = [];
    const gitOk = (cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("merge-base")) {
        return { stdout: "basebase\n", stderr: "", code: 0, missing: false };
      }
      if (args[0] === "log") {
        return { stdout: `${BRANCH_SHA} 2026-07-04T10:02:30Z the feature\n`, stderr: "", code: 0, missing: false };
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
      rollup: async () => [],
      cwd: "/home/dev/repo",
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    };
    const code = await runPr({ post: false }, deps);
    return { code, body: out.join("\n"), err };
  }

  it("parent (echo-only) is OUT; nested builder is IN under its own id; totals reconcile", async () => {
    const { code, body } = await run87();
    expect(code).toBe(0);
    // the builder, by stem
    expect(body).toContain("builder1");
    expect(body).toContain("1 session behind this PR");
    // the parent's echo must not credit it: its stem never appears as a contributor
    expect(body).not.toContain("nested-parent ·");
    expect(body).not.toContain("entire session");
  });

  it("pre-spec red path is pinned: without the shell gate the parent's Agent echo would anchor", () => {
    // The unflagged Agent call from the fixture, classified directly: the gate
    // is the ONLY thing between the echo and an anchor (red-then-green in one).
    const echo: ToolCall = { name: "Agent", input: { command: "build the feature" }, output: `[feat/x ${BRANCH_SHA.slice(0, 7)}] msg`, status: "ok" };
    expect(toolCallGitVerb(echo)).toBeNull();
    const unflaggedButBash: ToolCall = { ...echo, name: "Bash", shell: true, input: { command: "git commit -m x" } };
    expect(toolCallGitVerb(unflaggedButBash)).toBe("commit");
  });
});
