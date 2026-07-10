// SPEC-0023 R4 — the multi-session comment body: marker-first, then a fenced
// receipt rendered through the shared block interpreter: masthead + session
// count, dotted per-session role/model rows, muted slice provenance, one
// SUBAGENTS aggregate row per contributor (SPEC-0060 — the per-child breakdown
// lives in the details table), separate priced/unpriced totals (I2/I3), and
// the classic footer.
import { describe, expect, it } from "vitest";
import { PR_ATTRIBUTION_LINE } from "../../src/receipt/branding.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import type { ModelMixEntry } from "../../src/receipt/model.js";
import { DOGFOOD_MARKER, HELPER_FULL_LABEL, renderPrBody, renderPrReceiptText, sliceHeaderLine, subagentDetailsTable, type ContributorView } from "../../src/pr/body.js";
import { cacheServedText } from "../../src/receipt/present.js";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { FULL_FALLBACK_LABEL } from "../../src/pr/slice.js";
import { SAMOSA_URL } from "../../src/pr/publish.js";

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

  it("suppresses the role at N=1 and the redundant 100% share (SPEC-0026 R1, round 2)", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("builder ·");
    expect(body).not.toContain("100%");
    expect(body).toMatch(/^claude-opus-4-8\.+\$1\.50$/m);
    // Round 2: a real slice keeps its line (it changes the number's meaning); the id does not.
    expect(body).toContain("session slice: turns 2–4 of 6");
    expect(body).not.toContain("abc123");
  });

  it("keeps the role prefix whenever rows need telling apart (N≥2)", () => {
    const body = renderPrBody({ contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 });
    expect(body).toContain("builder · claude-opus-4-8");
    expect(body).not.toContain("100%");
  });

  it("shows each model with its rounded share for a multi-model session (no role at N=1)", () => {
    const view = builder({ modelMix: [mix("claude-opus-4-8", 0.8), mix("claude-haiku-4-5", 0.2)] });
    const body = renderPrBody({ contributors: [view], excludedCount: 0 });
    expect(body).toMatch(/^claude-opus-4-8 80% · claude-haiku-4-5 20%\.*\$1\.50$/m);
  });

  it("a real mix never rounds to 100%/0% (>99%/<1%, the cache line's rule)", () => {
    const view = builder({ modelMix: [mix("claude-opus-4-8", 0.996), mix("claude-haiku-4-5", 0.004)] });
    const body = renderPrBody({ contributors: [view], excludedCount: 0 });
    expect(body).toContain(">99%");
    expect(body).not.toContain("100%");
    expect(body).not.toContain(" 0%");
  });

  it("carries no session ids in the fence (round 2) and every line fits 50 columns", () => {
    const body = renderPrBody({
      contributors: [builder({ sessionId: "rollout-2026-07-02T18-06-36-019f2583-6862-71c3-9abf-0eb4244ae5b0" })],
      excludedCount: 0,
    });
    expect(body).not.toContain("rollout-2026-07-02T18-06-36");
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
    expect(body).toContain("orchestrator · claude-opus-4-8...............$1.50");
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
    // SPEC-0060 R1: ONE aggregate row in the fence — never per-child rows.
    expect(body).toContain("SUBAGENTS (2)..............................$0.25");
    expect(body).not.toContain("tester · claude-opus-4-8");
    // parent $1.50 + tester $0.25 = $1.75; the unreadable child makes the
    // total a FLOOR (SPEC-0028 R1) on top of the not-priced note.
    expect(body).toContain("TOTAL priced...............................≥ $1.75");
    expect(body).toContain("counted: 1 session + 2 subagents");
    expect(body).toContain("1 unreadable subagent not priced");
  });

  it("SPEC-0060 R1/R2: the aggregate row sums the priced children and drawn rows sum to the total", () => {
    const subagents: SubagentRow[] = [
      { name: "verifier", model: "claude-fable-5", usd: 0.25, tokens: tokens(400), unreadable: false, filePath: "a" },
      { name: "searcher", model: "claude-fable-5", usd: 0.1, tokens: tokens(200), unreadable: false, filePath: "b" },
    ];
    const body = renderPrBody({ contributors: [builder({ usd: 1.5, subagents })], excludedCount: 0 });
    expect(body).toContain("SUBAGENTS (2)..............................$0.35");
    expect(body).not.toContain("verifier");
    expect(body).toContain("TOTAL priced.................................$1.85");
    // Drawn `$` rows sum byte-exactly to the drawn total (SPEC-0044/B1 at the
    // SPEC-0060 aggregate granularity).
    const fence = fencedLines(body);
    const rowDollars = fence
      .filter((l) => l.includes("$") && !l.includes("TOTAL"))
      .map((l) => Number(/\$([\d,]+\.\d\d)/.exec(l)![1].replace(",", "")));
    const total = Number(/TOTAL priced\.+\$([\d,]+\.\d\d)/.exec(body)![1].replace(",", ""));
    expect(rowDollars.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 10);
  });

  it("SPEC-0060 R1: an all-unpriced subagent set renders a tokens aggregate, never `$`", () => {
    const subagents: SubagentRow[] = [
      { name: "a", usd: null, tokens: tokens(1000), unreadable: false, filePath: "a" },
      { name: "b", usd: null, tokens: tokens(500), unreadable: false, filePath: "b" },
    ];
    const body = renderPrBody({ contributors: [builder({ usd: null, tokens: tokens(100), subagents })], excludedCount: 0 });
    expect(body).toMatch(/SUBAGENTS \(2\)\.+1,500 tokens/);
    expect(body).not.toContain("$");
  });

  it("appends an honest not-attributed note when candidates were excluded", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 2 });
    expect(body).toContain("2 candidate sessions not attributed");
    expect(body).toContain("(in repo + branch window, no branch commit)");
  });
});

