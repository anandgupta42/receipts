import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_VALUES,
  EVENT_NAMES,
  activationMilestonePropertiesSchema,
  cliErrorPropertiesSchema,
  cliRunPropertiesSchema,
  exportGeneratedPropertiesSchema,
  hookConfiguredPropertiesSchema,
  integrationSurfaceRenderedPropertiesSchema,
  parseFailurePropertiesSchema,
  prFlowCompletedPropertiesSchema,
  receiptGeneratedPropertiesSchema,
  validateEvent,
  type CliErrorEvent,
  type CliRunEvent,
  type ParseFailureEvent,
  type TelemetryEvent,
} from "./schemas.js";

const INSTALL_HASH = "a".repeat(64);

describe("SPEC-0043 R1: exactly nine event names", () => {
  it("is exhaustive over the v2 catalog — no more, no less", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "activation_milestone",
        "cli_error",
        "cli_run",
        "export_generated",
        "hook_configured",
        "integration_surface_rendered",
        "parse_failure",
        "pr_flow_completed",
        "receipt_generated",
      ].sort(),
    );
  });
});

describe("SPEC-0043 R9: docs parity", () => {
  const doc = readFileSync(resolve(process.cwd(), "docs/telemetry.md"), "utf8");
  const fieldsByEvent = {
    cli_run: ["cliVersion", "os", "nodeMajor", "commandClass", "agentType", "durationBucket", "ok", "isCI", "installHash", "runOrdinalBucket"],
    cli_error: ["errorClass", "command", "agentType", "inPackage"],
    parse_failure: ["agentType", "adapterVersion", "signatureHash"],
    receipt_generated: [
      "surface",
      "agentType",
      "multiAgent",
      "outputMode",
      "template",
      "pricedRowCoverage",
      "hasStuckLoopWaste",
      "hasTrivialSpansWaste",
      "hasContextThrashWaste",
      "hasPriceDelta",
      "hasSubagents",
      "hasPreEditShare",
      "detailsView",
      "turnCountBucket",
      "toolCallCountBucket",
      "receiptOrdinalBucket",
    ],
    export_generated: ["surface", "format", "wroteFile", "result"],
    pr_flow_completed: [
      "mode",
      "artifactRequested",
      "shareRequested",
      "contributorCountBucket",
      "commentResult",
      "artifactResult",
      "shareResult",
      "handoffSectionIncluded",
      "result",
    ],
    hook_configured: ["operation", "promptOutcome", "result"],
    integration_surface_rendered: ["integration", "inputMode", "payloadValid", "customFormat", "scoped", "configFile", "result"],
    activation_milestone: ["milestone", "command", "installAgeBucket"],
  } as const;

  it("documents every event and field", () => {
    for (const event of EVENT_NAMES) {
      expect(doc).toContain(`### \`${event}\``);
      for (const field of fieldsByEvent[event]) {
        expect(doc).toContain(`| \`${field}\` |`);
      }
    }
  });
});

describe("SPEC-0043 R2: command enum", () => {
  it("pins the 20 command files plus stats", () => {
    expect([...COMMAND_VALUES].sort()).toEqual(
      [
        "backfill",
        "benchmark",
        "check-budget",
        "compare",
        "demo",
        "handoff",
        "help",
        "install-hook",
        "list",
        "methodology",
        "mini",
        "pr",
        "quota",
        "receipt",
        "stats",
        "statusline",
        "telemetry-show",
        "templates",
        "uninstall-hook",
        "version",
        "week",
      ].sort(),
    );
  });
});

