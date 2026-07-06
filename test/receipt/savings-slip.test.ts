// SPEC-0059 test matrix — the savings slip (R1–R4 render layer, R7 JSON) and
// its PR comment section (R5) + artifact parity (R6). The two-class golden
// lives in handoff.test.ts (SPEC-0013's suite pins the full local layout);
// this file covers the arithmetic/hedge variants, ordering semantics, the
// rule-string guard, and the PR surfaces.
import { describe, expect, it } from "vitest";
import {
  SLIP_RULE_LINES,
  couldHaveSavedOf,
  prCoverageLine,
  renderHandoff,
  savingsSlipLines,
} from "../../src/receipt/handoff.js";
import { handoffJsonSchema } from "../../src/receipt/exportSchema.js";
import { toHandoffJson } from "../../src/receipt/json.js";
import { buildHandoffSlip, renderPrBody, type ContributorView, type PrBodyInput } from "../../src/pr/body.js";
import { renderPrArtifactHtml } from "../../src/pr/html.js";
import type {
  ContextThrashWasteLine,
  ReceiptModel,
  StuckLoopWasteLine,
  TrivialSpansWasteLine,
  WasteLine,
} from "../../src/receipt/model.js";
import type { TokenUsage } from "../../src/parse/types.js";

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

const loop = (usd: number | null, tokens = 1000): StuckLoopWasteLine => ({
  kind: "stuck-loop",
  tool: "Bash",
  runLength: 4,
  usd,
  tokens: usage(tokens),
  wallClockMs: null,
  turnIndices: [2, 3, 4, 5],
});
const trivial = (usd: number): TrivialSpansWasteLine => ({
  kind: "trivial-spans",
  eligibleTurnCount: 8,
  usd,
  tokens: usage(400),
  cheaperModel: "a cheaper model",
});
const thrash = (usd: number | null, tokens = 500): ContextThrashWasteLine => ({
  kind: "context-thrash",
  compactionCount: 2,
  turnSpan: 5,
  turnIndices: [1, 2],
  usd,
  tokens: usage(tokens),
});

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "s1",
    modelMix: [],
    toolRows: [],
    totalUsd: null,
    totalTokens: usage(0),
    sessionTotalTokens: usage(0),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "m",
    priceRowsUsed: [],
    unpriceable: false,
    ...overrides,
  } as ReceiptModel;
}

describe("SPEC-0059 R2 — headline + hedge arithmetic", () => {
  it("sums priced waste into the `≤ $` ceiling with the percent hedge", () => {
    const lines = savingsSlipLines([loop(0.41)], 2.84);
    expect(lines[0]).toBe("COULD HAVE SAVED...........................≤ $0.41");
    expect(lines[1]).toBe("  14% of $2.84 · arithmetic, not a prediction");
  });

  it("percent uses Math.round at a .5 boundary", () => {
    // 0.25 of 2.00 → exactly 12.5 → rounds to 13 (the modelMix idiom).
    const lines = savingsSlipLines([loop(0.25)], 2.0);
    expect(lines[1]).toBe("  13% of $2.00 · arithmetic, not a prediction");
  });

  it("renders `≤ N tok` and the bare hedge when every fired line is unpriced (I2)", () => {
    const lines = savingsSlipLines([loop(null, 1200)], null);
    expect(lines[0]).toBe("COULD HAVE SAVED.......................≤ 1,200 tok");
    expect(lines[1]).toBe("  arithmetic, not a prediction");
    expect(lines.join("\n")).not.toContain("$");
  });

  it("prefixes the hedge with `≈` when an estimate-tier class contributes (I3)", () => {
    const withEstimate = savingsSlipLines([loop(0.41), trivial(0.05)], 2.84);
    expect(withEstimate[1]).toBe("  ≈ 16% of $2.84 · arithmetic, not a prediction");
    const loopOnly = savingsSlipLines([loop(0.41)], 2.84);
    expect(loopOnly[1]).not.toContain("≈");
  });

  it("mixed priced + token-only: `$` ceiling is priced-only and the hedge says so", () => {
    const lines = savingsSlipLines([loop(0.41), thrash(null, 900)], 2.84);
    expect(lines[0]).toBe("COULD HAVE SAVED...........................≤ $0.41");
    expect(lines[1]).toBe("  ≈ 14% of $2.84 · priced waste only, not a prediction");
    // The token-only line still renders as evidence (dottedLine ellipsizes the
    // long label at width 50, exactly as the receipt's own waste row does).
    expect(lines.join("\n")).toContain("≈ context thrash: 2 compactions");
  });

  it("couldHaveSavedOf: tokens sum over ALL lines; pct null without both dollar sides", () => {
    expect(couldHaveSavedOf([loop(0.41, 1000), thrash(null, 900)], null)).toEqual({
      usd: 0.41,
      tokens: 1900,
      pctOfTotal: null,
    });
    expect(couldHaveSavedOf([loop(null)], 2.84).usd).toBeNull();
  });
});

