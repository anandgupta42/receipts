// SPEC-0008 windowing + honest aggregation, exercised with a frozen clock and
// synthetic sessions (no disk). Covers: R1 windowing (endedAt in/out, missing
// excluded), R2 mixed pricing (priced-subset $ and all-session tokens never
// merged), R3 per-agent split sums to the grand total desc, R4 opt-in project
// split, R6 honest deltas (coverage change ≠ spend change; no prior data),
// R7 --since custom window. Uses the real committed price tables.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateWindow,
  assembleWeekDigest,
  computeDelta,
  partitionWindows,
  windowBounds,
} from "../../src/aggregate/week.js";
import { deriveProjectBucket } from "../../src/aggregate/project.js";
import type { AgentSource, Session, SessionSummary, SessionTotals, TokenUsage, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // Jun 15 2026, 12:00 UTC

function usage(input: number): TokenUsage {
  return { input, output: 0, cacheRead: 0, cacheCreation: 0, total: input };
}
function totals(t: TokenUsage): SessionTotals {
  return { tokens: t, turnCount: 1, toolCallCount: 0 };
}
function filePathFor(source: AgentSource, id: string): string {
  return source === "claude-code" ? `/u/.claude/projects/-u-proj-${id}/x.jsonl` : `/u/.codex/sessions/${id}.jsonl`;
}
function sess(id: string, source: AgentSource, model: string, tok: number, endedAt = NOW - DAY): Session {
  const u = usage(tok);
  const turn: Turn = { index: 0, timestamp: NOW - DAY, model, usage: u, toolCalls: [] };
  return {
    id,
    source,
    filePath: filePathFor(source, id),
    startedAt: NOW - DAY,
    endedAt,
    totals: totals(u),
    turns: [turn],
  };
}
function summary(id: string, endedAt: number | undefined): SessionSummary {
  return { id, source: "claude-code", filePath: `/f/${id}.jsonl`, startedAt: endedAt, endedAt, totals: totals(usage(0)) };
}

describe("windowBounds (R1/R7)", () => {
  it("default anchors the current window's end at now: [now-7d, now)", () => {
    const b = windowBounds(NOW);
    expect(b.curStart).toBe(NOW - 7 * DAY);
    expect(b.curEnd).toBe(NOW);
    expect(b.priorStart).toBe(NOW - 14 * DAY);
    expect(b.priorEnd).toBe(NOW - 7 * DAY);
  });

  it("--since anchors the current window's start: [since, since+7d)", () => {
    const since = Date.UTC(2026, 4, 1, 0, 0, 0); // May 1
    const b = windowBounds(NOW, since);
    expect(b.curStart).toBe(since);
    expect(b.curEnd).toBe(since + 7 * DAY);
    expect(b.priorStart).toBe(since - 7 * DAY);
    expect(b.priorEnd).toBe(since);
  });
});

describe("partitionWindows (R1)", () => {
  it("includes only timestamped sessions, bucketed half-open by endedAt", () => {
    const bounds = windowBounds(NOW);
    const inCurrent = summary("cur", NOW - DAY);
    const inPrior = summary("pri", NOW - 8 * DAY);
    const tooOld = summary("old", NOW - 15 * DAY);
    const noTimestamp = summary("none", undefined);
    const atCurEndExclusive = summary("edge", NOW); // curEnd is exclusive → not current
    const { current, prior } = partitionWindows(
      [inCurrent, inPrior, tooOld, noTimestamp, atCurEndExclusive],
      bounds,
    );
    expect(current.map((s) => s.id)).toEqual(["cur"]);
    expect(prior.map((s) => s.id)).toEqual(["pri"]);
  });

  it("places a session exactly at curStart in the current window (start inclusive)", () => {
    const bounds = windowBounds(NOW);
    const { current, prior } = partitionWindows([summary("start", bounds.curStart)], bounds);
    expect(current.map((s) => s.id)).toEqual(["start"]);
    expect(prior).toHaveLength(0);
  });

  it("retains a timestamped degraded summary even when its unreliable totals are all zero", () => {
    const degraded = summary("degraded", NOW - DAY);
    degraded.degraded = "unreadable";
    const { current } = partitionWindows([degraded], windowBounds(NOW));
    expect(current.map((session) => session.id)).toEqual(["degraded"]);
  });
});

describe("aggregateWindow (R2/R3/R4)", () => {
  it("R2: sums $ over priced sessions only but tokens over ALL sessions — never merged", async () => {
    const priced = sess("p", "claude-code", "claude-sonnet-5", 1_000_000);
    const unpriced = sess("u", "claude-code", "claude-unknown-xyz", 500_000);
    const w = await aggregateWindow([priced, unpriced], false, dataDir);

    expect(w.pricedUsd).not.toBeNull();
    expect(w.pricedUsd as number).toBeGreaterThan(0);
    expect(w.pricedSessionCount).toBe(1);
    expect(w.excludedSessionCount).toBe(1);
    // Token total counts BOTH sessions; the excluded session's tokens are not lost.
    expect(w.tokenTotal.total).toBe(1_500_000);
  });

  it("R2: a window with zero priced sessions reports pricedUsd null (not $0) but keeps tokens", async () => {
    const w = await aggregateWindow([sess("u", "claude-code", "claude-unknown-xyz", 400_000)], false, dataDir);
    expect(w.pricedUsd).toBeNull();
    expect(w.tokenTotal.total).toBe(400_000);
    expect(w.excludedSessionCount).toBe(1);
  });

  it("classifies mixed priced/unpriced turns as partial and preserves the exact unpriced-token subtotal", async () => {
    const mixed = sess("mixed", "claude-code", "claude-sonnet-5", 1_000);
    mixed.turns.push({
      index: 1,
      timestamp: NOW - DAY,
      model: "claude-unknown-xyz",
      usage: usage(250),
      toolCalls: [],
    });
    mixed.totals = totals(usage(1_250));

    const w = await aggregateWindow([mixed], false, dataDir);

    expect(w.pricedSessionCount).toBe(1);
    expect(w.fullyPricedSessionCount).toBe(0);
    expect(w.partiallyPricedSessionCount).toBe(1);
    expect(w.unpricedSessionCount).toBe(0);
    expect(w.unpricedTokenTotal.total).toBe(250);
  });

  it("does not call a session full when a cached component lacks a cited applicable rate", async () => {
    const cachedWrite = sess("cache-gap", "codex", "gpt-5.3-codex", 1_000);
    const cacheUsage: TokenUsage = {
      input: 900,
      output: 0,
      cacheRead: 0,
      cacheCreation: 100,
      total: 1_000,
    };
    cachedWrite.turns[0].usage = cacheUsage;
    cachedWrite.totals = totals(cacheUsage);

    const w = await aggregateWindow([cachedWrite], false, dataDir);

    expect(w.fullyPricedSessionCount).toBe(0);
    expect(w.partiallyPricedSessionCount).toBe(1);
    expect(w.cacheRatePartialSessionCount).toBe(1);
    // No invented component breakdown: only the boolean row evidence is known.
    expect(w.unpricedTokenTotal.total).toBe(0);
  });

  it("keeps unreadable summaries in the coverage denominator without trusting degraded totals", async () => {
    const reloadFailed = summary("reload-failed", NOW - DAY);
    reloadFailed.totals = totals(usage(300));
    const degraded = summary("degraded", NOW - DAY);
    degraded.totals = totals(usage(999));
    degraded.degraded = "unreadable";

    const w = await aggregateWindow([], false, dataDir, [reloadFailed, degraded]);

    expect(w.sessionCount).toBe(2);
    expect(w.unreadableSessionCount).toBe(2);
    expect(w.excludedSessionCount).toBe(2);
    expect(w.tokenTotal.total).toBe(300);
    expect(w.unpricedTokenTotal.total).toBe(300);
  });

  it("R3: per-agent split sums to the grand total and is ordered desc", async () => {
    const sessions = [
      sess("c1", "claude-code", "claude-sonnet-5", 1_000_000),
      sess("c2", "claude-code", "claude-sonnet-5", 2_000_000),
      sess("c3", "claude-code", "claude-haiku-4-5", 3_000_000),
      sess("x1", "codex", "gpt-5.3-codex", 1_000_000),
      sess("x2", "codex", "gpt-5.3-codex", 2_000_000),
    ];
    const w = await aggregateWindow(sessions, false, dataDir);

    expect(w.byAgent).toHaveLength(2);
    const agentUsd = w.byAgent.reduce((n, a) => n + (a.usd ?? 0), 0);
    expect(agentUsd).toBeCloseTo(w.pricedUsd as number, 8);
    const agentTokens = w.byAgent.reduce((n, a) => n + a.tokens.total, 0);
    expect(agentTokens).toBe(w.tokenTotal.total);
    // desc by priced $
    expect(w.byAgent[0].usd as number).toBeGreaterThanOrEqual(w.byAgent[1].usd as number);
  });

  it("R4: project split is absent by default and present with byProject, with (unknown) for Codex", async () => {
    const cc = sess("p", "claude-code", "claude-sonnet-5", 1_000_000);
    const cx = sess("x", "codex", "gpt-5.3-codex", 1_000_000);

    const off = await aggregateWindow([cc, cx], false, dataDir);
    expect(off.byProject).toBeNull();

    const on = await aggregateWindow([cc, cx], true, dataDir);
    expect(on.byProject).not.toBeNull();
    const names = on.byProject!.map((p) => p.project);
    expect(names).toContain(deriveProjectBucket(cc.filePath));
    expect(names).toContain("(unknown)");
    // Every session lands in exactly one project bucket.
    expect(on.byProject!.reduce((n, p) => n + p.sessionCount, 0)).toBe(2);
  });
});

describe("computeDelta (R6)", () => {
  it("renders a $ delta only when both windows priced; token delta always; excluded counts per window", async () => {
    const current = await aggregateWindow(
      [sess("c", "claude-code", "claude-sonnet-5", 2_000_000), sess("cu", "claude-code", "claude-unknown-xyz", 100_000)],
      false,
      dataDir,
    );
    const prior = await aggregateWindow([sess("p", "claude-code", "claude-sonnet-5", 1_000_000)], false, dataDir);
    const d = computeDelta(current, prior);

    expect(d.hasPrior).toBe(true);
    expect(d.pricedUsdDelta).toBeCloseTo((current.pricedUsd as number) - (prior.pricedUsd as number), 10);
    expect(d.tokenDelta).toBe(current.tokenTotal.total - prior.tokenTotal.total);
    expect(d.currentExcluded).toBe(1);
    expect(d.priorExcluded).toBe(0);
  });

  it("R6: coverage change never masquerades as spend — prior with no priced session yields a null $ delta, not a swing", async () => {
    const current = await aggregateWindow([sess("c", "claude-code", "claude-sonnet-5", 2_000_000)], false, dataDir);
    const prior = await aggregateWindow([sess("pu", "claude-code", "claude-unknown-xyz", 5_000_000)], false, dataDir);
    const d = computeDelta(current, prior);

    expect(d.hasPrior).toBe(true);
    expect(d.pricedUsdDelta).toBeNull(); // priced coverage differs → no fabricated $ delta
    expect(d.tokenDelta).toBe(current.tokenTotal.total - prior.tokenTotal.total); // tokens still comparable
    expect(d.priorExcluded).toBe(1);
  });

  it("R6: empty prior window reads as no prior data, never a fabricated 0%", async () => {
    const current = await aggregateWindow([sess("c", "claude-code", "claude-sonnet-5", 1_000_000)], false, dataDir);
    const prior = await aggregateWindow([], false, dataDir);
    const d = computeDelta(current, prior);
    expect(d.hasPrior).toBe(false);
  });
});

describe("assembleWeekDigest (R5/R7 end-to-end)", () => {
  it("carries window bounds, since-override flag, and top-3 waste as a sorted slice", async () => {
    const since = Date.UTC(2026, 4, 1, 0, 0, 0);
    const bounds = windowBounds(NOW, since);
    const current = [sess("c", "claude-code", "claude-sonnet-5", 1_000_000, since + DAY)];
    const prior: Session[] = [];
    const digest = await assembleWeekDigest(bounds, current, prior, { sinceOverride: true, byProject: false, dataDir });

    expect(digest.sinceOverride).toBe(true);
    expect(digest.windowStartMs).toBe(since);
    expect(digest.windowEndMs).toBe(since + 7 * DAY);
    expect(digest.delta.hasPrior).toBe(false);
    // top-3 is exactly the current window's waste, sliced and already cost-sorted.
    expect(digest.topWaste).toEqual(digest.current.waste.slice(0, 3));
    expect(digest.topWaste.length).toBeLessThanOrEqual(3);
  });
});
