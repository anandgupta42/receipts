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
  if (args[0] === "log") return ok("b1c2d3e4f5061728394a5b6c7d8e9f0011223344|2026-06-28T10:02:00.000Z\n");
  return { stdout: "", stderr: "", code: 1, missing: false };
};

const gitSubagentTime: CommandRunner = (_cmd, args) => {
  if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return ok("/home/dev/repo\n");
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
    // Explicit selection renders a single-contributor body; the child stem shows on the provenance line.
    expect(out[0]).toContain("1 session behind this PR");
    expect(out[0]).toContain("session: agent-child1");
    expect(out[0]).toContain("entire session (slice unavailable)");
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
    expect(out[0]).toContain("orchestrator · ");
    expect(out[0]).toContain("lead · session slice");
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
    expect(out[0].indexOf("team-1 · ")).toBeLessThan(out[0].indexOf("claude-anchors · "));
    expect(out[0].indexOf("team-1 · ")).toBeGreaterThan(-1);
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

  /** gh mock that answers pr view --json number,url and records upsert payloads. */
  function ghWithPr(prNumber: number) {
    const posted: string[] = [];
    const run: CommandRunner = (_cmd, args, opts) => {
      if (args[0] === "pr") {
        return ok(JSON.stringify({ number: prNumber, url: `https://github.com/o/r/pull/${prNumber}` }));
      }
      if (opts?.stdin) {
        posted.push(opts.stdin);
      }
      return ok("[]");
    };
    return { run, posted };
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
    expect(out[0]).toContain(`full receipt: [pr-7.html](https://anandgupta42.github.io/aireceipts/view.html?src=${raw})`);
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

  it("without --artifact nothing publishes and the body is unchanged", async () => {
    const { run: runGit, gitCalls } = gitWithPlumbing();
    const { run: runGh } = ghWithPr(7);
    const { deps, out } = await makeDeps({ runGit, runGh });
    const code = await runPr({ post: true }, deps);
    expect(code).toBe(0);
    expect(out[0]).not.toContain("full receipt:");
    expect(gitCalls.some((a) => a[0] === "push" || a[0] === "hash-object")).toBe(false);
  });
});
