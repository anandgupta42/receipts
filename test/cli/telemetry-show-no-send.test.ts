// v0.1.0 docs-board BLOCKER: `--telemetry-show` (the command that PREVIEWS what
// telemetry would be sent) must itself send nothing and record nothing — even
// with telemetry fully ENABLED. The existing lifecycle tests ran with
// AIRECEIPTS_TELEMETRY=off, so they never exercised the send path; this test
// enables telemetry with a valid connection string and spies `fetch`.
// SPEC-0002 R5 ("payload printed, nothing sent") is the governing contract.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";

const VALID_CONNECTION =
  "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/";

describe("SPEC-0002 R5 · --telemetry-show sends nothing even with telemetry enabled", () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aireceipts-telshow-"));
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    // Mark the first-run notice already shown so nothing else writes/prompts.
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }));
    for (const k of ["HOME", "USERPROFILE", "AIRECEIPTS_TELEMETRY", "DO_NOT_TRACK", "AIRECEIPTS_TELEMETRY_CONNECTION"]) {
      saved[k] = process.env[k];
    }
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    // Telemetry ON: kill switches cleared, a valid (but unreachable) endpoint set.
    delete process.env.AIRECEIPTS_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    process.env.AIRECEIPTS_TELEMETRY_CONNECTION = VALID_CONNECTION;
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("--telemetry-show fires zero fetch calls (telemetry enabled, valid endpoint)", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const code = await main(["--telemetry-show"]);

    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a normal command WITH telemetry enabled would attempt a send — proving the guard is real, not just an unreachable endpoint", async () => {
    // Sanity: this asserts our on-config actually enables sending, so the
    // telemetry-show zero-call result above is meaningful. `templates` is a
    // trivial always-succeeds command. fetch is stubbed so nothing leaves.
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const code = await main(["templates"]);

    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
