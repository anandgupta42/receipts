// SPEC-0043 R3/R8 — command-path proof: a real receipt render through main()
// queues one receipt_generated event with bounded fields (S5 review finding 4:
// recorder unit tests alone don't prove commands actually fire them). Only the
// flush is stubbed, so the queue can be inspected after main() returns.
//
// Home isolation happens in the hoisted node:os mock, not in beforeEach: vitest
// workers can't propagate a process.env.HOME mutation into the native environ
// os.homedir() reads (the notice.ts lesson), and adapters capture their roots
// at module load — so the temp home must exist, and be the mocked homedir,
// before the src/ module graph evaluates. Without this, discovery scans the
// REAL home: silently green against a dev machine's transcripts, exit 1 on CI.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const savedEnv = vi.hoisted(() => {
  const keys = ["HOME", "USERPROFILE", "LOCALAPPDATA", "AIRECEIPTS_HOME", "AIRECEIPTS_TELEMETRY"] as const;
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(actual.tmpdir(), "aireceipts-cmdpath-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, "AppData", "Local");
  process.env.AIRECEIPTS_HOME = home;
  process.env.AIRECEIPTS_TELEMETRY = "off";
  return { ...actual, homedir: () => home };
});

import * as telemetry from "../../src/telemetry/index.js";
import { peekQueuedEvents, __resetQueueForTests } from "../../src/telemetry/sender.js";
import { validateEvent, RECEIPT_SURFACE_VALUES, COUNT_BUCKET_VALUES, ORDINAL_BUCKET_VALUES, type TelemetryEvent } from "../../src/telemetry/schemas.js";
import { main } from "../../src/cli/index.js";

const fixturesDir = resolve(__dirname, "..", "fixtures");

function opencodeRoot(home: string): string {
  return process.platform === "win32" ? join(home, "AppData", "Local", "opencode") : join(home, ".local", "share", "opencode");
}

describe("SPEC-0043 command-path telemetry", () => {
  const home = homedir(); // the mocked, factory-created temp home
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;

  beforeEach(() => {
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }));
    mkdirSync(opencodeRoot(home), { recursive: true });
    copyFileSync(join(fixturesDir, "opencode", "clean-multi-vendor.db"), join(opencodeRoot(home), "opencode.db"));
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    __resetQueueForTests();
    vi.spyOn(telemetry, "flushTelemetry").mockResolvedValue(undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetQueueForTests();
    rmSync(home, { recursive: true, force: true });
  });

  it("a default receipt render queues one valid, bucket-only receipt_generated event", async () => {
    const code = await main([]);
    expect(code).toBe(0);

    const events = peekQueuedEvents();
    const receipts = events.filter((e) => e.name === "receipt_generated");
    expect(receipts).toHaveLength(1);
    const event = receipts[0] as TelemetryEvent;
    expect(validateEvent(event)).toBe(true);

    const props = event.properties as Record<string, unknown>;
    expect(RECEIPT_SURFACE_VALUES).toContain(props.surface);
    expect(props.surface).toBe("receipt");
    // Pins the event to the staged fixture — a discovery escape into a real
    // home renders some other agent's session and fails here, loudly.
    expect(props.agentType).toBe("opencode");
    expect(props.outputMode).toBe("text");
    expect(COUNT_BUCKET_VALUES).toContain(props.turnCountBucket);
    expect(COUNT_BUCKET_VALUES).toContain(props.toolCallCountBucket);
    expect(ORDINAL_BUCKET_VALUES).toContain(props.receiptOrdinalBucket);
    // Bounded by construction: every value is a boolean or an enum string — no
    // raw numbers, no free text, nothing resembling a path or a dollar figure.
    for (const value of Object.values(props)) {
      expect(["boolean", "string"]).toContain(typeof value);
      if (typeof value === "string") {
        expect(value).not.toMatch(/[/\\$]/);
      }
    }

    const runs = events.filter((e) => e.name === "cli_run");
    expect(runs).toHaveLength(1);
    expect((runs[0].properties as Record<string, unknown>).commandClass).toBe("receipt");
  });
});
