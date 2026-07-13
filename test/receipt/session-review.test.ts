import { describe, expect, it } from "vitest";
import type { AgentSource, Session, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";
import { reviewJsonSchema } from "../../src/receipt/exportSchema.js";
import reviewRegistryJson from "../../src/receipt/review-patterns.json";
import { actionOutcome, buildReviewActions } from "../../src/receipt/reviewActions.js";
import {
  REVIEW_PATTERNS,
  REVIEW_REGISTRY,
  validateReviewRegistry,
} from "../../src/receipt/reviewRegistry.js";
import {
  buildReviewReport,
  evaluateSessionReview,
  renderReview,
} from "../../src/receipt/review.js";

const ZERO_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 0,
};

function session(
  id: string,
  calls: ToolCall[],
  source: AgentSource = "claude-code",
  turnsOverride?: Turn[],
): Session {
  const turns = turnsOverride ?? [{ index: 0, toolCalls: calls }];
  return {
    id,
    source,
    filePath: "/private/redacted/" + id,
    totals: {
      tokens: ZERO_USAGE,
      turnCount: turns.length,
      toolCallCount: turns.reduce((total, turn) => total + turn.toolCalls.length, 0),
    },
    turns,
  };
}

function call(name: string, input: unknown, status: ToolCall["status"] = "ok"): ToolCall {
  return { name, input, status };
}

describe("SPEC-0083 production review registry", () => {
  it("keeps all researched patterns in one strict, ordered registry", () => {
    expect(REVIEW_REGISTRY.registryVersion).toBe(1);
    expect(REVIEW_PATTERNS).toHaveLength(23);
    expect(REVIEW_PATTERNS.map(({ pattern }) => pattern.order)).toEqual(
      [...REVIEW_PATTERNS.map(({ pattern }) => pattern.order)].sort((a, b) => a - b),
    );
    const states = REVIEW_PATTERNS.reduce<Record<string, number>>((counts, { pattern }) => {
      counts[pattern.rollout.state] = (counts[pattern.rollout.state] ?? 0) + 1;
      return counts;
    }, {});
    expect(states).toEqual({ enabled: 4, diagnostic: 2, disabled: 15, shadow: 2 });
    expect(
      REVIEW_PATTERNS
        .filter(({ pattern }) => pattern.rollout.state === "disabled")
        .every(({ pattern }) => pattern.extractor === null),
    ).toBe(true);
  });

  it("fails closed on unknown fields and parameter drift", () => {
    expect(() => validateReviewRegistry({ ...reviewRegistryJson, surprise: true })).toThrow();
    const mutated = structuredClone(reviewRegistryJson);
    mutated.patterns["repeated-identical-attempt"].extractor.parameters.minimumRunLength = 4;
    expect(() => validateReviewRegistry(mutated)).toThrow();
  });
});

