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
import { deriveRole, selectContributors, type PoolCandidate } from "../../src/pr/contributors.js";
import { summarizeConfidence } from "../../src/pr/confidence.js";

const BRANCH_SHA = "b1c2d3e4f5061728394a5b6c7d8e9f0011223344";
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const usage = withTotal({ ...emptyUsage(), input: 1000, output: 100 });

function bashTurn(index: number, command: string, output: string): Turn {
  return {
    index,
    timestamp: 1000 + index,
    model: "claude-opus-4-8",
    usage,
    toolCalls: [{ name: "Bash", shell: true, input: { command }, output, status: "ok" }],
  };
}

function namedToolTurn(index: number, name: string, input: unknown): Turn {
  return { index, timestamp: 1000 + index, model: "claude-opus-4-8", usage, toolCalls: [{ name, input, status: "ok" }] };
}

const CURRENT_ROOT = "/home/dev/repo";
const noGit = () => ({ stdout: "", stderr: "", code: 1, missing: false });

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

/** Pool-tagged candidates (SPEC-0024 R1): repo pool keeps SPEC-0023 rules; anchor pool is SHA-anchor-only. */
function repo(s: Session): PoolCandidate {
  return { summary: s, pool: "repo" };
}
function anchor(s: Session): PoolCandidate {
  return { summary: s, pool: "anchor" };
}

/** A loader that resolves candidates from a fixed map; unknown ids resolve to null (unreadable). Scoped to CURRENT_ROOT. */
function loaderFor(sessions: Session[]) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return {
    loadSession: async (summary: SessionSummary) => byId.get(summary.id) ?? null,
    currentWorktreeRoot: CURRENT_ROOT,
    runGit: noGit,
  };
}

const ownCommit = (id: string, startedAt = 1000, source: AgentSource = "claude-code") =>
  makeSession(id, [bashTurn(0, "git commit -m x", `[featB b1c2d3e] x\n 1 file changed`)], source, startedAt);

