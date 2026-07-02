// SPEC-0019 R2/R1e(e)/R1c — the comment body: marker-first, 🧾 header, fenced
// receipt, slice header, and the SUBAGENTS section with an honest combined total.
import { describe, expect, it } from "vitest";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { DOGFOOD_MARKER, renderPrBody, sliceHeaderLine } from "../../src/pr/body.js";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { FULL_FALLBACK_LABEL } from "../../src/pr/slice.js";

const parentTokens = withTotal({ ...emptyUsage(), input: 900, output: 100 });

function baseInput() {
  return {
    sessionId: "abc123",
    slice: { kind: "slice" as const, startTurn: 1, endTurn: 3, turnCount: 6 },
    receiptText: "RECEIPT CORE",
    parentUsd: 1.5,
    parentTokens,
    subagents: [] as SubagentRow[],
  };
}

describe("sliceHeaderLine", () => {
  it("renders the 1-based turn range for a slice", () => {
    expect(sliceHeaderLine({ kind: "slice", startTurn: 1, endTurn: 3, turnCount: 6 })).toBe("session slice: turns 2–4 of 6");
  });
  it("renders the honesty label for a full fallback", () => {
    expect(sliceHeaderLine({ kind: "full", startTurn: 0, endTurn: 5, turnCount: 6, label: FULL_FALLBACK_LABEL })).toBe(
      FULL_FALLBACK_LABEL,
    );
  });
});

describe("renderPrBody", () => {
  it("starts with the marker, names the session, and fences the receipt", () => {
    const body = renderPrBody(baseInput());
    expect(body.startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(body).toContain("🧾 **aireceipts** — session `abc123`");
    expect(body).toContain("session slice: turns 2–4 of 6");
    expect(body).toContain("RECEIPT CORE");
    expect(body.match(/```/g)).toHaveLength(2);
    expect(body).not.toContain("SUBAGENTS");
  });

  it("adds a SUBAGENTS section and a combined total, honest about unpriced children", () => {
    const child = withTotal({ ...emptyUsage(), input: 400, output: 50 });
    const subagents: SubagentRow[] = [
      { name: "tester", model: "claude-opus-4-8", usd: 0.25, tokens: child, unreadable: false, filePath: "a" },
      { name: "reviewer", usd: null, tokens: emptyUsage(), unreadable: true, filePath: "b" },
    ];
    const body = renderPrBody({ ...baseInput(), subagents });
    expect(body).toContain("SUBAGENTS · 2 sessions");
    expect(body).toContain("tester · claude-opus-4-8 — $0.25");
    expect(body).toContain("(unreadable)");
    // parent $1.50 + child $0.25 = $1.75, with a not-priced caveat for the unreadable child.
    expect(body).toContain("TOTAL (session slice + subagents) — $1.75 (+ 1 subagent not priced)");
  });

  it("falls back to a tokens combined total when the parent didn't price", () => {
    const child = withTotal({ ...emptyUsage(), input: 400 });
    const subagents: SubagentRow[] = [
      { name: "t", usd: null, tokens: child, unreadable: false, filePath: "a" },
    ];
    const body = renderPrBody({ ...baseInput(), parentUsd: null, subagents });
    expect(body).toContain("TOTAL (session slice + subagents) —");
    expect(body).toContain("tokens");
  });
});
