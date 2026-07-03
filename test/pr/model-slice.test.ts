// SPEC-0019 R1e(g) — sliceSessionForReceipt recomputes totals/timestamps/tool
// counts over a turn range without mutating the input; N (original turn count)
// is the caller's to preserve for the header.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { sliceSessionForReceipt } from "../../src/receipt/model.js";
import type { Session, Turn } from "../../src/parse/types.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");

describe("sliceSessionForReceipt", () => {
  it("recomputes totals over [1,3] and leaves the source session untouched", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    expect(session.turns.length).toBe(6);

    const sliced = sliceSessionForReceipt(session, { startTurn: 1, endTurn: 3 });
    expect(sliced.turns.length).toBe(3);
    expect(sliced.totals.turnCount).toBe(3);
    expect(sliced.totals.toolCallCount).toBe(3);
    // Edit(2420) + commitB(2760) + push(2430).
    expect(sliced.totals.tokens.total).toBe(7610);
    expect(sliced.startedAt).toBe(Date.parse("2026-06-28T10:01:00.000Z"));
    expect(sliced.endedAt).toBe(Date.parse("2026-06-28T10:03:00.000Z"));
    // Re-indexed 0..k.
    expect(sliced.turns.map((t) => t.index)).toEqual([0, 1, 2]);

    // Source is unchanged (no mutation) — N stays 6.
    expect(session.turns.length).toBe(6);
    expect(session.totals.turnCount).toBe(6);
  });

  it("clamps an out-of-range end to the last turn", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    const sliced = sliceSessionForReceipt(session, { startTurn: 4, endTurn: 99 });
    expect(sliced.turns.length).toBe(2);
  });

  it("SPEC-0017 — re-bases compactions onto the slice, dropping those outside it", () => {
    const turns: Turn[] = Array.from({ length: 6 }, (_, i) => ({ index: i, timestamp: 1000 + i, toolCalls: [] }));
    const session: Session = {
      id: "s",
      source: "claude-code",
      filePath: "/fake/s.jsonl",
      totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, turnCount: 6, toolCallCount: 0 },
      turns,
      // Before slice, after two turns, mid-slice, at the slice's after-final edge, and past it.
      compactions: [{ turnIndex: 1 }, { turnIndex: 3 }, { turnIndex: 5 }, { turnIndex: 6 }],
    };
    const sliced = sliceSessionForReceipt(session, { startTurn: 2, endTurn: 4 });
    // start=2,end=4 → keep turnIndex 3 (→1) and 5 (→3, after-final of the 3-turn slice); drop 1 (before) and 6 (past).
    expect(sliced.compactions).toEqual([{ turnIndex: 1 }, { turnIndex: 3 }]);
    // Source is not mutated.
    expect(session.compactions).toEqual([{ turnIndex: 1 }, { turnIndex: 3 }, { turnIndex: 5 }, { turnIndex: 6 }]);
  });
});