describe("R1 contributor selection", () => {
  it("credits two own-anchored Claude sessions (the union — no 'pick one' error)", async () => {
    const a = ownCommit("a", 1000);
    const b = ownCommit("b", 3000);
    const sel = await selectContributors([repo(a), repo(b)], [BRANCH_SHA], loaderFor([a, b]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["a", "b"]);
    expect(sel.excludedCount).toBe(0);
  });

  it("excludes a Claude session with no branch-SHA anchor and counts it (not attributed)", async () => {
    const owned = ownCommit("owned");
    const noAnchor = makeSession("edits", [namedToolTurn(0, "Edit", { file_path: "x.ts" })]);
    const sel = await selectContributors([repo(owned), repo(noAnchor)], [BRANCH_SHA], loaderFor([owned, noAnchor]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["owned"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("credits a Codex helper that made no git writes in THIS worktree (cwd+time rule)", async () => {
    const helper = makeSession("cx-help", [bashTurn(0, "ls -la", "src\ntest")], "codex");
    const sel = await selectContributors([repo(helper)], [BRANCH_SHA], loaderFor([helper]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["cx-help"]);
    expect(sel.excludedCount).toBe(0);
  });

  it("does NOT credit (or count) a SHA-less Codex helper from a sibling worktree (dogfood: cross-worktree over-attribution)", async () => {
    // A codex session doing unrelated work in another worktree of the same repo,
    // overlapping this branch's window. cwd is a sibling → silently ignored.
    const sibling = makeSession("cx-sibling", [bashTurn(0, "ls -la", "src")], "codex", 1000, "/home/dev/repo-spec9999");
    const sel = await selectContributors([repo(sibling)], [BRANCH_SHA], loaderFor([sibling]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(0); // not plausible for this branch → not even noted
  });

  it("still credits a sibling-worktree session that carries a branch-SHA anchor (SHA proof beats worktree scope)", async () => {
    const sibling = ownCommit("builder-sibling", 1000, "claude-code");
    sibling.cwd = "/home/dev/repo-spec9999";
    const sel = await selectContributors([repo(sibling)], [BRANCH_SHA], loaderFor([sibling]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["builder-sibling"]);
  });

  it("credits an own-anchored Codex session", async () => {
    const cx = ownCommit("cx-own", 1000, "codex");
    const sel = await selectContributors([repo(cx)], [BRANCH_SHA], loaderFor([cx]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["cx-own"]);
  });

  it("excludes a foreign-only session (committed to another branch) and counts it", async () => {
    const foreign = makeSession("cx-foreign", [bashTurn(0, "git commit -m y", "[other deadbee1] y\n 1 file changed")], "codex");
    const sel = await selectContributors([repo(foreign)], [BRANCH_SHA], loaderFor([foreign]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("excludes a Codex session that DID git-write but printed no SHA (no-op/failed) — a real git write is not a 'pure helper'", async () => {
    // Regression (codex review): `writeCount` must count git writes independent of
    // SHA output, so this is NOT mistaken for a no-git-writes helper.
    const noop = makeSession("cx-noop", [bashTurn(0, "git commit -m x", "nothing to commit, working tree clean")], "codex");
    const sel = await selectContributors([repo(noop)], [BRANCH_SHA], loaderFor([noop]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("writeCount counts each git write EXACTLY (kills a `writeCount++`→`--`/no-op mutant)", () => {
    // SPEC-0044 M3 — the classic tests only assert writeCount is nonzero, so a
    // `++`→`--` mutation survived. Two real git-write calls must yield exactly 2
    // (a `--` mutant gives -2, a deleted increment gives 0). writeCount is
    // output/SHA-independent, so no branch SHA is needed to count the writes.
    const twoWrites = makeSession(
      "cx-two",
      [bashTurn(0, "git commit -m a", "[featB aaaaaa1] a\n 1 file changed"), bashTurn(1, "git commit -m b", "[featB bbbbbb2] b\n 1 file changed")],
      "codex",
    );
    expect(classifyBranchAnchors(twoWrites.turns, []).writeCount).toBe(2);
    // And a session with no git verbs is exactly 0 (not -0/underflow).
    expect(classifyBranchAnchors(makeSession("cx-none", [bashTurn(0, "ls -la", "src")], "codex").turns, []).writeCount).toBe(0);
  });

  it("counts a candidate it can't load as excluded, never guessed in", async () => {
    const owned = ownCommit("owned");
    const ghost = repo(makeSession("ghost", []));
    const sel = await selectContributors([repo(owned), ghost], [BRANCH_SHA], loaderFor([owned]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["owned"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("orders contributors chronologically by session start", async () => {
    const late = ownCommit("late", 5000);
    const early = ownCommit("early", 1000);
    const sel = await selectContributors([repo(late), repo(early)], [BRANCH_SHA], loaderFor([late, early]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["early", "late"]);
  });
});


describe("SPEC-0024 R1 anchor pool (SHA anchor is the only key)", () => {
  it("credits a cross-repo lead on its own branch-SHA anchor (cwd outside every repo root)", async () => {
    const lead = ownCommit("lead-other-repo", 1000);
    lead.cwd = "/home/dev/OTHER-repo";
    const sel = await selectContributors([anchor(lead)], [BRANCH_SHA], loaderFor([lead]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["lead-other-repo"]);
    expect(sel.excludedCount).toBe(0);
  });

  it("silently ignores a cross-repo session with no anchor — not credited, not counted as excluded", async () => {
    const bystander = makeSession("bystander", [namedToolTurn(0, "Edit", { file_path: "x.ts" })], "claude-code", 1000, "/home/dev/OTHER-repo");
    const sel = await selectContributors([anchor(bystander)], [BRANCH_SHA], loaderFor([bystander]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(0);
  });

  it("credits an anchored session with no cwd at all (anchor beats missing cwd)", async () => {
    const noCwd = ownCommit("no-cwd", 1000);
    noCwd.cwd = undefined;
    const sel = await selectContributors([anchor(noCwd)], [BRANCH_SHA], loaderFor([noCwd]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["no-cwd"]);
  });

  it("never applies the SHA-less Codex helper rule to the anchor pool — even for a current-worktree cwd", async () => {
    // Same session shape the repo pool WOULD credit as a helper; in the anchor
    // pool the SHA anchor is the only key (SPEC-0024 R1).
    const helper = makeSession("cx-anchor-pool", [bashTurn(0, "ls -la", "src")], "codex");
    const sel = await selectContributors([anchor(helper)], [BRANCH_SHA], loaderFor([helper]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(0);
  });

  it("anchor credit is source-agnostic (a non-Claude, non-Codex session with an own anchor contributes)", async () => {
    const gem = ownCommit("gem", 1000, "gemini");
    gem.cwd = "/home/dev/OTHER-repo";
    const sel = await selectContributors([anchor(gem)], [BRANCH_SHA], loaderFor([gem]));
    expect(sel.contributors.map((c) => c.summary.id)).toEqual(["gem"]);
  });

  it("an unloadable anchor-pool candidate is counted as unreadable, never silent (B4)", async () => {
    const ghost = anchor(makeSession("anchor-ghost", []));
    const sel = await selectContributors([ghost], [BRANCH_SHA], loaderFor([]));
    expect(sel.contributors).toHaveLength(0);
    // Not the classic excluded count (that's "read, no SHA") …
    expect(sel.excludedCount).toBe(0);
    // … but its absence is NOT silent: "couldn't read" is counted distinctly so
    // the total floors `≥` (SPEC-0044 B4 — the honesty red-team gap).
    expect(summarizeConfidence(sel.events).unreadableSession).toBe(1);
  });

  it("SPEC-0045 R2 — a degraded (parse-failed) repo candidate flags unreadable-session even when `here`, not the silent excluded count", async () => {
    // A repo-scoped transcript whose lazy summary built (cwd = CURRENT_ROOT) but
    // whose full parse fails — `degraded: "unreadable"`, retained through discovery
    // (R1). Because cwd is the current worktree it is `here`; the pre-0045 path
    // folded a load-null `here` candidate into the SILENT silenced-git-write
    // excluded count (S2 CRITICAL). SPEC-0045 routes a degraded candidate to
    // `unreadable-session` instead. `loaderFor([])` returns null — the same
    // parse failure that degraded it.
    const degraded: PoolCandidate = { summary: { ...summaryOf(makeSession("dgr-here", [])), degraded: "unreadable" }, pool: "repo" };
    const sel = await selectContributors([degraded], [BRANCH_SHA], loaderFor([]));
    expect(sel.contributors).toHaveLength(0);
    expect(summarizeConfidence(sel.events).unreadableSession).toBe(1);
    // NOT the silent excluded count — that's the whole point of the fix.
    expect(sel.excludedCount).toBe(0);
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