describe("SPEC-0028 R1 floor totals (a known-incomplete number says so)", () => {
  it("renders TOTAL priced as a floor when a candidate was excluded", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 1 });
    expect(body).toContain("≥ $1.50");
    expect(body).toContain("candidate session not attributed");
  });

  it("renders a floor when a subagent is unreadable", () => {
    const body = renderPrBody({
      contributors: [builder({ subagents: [{ name: "ghost", usd: null, tokens: tokens(0, 0), unreadable: true, filePath: "g.jsonl" }] })],
      excludedCount: 0,
    });
    expect(body).toContain("≥ $1.50");
    expect(body).toContain("unreadable subagent");
  });

  it("keeps complete receipts byte-identical (no floor marker anywhere)", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("≥");
  });

  it("floors BOTH subtotals in a mixed priced/tokens-only receipt, never blending them (I2)", () => {
    const body = renderPrBody({
      contributors: [builder(), builder({ sessionId: "tok", usd: null, tokens: tokens(700, 40) })],
      excludedCount: 2,
    });
    expect(body).toContain("≥ $1.50");
    expect(body).toMatch(/TOTAL unpriced[.]+≥ [\d,]+ tokens/);
    expect(body).toContain("2 candidate sessions not attributed");
  });

  it("floors the zero-atom fallback when everything was excluded", () => {
    const body = renderPrBody({ contributors: [], excludedCount: 3 });
    expect(body).toContain("≥ 0 tokens");
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

describe("SPEC-0026 R3 (round 2) · helpers group under one explanatory header", () => {
  const fullSlice = { kind: "full" as const, startTurn: 0, endTurn: 5, turnCount: 6, label: FULL_FALLBACK_LABEL };
  const helper = (id: string, usd: number, durationMs?: number) =>
    builder({ sessionId: id, slice: fullSlice, basis: "helper", role: "codex", usd, durationMs, modelMix: [mix("gpt-5.5", 1)] });

  it("renders helpers as muted rows under CODEX HELPERS with duration as the one per-row fact", () => {
    const body = renderPrBody(
      { contributors: [builder(), helper("h1", 1.74, 18 * 60_000), helper("h2", 0.3, 4 * 60_000)], excludedCount: 0 },
    );
    const lines = fencedLines(body);
    const header = lines.findIndex((l) => l.includes(`CODEX HELPERS (2) — ${HELPER_FULL_LABEL}`));
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toMatch(/gpt-5\.5 · 18m\.+\$1\.74/);
    expect(lines[header + 2]).toMatch(/gpt-5\.5 · 4m\.+\$0\.30/);
    // The explainer lives once on the header — never per row, never the old long label.
    expect(body).not.toContain("no commits to slice by");
    expect(body).not.toContain(FULL_FALLBACK_LABEL);
    // Helpers are grouped after authors; the author row keeps its slice line.
    expect(body).toContain("session slice: turns 2–4 of 6");
  });

  it("an anchored full-session author renders a bare row — no explainer, no helper header", () => {
    const body = renderPrBody({ contributors: [builder({ slice: fullSlice, basis: "anchor" })], excludedCount: 0 });
    expect(body).not.toContain("CODEX HELPERS");
    expect(body).not.toContain(FULL_FALLBACK_LABEL);
    expect(body).toMatch(/^claude-opus-4-8\.+\$1\.50$/m);
  });

  it("an all-helper receipt still renders the group (header explains the whole set)", () => {
    const body = renderPrBody({ contributors: [helper("h1", 1.74)], excludedCount: 0 });
    expect(body).toContain(`CODEX HELPERS (1) — ${HELPER_FULL_LABEL}`);
    expect(body).toContain("1 session behind this PR");
  });
});

describe("SPEC-0026 R4 · footer hint", () => {
  it("is the last muted note of the fenced receipt", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 1 });
    const lines = fencedLines(body);
    const hint = lines.findIndex((l) => l.includes("details: npx aireceipts-cli --session <id>"));
    expect(hint).toBeGreaterThan(-1);
    // After the hint: only the rule/footer decoration, never another note.
    expect(lines.slice(hint + 1).every((l) => !l.trim().startsWith("(") && !l.includes("not attributed"))).toBe(true);
  });
});

