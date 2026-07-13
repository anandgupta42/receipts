// SPEC-0019 R1c — child discovery + rollup: children are found under the parent's
// subagents/ tree and excluded from the top-level list; a child rolls up on
// interval overlap (including a child spanning the whole parent range); an
// unreadable child is listed and counted, never dropped.
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
  const window = { kind: "range", start, end } as const;

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

  it("includes a child whose interval spans the entire parent range", async () => {
    const spanning = childSession("spanning", start - 500, end + 500);
    const rows = await rollupChildren(PARENT, window, {
      discover: async () => ["spanning"],
      load: async () => spanning,
    });
    expect(rows.map((r) => r.name)).toEqual(["child spanning"]);
    expect(rows[0].tokens).toEqual(spanning.totals.tokens);
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

  it("full-session render includes every child", async () => {
    const anytime = childSession("x", 42, 99);
    const rows = await rollupChildren(PARENT, { kind: "full" }, {
      discover: async () => ["x"],
      load: async () => anytime,
    });
    expect(rows).toHaveLength(1);
  });

  it("an unknown slice window excludes readable child usage but preserves unreadable evidence", async () => {
    const pricedStart = Date.UTC(2026, 5, 15, 10, 0, 0);
    const readable = childSession("readable", pricedStart, pricedStart + 1);
    const rows = await rollupChildren(PARENT, { kind: "unknown" }, {
      discover: async () => ["readable", "broken"],
      load: async (file) => (file === "readable" ? readable : null),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ filePath: "broken", usd: null, unreadable: true });
  });

  it("carries the exact unpriced portion of a partially-priced child", async () => {
    const mixedStart = Date.UTC(2026, 5, 15, 10, 0, 0);
    const child = childSession("mixed", mixedStart, mixedStart + 2);
    const unpricedUsage = withTotal({ ...emptyUsage(), input: 300, output: 75, cacheRead: 25 });
    child.turns.push({
      index: 1,
      timestamp: mixedStart + 1,
      model: "claude-unknown-model-xyz",
      usage: unpricedUsage,
      toolCalls: [],
    });
    child.totals.tokens = withTotal({ ...emptyUsage(), input: 800, output: 175, cacheRead: 25 });
    child.totals.turnCount = 2;

    const rows = await rollupChildren(PARENT, { kind: "range", start: mixedStart, end: mixedStart + 2 }, {
      discover: async () => ["mixed"],
      load: async () => child,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].usd).not.toBeNull();
    expect(rows[0].unpricedTokens).toEqual(unpricedUsage);
  });

  it("propagates a readable child's cache-rate lower-bound evidence", async () => {
    const startedAt = Date.UTC(2026, 6, 10, 10, 0, 0);
    const child = childSession("cache-gap", startedAt, startedAt + 1);
    child.source = "codex";
    child.model = "gpt-5.4-mini";
    child.turns[0].model = "gpt-5.4-mini";
    child.turns[0].usage = withTotal({ ...emptyUsage(), input: 500, output: 100, cacheCreation: 25 });
    child.totals.tokens = child.turns[0].usage;

    const rows = await rollupChildren(PARENT, { kind: "full" }, {
      discover: async () => ["cache-gap"],
      load: async () => child,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].usd).not.toBeNull();
    expect(rows[0].costLowerBoundCacheTier).toBe(true);
  });
});