describe("SPEC-0083 canonical action evidence", () => {
  it("sorts object keys, preserves array order, and gives missing input no identity", async () => {
    const actions = await buildReviewActions(
      session("canonical", [
        call("Read", { b: 2, a: [1, 2] }),
        call("Read", { a: [1, 2], b: 2 }),
        call("Read", { a: [2, 1], b: 2 }),
        { name: "Read", status: "ok" },
      ]),
    );
    expect(actions[0].identityHash).toBe(actions[1].identityHash);
    expect(actions[0].identityHash).not.toBe(actions[2].identityHash);
    expect(actions[3].identityHash).toBeUndefined();
  });

  it("never displays path-shaped tool names and does not merge their identities", async () => {
    const actions = await buildReviewActions(
      session("private-tools", [
        call("/private/first/tool", { value: 1 }),
        call("/private/second/tool", { value: 1 }),
      ]),
    );
    expect(actions.map((action) => action.tool)).toEqual(["other-tool", "other-tool"]);
    expect(actions[0].identityHash).not.toBe(actions[1].identityHash);
    expect(JSON.stringify(actions)).not.toContain("/private/");
  });

  it("does not display custom alphanumeric tool or MCP server names", async () => {
    const customName = "PrivateProjectTool";
    const actions = await buildReviewActions(
      session("custom-tool", [
        call(customName, { value: 1 }),
        call("mcp__PrivateProject__run_tests", { value: 2 }),
      ]),
    );
    expect(actions.map((action) => action.tool)).toEqual(["other-tool", "run_tests"]);
    expect(JSON.stringify(actions)).not.toContain(customName);
    expect(JSON.stringify(actions)).not.toContain("PrivateProject");
  });

  it("uses explicit errors or structured nonzero shell exits, but never treats running as failure", () => {
    expect(actionOutcome({ name: "shell", shell: true, status: "ok", output: { exit_code: 2 } })).toBe("error");
    expect(actionOutcome({ name: "shell", shell: true, status: "running", output: { exit_code: 2 } })).toBe("running");
    expect(actionOutcome({ name: "tool", status: "error" })).toBe("error");
  });

  it("recognizes source writes and validation through bounded classifiers", async () => {
    const actions = await buildReviewActions(
      session("classifiers", [
        call("Write", { file_path: "src/index.ts", content: "redacted" }),
        call("Write", { file_path: "docs/guide.md", content: "redacted" }),
        call("Write", { file_path: "generated/client.ts", content: "redacted" }),
        { name: "Bash", shell: true, input: { command: "npm run test:unit" }, status: "ok" },
        { name: "Bash", shell: true, input: { command: "echo npm test" }, status: "ok" },
      ]),
    );
    expect(actions.map((action) => action.sourceWrite)).toEqual([true, false, false, false, false]);
    expect(actions[3].validationKey).toBe("test-script");
    expect(actions[3].validationSuccess).toBe(true);
    expect(actions[4].validationKey).toBeUndefined();
  });

  it("does not treat an explicitly failed or still-running edit as a recorded write", async () => {
    const actions = await buildReviewActions(
      session("failed-writes", [
        call("Write", { file_path: "src/failed.ts", content: "redacted" }, "error"),
        call("Write", { file_path: "src/running.ts", content: "redacted" }, "running"),
      ]),
    );
    expect(actions.map((action) => action.directWrite)).toEqual([false, false]);
    expect(actions.map((action) => action.sourceWrite)).toEqual([false, false]);
  });

  it("recognizes a structured check behind an MCP server name containing underscores", async () => {
    const actions = await buildReviewActions(
      session("structured-check", [call("mcp__local_test_server__run_tests", {}, "ok")]),
    );
    expect(actions[0].validationKey).toBe("test-script");
    expect(actions[0].validationSuccess).toBe(true);
  });

  it("clamps recorded action duration at zero", async () => {
    const actions = await buildReviewActions(
      session("time", [{ name: "Read", input: { file_path: "src/a.ts" }, status: "ok", startedAt: 20, endedAt: 10 }]),
    );
    expect(actions[0].durationMs).toBe(0);
  });
});