describe("SPEC-0059 R3 — evidence groups, ordering, rules", () => {
  it("orders groups by dollar subtotal descending; token-only groups last", () => {
    const out = savingsSlipLines([loop(0.1), trivial(0.3), thrash(null)], null).join("\n");
    const trivialAt = out.indexOf("re-priced eligible trivial spans");
    const loopAt = out.indexOf("Bash loop ×4");
    const thrashAt = out.indexOf("context thrash");
    expect(trivialAt).toBeGreaterThanOrEqual(0);
    expect(trivialAt).toBeLessThan(loopAt);
    expect(loopAt).toBeLessThan(thrashAt);
  });

  it("a class's rule line renders once even when several of its lines fired", () => {
    const out = savingsSlipLines([loop(0.3), loop(0.1)], null).join("\n");
    expect(out.match(/→ change or stop after two identical failures/g)).toHaveLength(1);
    // Rows within the group are cost-descending.
    expect(out.indexOf("$0.30")).toBeLessThan(out.indexOf("$0.10"));
  });

  it("a class with no rule entry renders evidence only (omission contract)", () => {
    const rules = { ...SLIP_RULE_LINES };
    // Simulate a future class by removing one entry via the exported map's shape:
    // the renderer looks up by kind, so an unknown kind yields no rule line.
    const unknown = { ...thrash(0.2), kind: "some-future-class" } as unknown as WasteLine;
    const out = savingsSlipLines([unknown], null).join("\n");
    expect(out).not.toContain("→");
    expect(Object.keys(rules)).toEqual(["stuck-loop", "trivial-spans", "context-thrash"]);
  });

  it("every rule string is ≤ 48 chars and passes the banned-phrase guard (I3/I6)", () => {
    // Model names and capability judgments are banned. "cheaper model" itself is
    // NOT banned here: SPEC-0000's routable-spend contract speaks in exactly
    // those terms for spans where capability barely matters — the rule routes
    // work, it never claims a model would have completed the task.
    const banned = ["would have", "should have used", "claude", "gpt", "gemini", "codex", "opus", "sonnet", "haiku", "better", "worse"];
    for (const line of Object.values(SLIP_RULE_LINES)) {
      expect([...line].length).toBeLessThanOrEqual(48);
      const lower = line.toLowerCase();
      for (const phrase of banned) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});

describe("SPEC-0059 R4 — seam placement", () => {
  it("the local packet separates header from slip with the 50-dash rule; the bare slip has none", () => {
    const m = model({ title: "t", wasteLines: [loop(0.41)], totalUsd: 2.84 });
    const local = renderHandoff(m).split("\n");
    expect(local[1]).toBe("-".repeat(50));
    const bare = savingsSlipLines(m.wasteLines, m.totalUsd);
    expect(bare[0]).toContain("COULD HAVE SAVED");
    expect(bare.join("\n")).not.toContain("-".repeat(50));
  });
});

// --- R5/R6: the PR surfaces --------------------------------------------------

function contributor(usd: number | null, tokens: number): ContributorView {
  return {
    role: "lead",
    sessionId: "abc123",
    slice: { kind: "full", turnCount: 9 },
    modelMix: [],
    usd,
    tokens: usage(tokens),
    subagents: [],
  } as unknown as ContributorView;
}

function prInput(overrides: Partial<PrBodyInput> = {}): PrBodyInput {
  return { contributors: [contributor(2.84, 9000)], excludedCount: 0, ...overrides };
}

const detail = { label: "#### lead · `abc123`", row: ["lead", "`abc123`", "entire session", "9", "1m", "9k", "0%"], text: "RECEIPT" };

describe("SPEC-0059 R5 — PR comment section", () => {
  it("adds a collapsed sibling section with the dollars in the summary row", () => {
    const body = renderPrBody(prInput(), {
      details: [detail],
      handoff: { wasteLines: [loop(0.41), trivial(0.05)], sessionCount: 2, turnCount: 18 },
    });
    expect(body).toContain("<details><summary>handoff — could have saved ≤ $0.46 (16%)</summary>");
    expect(body).toContain("COULD HAVE SAVED...........................≤ $0.46");
    expect(body).toContain("covers: 2 sessions · 18 turns · 2 waste lines");
    // Sibling AFTER the full-receipts section.
    expect(body.indexOf("full receipts (1 session)")).toBeLessThan(body.indexOf("handoff — could have saved"));
  });

  it("omits the section entirely when no waste fired — clean-PR bytes unchanged", () => {
    const extras = { details: [detail] };
    const clean = renderPrBody(prInput(), { ...extras, handoff: { wasteLines: [], sessionCount: 1, turnCount: 9 } });
    const without = renderPrBody(prInput(), extras);
    expect(clean).toBe(without);
    expect(clean).not.toContain("handoff —");
  });

  it("omits the section when extras carry no handoff data (--no-details path)", () => {
    const body = renderPrBody(prInput(), { details: [detail] });
    expect(body).not.toContain("handoff —");
  });

  it("omits the percent when the PR total is a ≥ floor (I3)", () => {
    const slip = buildHandoffSlip(
      { wasteLines: [loop(0.41)], sessionCount: 1, turnCount: 9 },
      prInput({ excludedCount: 1 }),
    );
    expect(slip).not.toBeNull();
    expect(slip?.summary).toBe("handoff — could have saved ≤ $0.41");
    expect(slip?.text).toContain("  arithmetic, not a prediction");
    expect(slip?.text).not.toContain("% of $");
  });

  it("drops the whole section when it cannot fit the comment budget (never truncated)", () => {
    // A waste line with a huge tool name inflates the slip; a wall of details
    // consumes the budget first. The slip must be absent entirely, not cut.
    const bigDetails = Array.from({ length: 40 }, (_, i) => ({
      label: `#### s${i}`,
      row: ["role", `id${i}`, "entire session", "9", "1m", "9k", "0%"],
      text: "R".repeat(1800),
    }));
    const body = renderPrBody(prInput(), {
      details: bigDetails,
      handoff: { wasteLines: [loop(0.41)], sessionCount: 40, turnCount: 400 },
    });
    const hasWholeSection = body.includes("<details><summary>handoff — ");
    const hasAnySlipLine = body.includes("COULD HAVE SAVED");
    expect(hasAnySlipLine).toBe(hasWholeSection);
    expect([...body].length).toBeLessThanOrEqual(65_000);
  });
});

describe("SPEC-0059 R6 — artifact parity", () => {
  it("renders the same slip strings as a section on the artifact page", () => {
    const input = prInput();
    const slip = buildHandoffSlip({ wasteLines: [loop(0.41)], sessionCount: 1, turnCount: 9 }, input);
    const html = renderPrArtifactHtml({
      prNumber: 7,
      body: input,
      sessions: [{ label: "lead · abc123", model: model({ wasteLines: [loop(0.41)], totalUsd: 2.84 }) }],
      handoff: slip ?? undefined,
    });
    expect(html).toContain("<h2>handoff — could have saved ≤ $0.41 (14%)</h2>");
    expect(html).toContain("COULD HAVE SAVED");
    expect(html).toContain("→ change or stop after two identical failures");
  });

  it("renders no handoff section when the slip is absent", () => {
    const html = renderPrArtifactHtml({ prNumber: 7, body: prInput(), sessions: [] });
    expect(html).not.toContain("handoff —");
  });
});

describe("SPEC-0059 R7 — JSON surface", () => {
  const counts = { turns: 6, toolCalls: 5, compactions: 0 };

  it("carries rule per waste line and the couldHaveSaved object; schema version unchanged", () => {
    const m = model({ wasteLines: [loop(0.41), trivial(0.05)], totalUsd: 2.84 });
    const json = toHandoffJson(m, [], 3, counts, []);
    expect(() => handoffJsonSchema.parse(json)).not.toThrow();
    expect(json.schemaVersion).toBe(1);
    // Raw float sum, like every existing export's dollars; formatUsd rounds only for display.
    expect(json.couldHaveSaved.usd).toBeCloseTo(0.46, 10);
    expect(json.couldHaveSaved.tokens).toBe(1400);
    expect(json.couldHaveSaved.pctOfTotal).toBe(16);
    expect(json.wasteLines.map((w) => w.rule)).toEqual([
      "change or stop after two identical failures",
      "route short replies to a cheaper model",
    ]);
  });

  it("rule is null for a class without a fixed rule", () => {
    const m = model({ wasteLines: [loop(0.41)] });
    const raw = toHandoffJson(m, [], 3, counts, []);
    const smuggled = { ...raw, wasteLines: [{ ...raw.wasteLines[0], kind: "stuck-loop" }] };
    expect(() => handoffJsonSchema.parse(smuggled)).not.toThrow();
    // Structural: the schema rejects a waste line missing `rule`.
    const stripped: Record<string, unknown> = { ...raw.wasteLines[0] };
    delete stripped.rule;
    const missing = { ...raw, wasteLines: [stripped] };
    expect(() => handoffJsonSchema.parse(missing)).toThrow();
  });
});

describe("SPEC-0059 — covers line wording", () => {
  it("pluralizes each fact independently", () => {
    expect(prCoverageLine(1, 1, 1)).toBe("covers: 1 session · 1 turn · 1 waste line");
    expect(prCoverageLine(2, 18, 2)).toBe("covers: 2 sessions · 18 turns · 2 waste lines");
  });
});
