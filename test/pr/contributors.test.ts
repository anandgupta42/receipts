// SPEC-0023 R1/R3/R6 — the contributor set: which sessions are credited to the
// branch (Claude by own branch-SHA anchor; Codex by cwd+time OR own anchor; both
// minus foreign-only), the honest excluded count, deterministic order, and the
// descriptive role labels. R6: the Codex adapter already retains cwd + git-write
// output, so a real codex fixture classifies own-anchor.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSource, Session, SessionSummary, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { loadById } from "../../src/parse/load.js";
import { classifyBranchAnchors } from "../../src/pr/slice.js";
import { deriveRole, selectContributors } from "../../src/pr/contributors.js";

const BRANCH_SHA = "b1c2d3e4f5061728394a5b6c7d8e9f0011223344";
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const usage = withTotal({ ...emptyUsage(), input: 1000, output: 100 });

function bashTurn(index: number, command: string, output: string): Turn {
  return {
    index,
    timestamp: 1000 + index,
    model: "claude-opus-4-8",
    usage,
    toolCalls: [{ name: "Bash", input: { command }, output, status: "ok" }],
  };
}

function namedToolTurn(index: number, name: string, input: unknown): Turn {
  return { index, timestamp: 1000 + index, model: "claude-opus-4-8", usage, toolCalls: [{ name, input, status: "ok" }] };
}

const CURRENT_ROOT = "/home/dev/repo";

function makeSession(
  id: string,
  turns: Turn[],
  source: AgentSource = "claude-code",
  startedAt = 1000,
  cwd = CURRENT_ROOT,
): Session {
  return {
    id,
    source,
    filePath: id,
    cwd,
    startedAt,
    endedAt: startedAt + 1000,
    totals: { tokens: usage, turnCount: turns.length, toolCallCount: turns.length },
    turns,
  };
}

/** `Session extends SessionSummary`, so the loaded session is itself a valid summary row for selection. */
function summaryOf(s: Session): SessionSummary {
  return s;
}

/** A loader that resolves candidates from a fixed map; unknown ids resolve to null (unreadable). Scoped to CURRENT_ROOT. */
function loaderFor(sessions: Session[]) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return {
    loadSession: async (summary: SessionSummary) => byId.get(summary.id) ?? null,
    currentWorktreeRoot: CURRENT_ROOT,
  };
}

const ownCommit = (id: string, startedAt = 1000, source: AgentSource = "claude-code") =>
  makeSession(id, [bashTurn(0, "git commit -m x", `[featB b1c2d3e] x\n 1 file changed`)], source, startedAt);

