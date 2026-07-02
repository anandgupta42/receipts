// SPEC-0019 R1b/R1d — candidate selection: worktree-root containment, ±15-min
// commit overlap, missing-timestamp exclusion, and the zero/one/many outcomes.
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../src/parse/types.js";
import { cwdInsideRoots } from "../../src/pr/git.js";
import { OVERLAP_SLACK_MS, selectCandidates } from "../../src/pr/select.js";

const emptyTotals = { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, turnCount: 0, toolCallCount: 0 };

function summary(over: Partial<SessionSummary>): SessionSummary {
  return { id: over.filePath ?? "s", source: "claude-code", totals: emptyTotals, filePath: "s", ...over } as SessionSummary;
}

describe("R1b cwdInsideRoots (worktree + sibling containment)", () => {
  const roots = ["/home/dev/repo", "/home/dev/repo-spec0019"];
  it("matches a cwd at or inside a worktree root", () => {
    expect(cwdInsideRoots("/home/dev/repo", roots)).toBe(true);
    expect(cwdInsideRoots("/home/dev/repo/src/pr", roots)).toBe(true);
    expect(cwdInsideRoots("/home/dev/repo-spec0019", roots)).toBe(true); // sibling worktree
  });
  it("rejects a cwd outside every root (no prefix-string false match)", () => {
    expect(cwdInsideRoots("/home/dev/repo-other", roots)).toBe(false);
    expect(cwdInsideRoots("/home/dev", roots)).toBe(false);
  });
});

describe("R1d overlap + selection", () => {
  const roots = ["/home/dev/repo"];
  const commitMs = [Date.parse("2026-06-28T12:00:00.000Z")];

  it("includes a commit at the padded window edge (±15 min, inclusive)", () => {
    // Session ends exactly 15 min before the commit → still overlaps at the edge.
    const s = summary({
      filePath: "edge",
      cwd: "/home/dev/repo",
      startedAt: Date.parse("2026-06-28T11:00:00.000Z"),
      endedAt: commitMs[0] - OVERLAP_SLACK_MS,
    });
    expect(selectCandidates([s], roots, commitMs)).toEqual({ kind: "one", summary: s });
  });

  it("excludes a session just outside the padded window", () => {
    const s = summary({
      filePath: "far",
      cwd: "/home/dev/repo",
      startedAt: Date.parse("2026-06-28T08:00:00.000Z"),
      endedAt: commitMs[0] - OVERLAP_SLACK_MS - 1,
    });
    expect(selectCandidates([s], roots, commitMs)).toEqual({ kind: "none" });
  });

  it("excludes a session missing a timestamp", () => {
    const s = summary({ filePath: "notime", cwd: "/home/dev/repo", startedAt: undefined, endedAt: commitMs[0] });
    expect(selectCandidates([s], roots, commitMs)).toEqual({ kind: "none" });
  });

  it("excludes a session whose cwd is absent (never auto-attributed)", () => {
    const s = summary({ filePath: "nocwd", startedAt: commitMs[0], endedAt: commitMs[0] });
    expect(selectCandidates([s], roots, commitMs)).toEqual({ kind: "none" });
  });

  it("returns many when two sessions overlap", () => {
    const base = { cwd: "/home/dev/repo", startedAt: commitMs[0] - 1000, endedAt: commitMs[0] + 1000 };
    const a = summary({ filePath: "a", ...base });
    const b = summary({ filePath: "b", ...base });
    const result = selectCandidates([a, b], roots, commitMs);
    expect(result.kind).toBe("many");
  });

  it("never auto-attributes a subagent transcript", () => {
    const s = summary({
      filePath: "child",
      cwd: "/home/dev/repo",
      startedAt: commitMs[0],
      endedAt: commitMs[0],
      isSidechain: true,
    });
    expect(selectCandidates([s], roots, commitMs)).toEqual({ kind: "none" });
  });
});
