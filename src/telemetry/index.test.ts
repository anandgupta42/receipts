import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  noteReceiptGenerated,
  noteMilestone,
  noteRunStart,
  recordCardGenerated,
  recordCliError,
  recordCliRun,
  recordExportGenerated,
  recordHookConfigured,
  recordIntegrationSurfaceRendered,
  recordParseFailure,
  recordPrFlowCompleted,
  showTelemetryPayload,
  type RecordCliErrorInput,
  type RecordCliRunInput,
  type RecordParseFailureInput,
} from "./index.js";
import { EVENT_NAMES, validateEvent, type TelemetryEvent } from "./schemas.js";
import { __resetQueueForTests, peekQueuedEvents } from "./sender.js";

const VALID_CONN = "InstrumentationKey=abc-123;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";
const HASH = "a".repeat(64);

const RUN_BASE = {
  installHash: HASH,
  runOrdinalBucket: "1",
  isCI: false,
} as const;

let home: string;
let savedHome: string | undefined;

beforeEach(async () => {
  __resetQueueForTests();
  home = await mkdtemp(join(tmpdir(), "aireceipts-telemetry-index-"));
  savedHome = process.env.AIRECEIPTS_HOME;
  process.env.AIRECEIPTS_HOME = home;
});

afterEach(async () => {
  __resetQueueForTests();
  if (savedHome === undefined) delete process.env.AIRECEIPTS_HOME;
  else process.env.AIRECEIPTS_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
});

describe("recordCliRun builds a valid cli_run event from raw runtime inputs", () => {
  it("enqueues one event that passes schema validation", () => {
    const input: RecordCliRunInput = { command: "receipt", agentType: "claude-code", durationMs: 250, ok: true, ...RUN_BASE };
    recordCliRun(input);

    const queued = peekQueuedEvents();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.name).toBe("cli_run");
    expect(validateEvent(queued[0] as TelemetryEvent)).toBe(true);
  });

  it("drops an unknown raw command string rather than queueing it", () => {
    recordCliRun({
      command: "receipt --verbose /Users/anand/secret.json",
      agentType: "claude-code",
      durationMs: 1234,
      ok: false,
      ...RUN_BASE,
    });
    expect(peekQueuedEvents()).toHaveLength(0);
  });
});

describe("SPEC-0042 R5 — handoffFormat pass-through", () => {
  it("records the enum for handoff runs and validates against the strict schema", () => {
    recordCliRun({ command: "handoff", agentType: undefined, durationMs: 10, ok: true, handoffFormat: "json", ...RUN_BASE });
    const [event] = peekQueuedEvents();
    expect((event?.properties as Record<string, unknown>).commandClass).toBe("handoff");
    expect((event?.properties as Record<string, unknown>).handoffFormat).toBe("json");
    expect(validateEvent(event as TelemetryEvent)).toBe(true);
  });

  it("omits the field entirely when not supplied (absent, not null)", () => {
    recordCliRun({ command: "receipt", agentType: undefined, durationMs: 10, ok: true, ...RUN_BASE });
    const [event] = peekQueuedEvents();
    expect("handoffFormat" in (event?.properties as Record<string, unknown>)).toBe(false);
    expect(validateEvent(event as TelemetryEvent)).toBe(true);
  });
});

describe("recordCliError builds a valid cli_error event from raw runtime inputs", () => {
  it("enqueues one event that passes schema validation", () => {
    const input: RecordCliErrorInput = {
      command: "receipt",
      agentType: "codex",
      err: Object.assign(new Error("ENOENT: no such file /Users/anand/x.json"), { code: "ENOENT" }),
    };
    recordCliError(input);

    const queued = peekQueuedEvents();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.name).toBe("cli_error");
    expect(validateEvent(queued[0] as TelemetryEvent)).toBe(true);
  });

  it("never includes the raw error message in the queued event", () => {
    recordCliError({ command: "receipt", agentType: "codex", err: new Error("leaked /path and $99.00") });
    const serialized = JSON.stringify(peekQueuedEvents()[0]);
    expect(serialized).not.toContain("/path");
    expect(serialized).not.toContain("$99.00");
  });
});

describe("recordParseFailure builds a valid parse_failure event and hashes the shape", () => {
  it("enqueues one event that passes schema validation", () => {
    const input: RecordParseFailureInput = { agentType: "cursor", adapterVersion: "1", shape: "cursor:turn.usage.missing" };
    recordParseFailure(input);

    const queued = peekQueuedEvents();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.name).toBe("parse_failure");
    expect(validateEvent(queued[0] as TelemetryEvent)).toBe(true);
  });

  it("never includes the raw shape string in the queued event, only its hash", () => {
    recordParseFailure({ agentType: "cursor", adapterVersion: "1", shape: "a very specific content-free shape descriptor" });
    const serialized = JSON.stringify(peekQueuedEvents()[0]);
    expect(serialized).not.toContain("a very specific content-free shape descriptor");
  });
});

