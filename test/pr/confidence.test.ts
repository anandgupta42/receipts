// SPEC-0044 R1/R2 — the ConfidenceEvent contract: distinct-session counting,
// the floor rule, and that A1's counted-absence surfaces on the rendered
// receipt (the coverage-map C.2 hole — never a silent drop).
import { describe, expect, it } from "vitest";
import { summarizeConfidence, isFloored, type ConfidenceEvent } from "../../src/pr/confidence.js";
import { renderPrReceiptText, type ContributorView } from "../../src/pr/body.js";

const mix = (model: string, share: number) => ({ model, share });
const tokens = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheCreation: 0, total: input + output });
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

describe("SPEC-0044 · summarizeConfidence", () => {
  it("counts DISTINCT sessions per kind, not raw events", () => {
    const events: ConfidenceEvent[] = [
      { kind: "unattributable-anchor-pool", sessionId: "a" },
      { kind: "unattributable-anchor-pool", sessionId: "a" }, // dup session — counts once
      { kind: "unattributable-anchor-pool", sessionId: "b" },
      { kind: "silenced-git-write", sessionId: "c" },
      { kind: "unanchored-git-write", sessionId: "e" },
      { kind: "cost-lower-bound-cache-tier", sessionId: "d" },
      { kind: "unobserved-cache-write-tokens", sessionId: "w" },
      { kind: "partial-priced-coverage", sessionId: "p" },
    ];
    const s = summarizeConfidence(events);
    expect(s.unattributableAnchorPool).toBe(2);
    expect(s.silencedGitWrite).toBe(1);
    expect(s.unanchoredGitWrite).toBe(1);
    expect(s.costLowerBoundCacheTier).toBe(1);
    expect(s.unobservedCacheWriteTokens).toBe(1);
    expect(s.partialPricedCoverage).toBe(1);
    expect(s.unreadableSubagent).toBe(0);
  });

  it("isFloored is true iff any incompleteness/lower-bound event exists", () => {
    expect(isFloored(summarizeConfidence([]))).toBe(false);
    expect(isFloored(summarizeConfidence([{ kind: "cost-lower-bound-cache-tier", sessionId: "x" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "unobserved-cache-write-tokens", sessionId: "w" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "unattributable-anchor-pool", sessionId: "y" }]))).toBe(true);
    // each disjunct isolated (so a deleted one is caught, not masked by a sibling):
    expect(isFloored(summarizeConfidence([{ kind: "silenced-git-write", sessionId: "s" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "unanchored-git-write", sessionId: "g" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "unreadable-subagent", sessionId: "sub" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "unreadable-session", sessionId: "u" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "dropped-transcript-records", sessionId: "d" }]))).toBe(true);
    expect(isFloored(summarizeConfidence([{ kind: "partial-priced-coverage", sessionId: "p" }]))).toBe(true);
  });
});

describe("GPT-5.6 omitted cache-write tokens render (not silent)", () => {
  it("floors the total and names the missing trace bucket", () => {
    const body = renderPrReceiptText({
      contributors: [builder()],
      excludedCount: 0,
      confidence: summarizeConfidence([{ kind: "unobserved-cache-write-tokens", sessionId: "gpt56.jsonl" }]),
    });
    expect(body).toContain("1 GPT-5.6 Codex session omitted cache-write tokens");
    expect(body).toContain("floor excludes any write premium");
  });
});

describe("partial-priced-coverage renders (not silent)", () => {
  it("floors the priced total and names the excluded unpriced turns", () => {
    const body = renderPrReceiptText({
      contributors: [builder({ unpricedTokens: tokens(200, 50) })],
      excludedCount: 0,
      confidence: summarizeConfidence([{ kind: "partial-priced-coverage", sessionId: "mixed.jsonl" }]),
    });
    expect(body).toMatch(/TOTAL priced\.+≥/);
    expect(body).toMatch(/TOTAL unpriced\.+≥ 250 tokens/);
    expect(body).toContain("1 session had partial price coverage");
  });
});

describe("SPEC-0072 R3 · unanchored git-write renders (not silent)", () => {
  it("floors the total AND renders a distinct git-write note", () => {
    const body = renderPrReceiptText({
      contributors: [builder()],
      excludedCount: 1,
      confidence: summarizeConfidence([{ kind: "unanchored-git-write", sessionId: "writer.jsonl" }]),
    });
    expect(body).toMatch(/TOTAL priced\.+≥/);
    expect(body).toContain("1 session made git writes that could not be anchored");
  });
});

describe("SPEC-0044 A1 · counted-absence renders (not silent)", () => {
  it("floors the total AND renders a distinct note, separate from excludedCount", () => {
    const body = renderPrReceiptText({
      contributors: [builder()],
      excludedCount: 0,
      confidence: summarizeConfidence([{ kind: "unattributable-anchor-pool", sessionId: "cross-repo-lead" }]),
    });
    expect(body).toMatch(/TOTAL priced\.+≥/); // the total is floored
    expect(body).toContain("1 session touched this branch but couldn't be attributed precisely");
    expect(body).toContain("see docs/trust.md");
    // NOT conflated with the excluded-candidates note
    expect(body).not.toContain("candidate session not attributed");
  });

  it("with excludedCount==0 and no confidence, the note is absent (no false positive)", () => {
    const body = renderPrReceiptText({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("couldn't be attributed precisely");
    expect(body).toMatch(/TOTAL priced\.+≥/);
    expect(body).toContain("standard API-equivalent floor; not an invoice");
  });
});

describe("SPEC-0044 B4 · unreadable-session renders (not silent)", () => {
  it("floors the total AND renders the couldn't-be-read note", () => {
    const body = renderPrReceiptText({
      contributors: [builder()],
      excludedCount: 0,
      confidence: summarizeConfidence([{ kind: "unreadable-session", sessionId: "ghost.jsonl" }]),
    });
    expect(body).toMatch(/TOTAL priced\.+≥/);
    expect(body).toContain("1 session touched this branch but couldn't be read");
  });
});

describe("SPEC-0044 B3 · dropped-transcript-records renders (not silent)", () => {
  it("floors the total AND renders the skipped-records note as a lower bound", () => {
    const body = renderPrReceiptText({
      contributors: [builder()],
      excludedCount: 0,
      confidence: summarizeConfidence([{ kind: "dropped-transcript-records", sessionId: "torn.jsonl" }]),
    });
    expect(body).toMatch(/TOTAL priced\.+≥/);
    expect(body).toContain("1 session had unreadable transcript records skipped");
    expect(body).toContain("lower bound");
  });
});
