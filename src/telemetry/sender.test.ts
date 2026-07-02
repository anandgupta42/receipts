import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetQueueForTests, flushTelemetry, peekQueuedEvents, recordEvent } from "./sender.js";

const VALID_CONN = "InstrumentationKey=abc-123;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";

const SAMPLE_EVENT = {
  name: "cli_run" as const,
  properties: {
    cliVersion: "0.1.0",
    os: "darwin" as const,
    nodeMajor: 22,
    commandClass: "receipt" as const,
    agentType: "claude-code" as const,
    durationBucket: "100-500ms" as const,
    ok: true,
  },
};

describe("R6: no-network proof", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetQueueForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetQueueForTests();
  });

  it("DO_NOT_TRACK=1 results in zero fetch calls, even with a valid connection string and a queued event", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    await flushTelemetry({ env: { DO_NOT_TRACK: "1", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AIRECEIPTS_TELEMETRY=off results in zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    await flushTelemetry({ env: { AIRECEIPTS_TELEMETRY: "off", AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an explicitly empty connection string results in zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    await flushTelemetry({ env: { AIRECEIPTS_TELEMETRY_CONNECTION: "" } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an empty queue never calls fetch, even when telemetry is enabled", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await flushTelemetry({ env: { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("R1: bounded flush", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetQueueForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetQueueForTests();
  });

  it("resolves within the timeout budget even when fetch hangs forever", async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    const start = Date.now();
    await flushTelemetry({ timeoutMs: 300, env: { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });

  it("resolves within the timeout budget even when fetch rejects immediately", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    await expect(flushTelemetry({ timeoutMs: 300, env: { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } })).resolves.toBeUndefined();
  });

  it("drains the queue immediately regardless of how long the send takes", async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    recordEvent(SAMPLE_EVENT);
    expect(peekQueuedEvents()).toHaveLength(1);
    const flush = flushTelemetry({ timeoutMs: 300, env: { AIRECEIPTS_TELEMETRY_CONNECTION: VALID_CONN } });
    expect(peekQueuedEvents()).toHaveLength(0);
    await flush;
  });
});

describe("recordEvent", () => {
  beforeEach(() => {
    __resetQueueForTests();
  });

  it("enqueues a valid event", () => {
    recordEvent(SAMPLE_EVENT);
    expect(peekQueuedEvents()).toEqual([SAMPLE_EVENT]);
  });

  it("silently drops an invalid event rather than enqueuing it partially", () => {
    recordEvent({ name: "cli_run", properties: { ...SAMPLE_EVENT.properties, os: "not-an-os" as never } });
    expect(peekQueuedEvents()).toHaveLength(0);
  });
});