describe("SPEC-0043 R1-R5: valid events pass their schema", () => {
  it("accepts a well-formed cli_run event", () => {
    const event: CliRunEvent = {
      name: "cli_run",
      properties: {
        cliVersion: "0.1.0",
        os: "darwin",
        nodeMajor: 22,
        commandClass: "receipt",
        agentType: "opencode",
        durationBucket: "100-500ms",
        ok: true,
        isCI: false,
        installHash: INSTALL_HASH,
        runOrdinalBucket: "1",
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it("accepts a well-formed cli_error event", () => {
    const event: CliErrorEvent = {
      name: "cli_error",
      properties: {
        errorClass: "io_error",
        command: "receipt",
        agentType: "codex",
        inPackage: false,
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it("accepts a well-formed parse_failure event", () => {
    const event: ParseFailureEvent = {
      name: "parse_failure",
      properties: {
        agentType: "cursor",
        adapterVersion: "1",
        signatureHash: "b".repeat(64),
      },
    };
    expect(validateEvent(event)).toBe(true);
  });

  it.each([
    [
      "receipt_generated",
      {
        surface: "receipt",
        agentType: "claude-code",
        multiAgent: false,
        outputMode: "text",
        template: "none",
        pricedRowCoverage: "some",
        hasStuckLoopWaste: true,
        hasTrivialSpansWaste: false,
        hasContextThrashWaste: false,
        hasPriceDelta: true,
        hasSubagents: false,
        hasPreEditShare: false,
        detailsView: false,
        turnCountBucket: "4-10",
        toolCallCountBucket: "11-50",
        receiptOrdinalBucket: "2-3",
      },
    ],
    ["export_generated", { surface: "receipt", format: "csv_tool", wroteFile: false, result: "success" }],
    [
      "pr_flow_completed",
      {
        mode: "post",
        artifactRequested: true,
        shareRequested: true,
        contributorCountBucket: "2-3",
        commentResult: "success",
        artifactResult: "success",
        shareResult: "skipped",
        handoffSectionIncluded: true,
        result: "success",
      },
    ],
    ["hook_configured", { operation: "install", promptOutcome: "accepted", result: "success" }],
    [
      "integration_surface_rendered",
      {
        integration: "statusline",
        inputMode: "stdin_payload",
        payloadValid: true,
        customFormat: false,
        scoped: true,
        configFile: true,
        result: "success",
      },
    ],
    ["activation_milestone", { milestone: "first_receipt", command: "receipt", installAgeBucket: "first_day" }],
  ] as const)("accepts a well-formed %s event", (name, properties) => {
    expect(validateEvent({ name, properties } as TelemetryEvent)).toBe(true);
  });

  it("cli_run accepts the unavailable install hash sentinel", () => {
    expect(
      cliRunPropertiesSchema.safeParse({
        cliVersion: "0.1.0",
        os: "linux",
        nodeMajor: 20,
        commandClass: "stats",
        agentType: "unknown",
        durationBucket: "<100ms",
        ok: true,
        isCI: true,
        installHash: "unavailable",
        runOrdinalBucket: "unavailable",
      }).success,
    ).toBe(true);
  });

  it("SPEC-0075 R6 strictly accepts boolean-only statusline scope/config markers", () => {
    const valid = {
      integration: "statusline",
      inputMode: "disk_fallback",
      payloadValid: false,
      result: "success",
      customFormat: false,
      scoped: true,
      configFile: true,
    };
    expect(integrationSurfaceRenderedPropertiesSchema.safeParse(valid).success).toBe(true);
    expect(integrationSurfaceRenderedPropertiesSchema.safeParse({ ...valid, scoped: "/private/repo" }).success).toBe(false);
    expect(integrationSurfaceRenderedPropertiesSchema.safeParse({ ...valid, configFile: "brand,cost" }).success).toBe(false);
  });
});

describe("SPEC-0043 R9: leakage fixtures — banned content is structurally rejected", () => {
  const validBySchema = [
    [
      cliRunPropertiesSchema,
      {
        cliVersion: "0.1.0",
        os: "darwin",
        nodeMajor: 22,
        commandClass: "receipt",
        agentType: "claude-code",
        durationBucket: "100-500ms",
        ok: true,
        isCI: false,
        installHash: INSTALL_HASH,
        runOrdinalBucket: "1",
      },
    ],
    [
      cliErrorPropertiesSchema,
      { errorClass: "unknown_error", command: "compare", agentType: "unknown", inPackage: false },
    ],
    [
      parseFailurePropertiesSchema,
      { agentType: "claude-code", adapterVersion: "1", signatureHash: "c".repeat(64) },
    ],
    [
      receiptGeneratedPropertiesSchema,
      {
        surface: "receipt",
        agentType: "claude-code",
        multiAgent: false,
        outputMode: "text",
        template: "none",
        pricedRowCoverage: "all",
        hasStuckLoopWaste: false,
        hasTrivialSpansWaste: false,
        hasContextThrashWaste: false,
        hasPriceDelta: false,
        hasSubagents: false,
        hasPreEditShare: false,
        turnCountBucket: "1",
        toolCallCountBucket: "2-3",
        receiptOrdinalBucket: "1",
      },
    ],
    [exportGeneratedPropertiesSchema, { surface: "week", format: "json", wroteFile: false, result: "success" }],
    [
      prFlowCompletedPropertiesSchema,
      {
        mode: "dry_run",
        artifactRequested: false,
        shareRequested: false,
        contributorCountBucket: "1",
        commentResult: "skipped",
        artifactResult: "skipped",
        shareResult: "skipped",
        result: "success",
      },
    ],
    [hookConfiguredPropertiesSchema, { operation: "uninstall", promptOutcome: "not_prompted", result: "success" }],
    [
      integrationSurfaceRenderedPropertiesSchema,
      { integration: "quota", inputMode: "none", payloadValid: false, result: "no_data" },
    ],
    [activationMilestonePropertiesSchema, { milestone: "first_run", command: "stats", installAgeBucket: "2-7d" }],
  ] as const;

  it.each([
    ["a raw file path", { path: "/Users/anand/secret-project/main.py" }],
    ["a prompt snippet", { prompt: "write me a function that deletes prod" }],
    ["a repo name", { repo: "altimateai/altimate-backend" }],
    ["a hostname", { hostname: "anand-macbook.local" }],
    ["a username", { username: "anand" }],
    ["a session id", { sessionId: "sess_9f8a7b6c" }],
    ["a dollar amount", { costUsd: "$4.20" }],
    ["a raw model string", { model: "claude-fable-5-20260615" }],
    ["transcript content", { transcript: "user: help me debug this\nassistant: sure" }],
    ["a raw count", { receiptCount: 42 }],
    ["a raw UUID", { installId: "123e4567-e89b-12d3-a456-426614174000" }],
    ["a raw timestamp", { firstRunAt: "2026-07-04T12:34:56.000Z" }],
  ])("rejects %s as an extra property on every schema", (_label, extra) => {
    for (const [schema, valid] of validBySchema) {
      expect(schema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it("rejects a raw UUID in installHash", () => {
    expect(
      cliRunPropertiesSchema.safeParse({
        cliVersion: "0.1.0",
        os: "darwin",
        nodeMajor: 22,
        commandClass: "receipt",
        agentType: "claude-code",
        durationBucket: "100-500ms",
        ok: true,
        isCI: false,
        installHash: "123e4567-e89b-12d3-a456-426614174000",
        runOrdinalBucket: "1",
      }).success,
    ).toBe(false);
  });

  it("validateEvent returns false (never throws) for an unrecognized event name", () => {
    expect(validateEvent({ name: "unknown_event" as never, properties: {} as never })).toBe(false);
  });
});

describe("SPEC-0042 R5 — handoffFormat allowlist", () => {
  const base = {
    cliVersion: "0.1.0",
    os: "linux" as const,
    nodeMajor: 20,
    commandClass: "handoff" as const,
    agentType: "unknown" as const,
    durationBucket: "<100ms" as const,
    ok: true,
    isCI: false,
    installHash: "unavailable" as const,
    runOrdinalBucket: "1" as const,
  };

  it("accepts text/json and absence", () => {
    expect(cliRunPropertiesSchema.safeParse({ ...base, handoffFormat: "text" }).success).toBe(true);
    expect(cliRunPropertiesSchema.safeParse({ ...base, handoffFormat: "json" }).success).toBe(true);
    expect(cliRunPropertiesSchema.safeParse(base).success).toBe(true);
  });

  it("rejects any non-enum value (never content)", () => {
    expect(cliRunPropertiesSchema.safeParse({ ...base, handoffFormat: "markdown" }).success).toBe(false);
    expect(cliRunPropertiesSchema.safeParse({ ...base, handoffFormat: "/home/user/secret" }).success).toBe(false);
  });
});
