import { describe, it, expect } from "vitest";
import { pushSessionSubagentEvents } from "../../src/pr/index.js";
import type { ConfidenceEvent } from "../../src/pr/confidence.js";
import type { RawContributor } from "../../src/pr/contributors.js";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { emptyUsage } from "../../src/parse/util.js";

// SPEC-0044 M2/B3 — the cost-loop emitter is the single site that routes a
// session's own parse-skips AND each rolled-up subagent's parse-skip /
// unreadability through the typed ConfidenceEvent contract. These assert the
// exact events for each condition, so a future change that drops an emission
// (the mutation the M3 gate targets) fails here.

function raw(filePath: string, droppedRecords = 0): RawContributor {
  return { summary: { filePath }, session: { droppedRecords } } as unknown as RawContributor;
}

function subagent(over: Partial<SubagentRow>): SubagentRow {
  return { name: "child", model: null, usd: null, tokens: emptyUsage(), unreadable: false, filePath: "p/subagents/child.jsonl", ...over };
}

const usage = (input: number) => ({ ...emptyUsage(), input, total: input });

describe("pushSessionSubagentEvents — the cost-loop ConfidenceEvent emitter", () => {
  it("emits unreadable-subagent for an unreadable rolled-up subagent (M2 — the variant was dead code)", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [subagent({ unreadable: true, filePath: "lead/subagents/a.jsonl" })], {});
    expect(events).toContainEqual({ kind: "unreadable-subagent", sessionId: "lead/subagents/a.jsonl" });
  });

  it("does NOT emit unreadable-subagent for a readable subagent", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [subagent({ unreadable: false })], {});
    expect(events.some((e) => e.kind === "unreadable-subagent")).toBe(false);
  });

  it("emits dropped-transcript-records for a session with parse-skips (B3)", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl", 2), [], {});
    expect(events).toContainEqual({ kind: "dropped-transcript-records", sessionId: "lead.jsonl" });
  });

  it("emits dropped-transcript-records for a subagent with parse-skips (B3)", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [subagent({ droppedRecords: 1, filePath: "lead/subagents/b.jsonl" })], {});
    expect(events).toContainEqual({ kind: "dropped-transcript-records", sessionId: "lead/subagents/b.jsonl" });
  });

  it("a clean session with clean subagents emits nothing", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [subagent({}), subagent({})], {});
    expect(events).toEqual([]);
  });

  it("an unreadable subagent that ALSO dropped records emits both events", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [subagent({ unreadable: true, droppedRecords: 3, filePath: "lead/subagents/c.jsonl" })], {});
    expect(events).toContainEqual({ kind: "unreadable-subagent", sessionId: "lead/subagents/c.jsonl" });
    expect(events).toContainEqual({ kind: "dropped-transcript-records", sessionId: "lead/subagents/c.jsonl" });
  });

  it("emits partial-priced-coverage for a mixed-price contributor", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [], { unpricedTokens: usage(125) });
    expect(events).toContainEqual({ kind: "partial-priced-coverage", sessionId: "lead.jsonl" });
  });

  it("emits partial-priced-coverage for a mixed-price subagent", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [
      subagent({ usd: 0.1, unpricedTokens: usage(225), filePath: "lead/subagents/mixed.jsonl" }),
    ], {});
    expect(events).toContainEqual({ kind: "partial-priced-coverage", sessionId: "lead/subagents/mixed.jsonl" });
  });

  it("emits the GPT-5.6 cache-write omission for contributors and subagents", () => {
    const events: ConfidenceEvent[] = [];
    pushSessionSubagentEvents(events, raw("lead.jsonl"), [
      subagent({ unobservedCacheWriteTokens: true, filePath: "lead/subagents/gpt56.jsonl" }),
    ], { unobservedCacheWriteTokens: true });
    expect(events).toContainEqual({ kind: "unobserved-cache-write-tokens", sessionId: "lead.jsonl" });
    expect(events).toContainEqual({ kind: "unobserved-cache-write-tokens", sessionId: "lead/subagents/gpt56.jsonl" });
  });
});
