// SPEC-0040 — the Codex adapter extracts `compacted` records and
// `context_compacted` markers into `Compaction[]`, one entry per DISTINCT
// event, with SPEC-0017 `turnIndex` semantics. Built on tiny temp .jsonl files
// plus the committed sanitized fixture (never real ~/.codex transcripts).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/parse/codex.js";
import { detectContextThrash } from "../../src/pricing/waste.js";

const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-codex-compactions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const adapter = new CodexAdapter();
let seq = 0;

function assistantTurn(input: number, ts: string): unknown[] {
  return [
    {
      timestamp: ts,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: input, output_tokens: 10, total_tokens: input + 10 },
          last_token_usage: { input_tokens: input, output_tokens: 10, total_tokens: input + 10 },
        },
      },
    },
  ];
}

function cumulativeAssistantTurn(cumulativeInput: number, localInput: number, turnNumber: number, ts: string): unknown[] {
  return [
    {
      timestamp: ts,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: cumulativeInput,
            output_tokens: turnNumber * 10,
            total_tokens: cumulativeInput + turnNumber * 10,
          },
          last_token_usage: {
            input_tokens: localInput,
            output_tokens: 10,
            total_tokens: localInput + 10,
          },
        },
      },
    },
  ];
}

function userMsg(text: string, ts: string): unknown {
  return { timestamp: ts, type: "event_msg", payload: { type: "user_message", message: text } };
}

function compacted(ts?: string): unknown {
  const rec: Record<string, unknown> = { type: "compacted", payload: { message: "", replacement_history: [{ role: "user", content: "x" }] } };
  if (ts) rec.timestamp = ts;
  return rec;
}

function marker(ts?: string): unknown {
  const rec: Record<string, unknown> = { type: "event_msg", payload: { type: "context_compacted" } };
  if (ts) rec.timestamp = ts;
  return rec;
}

async function load(records: unknown[]) {
  const file = path.join(dir, `rollout-${seq++}.jsonl`);
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return adapter.loadSession(file);
}

describe("SPEC-0040 R1 — distinct events and pair dedupe", () => {
  it("merges a `compacted` record with its same-timestamp `context_compacted` marker into one compaction", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
      marker("2026-07-01T09:00:08.000Z"),
      ...assistantTurn(200, "2026-07-01T09:00:12.000Z"),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:08.000Z") }]);
  });

  it("merges the pair even when timestamps are absent (same-turnIndex pairing)", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted(),
      marker(),
      ...assistantTurn(200, "2026-07-01T09:00:12.000Z"),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1 }]);
  });

  it("merges the REAL stream shape: marker ~3ms later with unrelated records in between", async () => {
    // Sampled 2026-07-04 from a real rollout: `compacted` at :35.287, marker at
    // :35.290, with turn_context records between — neither same-ts nor adjacent.
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:35.287Z"),
      { timestamp: "2026-07-01T09:00:35.288Z", type: "turn_context", payload: { model: "gpt-5.3-codex", cwd: "/home/dev/app3" } },
      { timestamp: "2026-07-01T09:00:35.289Z", type: "event_msg", payload: { type: "task_started", model_context_window: 272000 } },
      marker("2026-07-01T09:00:35.290Z"),
      ...assistantTurn(200, "2026-07-01T09:00:40.000Z"),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:35.287Z") }]);
  });

  it("keeps two DISTINCT compactions, ordered by turnIndex", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
      marker("2026-07-01T09:00:08.000Z"),
      userMsg("continue", "2026-07-01T09:00:10.000Z"),
      ...assistantTurn(200, "2026-07-01T09:00:12.000Z"),
      compacted("2026-07-01T09:00:16.000Z"),
      marker("2026-07-01T09:00:16.000Z"),
      userMsg("more", "2026-07-01T09:00:18.000Z"),
      ...assistantTurn(300, "2026-07-01T09:00:20.000Z"),
    ]);
    expect(s?.compactions).toEqual([
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:08.000Z") },
      { turnIndex: 2, atMs: Date.parse("2026-07-01T09:00:16.000Z") },
    ]);
  });

  it("keeps opposite-form events far apart in time distinct, even at the same turnIndex", async () => {
    // A lone marker and a lone record 60s apart are NOT a pair (real pairs sit
    // ~3ms apart; the 5s pair window separates the regimes).
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      marker("2026-07-01T09:00:08.000Z"),
      compacted("2026-07-01T09:01:08.000Z"),
      ...assistantTurn(200, "2026-07-01T09:01:12.000Z"),
    ]);
    expect(s?.compactions).toEqual([
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:08.000Z") },
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:01:08.000Z") },
    ]);
  });

  it("retains two distinct same-turn events (different timestamps, same next turn)", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
      compacted("2026-07-01T09:00:10.000Z"),
      ...assistantTurn(200, "2026-07-01T09:00:12.000Z"),
    ]);
    expect(s?.compactions).toEqual([
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:08.000Z") },
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:10.000Z") },
    ]);
  });

  it("retains no content from `replacement_history` (positions only)", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
    ]);
    const keys = Object.keys(s?.compactions?.[0] ?? {}).sort();
    expect(keys).toEqual(["atMs", "turnIndex"]);
  });
});

