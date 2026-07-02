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
import type { AgentSource, Session, SessionTotals, TokenUsage, Turn } from "../../src/parse/types.js";

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
    expect(out).toContain("Priced total (1 of 2)");
    expect(out).toMatch(/Priced total \(1 of 2\)\.+\$/); // a $ figure on the priced line
    expect(out).toContain("Tokens (all sessions)");
    expect(out).toMatch(/Tokens \(all sessions\)\.+1,500,000 tok/); // both sessions' tokens
    expect(out).toContain("By agent");
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
      "window",
      "priorWindow",
      "sinceOverride",
      "byProject",
      "current",
      "prior",
      "delta",
      "topWaste",
    ]);
    expect(Object.keys(json.current)).toEqual([
      "sessionCount",
      "pricedSessionCount",
      "excludedSessionCount",
      "pricedUsd",
      "tokenTotal",
      "byAgent",
      "byProject",
      "waste",
    ]);
    expect(json.current.sessionCount).toBe(2);
    expect(json.current.pricedSessionCount).toBe(1);
    expect(json.current.excludedSessionCount).toBe(1);
    expect(json.current.pricedUsd).toBeGreaterThan(0);
    expect(json.current.tokenTotal.total).toBe(1_500_000);
    expect(Array.isArray(json.current.byProject)).toBe(true);
    expect(json.delta.hasPrior).toBe(true);
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
  });
});
