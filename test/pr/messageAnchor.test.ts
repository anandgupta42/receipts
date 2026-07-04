// SPEC-0032 — the commit-message fallback anchor. The safety is structural:
// a message credit requires a branch subject that is unclaimed by any SHA,
// unique on the branch, and claimed by exactly one current-worktree session
// that never SHA-committed elsewhere. These tests pin every clause plus the
// PR #61 replay (quiet commit) the spec was written for.
import { describe, expect, it } from "vitest";
import type { AgentSource, Session, SessionSummary, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { selectContributors, type PoolCandidate } from "../../src/pr/contributors.js";
import { renderPrBody, type ContributorView } from "../../src/pr/body.js";
import {
  MSG_MIN,
  eligibleSubjects,
  firstCommitSubject,
  hasForeignShaWrites,
  sessionCommitSubjects,
} from "../../src/pr/messageAnchor.js";

const SHA_A = "a1a2a3a4a5a6a7a8a9aa0b1b2b3b4b5b6b7b8b9b";
const SHA_B = "b1c2d3e4f5061728394a5b6c7d8e9f0011223344";
const SUBJ_A = "feat: quiet-committed spec subject A";
const SUBJ_B = "fix: the other branch commit subject B";
const usage = withTotal({ ...emptyUsage(), input: 1000, output: 100 });
const CURRENT_ROOT = "/home/dev/repo";

function bashTurn(index: number, command: string, output: string): Turn {
  return {
    index,
    timestamp: 1000 + index,
    model: "claude-opus-4-8",
    usage,
    toolCalls: [{ name: "Bash", shell: true, input: { command }, output, status: "ok" }],
  };
}

function makeSession(id: string, turns: Turn[], source: AgentSource = "claude-code", startedAt = 1000, cwd = CURRENT_ROOT): Session {
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

function repo(s: Session): PoolCandidate {
  return { summary: s, pool: "repo" };
}
function anchor(s: Session): PoolCandidate {
  return { summary: s, pool: "anchor" };
}
function loaderFor(sessions: Session[], branchSubjects: readonly string[] = [SUBJ_A, SUBJ_B]) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return {
    loadSession: async (summary: SessionSummary) => byId.get(summary.id) ?? null,
    currentWorktreeRoot: CURRENT_ROOT,
    branchSubjects,
  };
}

/** The PR #61 shape: `git commit --quiet -m <subject>` — a git write with NO output at all. */
const quietCommit = (id: string, subject: string, startedAt = 1000) =>
  makeSession(id, [bashTurn(0, `git commit --quiet -m "${subject}"`, "")], "claude-code", startedAt);

/** SHA-proven session claiming SHA_B via commit output. */
const shaOwner = (id: string, startedAt = 2000) =>
  makeSession(id, [bashTurn(0, "git commit -m x", `[featB ${SHA_B.slice(0, 7)}] x`)], "claude-code", startedAt);

describe("SPEC-0032 R1 · first -m extraction", () => {
  const forms: Array<[string[], string | null]> = [
    [["git", "commit", "-m", "subject one"], "subject one"],
    [["git", "commit", "-msubject two"], "subject two"],
    [["git", "commit", "--message", "subject three"], "subject three"],
    [["git", "commit", "--message=subject four"], "subject four"],
    [["git", "commit", "-am", "subject five"], "subject five"],
  ];
  it.each(forms)("extracts from %j", (argv, expected) => {
    expect(firstCommitSubject(argv)).toBe(expected);
  });

  it("first -m only — later values are body paragraphs", () => {
    expect(firstCommitSubject(["git", "commit", "-m", "the subject", "-m", "the body"])).toBe("the subject");
  });

  it("S5-3 safety: `--` stops scanning; value-taking flag arguments are skipped; -cm is NOT a message flag", () => {
    expect(firstCommitSubject(["git", "commit", "--", "path", "-m", "feat: a very eligible subject"])).toBeNull();
    expect(firstCommitSubject(["git", "commit", "-F", "-m", "not-a-subject"])).toBeNull();
    expect(firstCommitSubject(["git", "commit", "-C", "abc123", "-m", "real subject here"])).toBe("real subject here");
    expect(firstCommitSubject(["git", "commit", "-cm", "orig-head"])).toBeNull();
  });

  it("S5-3 git semantics: -m=x records `=x`, attached -mfoo records `foo`", () => {
    expect(firstCommitSubject(["git", "commit", "-m=x"])).toBe("=x");
    expect(firstCommitSubject(["git", "commit", "-mattached subject"])).toBe("attached subject");
  });

  it("non-commit verbs never yield a subject", () => {
    expect(firstCommitSubject(["git", "push", "-m", "not a commit"])).toBeNull();
    expect(firstCommitSubject(["git", "log", "-m"])).toBeNull();
  });

  it("session-level: dedupes across invocations, keeps order", () => {
    const s = makeSession("s", [
      bashTurn(0, `git commit -m "${SUBJ_A}"`, ""),
      bashTurn(1, `git commit -m "${SUBJ_A}"`, ""),
      bashTurn(2, `git commit -m "${SUBJ_B}"`, ""),
    ]);
    expect(sessionCommitSubjects(s)).toEqual([SUBJ_A, SUBJ_B]);
  });
});

describe("SPEC-0032 R3 · eligible subjects", () => {
  it("unclaimed + unique + long enough → eligible; claimed → not", () => {
    const set = eligibleSubjects([SHA_A, SHA_B], [SUBJ_A, SUBJ_B], new Set([SHA_B]));
    expect(set.has(SUBJ_A)).toBe(true);
    expect(set.has(SUBJ_B)).toBe(false);
  });

  it("a subject on two branch commits is never eligible (revert / re-applied pick)", () => {
    const set = eligibleSubjects([SHA_A, SHA_B], [SUBJ_A, SUBJ_A], new Set());
    expect(set.size).toBe(0);
  });

  it(`shorter than MSG_MIN (${MSG_MIN}) drops as noise`, () => {
    const set = eligibleSubjects([SHA_A], ["fix: x"], new Set());
    expect(set.size).toBe(0);
  });
});

describe("SPEC-0032 R4b · foreign SHA writes", () => {
  it("output SHA matching no branch commit → foreign; quiet output → not", () => {
    const foreign = makeSession("f", [bashTurn(0, "git commit -m x", "[other 9f8e7d6c5b] x")]);
    expect(hasForeignShaWrites(foreign, [SHA_A, SHA_B])).toBe(true);
    expect(hasForeignShaWrites(quietCommit("q", SUBJ_A), [SHA_A, SHA_B])).toBe(false);
  });
});

describe("SPEC-0032 R4/R5 · credit through selectContributors", () => {
  it("R4 happy path (PR #61 replay): quiet commit, eligible subject → basis message, floor cleared, full-fallback slice", async () => {
    const q = quietCommit("quiet", SUBJ_A);
    const sel = await selectContributors([repo(q)], [SHA_A, SHA_B], loaderFor([q]));
    expect(sel.contributors).toHaveLength(1);
    expect(sel.contributors[0].basis).toBe("message");
    expect(sel.contributors[0].slice.kind).toBe("full");
    expect(sel.contributors[0].slice.label).toBeDefined();
    expect(sel.excludedCount).toBe(0);
  });

  it("R3a order independence: the SHA owner claims its commit from either list position", async () => {
    const q = quietCommit("quiet", SUBJ_B, 1000);
    const owner = shaOwner("owner", 2000);
    for (const order of [
      [repo(q), repo(owner)],
      [repo(owner), repo(q)],
    ]) {
      const sel = await selectContributors(order, [SHA_A, SHA_B], loaderFor([q, owner]));
      const bases = sel.contributors.map((c) => c.basis).sort();
      expect(bases).toEqual(["anchor"]);
      expect(sel.excludedCount).toBe(1);
    }
  });

  it("R4d tie refusal: two sessions claiming the same eligible subject → neither credited, both excluded", async () => {
    const q1 = quietCommit("q1", SUBJ_A, 1000);
    const q2 = quietCommit("q2", SUBJ_A, 1500);
    const sel = await selectContributors([repo(q1), repo(q2)], [SHA_A, SHA_B], loaderFor([q1, q2]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(2);
  });

  it("S5-1: a PUSH-only SHA anchor claims its subject — no message credit for the same commit", async () => {
    const pusher = makeSession("pusher", [bashTurn(0, "git push origin featB", `To github.com:o/r\n   ${SHA_A.slice(0, 10)}..${SHA_B.slice(0, 10)}  featB -> featB`)], "claude-code", 2000);
    const quiet = quietCommit("quiet", SUBJ_B, 1000);
    const sel = await selectContributors([repo(quiet), repo(pusher)], [SHA_A, SHA_B], loaderFor([quiet, pusher]));
    expect(sel.contributors.map((c) => c.basis)).toEqual(["anchor"]);
    expect(sel.excludedCount).toBe(1);
  });

  it("S5-2: a disqualified claimant still poisons its subject (foreign claimant + clean claimant → nobody)", async () => {
    const clean = quietCommit("clean", SUBJ_A, 1000);
    const dirty = makeSession("dirty", [
      bashTurn(0, `git commit --quiet -m "${SUBJ_A}"`, ""),
      bashTurn(1, "git commit -m other", "[other 9f8e7d6c5b] other"),
    ], "claude-code", 1500);
    const sel = await selectContributors([repo(clean), repo(dirty)], [SHA_A, SHA_B], loaderFor([clean, dirty]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(2);
  });

  it("S5-2: a greedy claimant (two eligible subjects) poisons both for everyone else", async () => {
    const single = quietCommit("single", SUBJ_A, 1000);
    const greedy = makeSession("greedy", [
      bashTurn(0, `git commit --quiet -m "${SUBJ_A}"`, ""),
      bashTurn(1, `git commit --quiet -m "${SUBJ_B}"`, ""),
    ], "claude-code", 1500);
    const sel = await selectContributors([repo(single), repo(greedy)], [SHA_A, SHA_B], loaderFor([single, greedy]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(2);
  });

  it("R4b: a session that SHA-committed elsewhere gets no message credit", async () => {
    const s = makeSession("elsewhere", [
      bashTurn(0, `git commit --quiet -m "${SUBJ_A}"`, ""),
      bashTurn(1, "git commit -m other", "[other-branch 9f8e7d6c5b] other"),
    ]);
    const sel = await selectContributors([repo(s)], [SHA_A, SHA_B], loaderFor([s]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("R4a pool scope: anchor-pool and sibling-worktree candidates never message-credit", async () => {
    const pool = quietCommit("pooled", SUBJ_A);
    const sibling = makeSession("sib", [bashTurn(0, `git commit --quiet -m "${SUBJ_A}"`, "")], "claude-code", 1000, "/home/dev/other-worktree");
    for (const [cand, sess] of [
      [anchor(pool), pool],
      [repo(sibling), sibling],
    ] as const) {
      const sel = await selectContributors([cand], [SHA_A, SHA_B], loaderFor([sess]));
      expect(sel.contributors).toHaveLength(0);
    }
  });

  it("R4c: a session matching TWO eligible subjects is not credited (exactly one)", async () => {
    const s = makeSession("greedy", [
      bashTurn(0, `git commit --quiet -m "${SUBJ_A}"`, ""),
      bashTurn(1, `git commit --quiet -m "${SUBJ_B}"`, ""),
    ]);
    const sel = await selectContributors([repo(s)], [SHA_A, SHA_B], loaderFor([s]));
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("fallback off when no subjects supplied (existing callers unchanged)", async () => {
    const q = quietCommit("quiet", SUBJ_A);
    const sel = await selectContributors([repo(q)], [SHA_A, SHA_B], {
      loadSession: async () => q,
      currentWorktreeRoot: CURRENT_ROOT,
    });
    expect(sel.contributors).toHaveLength(0);
    expect(sel.excludedCount).toBe(1);
  });

  it("R5 row label: the fence carries `matched by commit message` with and without the details section", () => {
    const view: ContributorView = {
      role: "builder",
      sessionId: "quiet",
      modelMix: [{ model: "claude-opus-4-8", share: 1 }],
      usd: null,
      tokens: usage,
      slice: { kind: "full", turnCount: 1, label: "entire session (slice unavailable)" },
      basis: "message",
      subagents: [],
    };
    for (const detailsBelow of [true, false]) {
      const body = renderPrBody({ contributors: [view], excludedCount: 0, detailsBelow });
      // S5-4: inside the FENCED receipt (not comment prose), indented like a
      // provenance note, within the 50-col receipt, and never alongside a
      // slice note (a message row is always a full-session fallback).
      const fence = /```\n([\s\S]*?)```/.exec(body);
      expect(fence).not.toBeNull();
      const noteLine = fence![1].split("\n").find((l) => l.includes("matched by commit message"));
      expect(noteLine).toBeDefined();
      expect(noteLine!.startsWith("  ")).toBe(true);
      expect([...noteLine!].length).toBeLessThanOrEqual(50);
      expect(fence![1]).not.toContain("session slice:");
    }
  });
});
