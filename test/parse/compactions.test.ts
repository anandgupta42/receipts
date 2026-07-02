// SPEC-0017 R1/R2 — the Claude Code adapter extracts compaction events from the
// finite, named raw shapes BEFORE it drops `isMeta`/command-echo records, and
// positions each at the next assistant turn. Built on tiny temp .jsonl files
// (never real ~/.claude transcripts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../src/parse/claudeCode.js";

const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-compactions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const adapter = new ClaudeCodeAdapter();
let seq = 0;

function assistant(input: number, ts = "2026-06-15T14:00:00.000Z"): unknown {
  return { type: "assistant", timestamp: ts, message: { role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "ok" }], usage: { input_tokens: input, output_tokens: 10 } } };
}

async function load(records: unknown[]) {
  const file = path.join(dir, `s-${seq++}.jsonl`);
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return adapter.loadSession(file);
}

describe("SPEC-0017 R1/R2 — compaction extraction", () => {
  it("extracts an `isMeta` compact-summary record before the meta filter, at the next assistant turn", async () => {
    const s = await load([
      { type: "user", timestamp: "2026-06-15T14:00:00.000Z", message: { role: "user", content: "go" } },
      assistant(100),
      { type: "user", isMeta: true, timestamp: "2026-06-15T14:05:00.000Z", message: { role: "user", content: "Checkpoint: context compacted." } },
      assistant(200),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1, atMs: Date.parse("2026-06-15T14:05:00.000Z") }]);
    // The meta record itself is still filtered out of the turns (extraction is separate).
    expect(s?.turns).toHaveLength(2);
  });

  it("extracts `isCompactSummary` and `compact_boundary` shapes", async () => {
    const s = await load([
      assistant(100),
      { type: "system", isCompactSummary: true, timestamp: "2026-06-15T14:01:00.000Z" },
      assistant(200),
      { type: "compact_boundary", timestamp: "2026-06-15T14:02:00.000Z" },
      assistant(300),
    ]);
    expect(s?.compactions).toEqual([
      { turnIndex: 1, atMs: Date.parse("2026-06-15T14:01:00.000Z") },
      { turnIndex: 2, atMs: Date.parse("2026-06-15T14:02:00.000Z") },
    ]);
  });

  it("does NOT record a `/compact` command echo that has no adjacent summary", async () => {
    const s = await load([
      assistant(100),
      { type: "user", timestamp: "2026-06-15T14:01:00.000Z", message: { role: "user", content: "<command-name>compact</command-name>" } },
      assistant(200),
    ]);
    expect(s?.compactions).toEqual([]);
  });

  it("collapses a summary and its adjacent command echo into a single compaction (no double count)", async () => {
    const s = await load([
      assistant(100),
      { type: "user", isMeta: true, timestamp: "2026-06-15T14:01:00.000Z", message: { role: "user", content: "Checkpoint: context compacted." } },
      { type: "user", timestamp: "2026-06-15T14:01:05.000Z", message: { role: "user", content: "<command-name>compact</command-name>" } },
      assistant(200),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1, atMs: Date.parse("2026-06-15T14:01:00.000Z") }]);
  });

  it("retains a compaction after the final assistant turn with turnIndex = turns.length", async () => {
    const s = await load([
      assistant(100),
      assistant(200),
      { type: "system", isCompactSummary: true, timestamp: "2026-06-15T14:09:00.000Z" },
    ]);
    expect(s?.turns).toHaveLength(2);
    expect(s?.compactions).toEqual([{ turnIndex: 2, atMs: Date.parse("2026-06-15T14:09:00.000Z") }]);
  });

  it("never records ordinary (non-meta) user text that merely mentions compacting", async () => {
    const s = await load([
      { type: "user", timestamp: "2026-06-15T14:00:00.000Z", message: { role: "user", content: "please compact the code and note the context compacted earlier" } },
      assistant(100),
    ]);
    expect(s?.compactions).toEqual([]);
  });

  it("omits atMs when the compact record carries no timestamp", async () => {
    const s = await load([
      assistant(100),
      { type: "system", isCompactSummary: true },
      assistant(200),
    ]);
    expect(s?.compactions).toEqual([{ turnIndex: 1 }]);
  });
});