describe("SPEC-0043 recorders", () => {
  it("the public recorders cover every event name", async () => {
    recordCliRun({ command: "receipt", agentType: undefined, durationMs: 10, ok: true, ...RUN_BASE });
    recordCliError({ command: "receipt", agentType: undefined, err: new Error("x") });
    recordParseFailure({ agentType: "claude-code", adapterVersion: "1", shape: "x" });
    await noteReceiptGenerated({
      surface: "receipt",
      agentType: "claude-code",
      multiAgent: false,
      outputMode: "text",
      template: "none",
      pricedRowCoverage: "all",
      hasStuckLoopWaste: false,
      hasTrivialSpansWaste: false,
      hasContextThrashWaste: false,
      hasSubagents: false,
      hasPreEditShare: false,
      hasPriceDelta: false,
      detailsView: false,
      turnCount: 1,
      toolCallCount: 2,
    });
    recordExportGenerated({ surface: "receipt", format: "json", wroteFile: false, result: "success" });
    recordPrFlowCompleted({
      mode: "dry_run",
      artifactRequested: false,
      shareRequested: false,
      contributorCount: 1,
      commentResult: "skipped",
      artifactResult: "skipped",
      shareResult: "skipped",
      handoffSectionIncluded: false,
      result: "success",
    });
    recordHookConfigured({ operation: "install", promptOutcome: "accepted", result: "success" });
    recordIntegrationSurfaceRendered({
      integration: "statusline",
      inputMode: "stdin_payload",
      payloadValid: true,
      result: "success",
      customFormat: false,
      scoped: true,
      configFile: true,
    });
    recordCardGenerated({ scope: "session", theme: "light", format: "png", linkIncluded: false, clipboardImageCopied: true });

    const names = peekQueuedEvents().map((e) => e.name);
    expect(new Set(names)).toEqual(new Set(EVENT_NAMES));
    for (const event of peekQueuedEvents()) {
      expect(validateEvent(event)).toBe(true);
    }
  });

  it("recordReceiptGenerated uses buckets only, never raw counts", async () => {
    await noteReceiptGenerated({
      surface: "receipt",
      agentType: "claude-code",
      multiAgent: false,
      outputMode: "text",
      template: "none",
      pricedRowCoverage: "some",
      hasStuckLoopWaste: true,
      hasTrivialSpansWaste: false,
      hasContextThrashWaste: true,
      hasSubagents: false,
      hasPreEditShare: false,
      hasPriceDelta: true,
      detailsView: false,
      turnCount: 7,
      toolCallCount: 60,
    });
    const serialized = JSON.stringify(peekQueuedEvents());
    expect(serialized).toContain('"turnCountBucket":"4-10"');
    expect(serialized).toContain('"toolCallCountBucket":">50"');
    expect(serialized).not.toContain('"turnCount":7');
    expect(serialized).not.toContain('"toolCallCount":60');
  });
});

describe("SPEC-0043 noteRunStart", () => {
  it("returns a 64-hex install hash when telemetry is enabled", async () => {
    const result = await noteRunStart("receipt", { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }, Date.UTC(2026, 6, 4));
    expect(result.installHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runOrdinalBucket).toBe("1");
    expect(result.isCI).toBe(false);
  });

  it("does not create an install hash under a kill switch", async () => {
    const result = await noteRunStart("receipt", { DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }, Date.UTC(2026, 6, 4));
    expect(result.installHash).toBe("unavailable");
  });

  it("records the first_run activation milestone only once", async () => {
    const env = { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN };

    await noteRunStart("receipt", env, Date.UTC(2026, 6, 4));
    await noteRunStart("receipt", env, Date.UTC(2026, 6, 4));

    const milestones = peekQueuedEvents().filter((event) => event.name === "activation_milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]?.properties).toMatchObject({
      milestone: "first_run",
      command: "receipt",
      installAgeBucket: "first_day",
    });
  });

  it("records named activation milestones only once", async () => {
    await noteRunStart("receipt", { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN }, Date.UTC(2026, 6, 4));
    __resetQueueForTests();

    await noteMilestone("first_export", "receipt", Date.UTC(2026, 6, 4));
    await noteMilestone("first_export", "receipt", Date.UTC(2026, 6, 4));

    const milestones = peekQueuedEvents().filter((event) => event.name === "activation_milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]?.properties).toMatchObject({
      milestone: "first_export",
      command: "receipt",
      installAgeBucket: "first_day",
    });
  });
});

describe("showTelemetryPayload: R5 --telemetry-show backing function", () => {
  it("reports disabled with an empty queue when the connection string is explicitly empty", () => {
    const result = showTelemetryPayload({ AIRECEIPTS_TELEMETRY_CONNECTION: "" });
    expect(result).toEqual({ enabled: false, events: [] });
  });

  it("reports enabled and returns the queued (unsent) events without sending them", () => {
    recordCliRun({ command: "receipt", agentType: "claude-code", durationMs: 10, ok: true, ...RUN_BASE });
    const result = showTelemetryPayload({ AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });

    expect(result.enabled).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(peekQueuedEvents()).toHaveLength(1);
  });

  it("respects the kill switches", () => {
    recordCliRun({ command: "receipt", agentType: "claude-code", durationMs: 10, ok: true, ...RUN_BASE });
    const result = showTelemetryPayload({ DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(result.enabled).toBe(false);
  });
});
