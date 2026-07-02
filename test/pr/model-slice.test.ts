// SPEC-0019 R1e(g) — sliceSessionForReceipt recomputes totals/timestamps/tool
// counts over a turn range without mutating the input; N (original turn count)
// is the caller's to preserve for the header.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { sliceSessionForReceipt } from "../../src/receipt/model.js";

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
});
