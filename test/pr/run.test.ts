// SPEC-0019 R3 — render-first, fail-visible. The full body is ALWAYS written to
// stdout before any gh call; a failed/absent gh only adds a stderr diagnostic and
// exits 1. Also covers auto-select success and the zero/many selection outcomes.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import type { CommandResult, CommandRunner } from "../../src/pr/git.js";
import { DOGFOOD_MARKER } from "../../src/pr/body.js";
import { classifyPush } from "../../src/pr/gitWrite.js";
import { runPr, runPrDetailed, type PrDeps } from "../../src/pr/index.js";
import { listReceiptRefs } from "../../src/pr/store.js";
import type { SessionSummary } from "../../src/parse/types.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const ANCHORS = path.join(FIX, "claude-anchors.jsonl");
const CODEX_BRANCH = path.join(FIX, "codex-branch-commit.jsonl");
const PARENT_WITH_SUBAGENTS = path.join(FIX, "parent-with-subagents.jsonl");
const CHILD_ONE = path.join(FIX, "parent-with-subagents", "subagents", "agent-child1.jsonl");
const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });

/** git mock: one worktree at /home/dev/repo, one branch commit (our SHA) at 10:02. */
const gitOk: CommandRunner = (_cmd, args) => {
  if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return ok("/home/dev/repo\n");
  if (args[0] === "rev-parse") return ok("origin/main\n");
  if (args[0] === "merge-base") return ok("0000000000000000000000000000000000000000\n");
  if (args[0] === "log")
    return ok(
      [
        ["c9d8e7f60718293a4b5c6d7e8f9001122334455a", "2026-06-28T10:03:10.000Z", "feat: fixture tip"].join("\u0000"),
        ["b1c2d3e4f5061728394a5b6c7d8e9f0011223344", "2026-06-28T10:02:00.000Z", "feat: fixture commit"].join("\u0000"),
      ].join("\n") + "\n",
    );
  return { stdout: "", stderr: "", code: 1, missing: false };
};

