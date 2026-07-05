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
      totalTokens: usage(100),
      wasteLineCount: 1,
      unpriceable: false,
    },
    week: {
      sessionCount: 1,
      pricedSessionCount: 1,
      excludedSessionCount: 0,
      pricedUsd: 0.18,
      tokenTotal: usage(100),
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

describe("SPEC-0043 setup render", () => {
  it("shows value before next-step automation", () => {
    const out = renderSetupReport(report());
    expect(out.indexOf("Latest session")).toBeLessThan(out.indexOf("Next"));
    expect(out).toContain("Claude Code");
    expect(out).toContain("$0.18");
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
          totalTokens: usage(1234),
          wasteLineCount: 0,
          unpriceable: false,
        },
      }),
    );
    expect(out).toContain("1,234 tok");
    expect(out).not.toContain("$0.00");
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
    expect(Object.keys(json)).toEqual(["schemaVersion", "status", "agents", "latest", "week", "offers"]);
    expect(JSON.stringify(json)).not.toMatch(/filePath|sessionId|title|\/Users|repo/);
  });
});