describe("SPEC-0026 R5 · collapsed full receipts", () => {
  const detail = (label: string, text = "RECEIPT-TEXT") => ({ label, row: ["**r**", "`id`", "scope", "1", "1m", "1 / 1", "—"], text });

  it("ends every PR body with the canonical clickable provenance, including the no-details path", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body.trimEnd().split("\n").at(-1)).toBe(PR_ATTRIBUTION_LINE);
  });

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
    expect(body.trimEnd().split("\n").at(-1)).toBe(PR_ATTRIBUTION_LINE);
  });

  it("omits the section entirely without details (--no-details path)", () => {
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 });
    expect(body).not.toContain("<details>");
  });

  it("SPEC-0060 R3: a detail entry's subagent table renders inside the section, under its receipt", () => {
    const table = subagentDetailsTable([
      { name: "verifier", model: "claude-fable-5", usd: 0.25, tokens: tokens(400), unreadable: false, filePath: "a" },
    ]);
    const body = renderPrBody(
      { contributors: [builder()], excludedCount: 0 },
      { details: [{ ...detail("builder · abc123", "AAA"), subagents: table }] },
    );
    expect(body).toContain("##### subagents (1)");
    expect(body.indexOf("##### subagents (1)")).toBeGreaterThan(body.indexOf("AAA"));
    expect(body.indexOf("##### subagents (1)")).toBeLessThan(body.indexOf("</details>"));
  });

  it("SPEC-0060 R5: no breakdown appears anywhere without details", () => {
    const subagents: SubagentRow[] = [{ name: "verifier", usd: 0.25, tokens: tokens(400), unreadable: false, filePath: "a" }];
    const body = renderPrBody({ contributors: [builder({ subagents })], excludedCount: 0 });
    expect(body).toContain("SUBAGENTS (1)");
    expect(body).not.toContain("##### subagents");
  });
});

