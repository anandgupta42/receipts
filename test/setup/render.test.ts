import { describe, expect, it } from "vitest";
import type { SetupReport } from "../../src/setup/report.js";
import { setupReportToJson } from "../../src/setup/report.js";
import { renderSetupReport } from "../../src/setup/render.js";

const usage = (total: number) => ({
  input: total,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total,
});

function report(overrides: Partial<SetupReport> = {}): SetupReport {
  return {
    schemaVersion: 1,
    status: "ready",
    agents: [
      { source: "claude-code", label: "Claude Code", sessionCount: 1, tokenTotal: usage(100) },
      { source: "codex", label: "Codex", sessionCount: 0, tokenTotal: usage(0) },
    ],
    latest: {
      source: "claude-code",
      label: "Claude Code",
      model: "claude-opus-4-8",
      totalUsd: 0.18,
      pricingCoverage: "full",
      totalTokens: usage(100),
      parentUnpricedTokens: usage(0),
      combinedUnpricedTokens: usage(0),
      subagentUnpricedCount: 0,
      subagentUnreadableCount: 0,
      subagentRollupStatus: "complete",
      costScope: "parent-session",
      tokenScope: "parent-session",
      wasteLineCount: 1,
      unpriceable: false,
    },
    week: {
      sessionCount: 1,
      pricedSessionCount: 1,
      excludedSessionCount: 0,
      fullyPricedSessionCount: 1,
      partiallyPricedSessionCount: 0,
      cacheRatePartialSessionCount: 0,
      unpricedSessionCount: 0,
      unreadableSessionCount: 0,
      unpricedTokenTotal: usage(0),
      pricedUsd: 0.18,
      tokenTotal: usage(100),
      childSessionsIncluded: false,
    },
    offers: [
      {
        target: "claude-code",
        label: "Claude Code",
        scope: "user",
        network: "none",
        start: "npx aireceipts-cli install-hook",
      },
    ],
    ...overrides,
  };
}

describe("SPEC-0050 setup render", () => {
  it("shows value before next-step automation", () => {
    const out = renderSetupReport(report());
    expect(out.indexOf("Latest session")).toBeLessThan(out.indexOf("Next"));
    expect(out).toContain("Claude Code");
    expect(out).toContain("$0.18");
    expect(out).toContain("Priced floor (1 full + 0 partial)");
    expect(out).toContain("top-level only; children excluded");
    expect(out).toContain("npx aireceipts-cli integrations");
  });

  it("keeps tokens-only sessions honest", () => {
    const out = renderSetupReport(
      report({
        latest: {
          source: "opencode",
          label: "opencode",
          model: "local-provider",
          totalUsd: null,
          pricingCoverage: "unpriced",
          totalTokens: usage(1234),
          parentUnpricedTokens: usage(1234),
          combinedUnpricedTokens: usage(1234),
          subagentUnpricedCount: 0,
          subagentUnreadableCount: 0,
          subagentRollupStatus: "complete",
          costScope: "parent-session",
          tokenScope: "parent-session",
          wasteLineCount: 0,
          unpriceable: false,
        },
      }),
    );
    expect(out).toContain("1,234 tok");
    expect(out).not.toContain("$0.00");
  });

  it("exposes exact known-unpriced coverage and explicit cost/token scope", () => {
    const withChildren = report({
      latest: {
        source: "claude-code",
        label: "Claude Code",
        model: "claude-opus-4-8",
        totalUsd: 1.18,
        pricingCoverage: "partial",
        totalTokens: usage(100),
        combinedTotalTokens: 4_100,
        subagentCount: 2,
        parentUnpricedTokens: usage(125),
        combinedUnpricedTokens: usage(400),
        subagentUnpricedCount: 1,
        subagentUnreadableCount: 1,
        subagentRollupStatus: "complete",
        costScope: "parent-session-plus-readable-subagents",
        tokenScope: "parent-session-plus-readable-subagents",
        wasteLineCount: 0,
        unpriceable: false,
      },
    });
    expect(renderSetupReport(withChildren)).toContain("Known priced subtotal (incl. 2 subagents)");
    expect(renderSetupReport(withChildren)).toContain("Pricing coverage");
    expect(renderSetupReport(withChildren)).toContain("partial");
    expect(renderSetupReport(withChildren)).toContain("Parent unpriced tokens");
    expect(renderSetupReport(withChildren)).toContain("125 tok");
    expect(renderSetupReport(withChildren)).toContain("Known unpriced (combined)");
    expect(renderSetupReport(withChildren)).toContain("400 tok");
    expect(renderSetupReport(withChildren)).toContain("1 unpriced · 1 unreadable (tokens unknown)");
    expect(renderSetupReport(withChildren)).toContain("parent + readable subagents");
    expect(setupReportToJson(withChildren).latest).toMatchObject({
      totalUsd: 1.18,
      pricingCoverage: "partial",
      combinedTotalTokens: 4_100,
      subagentCount: 2,
      parentUnpricedTokens: usage(125),
      combinedUnpricedTokens: usage(400),
      subagentUnpricedCount: 1,
      subagentUnreadableCount: 1,
      subagentRollupStatus: "complete",
      costScope: "parent-session-plus-readable-subagents",
      tokenScope: "parent-session-plus-readable-subagents",
    });
  });

  it("does not fabricate zero child counts when subagent discovery is unavailable", () => {
    const unavailable = report({
      latest: {
        ...report().latest!,
        subagentUnpricedCount: null,
        subagentUnreadableCount: null,
        subagentRollupStatus: "unavailable",
        pricingCoverage: "partial",
      },
    });
    expect(renderSetupReport(unavailable)).toContain("unavailable · child counts/tokens unknown");
    expect(setupReportToJson(unavailable).latest).toMatchObject({
      subagentUnpricedCount: null,
      subagentUnreadableCount: null,
      subagentRollupStatus: "unavailable",
      costScope: "parent-session",
      tokenScope: "parent-session",
    });
  });

  it("exits the no-session path as useful text without requiring hooks", () => {
    const out = renderSetupReport(report({ status: "no_sessions", latest: null, week: null }), "no agent session data detected. Looked in:\n/tmp/agents");
    expect(out).toContain("no agent session data detected");
    expect(out).toContain("/tmp/agents");
    expect(out).toContain("Run a supported agent session");
    expect(out).not.toContain("install-hook");
  });

  it("emits JSON without session paths or prompt-like titles", () => {
    const json = setupReportToJson(report());
    expect(Object.keys(json)).toEqual(["schemaVersion", "costSemantics", "status", "agents", "latest", "week", "offers"]);
    expect(json.costSemantics).toEqual({ kind: "lower-bound", basis: "standard-api-list-price-equivalent" });
    expect(json.week?.pricingCoverage).toMatchObject({ fullyPricedSessionCount: 1, partiallyPricedSessionCount: 0 });
    expect(json.week?.scope).toEqual({ childSessionsIncluded: false });
    expect(JSON.stringify(json)).not.toMatch(/filePath|sessionId|title|\/Users|repo/);
  });
});
