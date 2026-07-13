// R7 surfaces: the text table and the stable-key-order JSON. Asserts the
// honesty carries into rendering — a mixed window shows a priced-subset $ line
// AND an all-session token line (never one merged number); a prior with no
// priced session renders "n/a (priced coverage differs)"; an empty prior reads
// "no prior data"; the JSON never fabricates a $0 for an unpriced window.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleWeekDigest, windowBounds } from "../../src/aggregate/week.js";
import { renderWeek, weekToJson } from "../../src/receipt/week.js";
import { INSTALL_FOOTER_TEXT, REPOSITORY_DISPLAY } from "../../src/receipt/branding.js";
import type { AgentSource, Session, SessionTotals, TokenUsage, Turn } from "../../src/parse/types.js";
import { HEURISTIC_PATTERN_PRICING_INTERPRETATION } from "../../src/receipt/costEstimate.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function usage(input: number): TokenUsage {
  return { input, output: 0, cacheRead: 0, cacheCreation: 0, total: input };
}
function totals(t: TokenUsage): SessionTotals {
  return { tokens: t, turnCount: 1, toolCallCount: 0 };
}
function sess(id: string, source: AgentSource, model: string, tok: number): Session {
  const u = usage(tok);
  const turn: Turn = { index: 0, timestamp: NOW - DAY, model, usage: u, toolCalls: [] };
  const filePath = source === "claude-code" ? `/u/.claude/projects/-u-proj-${id}/x.jsonl` : `/u/.codex/sessions/${id}.jsonl`;
  return { id, source, filePath, startedAt: NOW - DAY, endedAt: NOW - DAY, totals: totals(u), turns: [turn] };
}

async function mixedDigest(byProject = false) {
  const bounds = windowBounds(NOW);
  const current = [sess("p", "claude-code", "claude-sonnet-5", 1_000_000), sess("u", "claude-code", "claude-unknown-xyz", 500_000)];
  const prior = [sess("pp", "claude-code", "claude-sonnet-5", 800_000)];
  return assembleWeekDigest(bounds, current, prior, { sinceOverride: false, byProject, dataDir });
}

describe("renderWeek (R7 text)", () => {
  it("shows a priced-subset $ line and an all-session token line separately", async () => {
    const out = renderWeek(await mixedDigest(), { color: false });
    expect(out).toContain("WEEKLY DIGEST");
    expect(out).toContain("Priced floor (1 full + 0 partial)");
    expect(out).toMatch(/Priced floor \(1 full \+ 0 partial\)\.+≥ \$/); // a visibly floored $ figure
    expect(out).toContain("Pricing coverage");
    expect(out).toContain("Known unpriced tokens");
    expect(out).toContain("Tokens (observable)");
    expect(out).toMatch(/Tokens \(observable\)\.+1,500,000 tok/); // both observable sessions' tokens
    expect(out).toContain("top-level only; children excluded");
    expect(out).toContain("By agent");
    // Deltas carry a plain-language direction so the sign isn't the only cue:
    // current (1.5M tok / higher $) exceeds prior (0.8M tok) → both read "(more)".
    expect(out).toMatch(/Priced floor Δ.+\(more\)/);
    expect(out).toMatch(/Tokens Δ\.+\+700,000 tok \(more\)/);
    expect(out.split("\n").slice(-2).map((line) => line.trim())).toEqual([INSTALL_FOOTER_TEXT, REPOSITORY_DISPLAY]);
  });

  it("labels a drop vs prior as (fewer)/(less), not a bare minus sign", async () => {
    const bounds = windowBounds(NOW);
    // This week burned fewer tokens (and $) than the prior week — the reported
    // confusion: a negative delta must read as a reduction, not an increase.
    const digest = await assembleWeekDigest(
      bounds,
      [sess("c", "claude-code", "claude-sonnet-5", 500_000)],
      [sess("pp", "claude-code", "claude-sonnet-5", 800_000)],
      { sinceOverride: false, byProject: false, dataDir },
    );
    const out = renderWeek(digest, { color: false });
    expect(out).toMatch(/Tokens Δ\.+-300,000 tok \(fewer\)/);
    expect(out).toMatch(/Priced floor Δ.+\(less\)/);
  });

  it("renders 'no prior data' for an empty prior window", async () => {
    const bounds = windowBounds(NOW);
    const digest = await assembleWeekDigest(bounds, [sess("c", "claude-code", "claude-sonnet-5", 1_000_000)], [], {
      sinceOverride: false,
      byProject: false,
      dataDir,
    });
    const out = renderWeek(digest, { color: false });
    expect(out).toContain("no prior data");
    expect(out).not.toContain("0%");
  });

  it("renders a coverage-differs note instead of a $ delta when the prior has no priced session", async () => {
    const bounds = windowBounds(NOW);
    const digest = await assembleWeekDigest(
      bounds,
      [sess("c", "claude-code", "claude-sonnet-5", 2_000_000)],
      [sess("pu", "claude-code", "claude-unknown-xyz", 3_000_000)],
      { sinceOverride: false, byProject: false, dataDir },
    );
    const out = renderWeek(digest, { color: false });
    expect(out).toContain("n/a (priced coverage differs)");
    expect(out).toContain("Excluded");
    expect(out).toContain("Tokens Δ");
  });

  it("includes a By project section only with --by-project", async () => {
    expect(renderWeek(await mixedDigest(false), { color: false })).not.toContain("By project");
    expect(renderWeek(await mixedDigest(true), { color: false })).toContain("By project");
  });
});

