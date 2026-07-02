// SPEC-0006 CLI surface: arg parsing for the three new commands, and the R6
// fail-safe guarantee that `--mini` (the hook-invoked path) can never return a
// non-zero exit or throw, even with no session data on disk.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { main } from "../../src/cli/index.js";

describe("parseArgs (new commands)", () => {
  it("--mini → mini command, carrying an optional selector", () => {
    expect(parseArgs(["--mini"]).command).toBe("mini");
    expect(parseArgs(["--mini", "3"]).selector).toBe("3");
  });

  it("install-hook / uninstall-hook positionals map to their commands", () => {
    expect(parseArgs(["install-hook"]).command).toBe("install-hook");
    expect(parseArgs(["uninstall-hook"]).command).toBe("uninstall-hook");
  });

  it("--help still wins over everything (unchanged)", () => {
    expect(parseArgs(["--mini", "--help"]).command).toBe("help");
  });
});

describe("--mini fail-safe (R6)", () => {
  it("exits 0 even when no agent session data exists", async () => {
    // Point every adapter root at an empty temp HOME so nothing is detected.
    const emptyHome = mkdtempSync(join(tmpdir(), "aireceipts-empty-home-"));
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    process.env.HOME = emptyHome;
    process.env.USERPROFILE = emptyHome;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    try {
      const code = await main(["--mini"]);
      expect(code).toBe(0);
    } finally {
      process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
      if (savedTelemetry === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
      else process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
    }
  });
});

describe("install-hook consent on EOF / no TTY (R1)", () => {
  it("defaults to No — exits 0, writes nothing, never hangs on closed stdin", () => {
    const dir = mkdtempSync(join(tmpdir(), "aireceipts-eof-"));
    // Real CLI entry via tsx, empty stdin (immediate EOF), isolated config dir.
    const res = spawnSync("npx", ["tsx", "src/cli.ts", "install-hook"], {
      input: "",
      timeout: 30_000,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, AIRECEIPTS_TELEMETRY: "off" },
    });
    expect(res.error).toBeUndefined(); // no timeout kill => did not hang
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No changes made.");
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });
});
