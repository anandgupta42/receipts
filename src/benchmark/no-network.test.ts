import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptModel } from "../receipt/model.js";
import { BENCHMARK_UNAVAILABLE_MESSAGE, buildBenchmarkPayload, confirmPrompt, isBenchmarkServiceAvailable } from "./index.js";

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

const SAMPLE_MODEL: ReceiptModel = {
  agentLabel: "Claude Code",
  source: "claude-code",
  sessionId: "sess-1",
  modelMix: [],
  toolRows: [],
  totalUsd: 0.42,
  totalTokens: EMPTY_USAGE,
  sessionTotalTokens: EMPTY_USAGE,
  wasteLines: [],
  caveats: [],
  priceDelta: null,
  methodology: "",
  priceRowsUsed: [],
  unpriceable: false,
  costLowerBoundCacheTier: false,
};

function inputStream(line: string): Readable {
  return Readable.from([`${line}\n`]);
}

function sinkStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

/**
 * R1/R6 no-network proof: every v1 code path `runBenchmark` (src/cli/index.ts)
 * composes from this module's public surface — decline, accept-with-no-server,
 * and --dry-run — must make zero `fetch` calls. Mirrors
 * src/telemetry/sender.test.ts's "R6: no-network proof" pattern.
 */
describe("R1/R6: benchmark module makes zero fetch calls", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("decline path (user answers 'n') calls no fetch", async () => {
    const consented = await confirmPrompt("Send?", inputStream("n"), sinkStream());
    expect(consented).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("accept path with no server configured builds a payload, reports unavailable, and calls no fetch", async () => {
    const consented = await confirmPrompt("Send?", inputStream("y"), sinkStream());
    expect(consented).toBe(true);

    const payload = buildBenchmarkPayload(SAMPLE_MODEL, 5);
    expect(payload.name).toBe("benchmark_run");

    expect(isBenchmarkServiceAvailable()).toBe(false);
    expect(BENCHMARK_UNAVAILABLE_MESSAGE).toBe("benchmark service not yet available");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("--dry-run path (payload built without prompting) calls no fetch", async () => {
    const payload = buildBenchmarkPayload(SAMPLE_MODEL, 5);
    expect(payload.properties.agentType).toBe("claude-code");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("isBenchmarkServiceAvailable() is a static false, structurally incapable of a network round trip", () => {
    expect(isBenchmarkServiceAvailable()).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