describe("weekToJson (R7 schema)", () => {
  it("emits the documented key order and never a $0 for an unpriced window", async () => {
    const json = weekToJson(await mixedDigest(true));
    expect(Object.keys(json)).toEqual([
      "costSemantics",
      "scope",
      "window",
      "priorWindow",
      "sinceOverride",
      "byProject",
      "current",
      "prior",
      "delta",
      "topWaste",
    ]);
    expect(json.costSemantics).toEqual({ kind: "lower-bound", basis: "standard-api-list-price-equivalent" });
    expect(json.scope).toEqual({ childSessionsIncluded: false });
    expect(Object.keys(json.current)).toEqual([
      "sessionCount",
      "pricedSessionCount",
      "excludedSessionCount",
      "pricingCoverage",
      "pricedUsd",
      "tokenTotal",
      "byAgent",
      "byProject",
      "waste",
    ]);
    expect(json.current.sessionCount).toBe(2);
    expect(json.current.pricedSessionCount).toBe(1);
    expect(json.current.excludedSessionCount).toBe(1);
    expect(json.current.pricingCoverage).toMatchObject({
      fullyPricedSessionCount: 1,
      partiallyPricedSessionCount: 0,
      unpricedSessionCount: 1,
      unreadableSessionCount: 0,
    });
    expect(json.current.pricingCoverage.unpricedTokenTotal.total).toBe(500_000);
    expect(json.current.pricedUsd).toBeGreaterThan(0);
    expect(json.current.tokenTotal.total).toBe(1_500_000);
    expect(Array.isArray(json.current.byProject)).toBe(true);
    expect(json.delta.hasPrior).toBe(true);
    expect(json.delta.pricedUsdDeltaKind).toBe("difference-of-lower-bounds");
  });

  it("renders and exports a mixed-turn session as partial, never fully priced", async () => {
    const bounds = windowBounds(NOW);
    const mixed = sess("mixed", "claude-code", "claude-sonnet-5", 1_000);
    mixed.turns.push({ index: 1, timestamp: NOW - DAY, model: "unknown-model", usage: usage(250), toolCalls: [] });
    mixed.totals = totals(usage(1_250));
    const digest = await assembleWeekDigest(bounds, [mixed], [], {
      sinceOverride: false,
      byProject: false,
      dataDir,
    });

    expect(renderWeek(digest, { color: false })).toContain("0 full · 1 partial · 0 none");
    const json = weekToJson(digest);
    expect(json.current.pricingCoverage.fullyPricedSessionCount).toBe(0);
    expect(json.current.pricingCoverage.partiallyPricedSessionCount).toBe(1);
    expect(json.current.pricingCoverage.unpricedTokenTotal.total).toBe(250);
  });

  it("surfaces a cache-rate gap as partial coverage without inventing excluded tokens", async () => {
    const bounds = windowBounds(NOW);
    const cachedWrite = sess("cache-gap", "codex", "gpt-5.3-codex", 1_000);
    const cacheUsage: TokenUsage = { input: 900, output: 0, cacheRead: 0, cacheCreation: 100, total: 1_000 };
    cachedWrite.turns[0].usage = cacheUsage;
    cachedWrite.totals = totals(cacheUsage);
    const digest = await assembleWeekDigest(bounds, [cachedWrite], [], {
      sinceOverride: false,
      byProject: false,
      dataDir,
    });

    const text = renderWeek(digest, { color: false });
    expect(text).toContain("Priced floor (0 full + 1 partial)");
    expect(text).toContain("Cache-rate gaps");
    const json = weekToJson(digest);
    expect(json.current.pricingCoverage.cacheRatePartialSessionCount).toBe(1);
    expect(json.current.pricingCoverage.unpricedTokenTotal.total).toBe(0);
  });

  it("carries pricedUsd null (not 0) and byProject null when the flag is off / nothing priced", async () => {
    const bounds = windowBounds(NOW);
    const digest = await assembleWeekDigest(bounds, [sess("u", "claude-code", "claude-unknown-xyz", 400_000)], [], {
      sinceOverride: false,
      byProject: false,
      dataDir,
    });
    const json = weekToJson(digest);
    expect(json.current.pricedUsd).toBeNull();
    expect(json.current.byProject).toBeNull();
    expect(json.delta.hasPrior).toBe(false);
    expect(json.delta.pricedUsdDeltaKind).toBeNull();
  });

  it("labels aggregated detector pricing as heuristic and not proven savings", async () => {
    const bounds = windowBounds(NOW);
    const loop = sess("loop", "claude-code", "claude-sonnet-5", 1_000_000);
    loop.turns[0].toolCalls = [0, 1, 2].map(() => ({
      name: "Bash",
      shell: true,
      input: { command: "false" },
      output: "failed",
      status: "error" as const,
    }));
    loop.totals.toolCallCount = 3;
    const digest = await assembleWeekDigest(bounds, [loop], [], {
      sinceOverride: false,
      byProject: false,
      dataDir,
    });
    const json = weekToJson(digest);

    expect(json.current.waste[0]?.costInterpretation).toBe(HEURISTIC_PATTERN_PRICING_INTERPRETATION);
    expect(json.topWaste[0]?.costInterpretation).toBe(HEURISTIC_PATTERN_PRICING_INTERPRETATION);
    const text = renderWeek(digest, { color: false });
    expect(text).toContain("Flagged patterns");
    expect(text).toMatch(/stuck-loop.+≈ \$/);
    expect(text).toContain("heuristic pattern cost · standard API floor · not proven savings");
    expect(text).not.toContain("Top waste");
  });
});