describe("R1 contributor selection", () => {
  it("credits two own-anchored Claude sessions (the union — no 'pick one' error)", async () => {
    const a = ownCommit("a", 1000);
    const b = ownCommit("b", 3000);
    const sel = await selectContributors([summaryOf(a), summaryOf(b)], [BRANCH_SHA], loaderFor([a, b]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["a", "b"]);
    expect(sel.excludedCount).toBe(0);
  });

  it("excludes a Claude session with no branch-SHA anchor and counts it (not attributed)", async () => {
    const owned = ownCommit("owned");
    const noAnchor = makeSession("edits", [namedToolTurn(0, "Edit", { file_path: "x.ts" })]);
    const sel = await selectContributors([summaryOf(owned), summaryOf(noAnchor)], [BRANCH_SHA], loaderFor([owned, noAnchor]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["owned"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("credits a Codex helper that made no git writes in THIS worktree (cwd+time rule)", async () => {
    const helper = makeSession("cx-help", [bashTurn(0, "ls -la", "src\ntest")], "codex");
    const sel = await selectContributors([summaryOf(helper)], [BRANCH_SHA], loaderFor([helper]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["cx-help"]);
    expect(sel.excludedCount).toBe(0);
  });

  it("does NOT credit (or count) a SHA-less Codex helper from a sibling worktree (dogfood: cross-worktree over-attribution)", async () => {
    // A codex session doing unrelated work in another worktree of the same repo,
    // overlapping this branch's window. cwd is a sibling → silently ignored.
    const sibling = makeSession("cx-sibling", [bashTurn(0, "ls -la", "src")], "codex", 1000, "/home/dev/repo-spec9999");
    const sel = await selectContributors([summaryOf(sibling)], [BRANCH_SHA], loaderFor([sibling]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(0); // not plausible for this branch → not even noted
  });

  it("still credits a sibling-worktree session that carries a branch-SHA anchor (SHA proof beats worktree scope)", async () => {
    const sibling = ownCommit("builder-sibling", 1000, "claude-code");
    sibling.cwd = "/home/dev/repo-spec9999";
    const sel = await selectContributors([summaryOf(sibling)], [BRANCH_SHA], loaderFor([sibling]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["builder-sibling"]);
  });

  it("credits an own-anchored Codex session", async () => {
    const cx = ownCommit("cx-own", 1000, "codex");
    const sel = await selectContributors([summaryOf(cx)], [BRANCH_SHA], loaderFor([cx]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["cx-own"]);
  });

  it("excludes a foreign-only session (committed to another branch) and counts it", async () => {
    const foreign = makeSession("cx-foreign", [bashTurn(0, "git commit -m y", "[other deadbee1] y\n 1 file changed")], "codex");
    const sel = await selectContributors([summaryOf(foreign)], [BRANCH_SHA], loaderFor([foreign]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("excludes a Codex session that DID git-write but printed no SHA (no-op/failed) — a real git write is not a 'pure helper'", async () => {
    // Regression (codex review): `writeCount` must count git writes independent of
    // SHA output, so this is NOT mistaken for a no-git-writes helper.
    const noop = makeSession("cx-noop", [bashTurn(0, "git commit -m x", "nothing to commit, working tree clean")], "codex");
    const sel = await selectContributors([summaryOf(noop)], [BRANCH_SHA], loaderFor([noop]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("counts a candidate it can't load as excluded, never guessed in", async () => {
    const owned = ownCommit("owned");
    const ghost = summaryOf(makeSession("ghost", []));
    const sel = await selectContributors([summaryOf(owned), ghost], [BRANCH_SHA], loaderFor([owned]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["owned"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("orders contributors chronologically by session start", async () => {
    const late = ownCommit("late", 5000);
    const early = ownCommit("early", 1000);
    const sel = await selectContributors([summaryOf(late), summaryOf(early)], [BRANCH_SHA], loaderFor([late, early]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["early", "late"]);
  });
});

describe("R3 role derivation (descriptive, not ranking)", () => {
  const claude = makeSession("s", [bashTurn(0, "git commit -m x", "[featB b1c2d3e] x")]);
  it("labels a Codex session codex", () => {
    expect(deriveRole(summaryOf(makeSession("cx", [], "codex")), makeSession("cx", [], "codex"), false)).toBe("codex");
  });
  it("labels a session that spawned on-disk subagents orchestrator", () => {
    expect(deriveRole(summaryOf(claude), claude, true)).toBe("orchestrator");
  });
  it("labels a session with a Task tool call orchestrator", () => {
    const lead = makeSession("lead", [namedToolTurn(0, "Task", { prompt: "go" })]);
    expect(deriveRole(summaryOf(lead), lead, false)).toBe("orchestrator");
  });
  it("labels a session that launched codex exec orchestrator (tokenized, not substring)", () => {
    const lead = makeSession("lead", [bashTurn(0, "codex exec 'do the thing'", "done")]);
    expect(deriveRole(summaryOf(lead), lead, false)).toBe("orchestrator");
  });
  it("does NOT treat an echoed 'codex exec' string as a launch", () => {
    const notLead = makeSession("plain", [bashTurn(0, "echo 'run codex exec later'", "run codex exec later")]);
    expect(deriveRole(summaryOf(notLead), notLead, false)).toBe("builder");
  });
  it("labels a plain committing Claude session builder", () => {
    expect(deriveRole(summaryOf(claude), claude, false)).toBe("builder");
  });
});

describe("R6 Codex adapter parity (cwd + git-write output retained)", () => {
  it("retains cwd and classifies a branch-SHA commit output as own-anchor", async () => {
    const session = (await loadById("codex", path.join(FIX, "codex-branch-commit.jsonl")))!;
    expect(session.cwd).toBe("/home/dev/repo");
    expect(classifyBranchAnchors(session.turns, [BRANCH_SHA]).hasOwn).toBe(true);
  });
});
