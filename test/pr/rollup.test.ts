// SPEC-0019 R1c — child discovery + rollup: children are found under the parent's
// subagents/ tree and excluded from the top-level list; a child rolls up on
// launch- OR result-in-window overlap (straddle); an unreadable child is listed
// and counted, never dropped.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverChildFiles, isChildPath, parseChildPath } from "../../src/parse/children.js";
import type { Session, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { rollupChildren } from "../../src/pr/rollup.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");
const PARENT = path.join(FIX, "parent-with-subagents.jsonl");

function childSession(id: string, startedAt: number, endedAt: number): Session {
  const usage = withTotal({ ...emptyUsage(), input: 500, output: 100 });
  const turn: Turn = { index: 0, timestamp: startedAt, model: "claude-opus-4-8", usage, toolCalls: [] };
  return {
    id,
    source: "claude-code",
    title: `child ${id}`,
    model: "claude-opus-4-8",
    startedAt,
    endedAt,
    totals: { tokens: usage, turnCount: 1, toolCallCount: 0 },
    filePath: id,
    turns: [turn],
  };
}

describe("R1c discovery (path layout)", () => {
  it("maps a child path back to its parent and marks it a child", () => {
    const childPath = path.join(FIX, "parent-with-subagents", "subagents", "agent-child1.jsonl");
    expect(parseChildPath(childPath)).toEqual({
      agentId: "child1",
      parentSessionId: "parent-with-subagents",
      parentFilePath: PARENT,
    });
    expect(isChildPath(childPath)).toBe(true);
    expect(isChildPath(PARENT)).toBe(false); // the parent is a top-level session
  });

  it("discovers a parent's children in sorted order", async () => {
    const kids = await discoverChildFiles(PARENT);
    expect(kids.map((k) => path.basename(k))).toEqual(["agent-child1.jsonl", "agent-child2.jsonl"]);
  });
});

describe("R1c rollup (window overlap + honest count)", () => {
  const start = 1_000_000;
  const end = 2_000_000;
  const window = { start, end };

  it("includes a straddling child (launched in-slice, finished after)", async () => {
    const straddle = childSession("straddle", start + 10, end + 5_000);
    const rows = await rollupChildren(PARENT, window, {
      discover: async () => ["straddle"],
      load: async () => straddle,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].unreadable).toBe(false);
    expect(rows[0].name).toBe("child straddle");
  });

  it("includes a child whose result lands in-window and excludes one fully outside", async () => {
    const resultIn = childSession("resultIn", start - 500, start + 50);
    const before = childSession("before", start - 5_000, start - 4_000);
    const rows = await rollupChildren(PARENT, window, {
      discover: async () => ["resultIn", "before"],
      load: async (f) => (f === "resultIn" ? resultIn : before),
    });
    expect(rows.map((r) => r.name)).toEqual(["child resultIn"]);
  });

  it("lists an unreadable child and keeps the count honest", async () => {
    const good = childSession("good", start + 1, start + 2);
    const rows = await rollupChildren(PARENT, window, {
      discover: async () => ["good", "broken"],
      load: async (f) => (f === "good" ? good : null),
    });
    expect(rows).toHaveLength(2);
    const broken = rows.find((r) => r.unreadable);
    expect(broken).toBeTruthy();
    expect(broken!.usd).toBeNull();
  });

  it("full-session render (null window) includes every child", async () => {
    const anytime = childSession("x", 42, 99);
    const rows = await rollupChildren(PARENT, null, {
      discover: async () => ["x"],
      load: async () => anytime,
    });
    expect(rows).toHaveLength(1);
  });
});
