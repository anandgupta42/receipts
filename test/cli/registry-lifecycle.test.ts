// SPEC-0018 R6: the telemetry lifecycle stays owned by main() — parse → select →
// first-run notice → run → record → bounded flush. These tests spy the telemetry
// seam and drive main() through each outcome (success, nonzero exit, command
// throw, telemetry-show), asserting exactly one run/error event as appropriate,
// the first-run notice skipped only for telemetry-show, and flushTelemetry always
// awaited.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as telemetry from "../../src/telemetry/index.js";
import * as preview from "../../src/receipt/preview.js";
import { main } from "../../src/cli/index.js";

describe("SPEC-0018 R6 · main() telemetry lifecycle", () => {
  let home: string;
  let savedHome: string | undefined;
  let savedProfile: string | undefined;
  let savedTel: string | undefined;
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aireceipts-r6-"));
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }));
    savedHome = process.env.HOME;
    savedProfile = process.env.USERPROFILE;
    savedTel = process.env.AIRECEIPTS_TELEMETRY;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    // Spy the lifecycle seam; recording is a no-op internally (telemetry off) but
    // main() must still call it exactly as the contract requires.
    vi.spyOn(telemetry, "recordCliRun").mockImplementation(() => {});
    vi.spyOn(telemetry, "recordCliError").mockImplementation(() => {});
    vi.spyOn(telemetry, "flushTelemetry").mockResolvedValue(undefined);
    vi.spyOn(telemetry, "ensureFirstRunNotice").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedProfile;
    if (savedTel === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
    else process.env.AIRECEIPTS_TELEMETRY = savedTel;
    rmSync(home, { recursive: true, force: true });
  });

  it("command success → one run event (ok:true), no error event, flush awaited, notice shown", async () => {
    const code = await main(["templates"]);
    expect(code).toBe(0);
    expect(telemetry.recordCliRun).toHaveBeenCalledTimes(1);
    expect(telemetry.recordCliRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "templates", ok: true }),
    );
    expect(telemetry.recordCliError).not.toHaveBeenCalled();
    expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
    expect(telemetry.ensureFirstRunNotice).toHaveBeenCalledTimes(1);
  });

  it("command nonzero exit → one run event (ok:false), no error event, flush awaited", async () => {
    // --template fancy selects the receipt command, which returns 1 on a bad template.
    const code = await main(["--template", "fancy"]);
    expect(code).toBe(1);
    expect(telemetry.recordCliRun).toHaveBeenCalledTimes(1);
    expect(telemetry.recordCliRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "receipt", ok: false }),
    );
    expect(telemetry.recordCliError).not.toHaveBeenCalled();
    expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
  });

  it("command throw → one error event, no run event, flush awaited, exit 1", async () => {
    // Force the templates command to throw from inside its run (previewModel).
    vi.spyOn(preview, "previewModel").mockImplementation(() => {
      throw new Error("boom");
    });
    const code = await main(["templates"]);
    expect(code).toBe(1);
    expect(telemetry.recordCliError).toHaveBeenCalledTimes(1);
    expect(telemetry.recordCliError).toHaveBeenCalledWith(
      expect.objectContaining({ command: "templates" }),
    );
    expect(telemetry.recordCliRun).not.toHaveBeenCalled();
    expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
  });

  it("telemetry-show → run event recorded, flush awaited, first-run notice SKIPPED", async () => {
    const code = await main(["--telemetry-show"]);
    expect(code).toBe(0);
    expect(telemetry.recordCliRun).toHaveBeenCalledTimes(1);
    expect(telemetry.recordCliRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "telemetry-show", ok: true }),
    );
    expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
    // R6: the notice is skipped only for telemetry-show.
    expect(telemetry.ensureFirstRunNotice).not.toHaveBeenCalled();
  });
});
