// SPEC-0041 — real-session discovery filter: (R1) any `.jsonl` under a
// `subagents/` segment is excluded from top-level listing regardless of
// basename; (R2) all-zero artifacts are floored out of aggregate windows via
// the exported `isAggregatableSession` predicate; (R3) `--list`-level listing
// keeps real-but-all-zero transcripts visible. Committed fixture tree at
// test/fixtures/claude-code-discovery/ reproduces the observed journal noise.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../src/parse/claudeCode.js";
import { discoverChildFiles, isUnderSubagents, parseChildPath } from "../../src/parse/children.js";
import { aggregateWindow, computeDelta, isAggregatableSession, partitionWindows, windowBounds } from "../../src/aggregate/week.js";
import type { SessionSummary } from "../../src/parse/types.js";

const ROOT = path.join(process.cwd(), "test/fixtures/claude-code-discovery");
const adapter = new ClaudeCodeAdapter({ root: ROOT });

function summaryWith(totals: { turnCount: number; toolCallCount: number; tokensTotal: number }, endedAt?: number): SessionSummary {
  return {
    id: `s-${totals.turnCount}-${totals.toolCallCount}-${totals.tokensTotal}`,
    source: "claude-code",
    filePath: "/tmp/x.jsonl",
    endedAt,
    totals: {
      turnCount: totals.turnCount,
      toolCallCount: totals.toolCallCount,
      tokens: { input: totals.tokensTotal, output: 0, cacheRead: 0, cacheCreation: 0, total: totals.tokensTotal },
    },
  };
}

describe("SPEC-0041 R1 — descendant exclusion by path", () => {
  it("excludes the workflow journal from listSessions() while keeping the parent", async () => {
    const rows = await adapter.listSessions({ full: true });
    const basenames = rows.map((r) => path.basename(r.filePath)).sort();
    expect(basenames).toEqual(["s-all-zero.jsonl", "s-parent.jsonl"]);
  });

  it("excludes ANY .jsonl at any depth under subagents/, not just agent-*.jsonl", () => {
    expect(isUnderSubagents(path.join(ROOT, "s-parent/subagents/workflows/wf_a/journal.jsonl"))).toBe(true);
    expect(isUnderSubagents(path.join(ROOT, "s-parent/subagents/agent-w1.jsonl"))).toBe(true);
    expect(isUnderSubagents(path.join(ROOT, "s-parent.jsonl"))).toBe(false);
    // adversarial: a session whose own name merely CONTAINS the word
    expect(isUnderSubagents(path.join(ROOT, "my-subagents-notes.jsonl"))).toBe(false);
  });

  it("adversarial: an ANCESTOR directory named `subagents` never excludes the corpus (root-scoped)", async () => {
    // e.g. a user whose home path contains /subagents/ — only segments BELOW
    // the adapter root count.
    const trickyRoot = path.join("/Users", "subagents", ".claude", "projects");
    const file = path.join(trickyRoot, "proj", "s1.jsonl");
    expect(isUnderSubagents(file, trickyRoot)).toBe(false);
    expect(isUnderSubagents(file)).toBe(true); // unscoped would have excluded it
    expect(isUnderSubagents(path.join(trickyRoot, "proj", "s1", "subagents", "x.jsonl"), trickyRoot)).toBe(true);
  });

  it("keeps parseChildPath's linkage contract: agent children map, journals do not", () => {
    const child = parseChildPath(path.join(ROOT, "s-parent/subagents/agent-w1.jsonl"));
    expect(child?.agentId).toBe("w1");
    expect(child?.parentSessionId).toBe("s-parent");
    expect(parseChildPath(path.join(ROOT, "s-parent/subagents/workflows/wf_a/journal.jsonl"))).toBeNull();
  });

  it("leaves rollup discovery untouched: exactly the agent child, never the journal", async () => {
    const children = await discoverChildFiles(path.join(ROOT, "s-parent.jsonl"));
    expect(children.map((c) => path.basename(c))).toEqual(["agent-w1.jsonl"]);
  });
});

describe("SPEC-0041 R2 — all-zero floor for aggregate windows", () => {
  it("isAggregatableSession is false exactly for the all-zero artifact", () => {
    expect(isAggregatableSession(summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 0 }))).toBe(false);
    expect(isAggregatableSession(summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 5 }))).toBe(true);
    expect(isAggregatableSession(summaryWith({ turnCount: 0, toolCallCount: 2, tokensTotal: 0 }))).toBe(true);
    expect(isAggregatableSession(summaryWith({ turnCount: 1, toolCallCount: 0, tokensTotal: 0 }))).toBe(true);
  });

  it("partitionWindows floors the all-zero artifact but keeps a token-bearing zero-turn session", () => {
    const now = Date.parse("2026-07-04T12:00:00.000Z");
    const bounds = windowBounds(now);
    const inWindow = now - 60_000;
    const real = summaryWith({ turnCount: 2, toolCallCount: 3, tokensTotal: 1000 }, inWindow);
    const tokenBearing = summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 77 }, inWindow);
    const allZero = summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 0 }, inWindow);
    const { current } = partitionWindows([real, tokenBearing, allZero], bounds);
    expect(current).toHaveLength(2);
    expect(current.map((s) => s.id)).not.toContain(allZero.id);
  });

  it("week-window sessionCount drops by exactly the artifact while token inputs are unchanged", () => {
    const now = Date.parse("2026-07-04T12:00:00.000Z");
    const bounds = windowBounds(now);
    const inWindow = now - 60_000;
    const real = summaryWith({ turnCount: 2, toolCallCount: 3, tokensTotal: 1000 }, inWindow);
    const allZero = summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 0 }, inWindow);
    const with_ = partitionWindows([real, allZero], bounds).current;
    const without = partitionWindows([real], bounds).current;
    expect(with_).toEqual(without); // identical inputs → identical week totals downstream
  });

  it("pins the deliberate delta flip: a prior window holding ONLY all-zero artifacts is `no prior data`", async () => {
    // Before this spec, an artifact-only prior window made hasPrior true with
    // zero substance; after, it is honestly empty. Pinned as deliberate (I5:
    // the week output change is asserted, not incidental).
    const now = Date.parse("2026-07-04T12:00:00.000Z");
    const bounds = windowBounds(now);
    const priorTs = bounds.priorStart + 60_000;
    const allZero = { ...summaryWith({ turnCount: 0, toolCallCount: 0, tokensTotal: 0 }, priorTs), turns: [] };
    const { prior } = partitionWindows([allZero], bounds);
    const priorAgg = await aggregateWindow(prior as never, false);
    const currentAgg = await aggregateWindow([], false);
    expect(computeDelta(currentAgg, priorAgg).hasPrior).toBe(false);
  });
});

describe("SPEC-0041 R3 — listing stays inventory", () => {
  it("the all-zero (non-zero-byte) transcript remains visible in the session list", async () => {
    const rows = await adapter.listSessions({ full: true });
    const allZero = rows.find((r) => path.basename(r.filePath) === "s-all-zero.jsonl");
    expect(allZero).toBeDefined();
    expect(isAggregatableSession(allZero!)).toBe(false);
  });
});