describe("SPEC-0060 R3 · subagentDetailsTable", () => {
  const row = (name: string, usd: number | null, over: Partial<SubagentRow> = {}): SubagentRow => ({
    name,
    model: "claude-fable-5",
    usd,
    tokens: tokens(100),
    unreadable: false,
    filePath: name,
    ...over,
  });

  it("sorts by cost descending and renders mixed priced/unpriced/unreadable cells", () => {
    const table = subagentDetailsTable([
      row("cheap", 0.1),
      row("ghost", null, { unreadable: true, tokens: emptyUsage() }),
      row("dear", 5.05),
      row("tokens-only", null, { tokens: tokens(1234) }),
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toBe("##### subagents (4)");
    const dearIdx = lines.findIndex((l) => l.includes("dear"));
    const cheapIdx = lines.findIndex((l) => l.includes("cheap"));
    expect(dearIdx).toBeGreaterThan(-1);
    expect(dearIdx).toBeLessThan(cheapIdx);
    expect(table).toContain("| dear · claude-fable-5 | $5.05 |");
    expect(table).toContain("| cheap · claude-fable-5 | $0.10 |");
    expect(table).toContain("| tokens-only · claude-fable-5 | 1,234 tokens |");
    expect(table).toContain("| ghost · claude-fable-5 | (unreadable) |");
  });

  it("caps at 20 rows and the remainder row carries the leftover sum (never a silent drop)", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`agent-${i}`, 1.0));
    const table = subagentDetailsTable(rows);
    const dataRows = table.split("\n").filter((l) => l.startsWith("| agent-"));
    expect(dataRows.length).toBe(19);
    expect(table).toContain("| 6 more subagents | $6.00 |");
    expect(table).toContain("##### subagents (25)");
  });

  it("cap boundary: exactly 20 children render whole, 21 fold into a 2-row remainder", () => {
    const twenty = subagentDetailsTable(Array.from({ length: 20 }, (_, i) => row(`agent-${i}`, 1.0)));
    expect(twenty.split("\n").filter((l) => l.startsWith("| agent-")).length).toBe(20);
    expect(twenty).not.toContain("more subagent");
    const twentyOne = subagentDetailsTable(Array.from({ length: 21 }, (_, i) => row(`agent-${i}`, 1.0)));
    expect(twentyOne.split("\n").filter((l) => l.startsWith("| agent-")).length).toBe(19);
    expect(twentyOne).toContain("| 2 more subagents | $2.00 |");
  });

  it("a mixed remainder states dollars, tokens, and unreadable count separately — nothing dropped (I2)", () => {
    const rows = [
      ...Array.from({ length: 19 }, (_, i) => row(`agent-${i}`, 1.0)),
      row("late-priced", 0.5),
      row("late-tokens", null, { tokens: tokens(500) }),
      row("late-ghost", null, { unreadable: true, tokens: emptyUsage() }),
    ];
    const table = subagentDetailsTable(rows);
    expect(table).toContain("| 3 more subagents | $0.50 + 500 tokens + 1 unreadable |");
  });

  it("the priced column (shown cells + remainder dollars) sums to the children's rounded total", () => {
    // 21 children at $0.335: raw sum $7.035 → $7.04 (formatUsd rounding). Naive
    // per-cell rounding gives 20 × $0.34 + remainder — largest-remainder must
    // land the column exactly on 704 cents.
    const table = subagentDetailsTable(Array.from({ length: 21 }, (_, i) => row(`agent-${i}`, 0.335)));
    const cents = [...table.matchAll(/\$(\d+\.\d\d)/g)].map((m) => Math.round(Number(m[1]) * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(704);
  });

  it("escapes pipes and flattens newlines in prompt-derived names", () => {
    const table = subagentDetailsTable([row("a|b\nc", 0.5, { model: undefined })]);
    expect(table).toContain("| a\\|b c | $0.50 |");
  });

  it("escapes backslashes before pipes — a name's own backslash can't neutralize the pipe escape", () => {
    const table = subagentDetailsTable([row("a\\|b", 0.5, { model: undefined })]);
    expect(table).toContain("| a\\\\\\|b | $0.50 |");
  });

  it("reconciles the priced column so cells sum to the rounded total", () => {
    // 3 × $0.335 = $1.005 → rounds to $1.01; naive per-cell rounding would
    // print 3 × $0.34 = $1.02. Largest-remainder must keep the column at $1.01.
    const table = subagentDetailsTable([row("a", 0.335), row("b", 0.335), row("c", 0.335)]);
    const cents = [...table.matchAll(/\$(\d+\.\d\d)/g)].map((m) => Math.round(Number(m[1]) * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(101);
  });
});

describe("SPEC-0026 R5 · details size cap", () => {
  const detail = (label: string, text = "RECEIPT-TEXT") => ({ label, row: ["**r**", "`id`", "scope", "1", "1m", "1 / 1", "—"], text });

  it("drops trailing receipts to omission notes under the size cap — never mid-receipt truncation", () => {
    const big = "X".repeat(40_000);
    const body = renderPrBody(
      { contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 },
      { details: [detail("builder · abc123", big), detail("builder · def456", big)] },
    );
    expect([...body].length).toBeLessThanOrEqual(65_000);
    expect(body.trimEnd().split("\n").at(-1)).toBe(PR_ATTRIBUTION_LINE);
    expect(body).toContain("builder · def456 — full receipt omitted (comment size limit)");
    // The kept receipt is intact, not truncated.
    expect(body).toContain(big);
  });

  it("drops the whole section when even omission notes cannot fit — and the hint says command, not section", () => {
    const rollup = renderPrReceiptText({ contributors: [builder()], excludedCount: 0 });
    // 800 sessions × ~100-char labels → omission notes alone exceed the cap.
    const many = Array.from({ length: 800 }, (_, i) => detail(`session-${i}-${"L".repeat(90)}`, "small"));
    const body = renderPrBody({ contributors: [builder()], excludedCount: 0 }, { details: many });
    expect(body).not.toContain("<details>");
    // The dropped section must not leave a dangling "section below" hint.
    expect(body).toContain("details: npx aireceipts-cli --session <id>");
    expect(body).not.toContain("section below");
    expect(body).toContain(rollup);
  });

  it("SPEC-0070 R2 — the samosa link is OFF by default: no tip link anywhere in the comment", () => {
    const body = renderPrBody(
      { contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 },
      { details: [detail("builder · abc123", "AAA"), detail("builder · def456", "BBB")] },
    );
    expect(body).not.toContain("buy me a samosa");
    expect(body).not.toContain(SAMOSA_URL);
    // The section still closes cleanly straight after the last receipt.
    expect(body.indexOf("BBB")).toBeLessThan(body.indexOf("</details>"));
  });

  it("SPEC-0034 R3 / SPEC-0070 R2 — with samosa opted in, the link closes the details section, after the last receipt and before </details>; the fenced receipt itself carries no link", () => {
    const body = renderPrBody(
      { contributors: [builder(), builder({ sessionId: "def456" })], excludedCount: 0 },
      { details: [detail("builder · abc123", "AAA"), detail("builder · def456", "BBB")], samosa: true },
    );
    const samosaLink = `[buy me a samosa](${SAMOSA_URL})`;
    expect(body).toContain(samosaLink);
    expect(body.indexOf("BBB")).toBeLessThan(body.indexOf(samosaLink));
    expect(body.indexOf(samosaLink)).toBeLessThan(body.indexOf("</details>"));
    // The fenced receipt (what the terminal/README also render) never carries a link.
    const fence = fencedLines(body).join("\n");
    expect(fence).not.toContain("[buy me a samosa]");
    expect(fence).not.toContain(SAMOSA_URL);
  });
});