const gitSubagentTime: CommandRunner = (_cmd, args) => {
  if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return ok("/home/dev/repo\n");
  if (args[0] === "rev-parse") return ok("origin/main\n");
  if (args[0] === "merge-base") return ok("0000000000000000000000000000000000000000\n");
  if (args[0] === "log") return ok(["1111111111111111111111111111111111111111", "2026-06-27T12:01:00.000Z", "feat: other repo commit"].join("\u0000") + "\n");
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

describe("SPEC-0073 HEAD publish attach/store integration", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempRepo(): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), "aireceipts-head-push-"));
    dirs.push(cwd);
    const init = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
    if (init.status !== 0) {
      throw new Error(`git init failed: ${init.stderr}`);
    }
    return cwd;
  }

  async function attachForPush(argv: string[], resolvedBranch: string) {
    expect(classifyPush(argv).attach).toBe(true);
    const cwd = await tempRepo();
    const runGit: CommandRunner = (cmd, args) => {
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
        return ok(`${resolvedBranch}\n`);
      }
      return gitOk(cmd, args);
    };
    const { deps, err } = await makeDeps({ cwd, runGit });
    const result = await runPrDetailed({ post: false, store: "ref" }, deps);
    return { err, refs: listReceiptRefs(cwd), result };
  }

  it("writes the resolved current-branch slug identically for named and bare-HEAD publishes", async () => {
    const named = await attachForPush(["git", "push", "origin", "fix/hook-push-head"], "fix/hook-push-head");
    const head = await attachForPush(["git", "push", "-u", "origin", "HEAD"], "fix/hook-push-head");
    const expected = [{ ref: "refs/aireceipts/fix-hook-push-head", slug: "fix-hook-push-head" }];

    expect(named.result.code).toBe(0);
    expect(head.result.code).toBe(0);
    expect(named.refs).toEqual(expected);
    expect(head.refs).toEqual(expected);
  });

  it("writes no receipt ref when bare HEAD resolves to a detached HEAD", async () => {
    const detached = await attachForPush(["git", "push", "origin", "HEAD"], "HEAD");

    expect(detached.result.code).toBe(0);
    expect(detached.refs).toEqual([]);
    expect(detached.err).toContain("store=ref skipped: could not resolve current branch");
    expect(detached.err.some((line) => line.startsWith("wrote receipt ref "))).toBe(false);
  });
});

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

  it("marks a selected slice with no turn timestamps as an unknown subagent window", async () => {
    const session = (await loadById("claude-code", ANCHORS))!;
    const timeless = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn, timestamp: undefined })),
    };
    let observedWindow: Parameters<PrDeps["rollup"]>[1] | undefined;
    const { deps } = await makeDeps({
      listSessions: async () => [timeless],
      loadSession: async () => timeless,
      rollup: async (_parentFilePath, window) => {
        observedWindow = window;
        return [];
      },
    });

    expect(await runPr({ post: false }, deps)).toBe(0);
    expect(observedWindow).toEqual({ kind: "unknown" });
  });

  it("SPEC-0070 R1 end-to-end — opts.samosa threads through pr → PrOptions → the rendered comment; off by default", async () => {
    // Off by default: the dry-run body carries no tip link.
    const base = await makeDeps();
    expect(await runPr({ post: false }, base.deps)).toBe(0);
    expect(base.out.join("")).not.toContain("buy me a samosa");
    // With the flag, the same command threads it through to the details link.
    const withFlag = await makeDeps();
    expect(await runPr({ post: false, samosa: true }, withFlag.deps)).toBe(0);
    expect(withFlag.out.join("")).toContain("buy me a samosa");
  });

  it("SPEC-0045 R2 anti-wallpaper — a degraded no-cwd session that only overlaps the window does NOT flag unreadable-session", async () => {
    // A transcript that failed to parse (degraded) with NO cwd, whose timestamps
    // merely overlap the branch window. Without repo-cwd proof it isn't ours, so
    // index.ts keeps it OUT of the anchor pool (the `if (s.degraded) continue`
    // guard) — it must NOT fire `unreadable-session`, or every corrupt file
    // anywhere would floor unrelated PRs.
    const real = (await loadById("claude-code", ANCHORS))!;
    const degradedNoCwd: SessionSummary = {
      id: "/elsewhere/ghost.jsonl",
      source: "claude-code",
      filePath: "/elsewhere/ghost.jsonl",
      startedAt: Date.parse("2026-06-28T10:02:20.000Z"),
      endedAt: Date.parse("2026-06-28T10:02:40.000Z"),
      totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, turnCount: 0, toolCallCount: 0 },
      degraded: "unreadable", // no cwd → not repo-scoped
    };
    const { deps, out } = await makeDeps({ listSessions: async () => [real, degradedNoCwd] });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    // The real session still renders; the no-cwd degraded file is silent.
    expect(out[0]).not.toContain("couldn't be read");
  });

  it("explicit --session can select a subagent by stem, render, and post", async () => {
    const parent = (await loadById("claude-code", PARENT_WITH_SUBAGENTS))!;
    const ghCalls: string[] = [];
    const gh: CommandRunner = (_cmd, args) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr") return ok('{"number": 26, "url": "https://github.com/o/r/pull/26"}');
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
    // Explicit selection renders a single-contributor body; round 2 moved the
    // child stem + slice reason to the details section's stat line.
    expect(out[0]).toContain("1 session behind this PR");
    expect(out[0]).toContain("agent-child1");
    expect(out[0]).toContain("entire session (slice unavailable)");
    expect(ghCalls.some((c) => c.includes("issues/26/comments"))).toBe(true);
    expect(err.join("\n")).toContain("posted receipt (created) to PR #26");
  });

  it("posts after rendering: body to stdout FIRST, then the gh upsert (exit 0)", async () => {
    const ghCalls: string[] = [];
    const gh: CommandRunner = (_cmd, args) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr") return ok('{"number": 7, "url": "https://github.com/o/r/pull/7"}');
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
    // Worktree root does not contain the fixture session's cwd, AND the session
    // carries no branch-SHA anchor — since SPEC-0024, cwd alone no longer
    // excludes an anchored session, so a true zero-match needs both.
    const gitElsewhere: CommandRunner = (_cmd, args) =>
      args[0] === "worktree" ? ok("worktree /other/root\n") : gitOk(_cmd, args);
    const anchorless = { ...(await loadById("claude-code", ANCHORS))!, turns: [] };
    const { deps, out, err } = await makeDeps({
      runGit: gitElsewhere,
      listSessions: async () => [anchorless],
      loadSession: async () => anchorless,
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--session");
  });

  it("multiple matching sessions → both contribute (union), one receipt total, exit 0 (SPEC-0023 R1)", async () => {
    const session = (await loadById("claude-code", ANCHORS))!;
    const dupe = { ...session, id: "dupe", filePath: "dupe.jsonl" };
    const { deps, out } = await makeDeps({
      listSessions: async () => [session, dupe],
      loadSession: async (summary) => (summary.id === "dupe" ? session : loadById(summary.source, summary.id)),
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(out[0]).toContain("2 sessions behind this PR");
    expect(out[0]).toContain("TOTAL priced");
    expect(out[0]).toContain("counted: 2 sessions");
  });

  it("codex + claude mix → both contribute, one receipt total across vendors (SPEC-0023 R1/R6)", async () => {
    const claude = (await loadById("claude-code", ANCHORS))!;
    const codexSummary = { id: CODEX_BRANCH, source: "codex" as const, filePath: CODEX_BRANCH };
    const { deps, out } = await makeDeps({
      listSessions: async () => [
        claude,
        // summary carries the cwd + time window the candidate filter needs.
        { ...codexSummary, cwd: "/home/dev/repo", startedAt: Date.parse("2026-06-28T10:01:30.000Z"), endedAt: Date.parse("2026-06-28T10:02:10.000Z"), totals: claude.totals },
      ],
      loadSession: async (summary) => loadById(summary.source, summary.id),
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(out[0]).toContain("2 sessions behind this PR");
    expect(out[0]).toContain("codex · ");
    expect(out[0]).toContain("builder · ");
    expect(out[0]).toContain("TOTAL priced");
    expect(out[0]).toContain("counted: 2 sessions");
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

  it("repeated --session selectors append explicit sessions without replacing auto-selection", async () => {
    const fixture = (await loadById("claude-code", ANCHORS))!;
    const auto = { ...fixture, id: "auto", filePath: "auto.jsonl" };
    // Same repo/window, but no git-write evidence: auto-selection declines it.
    // Repeating --session is the user's explicit attribution claim and must add
    // both declined sessions while keeping the unlisted auto contributor.
    const manualOne = {
      ...fixture,
      id: "manual-one",
      filePath: "manual-one.jsonl",
      turns: fixture.turns.map((turn) => ({ ...turn, toolCalls: [] })),
    };
    const manualTwo = { ...manualOne, id: "manual-two", filePath: "manual-two.jsonl" };
    const byId = new Map([
      [auto.id, auto],
      [manualOne.id, manualOne],
      [manualTwo.id, manualTwo],
    ]);
    const { deps, out } = await makeDeps({
      listSessions: async () => [auto, manualOne, manualTwo],
      loadSession: async (summary) => byId.get(summary.id) ?? null,
    });

    const code = await runPr({ post: false, sessions: [manualOne.id, manualTwo.id] }, deps);

    expect(code).toBe(0);
    expect(out[0]).toContain("3 sessions behind this PR");
    expect(out[0]).toContain("counted: 3 sessions");
    expect(out[0]).not.toContain("not attributed");
  });

  it("repeated --session deduplicates a transcript that auto-selection already found", async () => {
    const fixture = (await loadById("claude-code", ANCHORS))!;
    const auto = { ...fixture, id: "auto", filePath: "auto.jsonl" };
    const manual = {
      ...fixture,
      id: "manual",
      filePath: "manual.jsonl",
      turns: fixture.turns.map((turn) => ({ ...turn, toolCalls: [] })),
    };
    const byId = new Map([
      [auto.id, auto],
      [manual.id, manual],
    ]);
    const { deps, out } = await makeDeps({
      listSessions: async () => [auto, manual],
      loadSession: async (summary) => byId.get(summary.id) ?? null,
    });

    const code = await runPr({ post: false, sessions: [auto.id, manual.id] }, deps);

    expect(code).toBe(0);
    expect(out[0]).toContain("2 sessions behind this PR");
    expect(out[0]).toContain("counted: 2 sessions");
  });

  it("repeated --session fails before rendering when any explicit selector is invalid", async () => {
    const session = (await loadById("claude-code", ANCHORS))!;
    const { deps, out, err } = await makeDeps();

    const code = await runPr({ post: false, sessions: [session.id, "missing-helper"] }, deps);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain('no session matched "missing-helper"');
  });
});

describe("SPEC-0024 attribution widening (e2e)", () => {
  const otherRepo = "/home/dev/OTHER-repo";

  async function crossRepoLead() {
    const session = (await loadById("claude-code", ANCHORS))!;
    // Recorded under another repo's project dir: cwd outside every worktree root.
    return { ...session, id: "lead", filePath: "lead.jsonl", cwd: otherRepo };
  }

  it("credits a cross-repo lead on its branch-SHA anchor and rolls up its children", async () => {
    const lead = await crossRepoLead();
    const { deps, out } = await makeDeps({
      listSessions: async () => [lead],
      loadSession: async (summary) => (summary.id === "lead" ? lead : null),
      rollup: async (parentFilePath) =>
        parentFilePath === "lead.jsonl"
          ? [{ name: "designer", model: "claude-opus-4-8", usd: null, tokens: lead.totals.tokens, unreadable: false, filePath: "lead/subagents/agent-designer.jsonl" }]
          : [],
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(out[0]).toContain("1 session behind this PR");
    expect(out[0]).toContain("| **orchestrator** |");
    expect(out[0]).toContain("turns ");
    expect(out[0]).toContain("SUBAGENTS (1)");
    expect(out[0]).toContain("counted: 1 session + 1 subagent");
  });

  it("does NOT credit a cross-repo session whose window misses every branch commit (overlap bound)", async () => {
    const lead = await crossRepoLead();
    // Shift the window a day before the only branch commit (2026-06-28T10:02Z ± 15 min).
    const stale = { ...lead, startedAt: Date.parse("2026-06-27T00:00:00.000Z"), endedAt: Date.parse("2026-06-27T01:00:00.000Z") };
    let loads = 0;
    const { deps, out, err } = await makeDeps({
      listSessions: async () => [stale],
      loadSession: async () => {
        loads++;
        return stale;
      },
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(loads).toBe(0); // outside the bound → never even loaded
    expect(err.join("\n")).toContain("no session matches");
  });

  it("promotes an anchored teammate sidechain to a top-level row, sorted chronologically with the builder", async () => {
    const builder = (await loadById("claude-code", ANCHORS))!;
    // The teammate started BEFORE the builder and is a flagged sidechain under the lead's (other) repo.
    const teammate = { ...builder, id: "team-1", filePath: "team-1.jsonl", cwd: otherRepo, isSidechain: true, startedAt: (builder.startedAt ?? 0) - 60_000 };
    const byId = new Map([[builder.id, builder], ["team-1", teammate]]);
    const { deps, out } = await makeDeps({
      listSessions: async () => [builder, teammate],
      loadSession: async (summary) => byId.get(summary.id) ?? null,
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(out[0]).toContain("2 sessions behind this PR");
    // Chronological across pools: the promoted teammate row renders before the builder row.
    expect(out[0].indexOf("`team-1`")).toBeLessThan(out[0].indexOf("`claude-anchors`"));
    expect(out[0].indexOf("`team-1`")).toBeGreaterThan(-1);
    expect(out[0]).toContain("counted: 2 sessions");
  });

  it("does NOT promote a sidechain already covered by a contributor's rollup (dedup guard, counted once)", async () => {
    const builder = (await loadById("claude-code", ANCHORS))!;
    const teammate = { ...builder, id: "team-1", filePath: "team-1.jsonl", cwd: otherRepo, isSidechain: true };
    const byId = new Map([[builder.id, builder], ["team-1", teammate]]);
    const { deps, out } = await makeDeps({
      listSessions: async () => [builder, teammate],
      loadSession: async (summary) => byId.get(summary.id) ?? null,
      // The builder's rollup already lists the teammate transcript by filePath.
      rollup: async (parentFilePath) =>
        parentFilePath === builder.filePath
          ? [{ name: "team-1", model: "claude-opus-4-8", usd: null, tokens: teammate.totals.tokens, unreadable: false, filePath: "team-1.jsonl" }]
          : [],
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    expect(out[0]).toContain("1 session behind this PR");
    expect(out[0]).toContain("counted: 1 session + 1 subagent");
  });

  it("renders byte-identically across repeated runs with promotion in play (I1)", async () => {
    const builder = (await loadById("claude-code", ANCHORS))!;
    const teammate = { ...builder, id: "team-1", filePath: "team-1.jsonl", cwd: otherRepo, isSidechain: true, startedAt: (builder.startedAt ?? 0) - 60_000 };
    const byId = new Map([[builder.id, builder], ["team-1", teammate]]);
    const render = async () => {
      const { deps, out } = await makeDeps({
        listSessions: async () => [builder, teammate],
        loadSession: async (summary) => byId.get(summary.id) ?? null,
      });
      expect(await runPr({ post: false }, deps)).toBe(0);
      return out[0];
    };
    expect(await render()).toBe(await render());
  });
});

describe("SPEC-0027 --artifact (e2e through runPr)", () => {
  const PLUMBING_OK: Record<string, string> = {
    "ls-remote": "",
    "hash-object": "f".repeat(40),
    mktree: "e".repeat(40),
    "commit-tree": "d".repeat(40),
    push: "",
    fetch: "",
    "ls-tree": "",
  };

  /** gitOk plus recording plumbing support; pushFails flips the push result. */
  function gitWithPlumbing(pushFails = false) {
    const gitCalls: string[][] = [];
    const run: CommandRunner = (_cmd, args) => {
      gitCalls.push(args);
      if (args[0] in PLUMBING_OK) {
        if (args[0] === "push" && pushFails) {
          return { stdout: "", stderr: "remote: Permission denied", code: 1, missing: false };
        }
        return ok(PLUMBING_OK[args[0]]);
      }
      return gitOk(_cmd, args);
    };
    return { run, gitCalls };
  }

  /** gh mock that answers pr view --json number,url, reports the repo public, and records upsert payloads. */
  function ghWithPr(prNumber: number) {
    const posted: string[] = [];
    const ghCalls: string[][] = [];
    const run: CommandRunner = (_cmd, args, opts) => {
      ghCalls.push([...args]);
      if (args[0] === "pr") {
        return ok(JSON.stringify({ number: prNumber, url: `https://github.com/o/r/pull/${prNumber}` }));
      }
      if (args[0] === "api" && args[1] === "repos/o/r" && args[2] === "--jq" && args[3] === ".private") {
        return ok("false\n"); // public
      }
      if (opts?.stdin) {
        posted.push(opts.stdin);
      }
      return ok("[]");
    };
    return { run, posted, ghCalls };
  }

  it("rejects --artifact without --post before rendering (R4)", async () => {
    const { deps, out, err } = await makeDeps();
    const code = await runPr({ post: false, artifact: true }, deps);
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--artifact requires --post");
  });

  it("publishes, then renders ONE body with the link — stdout equals the posted body (R3)", async () => {
    const { run: runGit } = gitWithPlumbing();
    const { run: runGh, posted } = ghWithPr(7);
    const { deps, out, err } = await makeDeps({ runGit, runGh });
    const code = await runPr({ post: true, artifact: true }, deps);
    expect(code).toBe(0);
    const raw = encodeURIComponent("https://raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html");
    expect(out[0]).toContain(`full receipt: [pr-7.html](https://anandgupta42.github.io/receipts/view.html?src=${raw})`);
    // Printed body and posted body are byte-identical (render-first spine).
    expect(posted.some((p) => JSON.parse(p).body === out[0])).toBe(true);
    // R4 preflight names branch, remote, file before the push.
    expect(err.join("\n")).toContain("publishing pr-7.html to aireceipts/artifacts on https://github.com/o/r.git");
  });

  it("failed push: body renders and posts WITHOUT the link, stderr names the push, exit 1 (R3)", async () => {
    const { run: runGit } = gitWithPlumbing(true);
    const { run: runGh, posted } = ghWithPr(7);
    const { deps, out, err } = await makeDeps({ runGit, runGh });
    const code = await runPr({ post: true, artifact: true }, deps);
    expect(code).toBe(1);
    expect(out[0]).not.toContain("full receipt:");
    expect(posted.some((p) => JSON.parse(p).body === out[0])).toBe(true);
    expect(err.join("\n")).toContain("Permission denied");
  });

  it("details order mirrors the fence: author receipts before helper receipts", async () => {
    // A codex helper (no writes, current worktree) that STARTED BEFORE the
    // anchored author must still render after it in the details section.
    const author = (await loadById("claude-code", ANCHORS))!;
    const helper = {
      id: CODEX_BRANCH,
      source: "codex" as const,
      filePath: CODEX_BRANCH,
      cwd: "/home/dev/repo",
      startedAt: (author.startedAt ?? 0) - 60_000,
      endedAt: Date.parse("2026-06-28T10:02:10.000Z"),
      totals: author.totals,
    };
    const byId = new Map<string, unknown>([[author.id, author]]);
    const { deps, out } = await makeDeps({
      listSessions: async () => [author, helper],
      loadSession: async (summary) =>
        summary.source === "codex" ? loadById("codex", CODEX_BRANCH) : ((byId.get(summary.id) ?? null) as never),
    });
    const code = await runPr({ post: false }, deps);
    expect(code).toBe(0);
    const body = out[0];
    const authorLabel = body.indexOf("#### builder · `claude-anchors`");
    const helperLabel = body.indexOf("#### codex · `codex-branch`");
    expect(authorLabel).toBeGreaterThan(-1);
    expect(helperLabel).toBeGreaterThan(-1);
    expect(authorLabel).toBeLessThan(helperLabel);
  });

  it("without --artifact nothing publishes and the body is unchanged", async () => {
    const { run: runGit, gitCalls } = gitWithPlumbing();
    const { run: runGh } = ghWithPr(7);
    const { deps, out } = await makeDeps({ runGit, runGh });
    const code = await runPr({ post: true }, deps);
    expect(code).toBe(0);
    expect(out[0]).not.toContain("full receipt:");
    expect(gitCalls.some((a) => a[0] === "push" || a[0] === "hash-object")).toBe(false);
  });

  describe("SPEC-0035 R5 --share (e2e through runPr)", () => {
    it("rejects --share without --artifact before rendering", async () => {
      const { deps, out, err } = await makeDeps();
      const code = await runPr({ post: true, artifact: false, share: true }, deps);
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.join("\n")).toContain("--share requires --artifact");
    });

    it("both the push and the comment upsert succeed: prints X + LinkedIn intent URLs, body unchanged", async () => {
      const { run: runGit } = gitWithPlumbing();
      const { run: runGh, posted } = ghWithPr(7);
      const { deps, out, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0);
      const raw = encodeURIComponent("https://raw.githubusercontent.com/o/r/refs/heads/aireceipts/artifacts/pr-7.html");
      const canonical = `https://anandgupta42.github.io/receipts/view.html?src=${raw}`;
      expect(err.join("\n")).toContain("share:");
      expect(err.join("\n")).toContain("https://twitter.com/intent/tweet?text=");
      expect(err.join("\n")).toContain(encodeURIComponent(canonical));
      expect(err.join("\n")).toContain("https://www.linkedin.com/sharing/share-offsite/?url=");
      // The share hint is stderr-only — the posted/rendered body never changes shape.
      expect(posted.some((p) => JSON.parse(p).body === out[0])).toBe(true);
      expect(out[0]).not.toContain("twitter.com");
      expect(out[0]).not.toContain("linkedin.com");
    });

    it("push fails: no share hint even though --share was requested (link is null)", async () => {
      const { run: runGit } = gitWithPlumbing(true);
      const { run: runGh } = ghWithPr(7);
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(1);
      expect(err.join("\n")).not.toContain("twitter.com");
      expect(err.join("\n")).not.toContain("linkedin.com");
    });

    it("push succeeds but the comment upsert fails: no share hint (timing — both must succeed)", async () => {
      const { run: runGit } = gitWithPlumbing();
      const runGh: CommandRunner = (_cmd, args) => {
        if (args[0] === "pr") return ok(JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7" }));
        if (args.includes("-X") && args.includes("POST")) return { stdout: "", stderr: "422", code: 1, missing: false };
        return ok("[]");
      };
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(1);
      expect(err.join("\n")).not.toContain("twitter.com");
      expect(err.join("\n")).not.toContain("linkedin.com");
    });

    it("PRIVATE repo: exactly one skip line, zero intent URLs (PR #87 review — the viewer would 404 for readers)", async () => {
      const { run: runGit } = gitWithPlumbing();
      const posted: string[] = [];
      const ghCalls: string[][] = [];
      const runGh: CommandRunner = (_cmd, args, opts) => {
        ghCalls.push([...args]);
        if (args[0] === "pr") return ok(JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7" }));
        if (args[0] === "api" && args[1] === "repos/o/r" && args[2] === "--jq" && args[3] === ".private") {
          return ok("true\n"); // private
        }
        if (opts?.stdin) {
          posted.push(opts.stdin);
          return ok("{}");
        }
        return ok("[]");
      };
      const { deps, out, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0); // push + upsert both succeeded — only the hint is replaced
      const stderr = err.join("\n");
      expect(err.filter((l) => l.startsWith("share:"))).toEqual([
        "share: skipped — repo is private; the viewer cannot render this for readers (works automatically once the repo is public)",
      ]);
      expect(stderr).not.toContain("twitter.com");
      expect(stderr).not.toContain("linkedin.com");
      // The exact endpoint fired, and only AFTER the comment write (both successes first).
      const visIdx = ghCalls.findIndex((a) => a[0] === "api" && a[1] === "repos/o/r" && a[2] === "--jq" && a[3] === ".private");
      const writeIdx = ghCalls.findIndex((a) => a.includes("POST") || a.includes("PATCH"));
      expect(visIdx).toBeGreaterThan(writeIdx);
      // The posted body is untouched by the guard.
      expect(posted.some((p) => JSON.parse(p).body === out[0])).toBe(true);
    });

    it("explicitly PUBLIC repo: intent URLs unchanged, exactly one visibility call", async () => {
      const { run: runGit } = gitWithPlumbing();
      const { run: runGh, ghCalls } = ghWithPr(7);
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0);
      const stderr = err.join("\n");
      expect(stderr).toContain("https://twitter.com/intent/tweet?text=");
      expect(stderr).toContain("https://www.linkedin.com/sharing/share-offsite/?url=");
      expect(stderr).not.toContain("share: skipped");
      expect(ghCalls.filter((a) => a[0] === "api" && a[1] === "repos/o/r" && a[2] === "--jq")).toHaveLength(1);
    });

    it("visibility check errors: neutral skip — no intent URLs, no false private claim (S6 Codex round)", async () => {
      const { run: runGit } = gitWithPlumbing();
      const runGh: CommandRunner = (_cmd, args, opts) => {
        if (args[0] === "pr") return ok(JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7" }));
        if (args[0] === "api" && args[2] === "--jq") return { stdout: "", stderr: "boom", code: 1, missing: false };
        if (opts?.stdin) return ok("{}");
        return ok("[]");
      };
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0);
      expect(err.filter((l) => l.startsWith("share:"))).toEqual(["share: skipped — could not verify repo visibility"]);
      expect(err.join("\n")).not.toContain("repo is private");
      expect(err.join("\n")).not.toContain("twitter.com");
    });

    it("same PR number but a different base repo mid-command: hint skipped (S6 owner/repo guard)", async () => {
      const { run: runGit } = gitWithPlumbing();
      let prViews = 0;
      const runGh: CommandRunner = (_cmd, args, opts) => {
        if (args[0] === "pr") {
          prViews += 1;
          const repo = prViews === 1 ? "o/r" : "o2/r";
          return ok(JSON.stringify({ number: 7, url: `https://github.com/${repo}/pull/7` }));
        }
        if (opts?.stdin) return ok("{}");
        return ok("[]");
      };
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0);
      expect(err.join("\n")).toContain("share hint skipped");
      expect(err.join("\n")).not.toContain("twitter.com");
    });

    it("artifact PR and comment PR disagree (mid-command `gh pr view` flip): hint skipped (S5)", async () => {
      const { run: runGit } = gitWithPlumbing();
      // First `pr view` (artifact publish) says PR 7; the second (comment upsert) says PR 8.
      let prViews = 0;
      const runGh: CommandRunner = (_cmd, args, opts) => {
        if (args[0] === "pr") {
          prViews += 1;
          const n = prViews === 1 ? 7 : 8;
          return ok(JSON.stringify({ number: n, url: `https://github.com/o/r/pull/${n}` }));
        }
        if (opts?.stdin) return ok("{}");
        return ok("[]");
      };
      const { deps, err } = await makeDeps({ runGit, runGh });
      const code = await runPr({ post: true, artifact: true, share: true }, deps);
      expect(code).toBe(0); // both halves succeeded — only the hint is withheld
      expect(err.join("\n")).toContain("share hint skipped");
      expect(err.join("\n")).not.toContain("twitter.com");
      expect(err.join("\n")).not.toContain("linkedin.com");
    });

    it("--share without --post/--artifact never printed on a plain dry run", async () => {
      const { deps, err } = await makeDeps();
      const code = await runPr({ post: false }, deps);
      expect(code).toBe(0);
      expect(err.join("\n")).not.toContain("twitter.com");
    });
  });
});

// SPEC-0044 A3 (e2e through runPr) — the real bug this closes: a session whose
// cache-write cost took the unsplit-tier fallback rendered an exact-looking
// dollar total with no signal it was a floor. These two fixtures are IDENTICAL
// in shape/tokens (see test/fixtures/claude-code/cache-tier-fallback-*.jsonl) —
// only whether the remainder is split into a nested cache_creation object
// differs — so this is a true positive/negative pair through the FULL pipeline
// (parse → attributeByTool → buildContributorView → the costEvents collection
// in src/pr/index.ts → summarizeConfidence → renderPrReceiptText), not just the
// unit-level summarizeConfidence/renderPrReceiptText tests in confidence.test.ts.
describe("SPEC-0044 A3 · cache-tier lower-bound floors the PR receipt (e2e through runPr)", () => {
  const CACHE_TIER_UNSPLIT = path.join(FIX, "..", "claude-code", "cache-tier-fallback-unsplit.jsonl");
  const CACHE_TIER_SPLIT = path.join(FIX, "..", "claude-code", "cache-tier-fallback-split.jsonl");

  it("RED-then-GREEN positive: an unsplit cache-write session floors the total and renders the caveat + docs pointer", async () => {
    const session = (await loadById("claude-code", CACHE_TIER_UNSPLIT))!;
    const { deps, out } = await makeDeps({
      listSessions: async () => [session],
      loadSession: async (summary) => loadById(summary.source, summary.id),
    });
    const code = await runPr({ post: false, session: session.id }, deps);
    expect(code).toBe(0);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(out[0]).toContain("1 session had cache tokens with no cited applicable rate");
    expect(out[0]).toContain("(see docs/cost-model.md)");
    // The `≥` floor prefix (isFloored) fires for this event kind (A3's own
    // "at least this much" meaning matches the existing floor semantics —
    // see the floor-semantics decision recorded in the PR description).
    expect(out[0]).toMatch(/TOTAL priced\.+≥/);
  });

  it("negative control: the SAME shape/tokens fully split into 5m/1h tiers renders NO caveat (no false positive)", async () => {
    const session = (await loadById("claude-code", CACHE_TIER_SPLIT))!;
    const { deps, out } = await makeDeps({
      listSessions: async () => [session],
      loadSession: async (summary) => loadById(summary.source, summary.id),
    });
    const code = await runPr({ post: false, session: session.id }, deps);
    expect(code).toBe(0);
    expect(out[0].startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(out[0]).not.toContain("cache-write cost that is a lower bound");
    expect(out[0]).not.toContain("cost-model.md");
    expect(out[0]).toMatch(/TOTAL priced\.+≥/);
    expect(out[0]).toContain("standard API-equivalent floor; not an invoice");
  });
});

// SPEC-0059 R5/R8 — the handoff section through the real PR flow: present on a
// wasteful PR (and reported via handoffSectionIncluded), absent on a clean PR
// and under --no-details. Section-content details (arithmetic, hedge, budget)
// are unit-covered in test/receipt/savings-slip.test.ts.
describe("SPEC-0059 handoff section (e2e through runPr)", () => {
  const LOOP_ANCHORS = path.join(FIX, "claude-anchors-loop.jsonl");

  async function loopDeps(): Promise<{ deps: PrDeps; out: string[] }> {
    const session = (await loadById("claude-code", LOOP_ANCHORS))!;
    const out: string[] = [];
    const deps: PrDeps = {
      listSessions: async () => [session],
      loadSession: async (summary) => loadById(summary.source, summary.id),
      runGit: gitOk,
      runGh: () => ok("[]"),
      rollup: async () => [],
      cwd: "/home/dev/repo",
      out: (s) => out.push(s),
      err: () => {},
    };
    return { deps, out };
  }

  it("a wasteful PR renders the collapsed section after full receipts and reports it (R8)", async () => {
    const { deps, out } = await loopDeps();
    const result = await runPrDetailed({ post: false }, deps);
    expect(result.code).toBe(0);
    expect(result.handoffSectionIncluded).toBe(true);
    const body = out[0];
    expect(body).toContain("<details><summary>handoff — flagged pattern cost ≈ $");
    expect(body).toContain("FLAGGED PATTERN COST");
    expect(body).toContain("→ change or stop after two identical failures");
    expect(body).toContain("covers: 1 session ·");
    expect(body.indexOf("full receipts (")).toBeLessThan(body.indexOf("<details><summary>handoff — "));
  });

  it("--no-details drops the section and the flag with it", async () => {
    const { deps, out } = await loopDeps();
    const result = await runPrDetailed({ post: false, details: false }, deps);
    expect(result.code).toBe(0);
    expect(result.handoffSectionIncluded).toBe(false);
    expect(out[0]).not.toContain("handoff — could have saved");
  });

  it("a clean PR has no section and the body is byte-identical to pre-SPEC-0059 output", async () => {
    const { deps, out } = await makeDeps();
    const result = await runPrDetailed({ post: false }, deps);
    expect(result.code).toBe(0);
    expect(result.handoffSectionIncluded).toBe(false);
    expect(out[0]).not.toContain("handoff —");
  });

  it("dry-run and --post render the identical body, and the post result reports the section (R8)", async () => {
    const first = await loopDeps();
    await runPrDetailed({ post: false }, first.deps);
    const second = await loopDeps();
    const ghPost: CommandRunner = (_cmd, args) => {
      if (args[0] === "pr") return ok('{"number": 7, "url": "https://github.com/o/r/pull/7"}');
      return ok("[]");
    };
    second.deps.runGh = ghPost;
    const posted = await runPrDetailed({ post: true }, second.deps);
    expect(second.out[0]).toBe(first.out[0]);
    // Codex review finding: the successful-post path must carry the boolean
    // too — a posted wasteful PR is the kill criterion's main denominator.
    expect(posted.commentResult).toBe("success");
    expect(posted.handoffSectionIncluded).toBe(true);
  });
});