describe("SPEC-0083 session issue detection", () => {
  it("attributes generic identical repetition only after the first two attempts", async () => {
    const selected = session("repeat", [
      call("Read", { file_path: "src/a.ts" }),
      call("Read", { file_path: "src/a.ts" }),
      call("Read", { file_path: "src/a.ts" }),
    ]);
    const report = await buildReviewReport(selected);
    const finding = report.review.findings["repeated-identical-attempt"];
    expect(finding?.evidence.facts).toContainEqual({ name: "triggering-attempts", value: 1 });
    expect(finding?.impact?.role).toBe("observed-attributed");
  });

  it("surfaces one strict failed-retry issue and suppresses overlapping generic advice", async () => {
    const failed = call("Bash", { command: "false" }, "error");
    const selected = session("failed-repeat", [failed, { ...failed }, { ...failed }]);
    const report = await buildReviewReport(selected);
    expect(Object.keys(report.review.findings)).toEqual(["repeated-identical-error"]);
    const finding = report.review.findings["repeated-identical-error"];
    expect(finding?.evidence.facts).toContainEqual({ name: "retries-after-first-error", value: 2 });
    expect(renderReview(report)).toContain("The same failed action was tried again unchanged");
  });

  it("does not join missing inputs into a repeated-attempt finding", async () => {
    const selected = session("missing", [
      { name: "Read", status: "ok" },
      { name: "Read", status: "ok" },
      { name: "Read", status: "ok" },
    ]);
    const report = await buildReviewReport(selected);
    expect(report.review.findings["repeated-identical-attempt"]).toBeUndefined();
  });

  it("resets strict failed-retry matching after a direct write or passing validation", async () => {
    const failed = call("Read", { file_path: "src/a.ts" }, "error");
    const withWrite = session("write-reset", [
      failed,
      call("Write", { file_path: "src/a.ts", content: "redacted" }),
      { ...failed },
    ]);
    const withCheck = session("check-reset", [
      failed,
      { name: "Bash", shell: true, input: { command: "npm test" }, status: "ok" },
      { ...failed },
    ]);
    expect((await buildReviewReport(withWrite)).review.findings["repeated-identical-error"]).toBeUndefined();
    expect((await buildReviewReport(withCheck)).review.findings["repeated-identical-error"]).toBeUndefined();
  });

  it("caveats three adjacent explicit errors even when their causes differ", async () => {
    const selected = session("errors", [
      call("Read", { file_path: "a" }, "error"),
      call("Bash", { command: "b" }, "error"),
      call("Write", { file_path: "c" }, "error"),
    ]);
    const report = await buildReviewReport(selected);
    const finding = report.review.findings["consecutive-tool-errors"];
    expect(finding?.claimLimit).toContain("may not share a cause");
    expect(renderReview(report)).toContain("THINGS TO WATCH");
  });

  it("keeps the tail-check rules shadow-only while exposing aggregate dogfood counts", async () => {
    const selected = session("unchecked", [
      call("Write", { file_path: "src/final.ts", content: "redacted" }),
    ]);
    const evaluation = await evaluateSessionReview(selected);
    expect(evaluation.shadowFirings["last-change-not-checked"]).toBe(1);
    const report = await buildReviewReport(selected);
    expect(Object.keys(report.review.findings)).toEqual([]);
    expect(renderReview(report)).toContain("No supported issues found in the recorded evidence.");
    expect(renderReview(report)).not.toContain("final code change");
  });

  it("applies the same source-write predicate across the three audited source families", async () => {
    for (const source of ["claude-code", "codex", "opencode"] as const) {
      const candidate = session(
        "tail-" + source,
        [call("Write", { file_path: "src/final.ts", content: "redacted" })],
        source,
      );
      expect((await evaluateSessionReview(candidate)).shadowFirings["last-change-not-checked"]).toBe(1);
    }
  });

  it("tracks the final result per normalized check key and clears it after a pass", async () => {
    const failed = { name: "Bash", shell: true, input: { command: "npm test" }, status: "error" } as ToolCall;
    const stillFailing = session("check-failed", [failed]);
    const laterPassed = session("check-passed", [failed, { ...failed, status: "ok" }]);
    expect((await evaluateSessionReview(stillFailing)).shadowFirings["last-check-still-failing"]).toBe(1);
    expect((await evaluateSessionReview(laterPassed)).shadowFirings["last-check-still-failing"]).toBeUndefined();
  });

  it("does not shadow-fire the final-change rule for docs or after a later passing check", async () => {
    const docs = session("docs", [call("Write", { file_path: "docs/readme.md", content: "redacted" })]);
    const checked = session("checked", [
      call("Write", { file_path: "src/a.ts", content: "redacted" }),
      { name: "Bash", shell: true, input: { command: "npx tsc --noEmit" }, status: "ok" },
    ]);
    expect((await evaluateSessionReview(docs)).shadowFirings["last-change-not-checked"]).toBeUndefined();
    expect((await evaluateSessionReview(checked)).shadowFirings["last-change-not-checked"]).toBeUndefined();
  });

  it("holds the tail-check boundary across at least 30 adversarial negative cases", async () => {
    const excludedWrites = [
      "docs/readme.md",
      "config/app.json",
      "generated/client.ts",
      "dist/bundle.js",
      "build/native.rs",
      "coverage/report.ts",
      "node_modules/pkg/index.js",
      "vendor/lib/source.go",
      ".github/workflows/check.ts",
      "README",
    ].map((filePath) => session("excluded-" + filePath, [call("Write", { file_path: filePath }, "ok")]));
    const passingChecks = [
      "npm test",
      "npm run test:unit",
      "pnpm test",
      "yarn test",
      "bun test",
      "npx vitest run",
      "python -m pytest",
      "uv run pytest",
      "poetry run mypy",
      "cargo test",
      "cargo check",
      "cargo clippy",
      "go test ./...",
      "go vet ./...",
      "./gradlew test",
      "mvn verify",
      "dotnet build",
      "make check",
      "composer test",
      "bundle exec rspec",
    ].map((command) =>
      session("checked-" + command, [
        call("Write", { file_path: "src/final.ts" }, "ok"),
        { name: "Bash", shell: true, input: { command }, status: "ok" },
      ]),
    );
    const shellMutations = [
      "sed -i s/a/b/ src/a.ts",
      "perl -pi -e s/a/b/ src/a.ts",
      "python scripts/rewrite.py",
      "tee src/a.ts",
      "cat input.ts > src/a.ts",
      "mv src/a.tmp src/a.ts",
    ].map((command) =>
      session("shell-only-" + command, [
        { name: "Bash", shell: true, input: { command }, status: "ok" },
      ]),
    );
    const cases = [...excludedWrites, ...passingChecks, ...shellMutations];
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const candidate of cases) {
      expect((await evaluateSessionReview(candidate)).shadowFirings["last-change-not-checked"]).toBeUndefined();
    }
  });
});

