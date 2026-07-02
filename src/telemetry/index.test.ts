import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordCliError,
  recordCliRun,
  recordParseFailure,
  showTelemetryPayload,
  type RecordCliErrorInput,
  type RecordCliRunInput,
  type RecordParseFailureInput,
} from "./index.js";
import { EVENT_NAMES, validateEvent, type TelemetryEvent } from "./schemas.js";
import { __resetQueueForTests, peekQueuedEvents } from "./sender.js";

const VALID_CONN = "InstrumentationKey=abc-123;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";

beforeEach(() => {
  __resetQueueForTests();
});

afterEach(() => {
  __resetQueueForTests();
});

describe("recordCliRun builds a valid cli_run event from raw runtime inputs", () => {
  it("enqueues one event that passes schema validation", () => {
    const input: RecordCliRunInput = { command: "receipt", agentType: "claude-code", durationMs: 250, ok: true };
    recordCliRun(input);

    const queued = peekQueuedEvents();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.name).toBe("cli_run");
    expect(validateEvent(queued[0] as TelemetryEvent)).toBe(true);
  });

  it("never includes the raw command string or raw duration in the queued event", () => {
    recordCliRun({ command: "receipt --verbose /Users/anand/secret.json", agentType: "claude-code", durationMs: 1234, ok: false });
    const [event] = peekQueuedEvents();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("/Users/anand/secret.json");
    expect(serialized).not.toContain("1234");
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

describe("R2: exactly three event names, exhaustively, via the public recorder functions", () => {
  it("recordCliRun, recordCliError, and recordParseFailure together cover every name in EVENT_NAMES", () => {
    recordCliRun({ command: "receipt", agentType: undefined, durationMs: 10, ok: true });
    recordCliError({ command: "receipt", agentType: undefined, err: new Error("x") });
    recordParseFailure({ agentType: "claude-code", adapterVersion: "1", shape: "x" });

    const names = peekQueuedEvents().map((e) => e.name);
    expect(new Set(names)).toEqual(new Set(EVENT_NAMES));
  });
});

describe("showTelemetryPayload: R5 --telemetry-show backing function", () => {
  it("reports disabled with an empty queue when the connection string is explicitly empty", () => {
    const result = showTelemetryPayload({ AIRECEIPTS_TELEMETRY_CONNECTION: "" });
    expect(result).toEqual({ enabled: false, events: [] });
  });

  it("reports enabled and returns the queued (unsent) events without sending them", () => {
    recordCliRun({ command: "receipt", agentType: "claude-code", durationMs: 10, ok: true });
    const result = showTelemetryPayload({ AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });

    expect(result.enabled).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(peekQueuedEvents()).toHaveLength(1);
  });

  it("respects the kill switches", () => {
    recordCliRun({ command: "receipt", agentType: "claude-code", durationMs: 10, ok: true });
    const result = showTelemetryPayload({ DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN });
    expect(result.enabled).toBe(false);
  });
});
