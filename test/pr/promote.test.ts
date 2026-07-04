// SPEC-0024 R2 — orphan SHA-anchored listed sidechains promote to top-level
// contributors, dedup-safe: a candidate already covered (a contributor's file
// or any rolled-up SubagentRow.filePath) is skipped so no token counts twice
// (I3); anchorless or unloadable sidechains are silently ignored (no cwd+time
// credit for sidechains, ever).
import { describe, expect, it } from "vitest";
import type { Session, SessionSummary, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { promoteOrphanSidechains } from "../../src/pr/promote.js";

const BRANCH_SHA = "b1c2d3e4f5061728394a5b6c7d8e9f0011223344";
const usage = withTotal({ ...emptyUsage(), input: 1000, output: 100 });

function commitTurn(index: number, output: string): Turn {
  return {
    index,
    timestamp: 1000 + index,
    model: "claude-opus-4-8",
    usage,
    toolCalls: [{ name: "Bash", shell: true, input: { command: "git commit -m x" }, output, status: "ok" }],
  };
}

function sidechain(id: string, turns: Turn[], startedAt = 1000): Session {
  return {
    id,
    source: "claude-code",
    filePath: `${id}.jsonl`,
    cwd: "/home/dev/lead-repo",
    isSidechain: true,
    startedAt,
    endedAt: startedAt + 1000,
    totals: { tokens: usage, turnCount: turns.length, toolCallCount: turns.length },
    turns,
  };
}

const anchored = (id: string, startedAt = 1000) =>
  sidechain(id, [commitTurn(0, "[featB b1c2d3e] x\n 1 file changed")], startedAt);

function loader(sessions: Session[]) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return async (summary: SessionSummary) => byId.get(summary.id) ?? null;
}

describe("SPEC-0024 R2 orphan sidechain promotion", () => {
  it("promotes an anchored sidechain no rollup covers, with its own PR slice", async () => {
    const teammate = anchored("teammate");
    const promoted = await promoteOrphanSidechains([teammate], [BRANCH_SHA], new Set(), loader([teammate]));
    expect(promoted.map((c) => c.summary.id)).toEqual(["teammate"]);
    expect(promoted[0].slice.kind).toBe("slice");
  });

  it("skips a candidate whose filePath is already covered — the dedup guard (counted once)", async () => {
    const teammate = anchored("teammate");
    const covered = new Set([teammate.filePath]);
    const promoted = await promoteOrphanSidechains([teammate], [BRANCH_SHA], covered, loader([teammate]));
    expect(promoted).toHaveLength(0);
  });

  it("never promotes an anchorless sidechain (no cwd+time credit for sidechains)", async () => {
    const idle = sidechain("idle", [commitTurn(0, "nothing to commit, working tree clean")]);
    const promoted = await promoteOrphanSidechains([idle], [BRANCH_SHA], new Set(), loader([idle]));
    expect(promoted).toHaveLength(0);
  });

  it("never promotes a sidechain whose only SHA is foreign (another branch's commit)", async () => {
    const foreign = sidechain("foreign", [commitTurn(0, "[other deadbee1] y\n 1 file changed")]);
    const promoted = await promoteOrphanSidechains([foreign], [BRANCH_SHA], new Set(), loader([foreign]));
    expect(promoted).toHaveLength(0);
  });

  it("silently skips an unloadable sidechain", async () => {
    const ghost = anchored("ghost");
    const promoted = await promoteOrphanSidechains([ghost], [BRANCH_SHA], new Set(), loader([]));
    expect(promoted).toHaveLength(0);
  });

  it("orders promotions chronologically by start, then id (deterministic)", async () => {
    const late = anchored("late", 5000);
    const early = anchored("early", 1000);
    const tieB = anchored("tie-b", 3000);
    const tieA = anchored("tie-a", 3000);
    const all = [late, tieB, early, tieA];
    const promoted = await promoteOrphanSidechains(all, [BRANCH_SHA], new Set(), loader(all));
    expect(promoted.map((c) => c.summary.id)).toEqual(["early", "tie-a", "tie-b", "late"]);
  });
});
