// SPEC-0023 R4 — the multi-session comment body: marker-first, then a fenced
// receipt rendered through the shared block interpreter: masthead + session
// count, dotted per-session role/model rows, muted slice provenance, SUBAGENTS
// sub-rows, separate priced/unpriced totals (I2/I3), and the classic footer.
import { describe, expect, it } from "vitest";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import type { ModelMixEntry } from "../../src/receipt/model.js";
import { DOGFOOD_MARKER, renderPrBody, sliceHeaderLine, type ContributorView } from "../../src/pr/body.js";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { FULL_FALLBACK_LABEL } from "../../src/pr/slice.js";

const tokens = (input: number, output = 0) => withTotal({ ...emptyUsage(), input, output });
const mix = (model: string, share: number): ModelMixEntry => ({ model, tokens: tokens(100), tokenShare: share });

function fencedLines(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.indexOf("```");
  const end = lines.indexOf("```", start + 1);
  return lines.slice(start + 1, end);
}

function builder(over: Partial<ContributorView> = {}): ContributorView {
  return {
    role: "builder",
    sessionId: "abc123",
    slice: { kind: "slice", startTurn: 1, endTurn: 3, turnCount: 6 },
    modelMix: [mix("claude-opus-4-8", 1)],
    usd: 1.5,
    tokens: tokens(900, 100),
    subagents: [],
    ...over,
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

describe("renderPrBody header + rows (#39 fixes)", () => {
  it("starts with the marker and names the session COUNT, not one session", () => {
    const body = renderPrBody({ contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 });
    expect(body.startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(body).toContain("AIRECEIPTS");
    expect(body).toContain("2 sessions behind this PR");
    expect(body.match(/```/g)).toHaveLength(2);
  });

  it("renders a role · model-mix dotted row with the slice as a muted provenance line under it", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).toContain("builder · claude-opus-4-8 100%...............$1.50");
    // provenance line: session id + slice header, demoted below the row.
    expect(body).toContain("abc123 · session slice: turns 2–4 of 6");
    // the slice line is NOT a markdown headline.
    expect(body).not.toContain("🧾 **aireceipts**");
  });

  it("shows each model with its rounded share for a multi-model session", () => {
    const view = builder({ modelMix: [mix("claude-opus-4-8", 0.8), mix("claude-haiku-4-5", 0.2)] });
    const body = renderPrBody({ contributors: [view], excludedCount: 0 });
    expect(body).toContain("builder · claude-opus-4-8 80% · claude-ha…...$1.50");
  });

  it("keeps long provenance inside the 50-column receipt", () => {
    const body = renderPrBody({
      contributors: [builder({ sessionId: "rollout-2026-07-02T18-06-36-019f2583-6862-71c3-9abf-0eb4244ae5b0" })],
      excludedCount: 0,
    });
    expect(body).toContain("session: rollout-2026-07-02T18-06-36-019f2583-6…");
    for (const line of fencedLines(body)) {
      expect([...line].length).toBeLessThanOrEqual(50);
    }
  });

  it("labels the role for each contributor kind", () => {
    const body = renderPrBody({
      contributors: [
        builder({ role: "orchestrator", sessionId: "lead" }),
        builder({ role: "codex", sessionId: "cx", modelMix: [], usd: null, tokens: tokens(5000) }),
      ],
      excludedCount: 0,
    });
    expect(body).toContain("orchestrator · claude-opus-4-8 100%..........$1.50");
    expect(body).toContain("codex · no model reported.............5,000 tokens");
  });
});

describe("renderPrBody combined total (SPEC-0008 honesty)", () => {
  it("sums a single `$` total when every atom is priced", () => {
    const body = renderPrBody({
      contributors: [builder({ usd: 1.5 }), builder({ sessionId: "d", usd: 2.25 })],
      excludedCount: 0,
    });
    expect(body).toContain("TOTAL priced.................................$3.75");
    expect(body).toContain("counted: 2 sessions");
    expect(body).not.toContain("TOTAL unpriced");
    expect(body).not.toContain("tokens-only");
  });

  it("keeps priced dollars and tokens-only counts SEPARATE, never blended (mixed)", () => {
    const priced = builder({ usd: 3.0 });
    const codex = builder({ role: "codex", sessionId: "cx", modelMix: [], usd: null, tokens: tokens(45000) });
    const body = renderPrBody({ contributors: [priced, codex], excludedCount: 0 });
    expect(body).toContain("TOTAL priced.................................$3.00");
    expect(body).toContain("TOTAL unpriced.......................45,000 tokens");
    expect(body).not.toContain("priced +");
  });

  it("renders a tokens-only combined total when nothing priced", () => {
    const a = builder({ usd: null, tokens: tokens(1000) });
    const b = builder({ sessionId: "b", usd: null, tokens: tokens(500) });
    const body = renderPrBody({ contributors: [a, b], excludedCount: 0 });
    expect(body).toContain("TOTAL unpriced........................1,500 tokens");
    expect(body).not.toContain("TOTAL priced");
    expect(body).not.toContain("$");
  });

  it("rolls subagents into the total and counts them in scope + not-priced caveat", () => {
    const subagents: SubagentRow[] = [
      { name: "tester", model: "claude-opus-4-8", usd: 0.25, tokens: tokens(400, 50), unreadable: false, filePath: "a" },
      { name: "reviewer", usd: null, tokens: emptyUsage(), unreadable: true, filePath: "b" },
    ];
    const body = renderPrBody({ contributors: [builder({ usd: 1.5, subagents })], excludedCount: 0 });
    expect(body).toContain("SUBAGENTS (2)");
    expect(body).toContain("tester · claude-opus-4-8...................$0.25");
    expect(body).toContain("(unreadable)");
    // parent $1.50 + tester $0.25 = $1.75, unreadable child noted as not priced.
    expect(body).toContain("TOTAL priced.................................$1.75");
    expect(body).toContain("counted: 1 session + 2 subagents");
    expect(body).toContain("1 unreadable subagent not priced");
  });

  it("appends an honest not-attributed note when candidates were excluded", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 2 });
    expect(body).toContain("2 candidate sessions not attributed");
    expect(body).toContain("(in repo + branch window, no branch commit)");
  });
});