describe("SPEC-0040 R2 — turnIndex semantics", () => {
  it("points a mid-transcript compaction at the NEXT assistant turn", async () => {
    const records: unknown[] = [userMsg("go", "2026-07-01T09:00:00.000Z")];
    for (let i = 0; i < 5; i++) {
      records.push(...assistantTurn(100 + i, `2026-07-01T09:0${i}:04.000Z`));
      records.push(userMsg(`next ${i}`, `2026-07-01T09:0${i}:08.000Z`));
    }
    // Compaction between assistant turns 4 and 5 (0-indexed): after turn index 4 ends.
    records.push(compacted("2026-07-01T09:05:00.000Z"));
    records.push(...assistantTurn(900, "2026-07-01T09:05:04.000Z"));
    const s = await load(records);
    expect(s?.compactions).toEqual([{ turnIndex: 5, atMs: Date.parse("2026-07-01T09:05:00.000Z") }]);
    expect(s?.turns).toHaveLength(6);
  });

  it("maps a compaction to the next turn even when it arrives before that turn's first usage event", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      userMsg("continue", "2026-07-01T09:00:06.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
      // next turn's first event arrives only after the compaction record:
      ...assistantTurn(200, "2026-07-01T09:00:12.000Z"),
    ]);
    expect(s?.compactions?.[0]?.turnIndex).toBe(1);
  });

  it("lands an after-final compaction at turns.length", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted("2026-07-01T09:00:08.000Z"),
    ]);
    expect(s?.turns).toHaveLength(1);
    expect(s?.compactions).toEqual([{ turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:08.000Z") }]);
  });

  it("leaves atMs absent (not 0) when the record has no parseable timestamp", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      compacted(),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1 }]);
    expect(s?.compactions?.[0]).not.toHaveProperty("atMs");
  });
});

describe("SPEC-0040 R3 — types.ts comment truth", () => {
  it("no longer claims Claude Code exclusivity for Compaction and names both populating specs", () => {
    const types = readFileSync(path.join(process.cwd(), "src/parse/types.ts"), "utf8");
    expect(types).not.toContain("Only the Claude Code adapter populates this");
    const compactionDoc = types.slice(types.indexOf("a raw compaction event"), types.indexOf("interface Compaction"));
    expect(compactionDoc).toContain("SPEC-0017");
    expect(compactionDoc).toContain("SPEC-0040");
    expect(compactionDoc).toContain("Codex");
  });
});

describe("SPEC-0040 R4 — detector parity (no agent branching)", () => {
  it("fires context-thrash on a parsed Codex session crossing SPEC-0017 thresholds", async () => {
    // 2+ refill-positive compactions with gap ≤ 25: prompt-side peaks at ~1000
    // before each compaction and refills to ≥ 0.8× after.
    const records: unknown[] = [userMsg("go", "2026-07-01T09:00:00.000Z")];
    records.push(...cumulativeAssistantTurn(1000, 1000, 1, "2026-07-01T09:00:04.000Z"));
    records.push(userMsg("a", "2026-07-01T09:00:06.000Z"));
    records.push(compacted("2026-07-01T09:00:08.000Z"));
    records.push(...cumulativeAssistantTurn(1950, 950, 2, "2026-07-01T09:00:12.000Z"));
    records.push(userMsg("b", "2026-07-01T09:00:14.000Z"));
    records.push(compacted("2026-07-01T09:00:16.000Z"));
    records.push(...cumulativeAssistantTurn(2930, 980, 3, "2026-07-01T09:00:20.000Z"));
    const s = await load(records);
    expect(s?.compactions).toHaveLength(2);
    const findings = await detectContextThrash(s!);
    expect(findings).toHaveLength(1);
    expect(findings[0].compactionCount).toBe(2);
  });
});

describe("SPEC-0040 R5 — fixtures", () => {
  it("parses the committed sanitized fixture: 2 distinct compactions, pairs merged", async () => {
    const s = await adapter.loadSession(path.join(process.cwd(), "test/fixtures/codex/compactions-2x.jsonl"));
    expect(s?.compactions).toEqual([
      { turnIndex: 1, atMs: Date.parse("2026-07-01T09:00:32.000Z") },
      { turnIndex: 2, atMs: Date.parse("2026-07-01T09:00:52.000Z") },
    ]);
  });

  it("leaves compactions ABSENT on the no-compaction fixture", async () => {
    const s = await adapter.loadSession(path.join(process.cwd(), "test/fixtures/codex/clean-session.jsonl"));
    expect(s).not.toBeNull();
    expect(s?.compactions).toBeUndefined();
  });

  it("adversarial: a lone `context_compacted` marker still records one event; unrelated event types never do", async () => {
    const s = await load([
      userMsg("go", "2026-07-01T09:00:00.000Z"),
      marker("2026-07-01T09:00:02.000Z"),
      ...assistantTurn(100, "2026-07-01T09:00:04.000Z"),
      { timestamp: "2026-07-01T09:00:06.000Z", type: "event_msg", payload: { type: "task_complete" } },
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 0, atMs: Date.parse("2026-07-01T09:00:02.000Z") }]);
  });
});