describe("SPEC-0083 report contract", () => {
  it("emits strict pattern-keyed JSON without session identity or raw evidence", async () => {
    const selected = session("private-id", [
      call("Bash", { command: "secret command", cwd: "/secret/repo" }, "error"),
      call("Bash", { cwd: "/secret/repo", command: "secret command" }, "error"),
    ]);
    const report = await buildReviewReport(selected);
    expect(() => reviewJsonSchema.parse(report)).not.toThrow();
    const json = JSON.stringify(report);
    expect(json).not.toContain("private-id");
    expect(json).not.toContain("/secret/repo");
    expect(json).not.toContain("secret command");
    expect(report.review.findings["repeated-identical-error"]?.recommendation).toBe(
      REVIEW_REGISTRY.patterns["repeated-identical-error"].recommendation,
    );
  });

  it("reports unavailable checks separately instead of treating them as non-firings", async () => {
    const report = await buildReviewReport(
      session(
        "limited",
        [
          { name: "first", status: "error" },
          { name: "second", status: "error" },
          { name: "third", status: "error" },
        ],
        "gemini",
      ),
    );
    expect(report.review.findings["consecutive-tool-errors"]).toBeDefined();
    expect(report.review.coverage.unavailable.patternIds).toContain("repeated-identical-error");
    expect(report.review.coverage.evaluated.patternIds).toContain("consecutive-tool-errors");
  });

  it("uses the exact canonical recommendation when recurrence reaches distinct sessions", async () => {
    const make = (id: string) =>
      session(id, [
        call("Read", { file_path: "src/a.ts" }),
        call("Read", { file_path: "src/a.ts" }),
        call("Read", { file_path: "src/a.ts" }),
      ]);
    const selected = make("one");
    const report = await buildReviewReport(selected, [selected, make("two"), make("three")]);
    const finding = report.review.findings["repeated-identical-attempt"];
    expect(finding?.recurrence?.distinctSessionCount).toBe(3);
    expect(finding?.recurrence?.recommendation).toBe(finding?.recommendation);
    expect(renderReview(report)).toContain(finding?.recommendation);
  });

  it("keeps the exact scoped empty state followed by deterministic coverage", async () => {
    const report = await buildReviewReport(session("empty", []));
    const text = renderReview(report);
    expect(text).toContain("No supported issues found in the recorded evidence.");
    expect(text.indexOf("No supported issues found")).toBeLessThan(text.indexOf("COVERAGE"));
    expect(text).not.toContain("clean");
  });
});
