// SPEC-0023 R4 — the multi-session comment body: marker-first, then a fenced
// receipt rendered through the shared block interpreter: masthead + session
// count, dotted per-session role/model rows, muted slice provenance, SUBAGENTS
// sub-rows, separate priced/unpriced totals (I2/I3), and the classic footer.
import { describe, expect, it } from "vitest";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import type { ModelMixEntry } from "../../src/receipt/model.js";
import { DOGFOOD_MARKER, HELPER_FULL_LABEL, renderPrBody, renderPrReceiptText, sliceHeaderLine, type ContributorView } from "../../src/pr/body.js";
import { cacheServedText } from "../../src/receipt/present.js";
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

  it("suppresses the role at N=1 (SPEC-0026 R1) — the row is the model mix alone", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("builder ·");
    expect(body).toMatch(/^claude-opus-4-8 100%\.+\$1\.50$/m);
    // provenance line: session id + slice header, demoted below the row.
    expect(body).toContain("abc123 · session slice: turns 2–4 of 6");
    // the slice line is NOT a markdown headline.
    expect(body).not.toContain("🧾 **aireceipts**");
  });

  it("keeps the role prefix whenever rows need telling apart (N≥2)", () => {
    const body = renderPrBody({ contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 });
    expect(body).toContain("builder · claude-opus-4-8 100%");
  });

  it("shows each model with its rounded share for a multi-model session (no role at N=1)", () => {
    const view = builder({ modelMix: [mix("claude-opus-4-8", 0.8), mix("claude-haiku-4-5", 0.2)] });
    const body = renderPrBody({ contributors: [view], excludedCount: 0 });
    expect(body).toMatch(/^claude-opus-4-8 80% · claude-haiku-4-5 20%\.*\$1\.50$/m);
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


describe("SPEC-0026 R2 · aggregate cache line", () => {
  const cached = (cacheRead: number, input = 1000) =>
    withTotal({ ...emptyUsage(), input, cacheRead });

  it("renders one muted cache line over the counted atoms, under counted:", () => {
    const view = builder({ tokens: cached(600, 400) });
    const lines = fencedLines(renderPrBody({ contributors: [view], excludedCount: 0 }));
    const counted = lines.findIndex((l) => l.includes("counted: 1 session"));
    expect(lines[counted + 1]).toContain("cache served 60% of input tokens");
  });

  it("stays absent when no counted atom read cache", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("cache served");
  });

  it("counts subagent tokens in the aggregate (a child's cache reads are real spend)", () => {
    const sub: SubagentRow = { name: "kid", usd: null, tokens: cached(500, 500), unreadable: false, filePath: "kid.jsonl" };
    const body = renderPrBody({ contributors: [builder({ subagents: [sub] })], excludedCount: 0 });
    expect(body).toContain("cache served");
  });

  it("matches the receipt masthead formatter exactly (one implementation, I3)", () => {
    const usage = cached(600, 400);
    const view = builder({ tokens: usage });
    const body = renderPrBody({ contributors: [view], excludedCount: 0 });
    expect(body).toContain(cacheServedText(usage)!);
  });

  it("never rounds a partial ratio up to 100 (>99 boundary preserved)", () => {
    const usage = cached(9990, 10);
    expect(cacheServedText(usage)).toBe("cache served >99% of input tokens");
    const body = renderPrBody({ contributors: [builder({ tokens: usage })], excludedCount: 0 });
    expect(body).toContain(">99% of input tokens");
    expect(body).not.toContain("cache served 100%");
  });
});

describe("SPEC-0026 R3 · honest helper label", () => {
  const fullSlice = { kind: "full" as const, startTurn: 0, endTurn: 5, turnCount: 6, label: FULL_FALLBACK_LABEL };

  it("relabels a helper-credited full session: no commits to slice by", () => {
    const body = renderPrBody({ contributors: [builder({ slice: fullSlice, basis: "helper" })], excludedCount: 0 });
    expect(body).toContain(HELPER_FULL_LABEL);
    expect(body).not.toContain(FULL_FALLBACK_LABEL);
  });

  it("keeps the anchored fallback label byte-for-byte", () => {
    const body = renderPrBody({ contributors: [builder({ slice: fullSlice, basis: "anchor" })], excludedCount: 0 });
    expect(body).toContain(FULL_FALLBACK_LABEL);
    expect(body).not.toContain(HELPER_FULL_LABEL);
  });
});

describe("SPEC-0026 R4 · footer hint", () => {
  it("is the last muted note of the fenced receipt", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 1 });
    const lines = fencedLines(body);
    const hint = lines.findIndex((l) => l.includes("details: npx aireceipts --session <id>"));
    expect(hint).toBeGreaterThan(-1);
    // After the hint: only the rule/footer decoration, never another note.
    expect(lines.slice(hint + 1).every((l) => !l.trim().startsWith("(") && !l.includes("not attributed"))).toBe(true);
  });
});

describe("SPEC-0026 R5 · collapsed full receipts", () => {
  const detail = (label: string, text = "RECEIPT-TEXT") => ({ label, text });

  it("appends the details section after the fence, receipts in row order, marker still first", () => {
    const body = renderPrBody(
      { contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 },
      { details: [detail("builder · abc123", "AAA"), detail("builder · def456", "BBB")] },
    );
    expect(body.startsWith(DOGFOOD_MARKER)).toBe(true);
    expect(body).toContain("<details><summary>full receipts (2 sessions)</summary>");
    expect(body.indexOf("</details>")).toBeGreaterThan(body.indexOf("AAA"));
    expect(body.indexOf("AAA")).toBeLessThan(body.indexOf("BBB"));
    expect(body.indexOf("<details>")).toBeGreaterThan(body.indexOf("```"));
  });

  it("places the SPEC-0027 artifact link under the details section, after a BLANK line (GFM HTML-block rule)", () => {
    const body = renderPrBody(
      { contributors: [builder()], excludedCount: 0 },
      { details: [detail("builder · abc123")], artifactLink: { fileName: "pr-9.html", url: "https://x/pr-9.html" } },
    );
    expect(body.indexOf("full receipt: [pr-9.html]")).toBeGreaterThan(body.indexOf("</details>"));
    // Without the blank line GitHub swallows the link into the HTML block and
    // renders it as raw text (maintainer catch on PR #63, 2026-07-03).
    expect(body).toContain("</details>\n\nfull receipt: [pr-9.html]");
  });

  it("omits the section entirely without details (--no-details path)", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("<details>");
  });

  it("drops trailing receipts to omission notes under the size cap — never mid-receipt truncation", () => {
    const big = "X".repeat(40_000);
    const body = renderPrBody(
      { contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 },
      { details: [detail("builder · abc123", big), detail("builder · def456", big)] },
    );
    expect([...body].length).toBeLessThanOrEqual(65_000);
    expect(body).toContain("builder · def456 — full receipt omitted (comment size limit)");
    // The kept receipt is intact, not truncated.
    expect(body).toContain(big);
  });

  it("drops the whole section when even omission notes cannot fit", () => {
    const rollup = renderPrReceiptText({ contributors: [builder()], excludedCount: 0 });
    // 800 sessions × ~100-char labels → omission notes alone exceed the cap.
    const many = Array.from({ length: 800 }, (_, i) => detail(`session-${i}-${"L".repeat(90)}`, "small"));
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 }, { details: many });
    expect(body).not.toContain("<details>");
    expect(body).toContain(rollup);
  });
});
